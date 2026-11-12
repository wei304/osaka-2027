-- Additive date relationship batches; never writes formal itinerary records.
begin;
create table if not exists private.favorite_day_batches(operation uuid primary key,request_hash text not null,entries jsonb not null,response jsonb not null,created_at timestamptz not null default now());
alter table private.favorite_day_batches enable row level security;
revoke all on private.favorite_day_batches from public,anon,authenticated;
do $$begin if to_regprocedure('private.favorite_request_before_batch_days(text,jsonb)') is null then alter function private.favorite_request(text,jsonb) rename to favorite_request_before_batch_days;end if;end$$;
create or replace function private.favorite_request(p_action text,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;e jsonb;cur private.favorite_places;b private.favorite_day_batches;op uuid;h text;child uuid;before_days jsonb;changed int:=0;added int:=0;removed int:=0;noops int:=0;failure jsonb;
begin
 if p_action in ('link_days','edit','restore','undo_import','import') and exists(select 1 from private.favorite_day_batches where operation=(p_body->>'operation')::uuid) then
  r:=private.favorite_request_before_batch_days('rows',jsonb_build_object('token',p_body->>'token'));if r ? 'status' then return r;end if;return jsonb_build_object('status',400,'error','operation_reused');end if;
 if p_action not in ('link_days_batch','days_context') then return private.favorite_request_before_batch_days(p_action,p_body);end if;
 if p_body is null or jsonb_typeof(p_body)<>'object' or length(p_body::text)>48000 then return jsonb_build_object('status',400,'error','invalid_request');end if;
 -- Reuse the existing shared gate lock and session validation before reading private data.
 r:=private.favorite_request_before_batch_days('rows',jsonb_build_object('token',p_body->>'token'));if r ? 'status' then return r;end if;
 if p_action='days_context' then return jsonb_build_object('fetchedAt',now(),'profiles',coalesce((select jsonb_agg(jsonb_build_object('day',f.day,'regions',f.regions,'valid',f.scope_hash=md5(private.favorite_day_scope(f.day)::text),'version',f.version) order by f.day) from private.favorite_day_regions f),'[]'));end if;
 op:=(p_body->>'operation')::uuid;if op is null or p_body->'confirmed' is distinct from 'true'::jsonb then return jsonb_build_object('status',400,'error','confirmation_required');end if;
 h:=encode(extensions.digest((p_body-'token')::text,'sha256'),'hex');select * into b from private.favorite_day_batches where operation=op;
 if found then if b.request_hash<>h then return jsonb_build_object('status',400,'error','operation_reused');end if;return b.response||'{"replayed":true}'::jsonb;end if;
 if exists(select 1 from private.favorite_ai_jobs where operation=op) or exists(select 1 from private.favorite_day_region_revisions where operation=op) or exists(select 1 from private.favorite_revisions where operation=op) or exists(select 1 from private.favorite_import_batches where operation=op or undo_operation=op) then return jsonb_build_object('status',400,'error','operation_reused');end if;
 if jsonb_typeof(p_body->'entries') is distinct from 'array' or jsonb_array_length(p_body->'entries') not between 1 and 100 or (select count(distinct x->>'id') from jsonb_array_elements(p_body->'entries')x)<>jsonb_array_length(p_body->'entries') then return jsonb_build_object('status',400,'error','invalid_days_batch');end if;
 -- Check the complete selection BEFORE any mutation.
 for e in select value from jsonb_array_elements(p_body->'entries') loop
  if jsonb_typeof(e) is distinct from 'object' or e-array['id','expected','days']<>'{}'::jsonb or jsonb_typeof(e->'expected') is distinct from 'number' or (e->>'expected')::numeric<>(e->>'expected')::int or jsonb_typeof(e->'days') is distinct from 'array' or jsonb_array_length(e->'days')>9 or exists(select 1 from jsonb_array_elements(e->'days')x where jsonb_typeof(x)<>'string' or x#>>'{}' not in ('2027-01-09','2027-01-10','2027-01-11','2027-01-12','2027-01-13','2027-01-14','2027-01-15','2027-01-16','2027-01-17')) or (select count(distinct x) from jsonb_array_elements(e->'days')x)<>jsonb_array_length(e->'days') then return jsonb_build_object('status',400,'error','invalid_days');end if;
  select * into cur from private.favorite_places where id=(e->>'id')::uuid and trip_id='osaka-2027';
  if not found then return jsonb_build_object('status',404,'error','favorite_not_found');end if;
  if cur.version is distinct from (e->>'expected')::int then return jsonb_build_object('status',409,'error','favorite_conflict');end if;
  if cur.archived and jsonb_array_length(e->'days')>0 then return jsonb_build_object('status',400,'error','favorite_archived');end if;
 end loop;
 -- Delegate every actual mutation to the SAME single-place date RPC.
 begin
  for e in select value from jsonb_array_elements(p_body->'entries') order by value->>'id' loop
   select coalesce(jsonb_agg(day::text order by day),'[]') into before_days from private.favorite_day_links where place_id=(e->>'id')::uuid and active;
   if before_days @> (e->'days') and (e->'days') @> before_days then noops:=noops+1;continue;end if;
   child:=md5(op::text||':'||(e->>'id'))::uuid;
   r:=private.favorite_request_before_batch_days('link_days',jsonb_build_object('token',p_body->>'token','operation',child,'id',e->>'id','expected',e->'expected','days',e->'days'));
   if r ? 'status' then failure:=r;raise exception 'date batch rejected' using errcode='P0001';end if;
   changed:=changed+1;added:=added+(select count(*) from jsonb_array_elements(e->'days')x where not(before_days ? (x#>>'{}')));removed:=removed+(select count(*) from jsonb_array_elements(before_days)x where not(e->'days' ? (x#>>'{}')));
  end loop;
  r:=jsonb_build_object('ok',true,'operation',op,'places',jsonb_array_length(p_body->'entries'),'changed',changed,'unchanged',noops,'added',added,'removed',removed);
  insert into private.favorite_day_batches(operation,request_hash,entries,response) values(op,h,p_body->'entries',r);
 exception when sqlstate 'P0001' then if failure is null then raise;end if;return failure;
 end;
 return r;
exception when invalid_text_representation or numeric_value_out_of_range or not_null_violation or check_violation or unique_violation or raise_exception then return jsonb_build_object('status',400,'error','invalid_days_batch');
end$$;
create or replace function public.favorite_request(p_action text,p_body jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.favorite_request(p_action,p_body);$$;
revoke all on function private.favorite_request_before_batch_days(text,jsonb),private.favorite_request(text,jsonb),public.favorite_request(text,jsonb) from public,anon,authenticated;
grant execute on function private.favorite_request(text,jsonb),public.favorite_request(text,jsonb) to service_role;
commit;
