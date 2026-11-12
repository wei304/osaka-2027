-- Additive bounded favorite tasks; isolated tests only until deployment approval.
begin;
create table if not exists private.favorite_bulk_tasks(
 id uuid primary key,created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '2 hours',
 state text not null default 'preview' check(state in ('preview','running','paused','stopped','review','expired')),
 items jsonb not null,guard text not null,request_hash text not null,cap_cny numeric not null default 0,cap_requests int not null default 0,
 policy_version int,executor uuid,executor_session bytea,lease_until timestamptz,pending uuid,
 done jsonb not null default '[]',reviewed jsonb not null default '[]',skipped jsonb not null default '[]',error text
);
create index if not exists favorite_bulk_tasks_created on private.favorite_bulk_tasks(created_at desc);
create table if not exists private.favorite_bulk_batches(operation uuid primary key references private.favorite_ai_jobs(operation),task_id uuid not null references private.favorite_bulk_tasks(id));
create index if not exists favorite_bulk_batches_task on private.favorite_bulk_batches(task_id);
create table if not exists private.favorite_bulk_reviews(operation uuid primary key,task_id uuid not null references private.favorite_bulk_tasks(id),request_hash text not null,response jsonb not null,created_at timestamptz not null default now());
alter table private.favorite_bulk_tasks enable row level security;
alter table private.favorite_bulk_batches enable row level security;
alter table private.favorite_bulk_reviews enable row level security;
revoke all on private.favorite_bulk_tasks,private.favorite_bulk_batches,private.favorite_bulk_reviews from public,anon,authenticated;
do $$begin
 if to_regprocedure('private.favorite_ai_plan_single()') is null then alter function private.favorite_ai_plan() rename to favorite_ai_plan_single;end if;
 if to_regprocedure('private.favorite_ai_request_single(text,jsonb)') is null then alter function private.favorite_ai_request(text,jsonb) rename to favorite_ai_request_single;end if;
end$$;
-- A transaction-local server-only override lets the original prepare use a fixed <=5 set.
create or replace function private.favorite_ai_plan() returns jsonb language plpgsql stable set search_path='' as $$
declare x jsonb;begin
 if coalesce(current_setting('osaka.bulk_items',true),'')='' then return private.favorite_ai_plan_single();end if;
 x:=current_setting('osaka.bulk_items',true)::jsonb;
 return jsonb_build_object('items',x,'guard',private.favorite_ai_guard(x));
end$$;
create or replace function private.favorite_bulk_view(t private.favorite_bulk_tasks) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',t.id,'state',case when t.expires_at<now() then 'expired' else t.state end,'expiresAt',t.expires_at,'leaseUntil',t.lease_until,'guard',t.guard,'items',t.items,'done',t.done,'reviewed',t.reviewed,'skipped',t.skipped,'pending',t.pending,'error',t.error,'capCny',t.cap_cny,'capRequests',t.cap_requests,
 'requests',count(u.id),'chargedCny',coalesce(sum(u.charged_cny),0),'reservedCny',coalesce(sum(u.reserved_cny) filter(where u.status in ('pending','failed')),0),'actualCny',coalesce(sum(u.charged_cny) filter(where u.status='done'),0),
 'batches',coalesce(jsonb_agg(jsonb_build_object('operation',job.operation,'status',job.status,'error',job.error,'result',job.result,'items',job.items)) filter(where job.operation is not null),'[]'))
 from private.favorite_bulk_batches b join private.favorite_ai_jobs job on job.operation=b.operation left join private.ai_usage u on u.id=job.request_id where b.task_id=t.id;
$$;
create or replace function private.favorite_ai_request(p_action text,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t private.favorite_bulk_tasks;p private.favorite_places;i jsonb;r jsonb;s jsonb;items jsonb:='[]';batch jsonb:='[]';check_r jsonb;j private.favorite_ai_jobs;v jsonb;entry jsonb;old jsonb;resp jsonb;prior private.favorite_bulk_reviews;
 tok text;th bytea;op uuid;tid uuid;ex uuid;h text;mode text;count_all int:=0;models int:=0;caches int:=0;rules int:=0;max_cost numeric;spent numeric;reqs int;reg text;d date;allowed boolean;
begin
 if p_action not like 'bulk_%' then
  if p_action='plan' then r:=private.favorite_ai_request_single(p_action,p_body);if r ? 'status' then return r;end if;return jsonb_set(r,'{jobs}',coalesce((select jsonb_agg(x) from jsonb_array_elements(r->'jobs')x where not exists(select 1 from private.favorite_bulk_batches b where b.operation=(x->>'operation')::uuid)),'[]'));end if;
  if p_action in ('confirm','discard') and exists(select 1 from private.favorite_bulk_batches where operation=(p_body->>'operation')::uuid) then return jsonb_build_object('status',409,'error','bulk_review_required');end if;
  return private.favorite_ai_request_single(p_action,p_body);
 end if;
 if p_body is null or jsonb_typeof(p_body)<>'object' or length(p_body::text)>100000 then return jsonb_build_object('status',400,'error','invalid_request');end if;
 tok:=p_body->>'token';th:=extensions.digest(tok,'sha256');
 -- This call takes the same shared gate lock used by edits, imports and the original AI chain.
 check_r:=private.favorite_request('rows',jsonb_build_object('token',tok));if check_r ? 'status' then return check_r;end if;
 if p_action='bulk_list' then
  return jsonb_build_object('tasks',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'state',case when x.expires_at<now() then 'expired' else x.state end,'createdAt',x.created_at,'total',jsonb_array_length(x.items))) from (select * from private.favorite_bulk_tasks order by created_at desc limit 20)x),'[]'));
 end if;
 tid:=(p_body->>'taskId')::uuid;if tid is null then return jsonb_build_object('status',400,'error','invalid_request');end if;
 select * into t from private.favorite_bulk_tasks where id=tid for update;
 if p_action='bulk_preview' then
  mode:=p_body->>'mode';if mode is null or mode not in ('pending','new','changed','region','selected') then return jsonb_build_object('status',400,'error','invalid_scope');end if;
  if mode='selected' and (jsonb_typeof(p_body->'ids') is distinct from 'array' or jsonb_array_length(p_body->'ids') not between 1 and 150 or (select count(distinct x) from jsonb_array_elements(p_body->'ids')x)<>jsonb_array_length(p_body->'ids')) then return jsonb_build_object('status',400,'error','invalid_scope');end if;
  if mode='region' and coalesce(length(trim(p_body->>'region')),0) not between 1 and 80 then return jsonb_build_object('status',400,'error','invalid_scope');end if;
  h:=md5((p_body-'token')::text);
  if t.id is not null then if t.request_hash<>h then return jsonb_build_object('status',409,'error','operation_reused');end if;return private.favorite_bulk_view(t);end if;
  for p in select * from private.favorite_places where not archived order by id loop
   i:=private.favorite_ai_input(p);if p.ai_fingerprint=i->>'fingerprint' then continue;end if;
   if mode='new' and p.ai_fingerprint is not null then continue;end if;
   if mode='changed' and p.ai_fingerprint is null then continue;end if;
   if mode='selected' and not(p_body->'ids' ? p.id::text) then continue;end if;
   if mode='region' and i->>'region' is distinct from p_body->>'region' then continue;end if;
   items:=items||jsonb_build_array(i);count_all:=count_all+1;
  end loop;
  if count_all>150 then return jsonb_build_object('status',400,'error','scope_too_large');end if;
  if count_all=0 then return jsonb_build_object('status',400,'error','nothing_to_classify');end if;
  insert into private.favorite_bulk_tasks(id,items,guard,request_hash) values(tid,items,private.favorite_ai_guard(items),h) returning * into t;
 elsif t.id is null then return jsonb_build_object('status',404,'error','bulk_not_found');end if;
 if p_action in ('bulk_preview','bulk_status') then
  -- No model calls on recovery. A lost batch stays the SAME UUID, including after lease expiry.
  if t.pending is not null then
   select * into j from private.favorite_ai_jobs where operation=t.pending;
   if j.status='pending' and j.created_at<now()-interval '90 seconds' then
    update private.ai_usage set status='failed',snapshot='[]' where id=j.request_id and status='pending';
    update private.favorite_ai_jobs set status='failed',error='request_expired' where operation=j.operation returning * into j;
   end if;
   if j.status in ('ready','failed') then
    update private.favorite_bulk_tasks set pending=null,done=done||(select coalesce(jsonb_agg(x->>'id'),'[]') from jsonb_array_elements(j.items)x),skipped=skipped||case when j.status='failed' then (select jsonb_agg(x->>'id') from jsonb_array_elements(j.items)x) else '[]'::jsonb end,state=case when j.status='failed' then 'paused' else state end,error=case when j.status='failed' then j.error else error end where id=tid returning * into t;
   end if;
  end if;
  if jsonb_array_length(t.done)=jsonb_array_length(t.items) and t.state='running' then update private.favorite_bulk_tasks set state='review',executor=null,lease_until=null where id=tid returning * into t;end if;
  if t.state='running' and t.lease_until<now() and t.pending is null then update private.favorite_bulk_tasks set state='paused',executor=null,lease_until=null where id=tid returning * into t;end if;
  s:=private.ai_trip_request('status',jsonb_build_object('token',tok));select 16000*max_price_per_million_cny/1000000 into max_cost from private.ai_policy where id=true;
  select count(*) filter(where x->'needsAI'='true'::jsonb),count(*) filter(where x->'cached'<>'null'::jsonb),count(*) filter(where x->'needsAI'='false'::jsonb and x->'cached'='null'::jsonb) into models,caches,rules from jsonb_array_elements(t.items)x;
  return private.favorite_bulk_view(t)||jsonb_build_object('policy',s,'maxBatchReservationCny',max_cost,'modelPlaces',models,'cachedPlaces',caches,'rulePlaces',rules,'estimatedBatches',ceil(jsonb_array_length(t.items)/5.0),'remainingRequests',greatest(0,(s->>'dailyRequests')::int-(s->>'todayRequests')::int),'remainingTokens',(select greatest(0,(s->>'dailyTokens')::int-coalesce(sum(charged_tokens),0)) from private.ai_usage where (created_at at time zone 'Asia/Tokyo')::date=(now() at time zone 'Asia/Tokyo')::date),'remainingCny',greatest(0,(s->>'dailyBudgetCny')::numeric-(s->>'usedCny')::numeric));
 end if;
 if p_action='bulk_stop' then update private.favorite_bulk_tasks set state='stopped',executor=null,lease_until=null where id=tid returning * into t;return private.favorite_bulk_view(t);end if;
 if t.expires_at<now() and p_action not in ('bulk_finish','bulk_fail','bulk_confirm') then return jsonb_build_object('status',409,'error','bulk_expired');end if;
 ex:=(p_body->>'executor')::uuid;
 if p_action in ('bulk_authorize','bulk_resume') then
  if p_body->'confirmed' is distinct from 'true'::jsonb or p_body->'automatic' is distinct from 'true'::jsonb or ex is null then return jsonb_build_object('status',400,'error','consent_required');end if;
  if t.executor is not null and t.lease_until>now() and (t.executor<>ex or t.executor_session<>th) then return jsonb_build_object('status',409,'error','bulk_executor_busy');end if;
  if exists(select 1 from private.favorite_bulk_tasks where id<>tid and state in ('running','paused') and expires_at>now()) then return jsonb_build_object('status',409,'error','bulk_task_active');end if;
  if t.state not in ('preview','paused','running') then return jsonb_build_object('status',409,'error','bulk_not_resumable');end if;
  if p_action='bulk_authorize' then
   if t.state<>'preview' or p_body->>'guard' is distinct from t.guard or jsonb_typeof(p_body->'capCny') is distinct from 'number' or (p_body->>'capCny')::numeric not between 0 and 10 or jsonb_typeof(p_body->'capRequests') is distinct from 'number' or (p_body->>'capRequests')::numeric<>(p_body->>'capRequests')::int or (p_body->>'capRequests')::int not between 0 and 100 then return jsonb_build_object('status',400,'error','invalid_authorization');end if;
   update private.favorite_bulk_tasks set cap_cny=(p_body->>'capCny')::numeric,cap_requests=(p_body->>'capRequests')::int,policy_version=(select budget_version from private.ai_policy where id=true) where id=tid;
  end if;
  if t.error is not null and p_body->'acknowledgeFailure' is distinct from 'true'::jsonb then return jsonb_build_object('status',409,'error','bulk_failure_needs_review');end if;
  update private.favorite_bulk_tasks set state='running',executor=ex,executor_session=th,lease_until=now()+interval '120 seconds',error=null where id=tid returning * into t;return private.favorite_bulk_view(t);
 end if;
 if p_action='bulk_pause' then
  if t.executor is distinct from ex or t.executor_session is distinct from th then return jsonb_build_object('status',409,'error','bulk_executor_busy');end if;
  update private.favorite_bulk_tasks set state='paused',executor=null,lease_until=null where id=tid returning * into t;return private.favorite_bulk_view(t);
 end if;
 if p_action in ('bulk_next','bulk_prepare') then
  op:=(p_body->>'operation')::uuid;
  if op is null then return jsonb_build_object('status',400,'error','invalid_request');end if;
  if exists(select 1 from private.favorite_ai_jobs where operation=op) and not exists(select 1 from private.favorite_bulk_batches where operation=op and task_id=tid) then return jsonb_build_object('status',409,'error','operation_reused');end if;
  if t.state<>'running' or t.executor is distinct from ex or t.executor_session is distinct from th or t.lease_until<now() then return jsonb_build_object('status',409,'error','bulk_executor_busy');end if;
  if t.pending is not null then return jsonb_build_object('status',409,'error','bulk_recover_first');end if;
  for i in select value from jsonb_array_elements(t.items) order by (value->>'needsAI')::boolean,value->>'id' loop
   if t.done ? (i->>'id') then continue;end if;
   select * into p from private.favorite_places where id=(i->>'id')::uuid;
   r:=private.favorite_ai_input(p);
   if p.id is null or p.archived or r->>'fingerprint' is distinct from i->>'fingerprint' or p.version is distinct from (i->>'version')::int then return jsonb_build_object('status',409,'error','draft_stale');end if;
   batch:=batch||jsonb_build_array(r);if jsonb_array_length(batch)=5 then exit;end if;
  end loop;
  if jsonb_array_length(batch)=0 then update private.favorite_bulk_tasks set state='review',executor=null,lease_until=null where id=tid;return jsonb_build_object('noWork',true);end if;
  -- Rules and cache first, including caches completed since the authorization snapshot.
  select coalesce(jsonb_agg(x order by (x->>'needsAI')::boolean,x->>'id'),'[]') into batch from jsonb_array_elements(batch)x;
  if p_action='bulk_next' then return jsonb_build_object('items',batch,'guard',private.favorite_ai_guard(batch));end if;
  if p_body->>'guard' is distinct from private.favorite_ai_guard(batch) then return jsonb_build_object('status',409,'error','draft_stale');end if;
  s:=private.ai_trip_request('status',jsonb_build_object('token',tok));
  if s->>'currency' is distinct from 'CNY' then return jsonb_build_object('status',409,'error','bulk_currency_unsupported');end if;
  if t.policy_version is distinct from (s->>'budgetVersion')::int then return jsonb_build_object('status',409,'error','budget_changed');end if;
  select 16000*max_price_per_million_cny/1000000 into max_cost from private.ai_policy where id=true;
  select coalesce(sum(u.charged_cny),0),count(u.id) into spent,reqs from private.favorite_bulk_batches b join private.favorite_ai_jobs job on job.operation=b.operation left join private.ai_usage u on u.id=job.request_id where b.task_id=tid;
  if exists(select 1 from jsonb_array_elements(batch)x where x->'needsAI'='true'::jsonb) and (spent+max_cost>t.cap_cny or reqs>=t.cap_requests) then update private.favorite_bulk_tasks set state='paused',error='bulk_budget_limit',executor=null,lease_until=null where id=tid;return jsonb_build_object('status',409,'error','bulk_budget_limit');end if;
  op:=(p_body->>'operation')::uuid;
  perform set_config('osaka.bulk_items',batch::text,true);
  r:=private.favorite_ai_request_single('prepare',p_body||jsonb_build_object('guard',private.favorite_ai_guard(batch)));
  perform set_config('osaka.bulk_items','',true);if r ? 'status' then update private.favorite_bulk_tasks set state='paused',error=r->>'error',executor=null,lease_until=null where id=tid;return r;end if;
  insert into private.favorite_bulk_batches values(op,tid);
  update private.favorite_bulk_tasks set pending=op,lease_until=now()+interval '120 seconds' where id=tid;
  return r;
 end if;
 if p_action in ('bulk_finish','bulk_fail') then
  op:=(p_body->>'operation')::uuid;
  if not exists(select 1 from private.favorite_bulk_batches where operation=op and task_id=tid) then return jsonb_build_object('status',404,'error','favorite_ai_not_found');end if;
  return private.favorite_ai_request_single(case when p_action='bulk_finish' then 'finish' else 'fail' end,p_body);
 end if;
 if p_action='bulk_confirm' then
  op:=(p_body->>'operation')::uuid;h:=md5((p_body-'token')::text);select * into prior from private.favorite_bulk_reviews where operation=op;
  if found then if prior.task_id<>tid or prior.request_hash<>h then return jsonb_build_object('status',409,'error','operation_reused');end if;return prior.response;end if;
  if t.expires_at<now() then return jsonb_build_object('status',409,'error','bulk_expired');end if;
  if exists(select 1 from private.favorite_revisions where operation=op) or exists(select 1 from private.favorite_ai_jobs where operation=op) then return jsonb_build_object('status',409,'error','operation_reused');end if;
  if p_body->'confirmed' is distinct from 'true'::jsonb or jsonb_typeof(p_body->'entries') is distinct from 'array' or jsonb_array_length(p_body->'entries') not between 1 and 50 or (select count(distinct x->>'id') from jsonb_array_elements(p_body->'entries')x)<>jsonb_array_length(p_body->'entries') then return jsonb_build_object('status',400,'error','confirmation_required');end if;
  -- Validate ALL selected rows before ANY writes. Invalid/stale selection rolls back as a unit.
  for entry in select value from jsonb_array_elements(p_body->'entries') loop
   select x into i from jsonb_array_elements(t.items)x where x->>'id'=entry->>'id';
   if i is null or t.reviewed ? (entry->>'id') or not exists(select 1 from private.favorite_bulk_batches b join private.favorite_ai_jobs job on b.operation=job.operation cross join lateral jsonb_array_elements(job.result)x where b.task_id=tid and job.status='ready' and x->>'id'=entry->>'id') then return jsonb_build_object('status',409,'error','bulk_not_reviewable');end if;
   select * into p from private.favorite_places where id=(entry->>'id')::uuid;
   if p.version is distinct from (i->>'version')::int or (private.favorite_ai_input(p))->>'fingerprint' is distinct from i->>'fingerprint' then return jsonb_build_object('status',409,'error','draft_stale');end if;
   if entry-array['id','type','days']<>'{}'::jsonb or entry->>'type' not in ('餐厅','咖啡厅 / 甜品','景点','购物','娱乐体验','交通','其他') or entry->>'type' is null or jsonb_typeof(entry->'days') is distinct from 'array' or exists(select 1 from jsonb_array_elements(entry->'days')x where jsonb_typeof(x)<>'string' or not(i->'eligibleDays' ? (x#>>'{}'))) or (select count(distinct x) from jsonb_array_elements(entry->'days')x)<>jsonb_array_length(entry->'days') then return jsonb_build_object('status',422,'error','invalid_favorite_ai_output');end if;
  end loop;
  for entry in select value from jsonb_array_elements(p_body->'entries') loop
   select x into i from jsonb_array_elements(t.items)x where x->>'id'=entry->>'id';select * into p from private.favorite_places where id=(entry->>'id')::uuid;
   old:=to_jsonb(p)||jsonb_build_object('day_links',coalesce((select jsonb_agg(to_jsonb(l)) from private.favorite_day_links l where place_id=p.id),'[]'));
   allowed:=p.manual_fields->'days' is distinct from 'true'::jsonb and (p.ai_day_managed or not exists(select 1 from private.favorite_day_links where place_id=p.id));
   if allowed then for d in select value::date from jsonb_array_elements_text(entry->'days') loop insert into private.favorite_day_links(place_id,day) values(p.id,d) on conflict(place_id,day) do update set active=true,version=private.favorite_day_links.version+1 where not private.favorite_day_links.active;end loop;end if;
   update private.favorite_places set place_type=case when manual_fields->'type'='true'::jsonb then place_type else entry->>'type' end,ai_fingerprint=i->>'fingerprint',ai_reason='有限批次建议已人工审核；地区依据保持原样。',ai_day_managed=ai_day_managed or allowed,version=version+1,updated_at=now() where id=p.id returning * into p;
   insert into private.favorite_revisions(place_id,operation,request_hash,action,before_data,after_data,version) values(p.id,op,h,'ai_bulk_confirm',old,to_jsonb(p)||jsonb_build_object('day_links',coalesce((select jsonb_agg(to_jsonb(l)) from private.favorite_day_links l where place_id=p.id),'[]')),p.version);
   update private.favorite_bulk_tasks set reviewed=reviewed||jsonb_build_array(p.id::text) where id=tid;
  end loop;
  resp:=jsonb_build_object('ok',true,'places',jsonb_array_length(p_body->'entries'));insert into private.favorite_bulk_reviews values(op,tid,h,resp,now());return resp;
 end if;
 return jsonb_build_object('status',400,'error','invalid_action');
exception when invalid_text_representation or numeric_value_out_of_range or not_null_violation or check_violation or unique_violation then return jsonb_build_object('status',400,'error','invalid_request');
end$$;
revoke all on function private.favorite_ai_plan(),private.favorite_ai_plan_single(),private.favorite_bulk_view(private.favorite_bulk_tasks),private.favorite_ai_request_single(text,jsonb),private.favorite_ai_request(text,jsonb) from public,anon,authenticated;
grant execute on function private.favorite_ai_request(text,jsonb) to service_role;
commit;
