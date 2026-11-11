-- Additive, disabled by default. Apply after private backup and isolated tests.
begin;
create table if not exists private.ai_policy(id boolean primary key default true check(id),enabled boolean not null default false,daily_requests int not null default 20 check(daily_requests between 1 and 100),daily_tokens int not null default 32000 check(daily_tokens between 16000 and 1000000),daily_budget_usd numeric not null default 0 check(daily_budget_usd between 0 and 10),max_price_per_million_usd numeric not null default 0 check(max_price_per_million_usd>=0));
insert into private.ai_policy(id) values(true) on conflict do nothing;
create table if not exists private.ai_usage(id uuid primary key default gen_random_uuid(),token_hash bytea not null,task text not null,model_name text not null,days jsonb not null,scope_hash text not null,snapshot jsonb not null,cache_key text not null,cacheable boolean not null default false,created_at timestamptz not null default now(),status text not null default 'pending' check(status in ('pending','done','failed')),reserved_tokens int not null,charged_tokens int not null,reserved_usd numeric not null,charged_usd numeric not null,result jsonb);
create index if not exists ai_usage_created_idx on private.ai_usage(created_at);
create table if not exists private.ai_drafts(id uuid primary key default gen_random_uuid(),request_id uuid not null unique references private.ai_usage(id),token_hash bytea not null,days jsonb not null,scope_hash text not null,entries jsonb not null,diff jsonb not null,risks jsonb not null,expires_at timestamptz not null default now()+interval '15 minutes',status text not null default 'preview' check(status in ('preview','cancelled','applied')),response jsonb);
alter table private.ai_policy enable row level security;
alter table private.ai_usage enable row level security;
alter table private.ai_drafts enable row level security;
revoke all on private.ai_policy,private.ai_usage,private.ai_drafts from public,anon,authenticated;
create or replace function private.ai_scope(p_days jsonb) returns jsonb language sql security definer set search_path='' as $$
select coalesce(jsonb_agg(jsonb_build_object('id',id,'payload',payload,'version',version) order by id),'[]'::jsonb) from public.trip_items where trip_id='osaka-2027' and p_days ? (payload->>'day') and not coalesce((payload->>'deleted')::boolean,false) and id !~ '^(tool-|ticket-|ledger-)';$$;
create or replace function private.ai_meta(p jsonb) returns jsonb language plpgsql immutable set search_path='' as $$begin return coalesce(substring(p->>'notes' from '【安排建议 v1】([^\n]+)')::jsonb,'{}'::jsonb);exception when others then return '{"fixed":true}'::jsonb;end$$;
create or replace function private.ai_budget(p_days jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r record; d jsonb; j bigint:=0; m bigint:=0;
begin
 for r in select payload from public.trip_items where trip_id='osaka-2027' and id like 'ledger-%' and p_days ? (payload->>'day') and not coalesce((payload->>'deleted')::boolean,false) loop
  begin d:=substring(r.payload->>'notes' from E'\n(.*)$')::jsonb;if d->>'type'='expense' and (d->>'amount')::bigint between 1 and 1000000000 then if d->>'currency'='JPY' then j:=j+(d->>'amount')::bigint;elsif d->>'currency'='MYR' then m:=m+(d->>'amount')::bigint;end if;end if;exception when others then null;end;
 end loop;
 return jsonb_build_object('JPY',j,'MYR_cents',m,'label','所选日期已记开销合计，非旅行预算，无姓名/分摊/明细');
end$$;
create or replace function private.ai_entries_safe(p_entries jsonb,p_snapshot jsonb,p_days jsonb) returns boolean language plpgsql set search_path='' as $$
declare e jsonb; old jsonb; v jsonb; meta jsonb;
begin
 if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) not between 1 and 20 then return false;end if;
 if (select count(distinct x->'item'->>'id') from jsonb_array_elements(p_entries)x)<>jsonb_array_length(p_entries) then return false;end if;
 for e in select * from jsonb_array_elements(p_entries) loop
  v:=e->'item';select x into old from jsonb_array_elements(p_snapshot)x where x->>'id'=v->>'id';
  if v->>'id' ~ '^(tool-|ticket-|ledger-|plan-choice-)' or not p_days ? (v->>'day') or length(coalesce(v->>'title','')) not between 1 and 160 or coalesce(v->>'time','') !~ '^$|^([01][0-9]|2[0-3]):[0-5][0-9]$' then return false;end if;
  if old is null then
   if v->>'id' !~ '^ai-[a-f0-9-]{36}$' or (e->>'expected')::int<>0 or v->>'status'<>'pending' or coalesce(v->>'notes','')<>'' or coalesce((v->>'deleted')::boolean,false) then return false;end if;
  else
   meta:=private.ai_meta(old->'payload');
   if (e->>'expected')::int<>(old->>'version')::int or coalesce((meta->>'fixed')::boolean,false) or coalesce(meta->>'group','')<>'' or meta->>'transport'='flight' or old->'payload'->>'status'='booked' then return false;end if;
   if (v-array['title','ja','day','time','category','notes','deleted']) is distinct from ((old->'payload')-array['title','ja','day','time','category','notes','deleted']) then return false;end if;
   if regexp_replace(coalesce(v->>'notes',''),'【安排建议 v1】[^\n]*\n?','','g') is distinct from regexp_replace(coalesce(old->'payload'->>'notes',''),'【安排建议 v1】[^\n]*\n?','','g') then return false;end if;
  end if;
 end loop;
 return true;
exception when others then return false;
end$$;
create or replace function private.ai_trip_request(p_action text,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $ai$
declare checked jsonb; policy private.ai_policy; u private.ai_usage; d private.ai_drafts; scope jsonb; scope_hash text; days jsonb; current_day date:=(now() at time zone 'Asia/Tokyo')::date; reserve_tokens int; cost numeric; v_cache_key text; request_count int; tokens_used bigint; usd_used numeric; previous jsonb; draft_id uuid; charged int; result jsonb;
begin
 if p_body is null or jsonb_typeof(p_body)<>'object' or length(p_body::text)>250000 then return jsonb_build_object('status',400,'error','invalid_request');end if;
 checked:=private.shared_trip_request('check',jsonb_build_object('token',p_body->>'token'),'');if checked->>'ok' is distinct from 'true' then return checked;end if;
 select * into policy from private.ai_policy where id=true for update;
 if p_action='status' then return jsonb_build_object('enabled',policy.enabled and policy.daily_budget_usd>0 and policy.max_price_per_million_usd>0,'dailyRequests',policy.daily_requests,'dailyTokens',policy.daily_tokens,'dailyBudgetUsd',policy.daily_budget_usd);end if;
 if p_action in ('confirm','cancel') then
  select * into d from private.ai_drafts where id=(p_body->>'draftId')::uuid and token_hash=extensions.digest(p_body->>'token','sha256') for update;
  if not found then return jsonb_build_object('status',404,'error','draft_not_found');end if;
  if p_action='cancel' then if d.status='applied' then return jsonb_build_object('status',409,'error','draft_already_applied');end if;update private.ai_drafts set status='cancelled' where id=d.id;return jsonb_build_object('ok',true);end if;
  if d.status='applied' then return d.response;end if;
  if not policy.enabled then return jsonb_build_object('status',503,'error','ai_disabled');end if;
  if d.status<>'preview' or d.expires_at<now() then return jsonb_build_object('status',409,'error','draft_expired_or_cancelled');end if;
  scope:=private.ai_scope(d.days);if md5(scope::text)<>d.scope_hash then return jsonb_build_object('status',409,'error','draft_stale');end if;
  if not private.ai_entries_safe(d.entries,scope,d.days) then return jsonb_build_object('status',422,'error','draft_constraints_changed');end if;
  result:=private.shared_trip_request('apply_batch',jsonb_build_object('token',p_body->>'token','entries',d.entries,'operation',d.id),'');
  if result ? 'status' or coalesce((result->>'conflict')::boolean,false) then return jsonb_build_object('status',409,'error','draft_stale');end if;
  update private.ai_drafts set status='applied',response=result where id=d.id;return result;
 end if;
 if not policy.enabled or policy.daily_budget_usd<=0 or policy.max_price_per_million_usd<=0 then return jsonb_build_object('status',503,'error','ai_disabled');end if;
 if p_action in ('snapshot','reserve') then
  days:=p_body->'days';if jsonb_typeof(days) is distinct from 'array' or jsonb_array_length(days) not between 1 and 2 or exists(select 1 from jsonb_array_elements_text(days)x where x !~ '^2027-01-(09|1[0-7])$') then return jsonb_build_object('status',400,'error','invalid_scope');end if;
  scope:=private.ai_scope(days);scope_hash:=md5(scope::text);
  if p_action='snapshot' then return jsonb_build_object('rows',scope,'scopeHash',scope_hash,'japanToday',current_day,'budget',case when p_body->>'shareBudget'='true' then private.ai_budget(days) else null end);end if;
  if p_body->>'scopeHash' is distinct from scope_hash then return jsonb_build_object('status',409,'error','draft_stale');end if;
  if p_body->>'task' not in ('ask','translate','conflicts','brief','edit') then return jsonb_build_object('status',400,'error','invalid_task');end if;
  v_cache_key:=md5(current_day::text||days::text||scope_hash||coalesce(p_body->>'model','unknown')||coalesce(p_body->>'task','')||coalesce(p_body->>'prompt',''));
  if p_body->>'cache'='true' and p_body->>'task'='brief' then select u1.result into previous from private.ai_usage u1 where u1.cache_key=v_cache_key and u1.cacheable and u1.status='done' and (u1.created_at at time zone 'Asia/Tokyo')::date=current_day order by created_at desc limit 1;if found then return jsonb_build_object('cached',previous);end if;end if;
  update private.ai_usage set status='failed',snapshot='[]' where status='pending' and created_at<=now()-interval '90 seconds';
  if exists(select 1 from private.ai_usage where status='pending' and created_at>now()-interval '90 seconds') then return jsonb_build_object('status',429,'error','ai_busy');end if;
  if exists(select 1 from private.ai_usage where created_at>now()-interval '10 seconds') then return jsonb_build_object('status',429,'error','ai_rate_limit');end if;
  reserve_tokens:=greatest(4096,(p_body->>'inputBytes')::int+1712);if reserve_tokens>16000 then return jsonb_build_object('status',400,'error','context_too_large');end if;cost:=reserve_tokens*policy.max_price_per_million_usd/1000000;
  select count(*),coalesce(sum(charged_tokens),0),coalesce(sum(charged_usd),0) into request_count,tokens_used,usd_used from private.ai_usage where (created_at at time zone 'Asia/Tokyo')::date=current_day;
  if request_count>=policy.daily_requests or tokens_used+reserve_tokens>policy.daily_tokens or usd_used+cost>policy.daily_budget_usd then return jsonb_build_object('status',429,'error','ai_daily_limit');end if;
  insert into private.ai_usage(token_hash,task,model_name,days,scope_hash,snapshot,cache_key,cacheable,reserved_tokens,charged_tokens,reserved_usd,charged_usd) values(extensions.digest(p_body->>'token','sha256'),p_body->>'task',left(coalesce(p_body->>'model','unknown'),100),days,scope_hash,scope,v_cache_key,(p_body->>'cache'='true' and p_body->>'task'='brief'),reserve_tokens,reserve_tokens,cost,cost) returning * into u;return jsonb_build_object('requestId',u.id);
 end if;
 if p_action in ('finish','fail') then
  select * into u from private.ai_usage where id=(p_body->>'requestId')::uuid and token_hash=extensions.digest(p_body->>'token','sha256') for update;if not found then return jsonb_build_object('status',404,'error','request_not_found');end if;
  if u.status<>'pending' then return jsonb_build_object('status',409,'error','request_finished');end if;
  if p_action='fail' then update private.ai_usage set status='failed',snapshot='[]' where id=u.id;return jsonb_build_object('ok',true);end if;
  if u.created_at<now()-interval '90 seconds' then update private.ai_usage set status='failed',snapshot='[]' where id=u.id;return jsonb_build_object('status',409,'error','request_expired');end if;
  if jsonb_typeof(p_body->'result') is distinct from 'object' or length((p_body->'result')::text)>16000 then return jsonb_build_object('status',422,'error','invalid_ai_output');end if;
  if u.task='edit' then
   if not private.ai_entries_safe(p_body->'draft'->'entries',u.snapshot,u.days) then return jsonb_build_object('status',422,'error','invalid_ai_output');end if;
   if md5(private.ai_scope(u.days)::text)<>u.scope_hash then return jsonb_build_object('status',409,'error','draft_stale');end if;
   insert into private.ai_drafts(request_id,token_hash,days,scope_hash,entries,diff,risks) values(u.id,u.token_hash,u.days,u.scope_hash,p_body->'draft'->'entries',p_body->'draft'->'diff',p_body->'draft'->'risks') returning id into draft_id;
  end if;
  charged:=u.reserved_tokens;if coalesce(p_body->'usage'->>'total_tokens','')~'^[0-9]{1,7}$' then charged:=least(u.reserved_tokens,greatest(1,(p_body->'usage'->>'total_tokens')::int));end if;
  update private.ai_usage set status='done',result=p_body->'result',snapshot='[]',charged_tokens=charged,charged_usd=case when charged=u.reserved_tokens then reserved_usd else reserved_usd*charged/u.reserved_tokens end where id=u.id;
  return jsonb_build_object('ok',true,'draftId',draft_id,'expiresAt',case when draft_id is not null then now()+interval '15 minutes' else null end);
 end if;
 return jsonb_build_object('status',400,'error','invalid_action');
exception when invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('status',400,'error','invalid_request');
end $ai$;
revoke all on function private.ai_scope(jsonb),private.ai_meta(jsonb),private.ai_budget(jsonb),private.ai_entries_safe(jsonb,jsonb,jsonb),private.ai_trip_request(text,jsonb) from public,anon,authenticated;
create or replace function public.ai_trip_request(p_action text,p_body jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.ai_trip_request(p_action,p_body);$$;
revoke all on function public.ai_trip_request(text,jsonb) from public,anon,authenticated;
grant execute on function private.ai_trip_request(text,jsonb),public.ai_trip_request(text,jsonb) to service_role;
commit;
