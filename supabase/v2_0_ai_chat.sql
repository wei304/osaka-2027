-- Additive receipts only; complete conversations stay in device IndexedDB.
-- Reuses the existing shared gate, policy lock, usage reservations and drafts.
begin;
create table if not exists private.ai_chat_receipts(
 operation uuid primary key,token_hash bytea not null,conversation_id uuid not null,message_id uuid not null,
 input_hash text not null check(length(input_hash)=64),request_id uuid unique references private.ai_usage(id),
 phase text not null check(phase in ('pending','ready','failed','expired')),response jsonb,
 created_at timestamptz not null default now()
);
alter table private.ai_chat_receipts enable row level security;
revoke all on private.ai_chat_receipts from public,anon,authenticated;
create index if not exists ai_chat_receipts_created on private.ai_chat_receipts(created_at);
create or replace function private.ai_chat_request(p_action text,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare checked jsonb;tok text;th bytea;op uuid;j private.ai_chat_receipts;r jsonb;v_response jsonb;
begin
 if p_body is null or jsonb_typeof(p_body)<>'object' or length(p_body::text)>30000 then return jsonb_build_object('status',400,'error','invalid_request');end if;
 tok:=p_body->>'token';checked:=private.shared_trip_request('check',jsonb_build_object('token',tok),'');if checked->>'ok' is distinct from 'true' then return checked;end if;
 -- Same lock order as ai_trip_request: shared gate -> policy -> receipt/usage.
 perform 1 from private.ai_policy where id=true for update;
 th:=extensions.digest(tok,'sha256');
 if p_action='status' then return private.ai_trip_request('status',p_body)||jsonb_build_object('maxReservationCny',(select 16000*max_price_per_million_cny/1000000 from private.ai_policy where id=true));end if;
 if p_action='sources' then return private.favorite_request('rows',jsonb_build_object('token',tok));end if;
 op:=(p_body->>'operation')::uuid;if op is null then return jsonb_build_object('status',400,'error','invalid_request');end if;
 select * into j from private.ai_chat_receipts where operation=op for update;
 if found and j.token_hash<>th then return jsonb_build_object('status',404,'error','chat_request_not_found');end if;
 if j.operation is not null then
  if p_body ? 'hash' and p_body->>'hash' is distinct from j.input_hash then return jsonb_build_object('status',409,'error','operation_reused');end if;
  if j.created_at<now()-interval '24 hours' then update private.ai_chat_receipts set phase='expired',response=null where operation=op returning * into j;end if;
  if j.phase='pending' and j.created_at<now()-interval '90 seconds' then
   perform private.ai_trip_request('fail',jsonb_build_object('token',tok,'requestId',j.request_id));
   update private.ai_chat_receipts set phase='failed' where operation=op returning * into j;
  end if;
 end if;
 if p_action in ('recover','prepare') and j.operation is not null then return jsonb_build_object('jobStatus',j.phase,'response',j.response,'claimed',false);end if;
 if p_action='prepare' then
  if coalesce(p_body->>'hash','')!~'^[0-9a-f]{64}$' or p_body->>'conversation_id' is null or p_body->>'message_id' is null then return jsonb_build_object('status',400,'error','invalid_chat_context');end if;
  r:=private.ai_trip_request('reserve',p_body||jsonb_build_object('cache',false));if r ? 'status' then return r;end if;
  insert into private.ai_chat_receipts(operation,token_hash,conversation_id,message_id,input_hash,request_id,phase) values(op,th,(p_body->>'conversation_id')::uuid,(p_body->>'message_id')::uuid,p_body->>'hash',(r->>'requestId')::uuid,'pending');
  return r||jsonb_build_object('claimed',true);
 end if;
 if j.operation is null then return jsonb_build_object('status',404,'error','chat_request_not_found');end if;
 if p_action='recover' then return jsonb_build_object('jobStatus',j.phase,'response',j.response);end if;
 if p_action='fail' then
  if j.phase='pending' then perform private.ai_trip_request('fail',jsonb_build_object('token',tok,'requestId',j.request_id));update private.ai_chat_receipts set phase='failed' where operation=op;end if;
  return jsonb_build_object('ok',true);
 end if;
 if p_action='finish' then
  if j.phase='ready' then return j.response;end if;
  if j.phase<>'pending' then return jsonb_build_object('status',409,'error','request_finished');end if;
  if p_body->>'noChanges'='true' then r:=private.ai_no_changes_finish(p_body||jsonb_build_object('requestId',j.request_id));
  else r:=private.ai_trip_request('finish',p_body||jsonb_build_object('requestId',j.request_id));end if;
  if r ? 'status' then return r;end if;
  v_response:=jsonb_build_object('result',p_body->'result','cached',false)||case when p_body->>'noChanges'='true' then jsonb_build_object('noChanges',true) else '{}'::jsonb end||case when r->>'draftId' is not null then jsonb_build_object('draftId',r->>'draftId','expiresAt',r->>'expiresAt') else '{}'::jsonb end;
  update private.ai_chat_receipts set phase='ready',response=v_response where operation=op;
  return v_response;
 end if;
 return jsonb_build_object('status',400,'error','invalid_action');
exception when invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('status',400,'error','invalid_request');
end $$;
create or replace function public.ai_chat_request(p_action text,p_body jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.ai_chat_request(p_action,p_body);$$;
revoke all on function private.ai_chat_request(text,jsonb),public.ai_chat_request(text,jsonb) from public,anon,authenticated;
grant execute on function private.ai_chat_request(text,jsonb),public.ai_chat_request(text,jsonb) to service_role;
commit;
