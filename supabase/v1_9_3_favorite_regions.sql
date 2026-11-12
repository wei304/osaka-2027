-- Optional, additive region review. Reuses favorite_places / favorite_revisions.
begin;
create table if not exists private.favorite_region_reviews(
 operation uuid primary key,token_hash bytea not null,request_hash text not null,entries jsonb not null,
 status text not null default 'preview' check(status in ('preview','applied')),response jsonb,
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '15 minutes'
);
alter table private.favorite_region_reviews enable row level security;
revoke all on private.favorite_region_reviews from public,anon,authenticated;
create or replace function private.favorite_region_request(p_action text,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare gate private.shared_gate;tok text;th bytea;op uuid;h text;review private.favorite_region_reviews;p private.favorite_places;e jsonb;ev jsonb;before_p jsonb;v_response jsonb;
begin
 if p_body is null or jsonb_typeof(p_body)<>'object' or length(p_body::text)>150000 then return jsonb_build_object('status',400,'error','invalid_request');end if;
 select * into gate from private.shared_gate where trip_id='osaka-2027' for update;
 tok:=p_body->>'token';th:=extensions.digest(tok,'sha256');
 if gate.password_hash is null or tok is null or tok !~ '^[a-f0-9]{64}$' or not exists(select 1 from private.shared_sessions where token_hash=th and generation=gate.generation and expires_at>now()) then return jsonb_build_object('status',401,'error','locked');end if;
 if p_action='snapshot' then
  return private.favorite_request('rows',jsonb_build_object('token',tok))||jsonb_build_object('regionHistory',coalesce((select jsonb_agg(to_jsonb(x)) from (select r.place_id,r.id as revision,r.created_at as at,r.after_data->'geo_evidence' as evidence from private.favorite_revisions r where r.after_data->'geo_evidence'->'verified'='true'::jsonb and r.action in ('geo_evidence','region_confirm') and r.id in (select r2.id from private.favorite_revisions r2 where r2.place_id=r.place_id and r2.after_data->'geo_evidence'->'verified'='true'::jsonb and r2.action in ('geo_evidence','region_confirm') order by r2.version desc limit 5))x),'[]'));
 end if;
 op:=(p_body->>'operation')::uuid;if op is null then return jsonb_build_object('status',400,'error','invalid_request');end if;
 select * into review from private.favorite_region_reviews where operation=op;
 if found and review.token_hash<>th then return jsonb_build_object('status',404,'error','region_review_not_found');end if;
 if p_action='preview' then
  if jsonb_typeof(p_body->'entries') is distinct from 'array' or jsonb_array_length(p_body->'entries') not between 1 and 25 or (select count(distinct x->>'id') from jsonb_array_elements(p_body->'entries')x)<>jsonb_array_length(p_body->'entries') then return jsonb_build_object('status',400,'error','invalid_region_selection');end if;
  h:=encode(extensions.digest((p_body->'entries')::text,'sha256'),'hex');
  if review.operation is not null then if review.request_hash<>h then return jsonb_build_object('status',409,'error','operation_reused');end if;return jsonb_build_object('operation',op,'entries',review.entries,'expiresAt',review.expires_at,'reviewStatus',review.status);end if;
  if exists(select 1 from private.favorite_revisions where operation=op) or exists(select 1 from private.favorite_import_batches where operation=op or undo_operation=op) or exists(select 1 from private.favorite_ai_jobs where operation=op) or exists(select 1 from private.favorite_day_region_revisions where operation=op) then return jsonb_build_object('status',409,'error','operation_reused');end if;
  for e in select value from jsonb_array_elements(p_body->'entries') loop
   select * into p from private.favorite_places where id=(e->>'id')::uuid and trip_id='osaka-2027';
   if not found or p.version is distinct from (e->>'expected')::int then return jsonb_build_object('status',409,'error','favorite_conflict');end if;
   if p.archived or (p.geo_evidence->'verified'='true'::jsonb and length(trim(coalesce(p.geo_evidence->>'region','')))>0 and p.geo_evidence->>'region' not in ('待确认','待确认地区')) or (p.manual_fields->'region'='true'::jsonb and p.region not in ('待确认地区','待确认')) then return jsonb_build_object('status',409,'error','region_protected');end if;
   ev:=e->'evidence';
   if jsonb_typeof(e->'region') is distinct from 'string' or length(trim(e->>'region')) not between 1 and 80 or e->>'region' in ('待确认','待确认地区') or jsonb_typeof(ev) is distinct from 'object' or ev->'verified' is distinct from 'false'::jsonb or ev->>'region' is distinct from e->>'region' or coalesce(ev->>'type','') not in ('verified_address','history_verified') or ev->'upstreamVerified' is distinct from 'true'::jsonb or length(coalesce(ev->>'source','')) not between 1 and 2000 or ev->>'source' !~ '^https://[^[:space:]]+$' or length(coalesce(ev->>'address',''))>500 then return jsonb_build_object('status',400,'error','region_evidence_required');end if;
  end loop;
  insert into private.favorite_region_reviews(operation,token_hash,request_hash,entries) values(op,th,h,p_body->'entries') returning * into review;
  return jsonb_build_object('operation',op,'entries',review.entries,'expiresAt',review.expires_at,'reviewStatus','preview');
 end if;
 if p_action='confirm' then
  if p_body->'confirmed' is distinct from 'true'::jsonb then return jsonb_build_object('status',400,'error','confirmation_required');end if;
  if review.operation is null then return jsonb_build_object('status',404,'error','region_review_not_found');end if;
  if review.status='applied' then return review.response;end if;
  if review.expires_at<now() then return jsonb_build_object('status',409,'error','preview_stale');end if;
  -- Validate every version/protection BEFORE writing any row. The shared gate serializes writers.
  for e in select value from jsonb_array_elements(review.entries) loop
   select * into p from private.favorite_places where id=(e->>'id')::uuid;
   if not found or p.version is distinct from (e->>'expected')::int then return jsonb_build_object('status',409,'error','favorite_conflict');end if;
   if p.archived or (p.geo_evidence->'verified'='true'::jsonb and length(trim(coalesce(p.geo_evidence->>'region','')))>0 and p.geo_evidence->>'region' not in ('待确认','待确认地区')) or (p.manual_fields->'region'='true'::jsonb and p.region not in ('待确认地区','待确认')) then return jsonb_build_object('status',409,'error','region_protected');end if;
  end loop;
  for e in select value from jsonb_array_elements(review.entries) loop
   select * into p from private.favorite_places where id=(e->>'id')::uuid;before_p:=to_jsonb(p);
   ev:=(e->'evidence')||jsonb_build_object('verified',true,'confirmed_at',now(),'review_operation',op);
   update private.favorite_places set region=e->>'region',geo_evidence=ev,manual_fields=manual_fields||'{"region":true}'::jsonb,version=version+1,updated_at=now() where id=p.id returning * into p;
   insert into private.favorite_revisions(place_id,operation,request_hash,action,before_data,after_data,version) values(p.id,op,review.request_hash,'region_confirm',before_p,to_jsonb(p),p.version);
  end loop;
  v_response:=jsonb_build_object('ok',true,'operation',op,'reviewStatus','applied','count',jsonb_array_length(review.entries));
  update private.favorite_region_reviews set status='applied',response=v_response where operation=op;
  return v_response;
 end if;
 return jsonb_build_object('status',400,'error','invalid_action');
exception when invalid_text_representation or numeric_value_out_of_range or not_null_violation or check_violation then return jsonb_build_object('status',400,'error','invalid_request');
end $$;
create or replace function public.favorite_region_request(p_action text,p_body jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.favorite_region_request(p_action,p_body);$$;
revoke all on function private.favorite_region_request(text,jsonb),public.favorite_region_request(text,jsonb) from public,anon,authenticated;
grant execute on function private.favorite_region_request(text,jsonb),public.favorite_region_request(text,jsonb) to service_role;
commit;
