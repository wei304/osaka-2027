-- Budget activation: preserves old USD usage; new requests use CNY only.
-- Defaults authorized by user: CNY2/day, CNY10 on Jan9-17 Tokyo dates.
begin;
alter table private.ai_policy add column if not exists budget_currency text not null default 'USD' check(budget_currency in ('USD','CNY'));
alter table private.ai_policy add column if not exists normal_budget_cny numeric not null default 2 check(normal_budget_cny between 0 and 10);
alter table private.ai_policy add column if not exists travel_budget_cny numeric not null default 10 check(travel_budget_cny between 0 and 10);
alter table private.ai_policy add column if not exists max_price_per_million_cny numeric not null default 8 check(max_price_per_million_cny>0);
alter table private.ai_policy add column if not exists budget_version int not null default 1;
alter table private.ai_usage add column if not exists currency text not null default 'USD' check(currency in ('USD','CNY'));
alter table private.ai_usage add column if not exists reserved_cny numeric not null default 0 check(reserved_cny>=0);
alter table private.ai_usage add column if not exists charged_cny numeric not null default 0 check(charged_cny>=0);
create table if not exists private.ai_budget_revisions(version int primary key,normal_cny numeric not null,travel_cny numeric not null,enabled boolean not null,created_at timestamptz not null default now());
alter table private.ai_budget_revisions enable row level security;
revoke all on private.ai_budget_revisions from public,anon,authenticated;
do $$begin
 if exists(select 1 from private.ai_policy where budget_currency='USD') and exists(select 1 from private.ai_usage where (created_at at time zone 'Asia/Tokyo')::date=(now() at time zone 'Asia/Tokyo')::date and charged_usd>0) then raise exception 'Reconcile existing same-day USD reservations before enabling CNY';end if;
end$$;
update private.ai_policy set budget_currency='CNY',daily_requests=100,daily_tokens=1000000 where id=true and budget_currency='USD';
insert into private.ai_budget_revisions(version,normal_cny,travel_cny,enabled) select budget_version,normal_budget_cny,travel_budget_cny,enabled from private.ai_policy where id=true on conflict do nothing;
create or replace function private.ai_trip_request(p_action text,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $ai$
declare checked jsonb; policy private.ai_policy; u private.ai_usage; d private.ai_drafts; scope jsonb; scope_hash text; days jsonb; current_day date:=(now() at time zone 'Asia/Tokyo')::date; reserve_tokens int; cost numeric; v_cache_key text; request_count int; tokens_used bigint; usd_used numeric; previous jsonb; draft_id uuid; charged int; result jsonb; effective_cny numeric; cny_used numeric; today_requests int; travel_day boolean;
begin
 if p_body is null or jsonb_typeof(p_body)<>'object' or length(p_body::text)>250000 then return jsonb_build_object('status',400,'error','invalid_request');end if;
 checked:=private.shared_trip_request('check',jsonb_build_object('token',p_body->>'token'),'');if checked->>'ok' is distinct from 'true' then return checked;end if;
 select * into policy from private.ai_policy where id=true for update;
 travel_day:=current_day between date '2027-01-09' and date '2027-01-17';effective_cny:=case when travel_day then policy.travel_budget_cny else policy.normal_budget_cny end;
 if p_action='budget_save' then
  if coalesce(p_body->>'expected','')!~'^[0-9]{1,9}$' or (p_body->>'expected')::int<>policy.budget_version then return jsonb_build_object('status',409,'error','budget_changed');end if;
  if coalesce(p_body->>'normalCny','')!~'^[0-9]+(\.[0-9]{1,2})?$' or coalesce(p_body->>'travelCny','')!~'^[0-9]+(\.[0-9]{1,2})?$' or (p_body->>'normalCny')::numeric not between 0 and 10 or (p_body->>'travelCny')::numeric not between 0 and 10 or jsonb_typeof(p_body->'enabled') is distinct from 'boolean' then return jsonb_build_object('status',400,'error','invalid_budget');end if;
  update private.ai_policy set normal_budget_cny=(p_body->>'normalCny')::numeric,travel_budget_cny=(p_body->>'travelCny')::numeric,enabled=(p_body->>'enabled')::boolean,budget_version=budget_version+1 where id=true returning * into policy;
  insert into private.ai_budget_revisions(version,normal_cny,travel_cny,enabled) values(policy.budget_version,policy.normal_budget_cny,policy.travel_budget_cny,policy.enabled);
  return jsonb_build_object('ok',true,'budgetVersion',policy.budget_version);
 end if;
 if p_action='status' then
  select coalesce(sum(charged_cny),0),count(*) into cny_used,today_requests from private.ai_usage where (created_at at time zone 'Asia/Tokyo')::date=current_day;
  return jsonb_build_object('enabled',policy.enabled and (case when policy.budget_currency='CNY' then effective_cny>0 and policy.max_price_per_million_cny>0 else policy.daily_budget_usd>0 and policy.max_price_per_million_usd>0 end),'policyOn',policy.enabled,'currency',policy.budget_currency,'dailyRequests',policy.daily_requests,'dailyTokens',policy.daily_tokens,'dailyBudgetUsd',policy.daily_budget_usd,'dailyBudgetCny',effective_cny,'normalBudgetCny',policy.normal_budget_cny,'travelBudgetCny',policy.travel_budget_cny,'usedCny',cny_used,'todayRequests',today_requests,'travelActive',travel_day,'budgetVersion',policy.budget_version,'budgetDate',current_day);
 end if;
 if p_action in ('confirm','cancel') then
  select * into d from private.ai_drafts where id=(p_body->>'draftId')::uuid and token_hash=extensions.digest(p_body->>'token','sha256') for update;
  if not found then return jsonb_build_object('status',404,'error','draft_not_found');end if;
  if p_action='cancel' then if d.status='applied' then return jsonb_build_object('status',409,'error','draft_already_applied');end if;update private.ai_drafts set status='cancelled' where id=d.id;return jsonb_build_object('ok',true);end if;
  if d.status='applied' then return d.response;end if;
  if d.origin='route' and not coalesce((select enabled from private.route_policy where id=true),false) then return jsonb_build_object('status',503,'error','route_disabled');end if;
  if d.origin<>'route' and not policy.enabled then return jsonb_build_object('status',503,'error','ai_disabled');end if;
  if d.status<>'preview' or d.expires_at<now() then return jsonb_build_object('status',409,'error','draft_expired_or_cancelled');end if;
  scope:=private.ai_scope(d.days);if md5(scope::text)<>d.scope_hash then return jsonb_build_object('status',409,'error','draft_stale');end if;
  if not (case when d.origin in ('route','optimize') then private.route_entries_safe(d.entries,scope,d.days) else private.ai_entries_safe(d.entries,scope,d.days) end) then return jsonb_build_object('status',422,'error','draft_constraints_changed');end if;
  result:=private.shared_trip_request('apply_batch',jsonb_build_object('token',p_body->>'token','entries',d.entries,'operation',d.id),'');
  if result ? 'status' or coalesce((result->>'conflict')::boolean,false) then return jsonb_build_object('status',409,'error','draft_stale');end if;
  update private.ai_drafts set status='applied',response=result where id=d.id;return result;
 end if;

 if p_action in ('route_snapshot','route_draft') then
  if not coalesce((select enabled from private.route_policy where id=true),false) then return jsonb_build_object('status',503,'error','route_disabled');end if;
  days:=p_body->'days';if jsonb_typeof(days) is distinct from 'array' or jsonb_array_length(days)<>1 or exists(select 1 from jsonb_array_elements_text(days)x where x !~ '^2027-01-(09|1[0-7])$') then return jsonb_build_object('status',400,'error','invalid_scope');end if;
  scope:=private.ai_scope(days);scope_hash:=md5(scope::text);
  if p_action='route_snapshot' then return jsonb_build_object('rows',scope,'scopeHash',scope_hash,'japanToday',current_day);end if;
  if p_body->>'scopeHash' is distinct from scope_hash then return jsonb_build_object('status',409,'error','draft_stale');end if;
  if not private.route_entries_safe(p_body->'entries',scope,days) then return jsonb_build_object('status',422,'error','invalid_ai_output');end if;
  if (select count(*) from private.ai_drafts where status='preview' and expires_at>now())>=20 then return jsonb_build_object('status',429,'error','draft_quota');end if;
  insert into private.ai_drafts(request_id,token_hash,days,scope_hash,entries,diff,risks,origin) values(null,extensions.digest(p_body->>'token','sha256'),days,scope_hash,p_body->'entries',p_body->'diff',p_body->'risks','route') returning id into draft_id;
  return jsonb_build_object('draftId',draft_id,'expiresAt',now()+interval '15 minutes');
 end if;
 if not policy.enabled or (case when policy.budget_currency='CNY' then effective_cny<=0 or policy.max_price_per_million_cny<=0 else policy.daily_budget_usd<=0 or policy.max_price_per_million_usd<=0 end) then return jsonb_build_object('status',503,'error','ai_disabled');end if;
 if p_action in ('snapshot','reserve') then
  days:=p_body->'days';if jsonb_typeof(days) is distinct from 'array' or jsonb_array_length(days) not between 1 and 2 or exists(select 1 from jsonb_array_elements_text(days)x where x !~ '^2027-01-(09|1[0-7])$') then return jsonb_build_object('status',400,'error','invalid_scope');end if;
  scope:=private.ai_scope(days);scope_hash:=md5(scope::text);
  if p_action='snapshot' then return jsonb_build_object('rows',scope,'scopeHash',scope_hash,'japanToday',current_day,'budget',case when p_body->>'shareBudget'='true' then private.ai_budget(days) else null end);end if;
  if p_body->>'scopeHash' is distinct from scope_hash then return jsonb_build_object('status',409,'error','draft_stale');end if;
  if p_body->>'task' not in ('ask','translate','conflicts','brief','edit','organize','optimize') then return jsonb_build_object('status',400,'error','invalid_task');end if;
  v_cache_key:=md5(current_day::text||days::text||scope_hash||coalesce(p_body->>'model','unknown')||coalesce(p_body->>'task','')||coalesce(p_body->>'prompt',''));
  if p_body->>'cache'='true' and p_body->>'task'='brief' then select u1.result into previous from private.ai_usage u1 where u1.cache_key=v_cache_key and u1.cacheable and u1.status='done' and (u1.created_at at time zone 'Asia/Tokyo')::date=current_day order by created_at desc limit 1;if found then return jsonb_build_object('cached',previous);end if;end if;
  update private.ai_usage set status='failed',snapshot='[]' where status='pending' and created_at<=now()-interval '90 seconds';
  if exists(select 1 from private.ai_usage where status='pending' and created_at>now()-interval '90 seconds') then return jsonb_build_object('status',429,'error','ai_busy');end if;
  if exists(select 1 from private.ai_usage where created_at>now()-interval '10 seconds') then return jsonb_build_object('status',429,'error','ai_rate_limit');end if;
  reserve_tokens:=greatest(4096,(p_body->>'inputBytes')::int+1712);if reserve_tokens>16000 then return jsonb_build_object('status',400,'error','context_too_large');end if;if policy.budget_currency='CNY' and p_body->>'model' is distinct from 'deepseek-flash' then return jsonb_build_object('status',400,'error','unapproved_model');end if;cost:=reserve_tokens*(case when policy.budget_currency='CNY' then policy.max_price_per_million_cny else policy.max_price_per_million_usd end)/1000000;
  select count(*),coalesce(sum(charged_tokens),0),coalesce(sum(case when policy.budget_currency='CNY' then charged_cny else charged_usd end),0) into request_count,tokens_used,usd_used from private.ai_usage where (created_at at time zone 'Asia/Tokyo')::date=current_day;
  if request_count>=policy.daily_requests or tokens_used+reserve_tokens>policy.daily_tokens or usd_used+cost>(case when policy.budget_currency='CNY' then effective_cny else policy.daily_budget_usd end) then return jsonb_build_object('status',429,'error','ai_daily_limit');end if;
  insert into private.ai_usage(token_hash,task,model_name,days,scope_hash,snapshot,cache_key,cacheable,reserved_tokens,charged_tokens,reserved_usd,charged_usd,currency,reserved_cny,charged_cny) values(extensions.digest(p_body->>'token','sha256'),p_body->>'task',left(coalesce(p_body->>'model','unknown'),100),days,scope_hash,scope,v_cache_key,(p_body->>'cache'='true' and p_body->>'task'='brief'),reserve_tokens,reserve_tokens,case when policy.budget_currency='USD' then cost else 0 end,case when policy.budget_currency='USD' then cost else 0 end,policy.budget_currency,case when policy.budget_currency='CNY' then cost else 0 end,case when policy.budget_currency='CNY' then cost else 0 end) returning * into u;return jsonb_build_object('requestId',u.id);
 end if;
 if p_action in ('finish','fail') then
  select * into u from private.ai_usage where id=(p_body->>'requestId')::uuid and token_hash=extensions.digest(p_body->>'token','sha256') for update;if not found then return jsonb_build_object('status',404,'error','request_not_found');end if;
  if u.status<>'pending' then return jsonb_build_object('status',409,'error','request_finished');end if;
  if p_action='fail' then update private.ai_usage set status='failed',snapshot='[]' where id=u.id;return jsonb_build_object('ok',true);end if;
  if u.created_at<now()-interval '90 seconds' then update private.ai_usage set status='failed',snapshot='[]' where id=u.id;return jsonb_build_object('status',409,'error','request_expired');end if;
  if jsonb_typeof(p_body->'result') is distinct from 'object' or length((p_body->'result')::text)>16000 then return jsonb_build_object('status',422,'error','invalid_ai_output');end if;
  if u.task in ('edit','organize','optimize') then
   if not (case when u.task='optimize' then private.route_entries_safe(p_body->'draft'->'entries',u.snapshot,u.days) else private.ai_entries_safe(p_body->'draft'->'entries',u.snapshot,u.days) end) then return jsonb_build_object('status',422,'error','invalid_ai_output');end if;
   if md5(private.ai_scope(u.days)::text)<>u.scope_hash then return jsonb_build_object('status',409,'error','draft_stale');end if;
   insert into private.ai_drafts(request_id,token_hash,days,scope_hash,entries,diff,risks,origin) values(u.id,u.token_hash,u.days,u.scope_hash,p_body->'draft'->'entries',p_body->'draft'->'diff',p_body->'draft'->'risks',case when u.task='optimize' then 'optimize' else 'ai' end) returning id into draft_id;
  end if;
  charged:=u.reserved_tokens;if coalesce(p_body->'usage'->>'total_tokens','')~'^[0-9]{1,7}$' then charged:=least(u.reserved_tokens,greatest(1,(p_body->'usage'->>'total_tokens')::int));end if;
  update private.ai_usage set status='done',result=p_body->'result',snapshot='[]',charged_tokens=charged,charged_usd=case when charged=u.reserved_tokens then reserved_usd else reserved_usd*charged/u.reserved_tokens end,charged_cny=case when charged=u.reserved_tokens then reserved_cny else reserved_cny*charged/u.reserved_tokens end where id=u.id;
  return jsonb_build_object('ok',true,'draftId',draft_id,'expiresAt',case when draft_id is not null then now()+interval '15 minutes' else null end);
 end if;
 return jsonb_build_object('status',400,'error','invalid_action');
exception when invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('status',400,'error','invalid_request');
end $ai$;
revoke all on function private.ai_trip_request(text,jsonb) from public,anon,authenticated;
grant execute on function private.ai_trip_request(text,jsonb) to service_role;
commit;
