-- Apply only after the complete private snapshot and isolated migration tests.
-- Existing itinerary and revision rows are never rewritten by this migration.
begin;
create table if not exists private.trip_batches(operation uuid primary key,trip_id text not null,request jsonb not null,response jsonb not null,created_at timestamptz not null default now());
alter table private.trip_batches enable row level security;
revoke all on private.trip_batches from public,anon,authenticated;
create or replace function private.apply_trip_batch(p_body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $batch$
declare entry jsonb; result jsonb; rows_json jsonb:='[]'; before_json jsonb:='[]'; current_row public.trip_items; previous private.trip_batches; v_operation uuid;
begin
 if jsonb_typeof(p_body->'entries') is distinct from 'array' or jsonb_array_length(p_body->'entries') not between 1 and 50 or coalesce(p_body->>'operation','')!~'^[a-fA-F0-9-]{36}$' then return jsonb_build_object('status',400,'error','invalid_batch');end if;
 v_operation:=(p_body->>'operation')::uuid;
 if (select count(distinct e->'item'->>'id') from jsonb_array_elements(p_body->'entries') e)<>jsonb_array_length(p_body->'entries') then return jsonb_build_object('status',400,'error','invalid_batch');end if;
 select * into previous from private.trip_batches where trip_batches.operation=v_operation;
 if found then if previous.request<>p_body->'entries' then return jsonb_build_object('status',400,'error','operation_reused');end if;return previous.response;end if;
 for entry in select * from jsonb_array_elements(p_body->'entries') loop
  if coalesce(entry->>'expected','')!~'^[0-9]{1,9}$' then return jsonb_build_object('status',400,'error','invalid_batch');end if;
  select * into current_row from public.trip_items where trip_id='osaka-2027' and id=entry->'item'->>'id';
  if found then rows_json:=rows_json||jsonb_build_array(jsonb_build_object('id',current_row.id,'payload',current_row.payload,'version',current_row.version));before_json:=before_json||jsonb_build_array(current_row.payload);end if;
 end loop;
 for entry in select * from jsonb_array_elements(p_body->'entries') loop
  select * into current_row from public.trip_items where trip_id='osaka-2027' and id=entry->'item'->>'id';
  if coalesce(current_row.version,0)<>(entry->>'expected')::integer then return jsonb_build_object('conflict',true,'rows',rows_json);end if;
 end loop;
 rows_json:='[]';
 begin
  for entry in select * from jsonb_array_elements(p_body->'entries') loop
   result:=private.shared_trip_request('apply',jsonb_build_object('token',p_body->>'token','item',entry->'item','expected',(entry->>'expected')::integer,'operation',gen_random_uuid()),'');
   if coalesce((result->>'conflict')::boolean,false) or result ? 'status' then raise exception using errcode='P0001',message='batch_rejected';end if;
   rows_json:=rows_json||jsonb_build_array(result->'row');
  end loop;
 exception when sqlstate 'P0001' then return jsonb_build_object('status',400,'error','batch_rejected');end;
 result:=jsonb_build_object('conflict',false,'rows',rows_json,'before',before_json);
 insert into private.trip_batches(operation,trip_id,request,response) values(v_operation,'osaka-2027',p_body->'entries',result);
 return result;
end $batch$;
revoke all on function private.apply_trip_batch(jsonb) from public,anon,authenticated;

create table if not exists private.trip_files(
 id uuid primary key,trip_id text not null check(trip_id='osaka-2027'),ticket_id text not null,
 storage_path text not null unique,original_name text not null,mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
 bytes integer not null check(bytes between 1 and 5242880),status text not null check(status in ('pending','ready','removed')),
 sha256 text not null check(sha256~'^[a-f0-9]{64}$'),version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists private.trip_file_revisions(id uuid primary key default gen_random_uuid(),file_id uuid not null,payload jsonb not null,version integer not null,created_at timestamptz not null default now());
alter table private.trip_files enable row level security;
alter table private.trip_file_revisions enable row level security;
revoke all on private.trip_files,private.trip_file_revisions from public,anon,authenticated;
create or replace function private.trip_file_request(p_action text,p_body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $files$
declare checked jsonb; f private.trip_files; doc public.trip_items; file_id uuid; listing jsonb;
begin
 checked:=private.shared_trip_request('check',jsonb_build_object('token',p_body->>'token'),'');
 if checked->>'ok' is distinct from 'true' then return checked;end if;
 if p_action='list' then
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'ticketId',t.ticket_id,'name',t.original_name,'type',t.mime_type,'bytes',t.bytes,'status',t.status,'version',t.version) order by t.created_at),'[]') into listing
  from private.trip_files t join public.trip_items d on d.trip_id=t.trip_id and d.id=t.ticket_id where not coalesce((d.payload->>'deleted')::boolean,false);
  return jsonb_build_object('files',listing);
 end if;
 if coalesce(p_body->>'fileId','')!~'^[a-fA-F0-9-]{36}$' then return jsonb_build_object('status',400,'error','invalid_file');end if;
 file_id:=(p_body->>'fileId')::uuid;
 select * into f from private.trip_files where id=file_id for update;
 if p_action='reserve' then
  select * into doc from public.trip_items where trip_id='osaka-2027' and id=p_body->>'ticketId' and id like 'ticket-%' and not coalesce((payload->>'deleted')::boolean,false) and payload->>'notes' like '【旅行票券 v1】%';
  if not found then return jsonb_build_object('status',404,'error','ticket_not_found');end if;
  if f.id is not null then
   if f.ticket_id<>doc.id or f.mime_type<>p_body->>'type' or f.bytes<>(p_body->>'bytes')::int or f.original_name<>p_body->>'name' or f.sha256 is distinct from p_body->>'hash' then return jsonb_build_object('status',409,'error','operation_reused');end if;
   if f.status='removed' then return jsonb_build_object('status',409,'error','file_removed');end if;
   return jsonb_build_object('file',to_jsonb(f));
  end if;
  if coalesce(p_body->>'type','') not in ('application/pdf','image/jpeg','image/png','image/webp') or coalesce(p_body->>'bytes','')!~'^[0-9]{1,8}$' or (p_body->>'bytes')::int not between 1 and 5242880 or length(coalesce(p_body->>'name','')) not between 1 and 160 then return jsonb_build_object('status',400,'error','invalid_file');end if;
  if (select count(*) from private.trip_files)>=30 or (select coalesce(sum(bytes),0) from private.trip_files)+(p_body->>'bytes')::int>52428800 then return jsonb_build_object('status',400,'error','file_quota');end if;
  if coalesce(p_body->>'hash','')!~'^[a-f0-9]{64}$' then return jsonb_build_object('status',400,'error','invalid_file');end if;
  insert into private.trip_files(id,trip_id,ticket_id,storage_path,original_name,mime_type,bytes,status,sha256) values(file_id,'osaka-2027',doc.id,'osaka-2027/'||file_id::text,p_body->>'name',p_body->>'type',(p_body->>'bytes')::int,'pending',p_body->>'hash') returning * into f;
  insert into private.trip_file_revisions(file_id,payload,version) values(f.id,to_jsonb(f),f.version);
  return jsonb_build_object('file',to_jsonb(f));
 end if;
 if f.id is null then return jsonb_build_object('status',404,'error','file_not_found');end if;
 select * into doc from public.trip_items where trip_id=f.trip_id and id=f.ticket_id and not coalesce((payload->>'deleted')::boolean,false);
 if not found then return jsonb_build_object('status',404,'error','ticket_not_found');end if;
 if p_action='get' then if f.status<>'ready' then return jsonb_build_object('status',404,'error','file_not_ready');end if;return jsonb_build_object('file',to_jsonb(f));end if;
 if p_action='finalize' then
  if f.status='removed' then return jsonb_build_object('status',409,'error','file_removed');end if;
  if f.status='ready' then return jsonb_build_object('file',to_jsonb(f));end if;
  update private.trip_files set status='ready',version=version+1,updated_at=now() where id=f.id returning * into f;
 elsif p_action in ('remove','restore') then
  if coalesce(p_body->>'expected','')!~'^[0-9]{1,9}$' or f.version<>(p_body->>'expected')::int then return jsonb_build_object('status',409,'error','file_conflict');end if;
  if p_action='restore' and not exists(select 1 from private.trip_file_revisions where trip_file_revisions.file_id=f.id and payload->>'status'='ready') then return jsonb_build_object('status',400,'error','file_not_ready');end if;
  update private.trip_files set status=case when p_action='remove' then 'removed' else 'ready' end,version=version+1,updated_at=now() where id=f.id returning * into f;
 else return jsonb_build_object('status',400,'error','invalid_action');end if;
 insert into private.trip_file_revisions(file_id,payload,version) values(f.id,to_jsonb(f),f.version);
 return jsonb_build_object('file',to_jsonb(f));
end $files$;
revoke all on function private.trip_file_request(text,jsonb) from public,anon,authenticated;
create or replace function public.trip_file_request(p_action text,p_body jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.trip_file_request(p_action,p_body);$$;
revoke all on function public.trip_file_request(text,jsonb) from public,anon,authenticated;
grant execute on function private.trip_file_request(text,jsonb),public.trip_file_request(text,jsonb) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('osaka-tickets','osaka-tickets',false,5242880,array['application/pdf','image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
do $$begin if exists(select 1 from storage.buckets where id='osaka-tickets' and public) then raise exception 'Ticket bucket must remain private';end if;end$$;
commit;
