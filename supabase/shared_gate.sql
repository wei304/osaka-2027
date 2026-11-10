-- Shared-password access. Apply after schema.sql and harden.sql.
-- A one-use setup-token hash is provisioned separately; no secret belongs here.
begin;
create table if not exists private.shared_gate (
 trip_id text primary key check(trip_id='osaka-2027'),
 password_hash text,
 setup_hash bytea,
 setup_expires timestamptz,
 generation integer not null default 1
);
create table if not exists private.shared_sessions (
 token_hash bytea primary key,
 generation integer not null,
 expires_at timestamptz not null
);
create table if not exists private.shared_attempts (
 bucket text not null,
 started_at timestamptz not null,
 attempts integer not null,
 primary key(bucket,started_at)
);
alter table private.shared_gate enable row level security;
alter table private.shared_sessions enable row level security;
alter table private.shared_attempts enable row level security;
revoke all on private.shared_gate,private.shared_sessions,private.shared_attempts from public,anon,authenticated;
insert into private.shared_gate(trip_id) values('osaka-2027') on conflict do nothing;
create or replace function private.issue_shared_session(p_generation integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare raw_token text; expiry timestamptz:=now()+interval '180 days';
begin
 raw_token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into private.shared_sessions(token_hash,generation,expires_at)
 values(extensions.digest(raw_token,'sha256'),p_generation,expiry);
 return jsonb_build_object('token',raw_token,'expiresAt',(extract(epoch from expiry)*1000)::bigint);
end $$;
revoke all on function private.issue_shared_session(integer) from public,anon,authenticated;
create or replace function private.shared_trip_request(p_action text,p_body jsonb,p_network text) returns jsonb
language plpgsql security definer set search_path='' as $$
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
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'item_id',item_id,'payload',payload,'version',version,'created_at',created_at) order by created_at desc),'[]'::jsonb) into rows_json
   from (select id,item_id,payload,version,created_at from public.trip_revisions where trip_id=gate.trip_id order by created_at desc limit 100) recent;
  return jsonb_build_object('revisions',rows_json);
 end if;
 if p_action<>'apply' then return jsonb_build_object('status',400,'error','invalid_action'); end if;
 item:=p_body->'item'; item_id:=item->>'id';
 if item_id is null or item_id !~ '^[a-zA-Z0-9_-]{1,100}$'
  or jsonb_typeof(item) is distinct from 'object' or length(item::text)>24000
  or coalesce(length(trim(item->>'title')),0) not between 1 and 160
  or coalesce(item->>'day','') not in ('2027-01-10','2027-01-11','2027-01-12','2027-01-13','2027-01-14','2027-01-15','2027-01-16','2027-01-17')
  or coalesce(item->>'status','') not in ('pending','confirmed','booked')
  or coalesce(p_body->>'expected','') !~ '^[0-9]{1,9}$'
  or coalesce(p_body->>'operation','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
 then return jsonb_build_object('status',400,'error','invalid_item'); end if;
 expected:=(p_body->>'expected')::integer;operation:=(p_body->>'operation')::uuid;
 perform pg_advisory_xact_lock(hashtextextended(gate.trip_id,1));
 select * into prior from public.trip_revisions where id=operation;
 if found then
  if prior.trip_id<>gate.trip_id or prior.item_id<>item_id or prior.payload<>item then return jsonb_build_object('status',400,'error','operation_reused'); end if;
  return jsonb_build_object('conflict',false,'row',jsonb_build_object('id',item_id,'payload',prior.payload,'version',prior.version));
 end if;
 select * into current_row from public.trip_items where trip_id=gate.trip_id and id=item_id;
 if coalesce(current_row.version,0)<>expected then return jsonb_build_object('conflict',true,'row',case when current_row.id is null then null else jsonb_build_object('id',current_row.id,'payload',current_row.payload,'version',current_row.version) end); end if;
 if current_row.id is null and (select count(*) from public.trip_items where trip_id=gate.trip_id)>=500 then return jsonb_build_object('status',400,'error','item_limit'); end if;
 insert into public.trip_items(trip_id,id,payload,version) values(gate.trip_id,item_id,item,expected+1)
 on conflict(trip_id,id) do update set payload=excluded.payload,version=excluded.version,updated_at=now() returning * into saved;
 insert into public.trip_revisions(id,trip_id,item_id,payload,version,actor) values(operation,gate.trip_id,item_id,item,saved.version,'共用编辑');
 return jsonb_build_object('conflict',false,'row',jsonb_build_object('id',saved.id,'payload',saved.payload,'version',saved.version));
end $$;
revoke all on function private.shared_trip_request(text,jsonb,text) from public,anon,authenticated;
grant execute on function private.shared_trip_request(text,jsonb,text) to service_role;
grant usage on schema private to service_role;
create or replace function public.shared_trip_request(p_action text,p_body jsonb,p_network text) returns jsonb
language sql security invoker set search_path='' as $$ select private.shared_trip_request(p_action,p_body,p_network); $$;
revoke all on function public.shared_trip_request(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.shared_trip_request(text,jsonb,text) to service_role;
commit;
