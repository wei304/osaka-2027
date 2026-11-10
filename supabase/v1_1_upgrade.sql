-- V1.1 additive compatibility upgrade. Back up all items/revisions before applying.
-- No data rewrite, table deletion or permission widening.
begin;
create or replace function private.merge_plan_notes(old_notes text,new_notes text) returns text
language plpgsql immutable set search_path='' as $merge$
declare old_text text; new_text text; old_meta jsonb:='{}'; new_meta jsonb:='{}'; retained jsonb; clean text;
begin
 old_text:=substring(coalesce(old_notes,'') from '(?n)^【安排建议 v1】([^\n]+)$');
 new_text:=substring(coalesce(new_notes,'') from '(?n)^【安排建议 v1】([^\n]+)$');
 begin old_meta:=coalesce(old_text::jsonb,'{}');exception when others then old_meta:='{}';end;
 begin new_meta:=coalesce(new_text::jsonb,'{}');exception when others then new_meta:='{}';end;
 if jsonb_typeof(old_meta)<>'object' then old_meta:='{}';end if;
 if jsonb_typeof(new_meta)<>'object' then new_meta:='{}';end if;
 if new_text is null then retained:=old_meta-array['end','summary','group','kind','state','suggested','map'];else retained:=old_meta||new_meta;end if;
 if retained='{}'::jsonb then return coalesce(new_notes,'');end if;
 clean:=regexp_replace(coalesce(new_notes,''),'(?n)^【安排建议 v1】[^\n]*\n?','','g');
 return '【安排建议 v1】'||retained::text||E'\n'||clean;
end $merge$;
revoke all on function private.merge_plan_notes(text,text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION private.shared_trip_request(p_action text, p_body jsonb, p_network text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$

declare

 gate private.shared_gate; token text; password text; bucket_time timestamptz;

 network_count integer; global_count integer; result jsonb; rows_json jsonb;

 item jsonb; item_id text; expected integer; operation uuid;

 current_row public.trip_items; prior public.trip_revisions; saved public.trip_items;

begin

 if p_body is null or jsonb_typeof(p_body)<>'object' or length(p_body::text)>48000 then return jsonb_build_object('status',400,'error','invalid_request'); end if;

 select * into gate from private.shared_gate where trip_id='osaka-2027' for update;

 if p_action='status' then return jsonb_build_object('configured',gate.password_hash is not null); end if;

 if p_action in ('setup','unlock','rotate') then

  bucket_time:=to_timestamp(floor(extract(epoch from now())/600)*600);

  delete from private.shared_attempts where started_at<now()-interval '1 day';

  delete from private.shared_sessions where expires_at<now();

  insert into private.shared_attempts(bucket,started_at,attempts) values('global',bucket_time,1)

   on conflict(bucket,started_at) do update set attempts=private.shared_attempts.attempts+1 returning attempts into global_count;

  insert into private.shared_attempts(bucket,started_at,attempts) values('network:'||left(coalesce(p_network,'unknown'),128),bucket_time,1)

   on conflict(bucket,started_at) do update set attempts=private.shared_attempts.attempts+1 returning attempts into network_count;

  if global_count>120 or network_count>10 then return jsonb_build_object('status',429,'error','too_many_attempts','retryAfter',greatest(1,ceil(extract(epoch from (bucket_time+interval '10 minutes'-now())))::integer)); end if;

 end if;

 if p_action='setup' then

  if gate.password_hash is not null then return jsonb_build_object('status',409,'error','already_configured'); end if;

  if gate.setup_hash is null or gate.setup_expires is null or gate.setup_expires<now() or gate.setup_hash<>extensions.digest(coalesce(p_body->>'setupToken',''),'sha256') then return jsonb_build_object('status',403,'error','invalid_setup_link'); end if;

  password:=p_body->>'password';

  if password is null or length(password)<10 or octet_length(password)>72 then return jsonb_build_object('status',400,'error','invalid_password_length'); end if;

  update private.shared_gate set password_hash=extensions.crypt(password,extensions.gen_salt('bf',10)),setup_hash=null,setup_expires=null where trip_id=gate.trip_id;

  -- The shared gate replaces all direct access through the former member accounts.

  revoke all on public.trip_items,public.trip_revisions,public.trip_members from anon,authenticated;

  revoke all on function public.apply_trip_change(text,text,jsonb,integer,uuid) from public,anon,authenticated;

  revoke all on function private.apply_trip_change(text,text,jsonb,integer,uuid) from public,anon,authenticated;

  return jsonb_build_object('session',private.issue_shared_session(gate.generation));

 end if;

 if gate.password_hash is null then return jsonb_build_object('status',409,'error','not_configured'); end if;

 if p_action='unlock' then

  password:=p_body->>'password';

  if password is null or octet_length(password)>72 or extensions.crypt(password,gate.password_hash)<>gate.password_hash then return jsonb_build_object('status',401,'error','wrong_password'); end if;

  return jsonb_build_object('session',private.issue_shared_session(gate.generation));

 end if;

 token:=coalesce(p_body->>'token','');

 if token !~ '^[a-f0-9]{64}$' or not exists(select 1 from private.shared_sessions where token_hash=extensions.digest(token,'sha256') and generation=gate.generation and expires_at>now()) then return jsonb_build_object('status',401,'error','locked'); end if;

 if p_action='check' then return jsonb_build_object('ok',true); end if;

 if p_action='lock' then

  delete from private.shared_sessions where token_hash=extensions.digest(token,'sha256');

  return jsonb_build_object('ok',true);

 end if;

 if p_action='rotate' then

  password:=p_body->>'currentPassword';

  if password is null or octet_length(password)>72 or extensions.crypt(password,gate.password_hash)<>gate.password_hash then return jsonb_build_object('status',401,'error','wrong_current_password'); end if;

  password:=p_body->>'password';

  if password is null or length(password)<10 or octet_length(password)>72 then return jsonb_build_object('status',400,'error','invalid_password_length'); end if;

  update private.shared_gate set password_hash=extensions.crypt(password,extensions.gen_salt('bf',10)),generation=generation+1 where trip_id=gate.trip_id returning * into gate;

  delete from private.shared_sessions;

  return jsonb_build_object('session',private.issue_shared_session(gate.generation));

 end if;

 if p_action='rows' then

  select coalesce(jsonb_agg(jsonb_build_object('id',id,'payload',payload,'version',version) order by id),'[]'::jsonb) into rows_json from public.trip_items where trip_id=gate.trip_id;

  return jsonb_build_object('rows',rows_json);

 end if;

 if p_action='history' then

  select coalesce(jsonb_agg(jsonb_build_object('id',recent.id,'item_id',recent.item_id,'payload',recent.payload,'version',recent.version,'created_at',recent.created_at) order by recent.created_at desc),'[]'::jsonb) into rows_json

   from (select h.id,h.item_id,h.payload,h.version,h.created_at from public.trip_revisions h where h.trip_id=gate.trip_id order by h.created_at desc limit 100) recent;

  return jsonb_build_object('revisions',rows_json);

 end if;

 if p_action<>'apply' then return jsonb_build_object('status',400,'error','invalid_action'); end if;

 item:=p_body->'item'; item_id:=item->>'id';

 if item_id is null or item_id !~ '^[a-zA-Z0-9_-]{1,100}$'

  or jsonb_typeof(item) is distinct from 'object' or length(item::text)>24000

  or coalesce(length(trim(item->>'title')),0) not between 1 and 160

  or coalesce(item->>'day','') not in ('2027-01-09','2027-01-10','2027-01-11','2027-01-12','2027-01-13','2027-01-14','2027-01-15','2027-01-16','2027-01-17')

  or coalesce(item->>'status','') not in ('pending','confirmed','booked')

  or coalesce(p_body->>'expected','') !~ '^[0-9]{1,9}$'

  or coalesce(p_body->>'operation','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

 then return jsonb_build_object('status',400,'error','invalid_item'); end if;

 expected:=(p_body->>'expected')::integer;operation:=(p_body->>'operation')::uuid;

 perform pg_advisory_xact_lock(hashtextextended(gate.trip_id,1));

 select * into prior from public.trip_revisions where id=operation;

 if found then

  if prior.trip_id<>gate.trip_id or prior.item_id<>item_id or prior.payload<>jsonb_set(item,'{notes}',to_jsonb(private.merge_plan_notes(prior.payload->>'notes',item->>'notes'))) then return jsonb_build_object('status',400,'error','operation_reused'); end if;

  return jsonb_build_object('conflict',false,'row',jsonb_build_object('id',item_id,'payload',prior.payload,'version',prior.version));

 end if;

 select * into current_row from public.trip_items where trip_id=gate.trip_id and id=item_id;

 if coalesce(current_row.version,0)<>expected then return jsonb_build_object('conflict',true,'row',case when current_row.id is null then null else jsonb_build_object('id',current_row.id,'payload',current_row.payload,'version',current_row.version) end); end if;

 if current_row.id is null then
  if (select count(*) from public.trip_items where trip_id=gate.trip_id)>=1200
   or (item_id like 'tool-%' and (select count(*) from public.trip_items where trip_id=gate.trip_id and id like 'tool-%')>=200)
   or (item_id like 'ledger-%' and (select count(*) from public.trip_items where trip_id=gate.trip_id and id like 'ledger-%')>=500)
   or (item_id not like 'tool-%' and item_id not like 'ledger-%' and (select count(*) from public.trip_items where trip_id=gate.trip_id and id not like 'tool-%' and id not like 'ledger-%')>=500)
  then return jsonb_build_object('status',400,'error','item_limit');end if;
 end if;
 item:=jsonb_set(item,'{notes}',to_jsonb(private.merge_plan_notes(current_row.payload->>'notes',item->>'notes')));

 insert into public.trip_items(trip_id,id,payload,version) values(gate.trip_id,item_id,item,expected+1)

 on conflict(trip_id,id) do update set payload=excluded.payload,version=excluded.version,updated_at=now() returning * into saved;

 insert into public.trip_revisions(id,trip_id,item_id,payload,version,actor) values(operation,gate.trip_id,item_id,item,saved.version,'���ñ༭');

 return jsonb_build_object('conflict',false,'row',jsonb_build_object('id',saved.id,'payload',saved.payload,'version',saved.version));

end $function$;

CREATE OR REPLACE FUNCTION private.apply_trip_change(p_trip text, p_id text, p_payload jsonb, p_expected integer, p_operation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare current_row public.trip_items; old_revision public.trip_revisions; result_row public.trip_items;
begin
 if auth.uid() is null or not public.is_trip_member(p_trip) then raise exception 'Not a trip member' using errcode='42501'; end if;
 if p_id !~ '^[a-zA-Z0-9_-]{1,100}$' or p_payload->>'id' is distinct from p_id
  or jsonb_typeof(p_payload) is distinct from 'object'
  or length(p_payload::text)>24000
  or coalesce(length(trim(p_payload->>'title')),0) not between 1 and 160
  or coalesce(p_payload->>'day','') not in ('2027-01-09','2027-01-10','2027-01-11','2027-01-12','2027-01-13','2027-01-14','2027-01-15','2027-01-16','2027-01-17')
  or coalesce(p_payload->>'status','') not in ('pending','confirmed','booked')
 then raise exception 'Invalid itinerary data'; end if;
 -- Per-trip lock covers first insertion, and makes operation retries idempotent.
 perform pg_advisory_xact_lock(hashtextextended(p_trip,1));
 select * into old_revision from public.trip_revisions where id=p_operation;
 if found then
  if old_revision.trip_id<>p_trip or old_revision.item_id<>p_id or old_revision.payload<>p_payload then raise exception 'Operation ID reused'; end if;
  return jsonb_build_object('conflict',false,'row',jsonb_build_object('id',p_id,'payload',old_revision.payload,'version',old_revision.version));
 end if;
 select * into current_row from public.trip_items where trip_id=p_trip and id=p_id;
 if coalesce(current_row.version,0)<>p_expected then return jsonb_build_object('conflict',true,'row',case when current_row.id is null then null else to_jsonb(current_row) end); end if;
 if current_row.id is null and (select count(*) from public.trip_items where trip_id=p_trip)>=500 then raise exception 'Trip has reached 500 items'; end if;
 insert into public.trip_items(trip_id,id,payload,version) values(p_trip,p_id,p_payload,p_expected+1)
 on conflict(trip_id,id) do update set payload=excluded.payload,version=excluded.version,updated_at=now()
 returning * into result_row;
 insert into public.trip_revisions(id,trip_id,item_id,payload,version,actor) values(p_operation,p_trip,p_id,p_payload,result_row.version,lower(auth.jwt()->>'email'));
 return jsonb_build_object('conflict',false,'row',to_jsonb(result_row));
end $function$;

revoke all on function private.shared_trip_request(text,jsonb,text),private.apply_trip_change(text,text,jsonb,integer,uuid) from public,anon,authenticated;
grant execute on function private.shared_trip_request(text,jsonb,text) to service_role;
commit;
