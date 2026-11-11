-- Stage 4 upgrade script, following this repository's versioned SQL convention.
-- Local isolated verification only until the separately approved deployment stage.
begin;
alter table private.favorite_places add column if not exists geo_evidence jsonb not null default '{}';
alter table private.favorite_places add column if not exists ai_fingerprint text;
alter table private.favorite_places add column if not exists ai_reason text not null default '';
alter table private.favorite_places add column if not exists ai_day_managed boolean not null default false;
create table if not exists private.favorite_day_regions(day date primary key check(day between date '2027-01-09' and date '2027-01-17'),regions jsonb not null,scope_hash text not null,version int not null,updated_at timestamptz not null default now());
create table if not exists private.favorite_day_region_revisions(operation uuid primary key,day date not null references private.favorite_day_regions(day),request_hash text not null,before_data jsonb,after_data jsonb not null,created_at timestamptz not null default now());
create table if not exists private.favorite_ai_jobs(operation uuid primary key,token_hash bytea not null,request_id uuid unique references private.ai_usage(id),guard text not null,items jsonb not null,status text not null check(status in ('pending','ready','applied','failed')),result jsonb,response jsonb,error text,created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '15 minutes');
create index if not exists favorite_ai_jobs_created on private.favorite_ai_jobs(created_at desc);
create index if not exists favorite_day_region_revisions_day on private.favorite_day_region_revisions(day,created_at desc);
alter table private.favorite_day_regions enable row level security;
alter table private.favorite_day_region_revisions enable row level security;
alter table private.favorite_ai_jobs enable row level security;
revoke all on private.favorite_day_regions,private.favorite_day_region_revisions,private.favorite_ai_jobs from public,anon,authenticated;

create or replace function private.favorite_day_scope(d date) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'version',version,'title',left(payload->>'title',160),'time',payload->>'time','category',payload->>'category') order by id),'[]') from public.trip_items where trip_id='osaka-2027' and payload->>'day'=d::text and not coalesce((payload->>'deleted')::boolean,false) and id !~ '^(tool-|ticket-|ledger-|plan-choice-)';
$$;
create or replace function private.favorite_verified_region(e jsonb) returns text language plpgsql immutable set search_path='' as $$
declare regions text[]:='{}';a text;
begin
 if e->'verified' is distinct from 'true'::jsonb or coalesce(length(e->>'source'),0)=0 then return '待确认地区';end if;
 if coalesce(length(trim(e->>'region')),0)>0 then return e->>'region';end if;
 a:=e->>'address';
 -- Only explicit administrative names in a user-verified address; ambiguous matches stay unknown.
 if a ~ '大阪市(天王寺区|阿倍野区)' then regions:=array_append(regions,'天王寺 / 阿倍野');end if;
 if a ~ '大阪市北区' then regions:=array_append(regions,'梅田 / 大阪站');end if;
 if a ~ '大阪市港区' then regions:=array_append(regions,'大阪湾 / 天保山');end if;
 if a ~ '京都(市|府)' then regions:=array_append(regions,'京都');end if;
 if a ~ '奈良市' then regions:=array_append(regions,'奈良');end if;
 return case when cardinality(regions)=1 then regions[1] else '待确认地区' end;
end $$;
create or replace function private.favorite_ai_input(p private.favorite_places) returns jsonb language plpgsql stable set search_path='' as $$
declare region text;profiles jsonb;eligible jsonb;cached jsonb;base_type text;fp text;manual_type boolean;
begin
 region:=private.favorite_verified_region(p.geo_evidence);
 if p.manual_fields->'region'='true'::jsonb and p.region<>region then region:='待确认地区';end if;
 select coalesce(jsonb_agg(jsonb_build_object('day',d.day,'regions',d.regions,'scope',d.scope_hash,'valid',d.scope_hash=md5(private.favorite_day_scope(d.day)::text)) order by d.day),'[]') into profiles from private.favorite_day_regions d;
 select coalesce(jsonb_agg(x->>'day' order by x->>'day'),'[]') into eligible from jsonb_array_elements(profiles) x where x->'valid'='true'::jsonb and x->'regions' ? region and region not in ('待确认地区','大阪','大阪府','大阪市','関西','关西','日本','其他地区','其他');
 manual_type:=p.manual_fields->'type'='true'::jsonb;
 base_type:=case when manual_type then p.place_type else (select raw->>'labels' from private.favorite_source_items where place_id=p.id and active and raw->>'labels' in ('餐厅','咖啡厅 / 甜品','景点','购物','娱乐体验','交通','其他') order by source_id limit 1) end;
 fp:=md5(jsonb_build_array(1,p.source_name,p.original_url,p.geo_evidence,coalesce(manual_type,false),case when manual_type then p.place_type else null end,case when p.manual_fields->'region'='true'::jsonb then p.region else null end,base_type,profiles)::text);
 select result into cached from private.favorite_ai_results where place_id=p.id and task='favorite-classify-v1' and fingerprint=fp and version=1;
 return jsonb_build_object('id',p.id,'name',p.source_name,'version',p.version,'fingerprint',fp,'region',region,'eligibleDays',eligible,'itinerary',(select coalesce(jsonb_agg(jsonb_build_object('day',x->>'day','regions',x->'regions','activities',(select coalesce(jsonb_agg(a),'[]') from (select jsonb_build_object('title',left(t->>'title',80),'time',t->>'time','category',t->>'category') a from jsonb_array_elements(private.favorite_day_scope((x->>'day')::date)) t where t->>'category' in ('spot','food','shopping') limit 3) selected_activities))),'[]') from jsonb_array_elements(profiles) x where eligible ? (x->>'day')),'baseType',coalesce(base_type,'其他'),'manualType',coalesce(manual_type,false),'cached',cached,'needsAI',base_type is null and cached is null);
end $$;
create or replace function private.favorite_ai_guard(items jsonb) returns text language sql immutable set search_path='' as $$
 select md5(coalesce(jsonb_agg(jsonb_build_array(x->>'id',x->'version',x->>'fingerprint') order by x->>'id'),'[]')::text) from jsonb_array_elements(items) x;
$$;
create or replace function private.favorite_ai_plan() returns jsonb language plpgsql stable set search_path='' as $$
declare p private.favorite_places;i jsonb;items jsonb:='[]';total int:=0;pending int:=0;models int:=0;cached int:=0;rules int:=0;
begin
 for p in select * from private.favorite_places where not archived order by id loop
  total:=total+1;i:=private.favorite_ai_input(p);if p.ai_fingerprint=i->>'fingerprint' then continue;end if;
  pending:=pending+1;if i->'needsAI'='true'::jsonb then models:=models+1;elsif i->'cached'<>'null'::jsonb then cached:=cached+1;else rules:=rules+1;end if;
  if jsonb_array_length(items)<5 then items:=items||jsonb_build_array(i);end if;
 end loop;
 return jsonb_build_object('total',total,'pending',pending,'modelPlaces',models,'cachedPlaces',cached,'rulePlaces',rules,'items',items,'guard',private.favorite_ai_guard(items),'maxBatch',5,'version',1);
end $$;

create or replace function private.favorite_ai_request(p_action text,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare checked jsonb;tok text;op uuid;h text;j private.favorite_ai_jobs;p private.favorite_places;old jsonb;i jsonb;r jsonb;items jsonb;final_result jsonb:='[]';plan jsonb;reservation jsonb;snapshot jsonb;done jsonb;reg text;days jsonb;d date;profile private.favorite_day_regions;prior private.favorite_day_region_revisions;rev private.favorite_revisions;engine text;allowed boolean;
begin
 if p_body is null or jsonb_typeof(p_body)<>'object' or length(p_body::text)>100000 then return jsonb_build_object('status',400,'error','invalid_request');end if;
 -- Shared gate lock and session generation validation are reused, not replaced by a JWT.
 checked:=private.favorite_request('rows',jsonb_build_object('token',p_body->>'token'));if checked ? 'status' then return checked;end if;tok:=p_body->>'token';
 if p_action='plan' then
  plan:=private.favorite_ai_plan();checked:=private.ai_trip_request('status',jsonb_build_object('token',tok));
  return plan||jsonb_build_object('policy',checked,'maxBatchReservationCny',(select 16000*max_price_per_million_cny/1000000 from private.ai_policy where id=true),'profiles',coalesce((select jsonb_agg(jsonb_build_object('day',dt,'scopeHash',md5(private.favorite_day_scope(dt)::text),'itinerary',private.favorite_day_scope(dt),'regions',coalesce(f.regions,'[]'),'version',coalesce(f.version,0),'valid',coalesce(f.scope_hash=md5(private.favorite_day_scope(dt)::text),false)) order by dt) from (select generate_series(date '2027-01-09',date '2027-01-17',interval '1 day')::date dt) ds left join private.favorite_day_regions f on f.day=dt),'[]'),'jobs',coalesce((select jsonb_agg(to_jsonb(x)) from (select fj.operation,fj.status,fj.error,fj.created_at,jsonb_array_length(fj.items) as places,fj.request_id,(fj.token_hash=extensions.digest(tok,'sha256')) as recoverable from private.favorite_ai_jobs fj order by fj.created_at desc limit 20)x),'[]'),'usage',coalesce((select jsonb_agg(to_jsonb(x)) from (select u.id,u.status,u.created_at,u.charged_tokens,u.charged_cny,u.reserved_cny from private.ai_usage u join private.favorite_ai_jobs f on f.request_id=u.id order by u.created_at desc limit 20)x),'[]'));
 end if;
 op:=(p_body->>'operation')::uuid;if op is null then return jsonb_build_object('status',400,'error','invalid_request');end if;
 h:=md5(jsonb_build_array(p_action,p_body-'token')::text);
 if p_action in ('evidence','profile') then
  select * into rev from private.favorite_revisions where operation=op limit 1;
  if found then if p_action='evidence' and rev.action='geo_evidence' and rev.request_hash=h then return jsonb_build_object('ok',true,'replayed',true);else return jsonb_build_object('status',400,'error','operation_reused');end if;end if;
  select * into prior from private.favorite_day_region_revisions where operation=op;
  if found then if p_action='profile' and prior.request_hash=h then return jsonb_build_object('ok',true,'replayed',true);else return jsonb_build_object('status',400,'error','operation_reused');end if;end if;
  if exists(select 1 from private.favorite_import_batches where operation=op or undo_operation=op) or exists(select 1 from private.favorite_ai_jobs where operation=op) then return jsonb_build_object('status',400,'error','operation_reused');end if;
  if p_action='evidence' then
   select * into p from private.favorite_places where id=(p_body->>'id')::uuid;if not found then return jsonb_build_object('status',404,'error','favorite_not_found');end if;
   if p.version is distinct from (p_body->>'expected')::int then return jsonb_build_object('status',409,'error','favorite_conflict');end if;
   r:=p_body->'evidence';
   if jsonb_typeof(r) is distinct from 'object' or r-array['region','address','source','verified']<>'{}'::jsonb or r->'verified' is distinct from 'true'::jsonb or jsonb_typeof(r->'region') is distinct from 'string' or length(r->>'region')>80 or jsonb_typeof(r->'address') is distinct from 'string' or length(r->>'address')>500 or jsonb_typeof(r->'source') is distinct from 'string' or length(r->>'source')>2000 or r->>'source' !~ '^https://[^[:space:]]+$' or (length(trim(r->>'region'))=0 and length(trim(r->>'address'))=0) then return jsonb_build_object('status',400,'error','invalid_evidence');end if;
   old:=to_jsonb(p);update private.favorite_places set geo_evidence=r,version=version+1,updated_at=now() where id=p.id returning * into p;
   insert into private.favorite_revisions(place_id,operation,request_hash,action,before_data,after_data,version) values(p.id,op,h,'geo_evidence',old,to_jsonb(p),p.version);return jsonb_build_object('ok',true);
  end if;
  d:=(p_body->>'day')::date;days:=p_body->'regions';
  if d is null or d not between date '2027-01-09' and date '2027-01-17' or p_body->'confirmed' is distinct from 'true'::jsonb or jsonb_typeof(days) is distinct from 'array' or jsonb_array_length(days)>8 or exists(select 1 from jsonb_array_elements(days)x where jsonb_typeof(x)<>'string' or length(trim(x#>>'{}')) not between 1 and 80 or x#>>'{}'='待确认地区') or (select count(distinct x) from jsonb_array_elements(days)x)<>jsonb_array_length(days) then return jsonb_build_object('status',400,'error','invalid_profile');end if;
  select * into profile from private.favorite_day_regions where day=d;
  if coalesce(profile.version,0) is distinct from (p_body->>'expected')::int or p_body->>'scopeHash' is distinct from md5(private.favorite_day_scope(d)::text) then return jsonb_build_object('status',409,'error','draft_stale');end if;
  old:=case when profile.day is null then null else to_jsonb(profile) end;
  insert into private.favorite_day_regions(day,regions,scope_hash,version) values(d,days,p_body->>'scopeHash',1) on conflict(day) do update set regions=excluded.regions,scope_hash=excluded.scope_hash,version=private.favorite_day_regions.version+1,updated_at=now() returning * into profile;
  insert into private.favorite_day_region_revisions(operation,day,request_hash,before_data,after_data) values(op,d,h,old,to_jsonb(profile));return jsonb_build_object('ok',true);
 end if;
 select * into j from private.favorite_ai_jobs where operation=op;
 if found and j.token_hash<>extensions.digest(tok,'sha256') then return jsonb_build_object('status',404,'error','favorite_ai_not_found');end if;
 if p_action='recover' then
  if j.operation is null then return jsonb_build_object('status',404,'error','favorite_ai_not_found');end if;
  if j.status='pending' and j.created_at<now()-interval '90 seconds' then
   if j.request_id is not null then perform private.ai_trip_request('fail',jsonb_build_object('token',tok,'requestId',j.request_id));end if;
   update private.favorite_ai_jobs set status='failed',error='request_expired' where operation=op returning * into j;
  end if;
  return jsonb_build_object('operation',op,'jobStatus',j.status,'result',j.result,'error',j.error,'expiresAt',j.expires_at);
 end if;
 if p_action='prepare' then
  if j.operation is not null then return jsonb_build_object('status',409,'error','favorite_ai_in_progress');end if;
  if exists(select 1 from private.favorite_revisions where operation=op) or exists(select 1 from private.favorite_import_batches where operation=op or undo_operation=op) or exists(select 1 from private.favorite_day_region_revisions where operation=op) then return jsonb_build_object('status',400,'error','operation_reused');end if;
  plan:=private.favorite_ai_plan();items:=plan->'items';if jsonb_array_length(items)=0 then return jsonb_build_object('status',400,'error','nothing_to_classify');end if;
  if p_body->>'guard' is distinct from plan->>'guard' then return jsonb_build_object('status',409,'error','draft_stale');end if;
  if exists(select 1 from jsonb_array_elements(items)x where x->'needsAI'='true'::jsonb) then
   snapshot:=private.ai_trip_request('snapshot',jsonb_build_object('token',tok,'days',jsonb_build_array('2027-01-09')));if snapshot ? 'status' then return snapshot;end if;
   reservation:=private.ai_trip_request('reserve',jsonb_build_object('token',tok,'days',jsonb_build_array('2027-01-09'),'scopeHash',snapshot->>'scopeHash','task','ask','model',p_body->>'model','prompt','favorite-classify-v1','cache',false,'inputBytes',p_body->'inputBytes'));if reservation ? 'status' then return reservation;end if;
  end if;
  insert into private.favorite_ai_jobs(operation,token_hash,request_id,guard,items,status) values(op,extensions.digest(tok,'sha256'),(reservation->>'requestId')::uuid,plan->>'guard',items,'pending');return jsonb_build_object('operation',op,'items',items);
 end if;
 if j.operation is null then return jsonb_build_object('status',404,'error','favorite_ai_not_found');end if;
 if p_action='discard' then
  if j.status='pending' then return jsonb_build_object('status',409,'error','favorite_ai_in_progress');end if;
  if j.status='applied' then return jsonb_build_object('status',409,'error','draft_already_applied');end if;
  update private.favorite_ai_jobs set status='failed',error='discarded_by_user' where operation=op;return jsonb_build_object('ok',true);
 end if;
 if p_action='fail' then
  if j.status='pending' then
   if j.request_id is not null then perform private.ai_trip_request('fail',jsonb_build_object('token',tok,'requestId',j.request_id));end if;
   update private.favorite_ai_jobs set status='failed',error='provider_or_validation_failed' where operation=op;
  end if;return jsonb_build_object('ok',true);
 end if;
 if p_action='finish' then
  if j.status<>'pending' or j.created_at<now()-interval '90 seconds' then return jsonb_build_object('status',409,'error','favorite_ai_in_progress');end if;
  items:=p_body->'suggestions';if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)<>jsonb_array_length(j.items) then return jsonb_build_object('status',422,'error','invalid_favorite_ai_output');end if;
  if (select count(distinct x->>'id') from jsonb_array_elements(items)x)<>jsonb_array_length(items) then return jsonb_build_object('status',422,'error','invalid_favorite_ai_output');end if;
  for i in select value from jsonb_array_elements(j.items) loop
   select value into r from jsonb_array_elements(items) where value->>'id'=i->>'id';
   if r is null or jsonb_typeof(r)<>'object' or r-array['id','type','confidence','days']<>'{}'::jsonb or coalesce(r->>'type','') not in ('餐厅','咖啡厅 / 甜品','景点','购物','娱乐体验','交通','其他') or coalesce(r->>'confidence','') not in ('low','medium') or jsonb_typeof(r->'days') is distinct from 'array' or exists(select 1 from jsonb_array_elements(r->'days')x where jsonb_typeof(x)<>'string' or not(i->'eligibleDays' ? (x#>>'{}'))) or (select count(distinct x) from jsonb_array_elements(r->'days')x)<>jsonb_array_length(r->'days') then return jsonb_build_object('status',422,'error','invalid_favorite_ai_output');end if;
   if i->'needsAI'='false'::jsonb then
    if i->'cached'<>'null'::jsonb then if r<>i->'cached' then return jsonb_build_object('status',422,'error','invalid_favorite_ai_output');end if;
    elsif r->>'type'<>i->>'baseType' or r->'days'<>i->'eligibleDays' then return jsonb_build_object('status',422,'error','invalid_favorite_ai_output');end if;
   end if;
   engine:=case when i->'needsAI'='true'::jsonb then 'ai' when i->'cached'<>'null'::jsonb then 'cache' when i->'manualType'='true'::jsonb then 'manual' else 'rule' end;
   final_result:=final_result||jsonb_build_array(r||jsonb_build_object('region',i->>'region','engine',engine,'reason',case when engine in ('ai','cache') then 'AI仅根据名称提供类型建议，需人工核对。' else '类型来自已保存的手动分类或来源标签。' end,'dayReason',case when jsonb_array_length(r->'days')>0 then '已核对地点地区与已审核的当天行程地区一致；交通、营业及可用时间仍需核对。' else '缺少已核对的地区匹配或未推荐日期，保留未安排。' end,'dayConfidence',case when jsonb_array_length(r->'days')>0 then 'medium' else 'low' end));
  end loop;
  if j.request_id is not null then done:=private.ai_trip_request('finish',jsonb_build_object('token',tok,'requestId',j.request_id,'usage',p_body->'usage','result',jsonb_build_object('purpose','favorite-classify-v1','places',jsonb_array_length(items))));if done ? 'status' then return done;end if;end if;
  for i in select value from jsonb_array_elements(j.items) loop
   if i->'needsAI'='true'::jsonb then select value into r from jsonb_array_elements(items) where value->>'id'=i->>'id';insert into private.favorite_ai_results(place_id,fingerprint,task,result,version) values((i->>'id')::uuid,i->>'fingerprint','favorite-classify-v1',r,1) on conflict(place_id,task,fingerprint,version) do nothing;end if;
  end loop;
  update private.favorite_ai_jobs set status='ready',result=final_result where operation=op;return jsonb_build_object('operation',op,'jobStatus','ready','result',final_result,'expiresAt',j.expires_at);
 end if;
 if p_action='confirm' then
  if p_body->'confirmed' is distinct from 'true'::jsonb then return jsonb_build_object('status',400,'error','confirmation_required');end if;
  if j.status='applied' then return j.response;end if;
  if j.status<>'ready' or j.expires_at<now() then return jsonb_build_object('status',409,'error','draft_expired_or_cancelled');end if;
  items:='[]';for i in select value from jsonb_array_elements(j.items) loop select * into p from private.favorite_places where id=(i->>'id')::uuid;items:=items||jsonb_build_array(private.favorite_ai_input(p));end loop;
  if private.favorite_ai_guard(items)<>j.guard then return jsonb_build_object('status',409,'error','draft_stale');end if;
  for r in select value from jsonb_array_elements(j.result) loop
   select * into p from private.favorite_places where id=(r->>'id')::uuid;select value into i from jsonb_array_elements(j.items) where value->>'id'=r->>'id';
   old:=to_jsonb(p)||jsonb_build_object('day_links',coalesce((select jsonb_agg(to_jsonb(l) order by day) from private.favorite_day_links l where place_id=p.id),'[]'));
   allowed:=p.manual_fields->'days' is distinct from 'true'::jsonb and (p.ai_day_managed or not exists(select 1 from private.favorite_day_links where place_id=p.id));
   if allowed then for d in select value::date from jsonb_array_elements_text(r->'days') loop insert into private.favorite_day_links(place_id,day) values(p.id,d) on conflict(place_id,day) do update set active=true,version=private.favorite_day_links.version+1 where not private.favorite_day_links.active;end loop;end if;
   update private.favorite_places set region=case when manual_fields->'region'='true'::jsonb then region else r->>'region' end,place_type=case when manual_fields->'type'='true'::jsonb then place_type else r->>'type' end,ai_fingerprint=i->>'fingerprint',ai_reason=(r->>'reason')||' '||(r->>'dayReason'),ai_day_managed=ai_day_managed or allowed,version=version+1,updated_at=now() where id=p.id returning * into p;
   insert into private.favorite_revisions(place_id,operation,request_hash,action,before_data,after_data,version) values(p.id,op,j.guard,'ai_confirm',old,to_jsonb(p)||jsonb_build_object('day_links',coalesce((select jsonb_agg(to_jsonb(l) order by day) from private.favorite_day_links l where place_id=p.id),'[]')),p.version);
  end loop;
  done:=jsonb_build_object('ok',true,'operation',op,'jobStatus','applied','places',jsonb_array_length(j.items));update private.favorite_ai_jobs set status='applied',response=done where operation=op;return done;
 end if;
 return jsonb_build_object('status',400,'error','invalid_action');
exception when invalid_text_representation or numeric_value_out_of_range or not_null_violation or check_violation then return jsonb_build_object('status',400,'error','invalid_request');
end $$;

do $$begin if to_regprocedure('private.favorite_request_v18(text,jsonb)') is null then alter function private.favorite_request(text,jsonb) rename to favorite_request_v18;end if;end$$;
create or replace function private.favorite_request(p_action text,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;g private.shared_gate;tok text;
begin
 if p_action in ('edit','restore','undo_import','import','link_days') then
  select * into g from private.shared_gate where trip_id='osaka-2027' for update;tok:=p_body->>'token';
  if g.password_hash is null or tok is null or tok !~ '^[a-f0-9]{64}$' or not exists(select 1 from private.shared_sessions where token_hash=extensions.digest(tok,'sha256') and generation=g.generation and expires_at>now()) then return jsonb_build_object('status',401,'error','locked');end if;
  if exists(select 1 from private.favorite_ai_jobs where operation=(p_body->>'operation')::uuid) or exists(select 1 from private.favorite_day_region_revisions where operation=(p_body->>'operation')::uuid) then return jsonb_build_object('status',400,'error','operation_reused');end if;
 end if;
 r:=private.favorite_request_v18(p_action,p_body);
 if p_action='link_days' and r->'ok'='true'::jsonb and r->'replayed' is distinct from 'true'::jsonb then
  update private.favorite_places set manual_fields=manual_fields||'{"days":true}'::jsonb where id=(p_body->>'id')::uuid;
  update private.favorite_revisions set after_data=jsonb_set(after_data,'{manual_fields,days}','true') where operation=(p_body->>'operation')::uuid and action='link_days';
 end if;return r;
exception when invalid_text_representation then return jsonb_build_object('status',400,'error','invalid_request');
end $$;
create or replace function public.favorite_request(p_action text,p_body jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.favorite_request(p_action,p_body);$$;
create or replace function public.favorite_ai_request(p_action text,p_body jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.favorite_ai_request(p_action,p_body);$$;
revoke all on function private.favorite_day_scope(date),private.favorite_verified_region(jsonb),private.favorite_ai_input(private.favorite_places),private.favorite_ai_guard(jsonb),private.favorite_ai_plan(),private.favorite_ai_request(text,jsonb),private.favorite_request(text,jsonb),private.favorite_request_v18(text,jsonb),public.favorite_request(text,jsonb),public.favorite_ai_request(text,jsonb) from public,anon,authenticated;
grant execute on function private.favorite_request(text,jsonb),public.favorite_request(text,jsonb),private.favorite_ai_request(text,jsonb),public.favorite_ai_request(text,jsonb) to service_role;
commit;
