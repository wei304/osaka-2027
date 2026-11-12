-- Optional phrase assistance only. Local phrase library needs no database migration.
-- Additive, after v1_9_1; never deploy automatically with the frontend.
begin;
create table if not exists private.phrase_ai_jobs(
 operation uuid primary key,token_hash bytea not null,input_hash text not null,task text not null,
 request_id uuid unique references private.ai_usage(id),status text not null check(status in ('pending','ready','failed')),
 result jsonb,created_at timestamptz not null default now()
);
create index if not exists phrase_ai_cache on private.phrase_ai_jobs(token_hash,input_hash,created_at desc);
alter table private.phrase_ai_jobs enable row level security;
revoke all on private.phrase_ai_jobs from public,anon,authenticated;
create or replace function private.phrase_ai_request(p_action text,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare checked jsonb;tok text;th bytea;j private.phrase_ai_jobs;cached private.phrase_ai_jobs;h text;op uuid;input jsonb;r jsonb;snapshot jsonb;reserved jsonb;settled jsonb;k text;
begin
 if p_body is null or jsonb_typeof(p_body)<>'object' or length(p_body::text)>20000 then return jsonb_build_object('status',400,'error','invalid_request');end if;
 tok:=p_body->>'token';checked:=private.shared_trip_request('check',jsonb_build_object('token',tok),'');if checked->>'ok' is distinct from 'true' then return checked;end if;
 th:=extensions.digest(tok,'sha256');
 if p_action='status' then
  checked:=private.ai_trip_request('status',jsonb_build_object('token',tok));
  return checked||jsonb_build_object('maxReservationCny',(select 16000*max_price_per_million_cny/1000000 from private.ai_policy where id=true));
 end if;
 op:=(p_body->>'operation')::uuid;if op is null then return jsonb_build_object('status',400,'error','invalid_request');end if;
 select * into j from private.phrase_ai_jobs where operation=op;
 if found and j.token_hash<>th then return jsonb_build_object('status',404,'error','phrase_request_not_found');end if;
 if p_action='prepare' then
  input:=p_body->'input';
  if input->>'version' is distinct from '1' or coalesce(input->>'task','') not in ('translate','explain','reading','polite','simple','scenario') or jsonb_typeof(input->'phrase') is distinct from 'object' or (input->'phrase')-array['category','zh','ja','kana']<>'{}'::jsonb then return jsonb_build_object('status',400,'error','invalid_phrase_input');end if;
  foreach k in array array['category','zh','ja','kana'] loop if jsonb_typeof(input->'phrase'->k) is distinct from 'string' or length(input->'phrase'->>k)>(case k when 'category' then 40 when 'zh' then 500 when 'ja' then 800 else 1000 end) then return jsonb_build_object('status',400,'error','invalid_phrase_input');end if;end loop;
  h:=encode(extensions.digest(input::text,'sha256'),'hex');
  if j.operation is not null then
   if j.input_hash<>h then return jsonb_build_object('status',409,'error','operation_reused');end if;
   return jsonb_build_object('operation',op,'jobStatus',j.status,'result',j.result,'claimed',false,'cached',j.status='ready');
  end if;
  select * into cached from private.phrase_ai_jobs where token_hash=th and input_hash=h and status='ready' and created_at>now()-interval '7 days' order by created_at desc limit 1;
  if found then return jsonb_build_object('operation',cached.operation,'jobStatus','ready','result',cached.result,'claimed',false,'cached',true);end if;
  snapshot:=private.ai_trip_request('snapshot',jsonb_build_object('token',tok,'days',jsonb_build_array('2027-01-09')));if snapshot ? 'status' then return snapshot;end if;
  reserved:=private.ai_trip_request('reserve',jsonb_build_object('token',tok,'days',jsonb_build_array('2027-01-09'),'scopeHash',snapshot->>'scopeHash','task','translate','model',p_body->>'model','prompt','offline-phrase-v1:'||h,'cache',false,'inputBytes',p_body->'inputBytes'));if reserved ? 'status' then return reserved;end if;
  insert into private.phrase_ai_jobs(operation,token_hash,input_hash,task,request_id,status) values(op,th,h,input->>'task',(reserved->>'requestId')::uuid,'pending');
  return jsonb_build_object('operation',op,'claimed',true,'jobStatus','pending');
 end if;
 if j.operation is null then return jsonb_build_object('status',404,'error','phrase_request_not_found');end if;
 if p_action='recover' then
  if j.status='pending' and j.created_at<now()-interval '90 seconds' then perform private.ai_trip_request('fail',jsonb_build_object('token',tok,'requestId',j.request_id));update private.phrase_ai_jobs set status='failed' where operation=op returning * into j;end if;
  return jsonb_build_object('operation',op,'jobStatus',j.status,'result',j.result);
 end if;
 if p_action='fail' then
  if j.status='pending' then perform private.ai_trip_request('fail',jsonb_build_object('token',tok,'requestId',j.request_id));update private.phrase_ai_jobs set status='failed' where operation=op;end if;return jsonb_build_object('ok',true);
 end if;
 if p_action='finish' then
  if j.status='ready' then return jsonb_build_object('operation',op,'jobStatus','ready','result',j.result);end if;
  if j.status<>'pending' then return jsonb_build_object('status',409,'error','request_finished');end if;
  r:=p_body->'result';
  if jsonb_typeof(r) is distinct from 'object' or r-array['zh','ja','kana','sourceLanguage','targetLanguage']<>'{}'::jsonb or r->>'sourceLanguage' is distinct from (case when j.task='translate' then 'zh' else 'ja' end) or r->>'targetLanguage' is distinct from (case when j.task='explain' then 'zh' else 'ja' end) then return jsonb_build_object('status',422,'error','invalid_phrase_output');end if;
  foreach k in array array['zh','ja','kana'] loop if jsonb_typeof(r->k) is distinct from 'string' or length(trim(r->>k)) not between 1 and (case k when 'zh' then 500 when 'ja' then 800 else 1000 end) or r->>k ~ '[<>[:cntrl:]]' then return jsonb_build_object('status',422,'error','invalid_phrase_output');end if;end loop;
  if r->>'ja' !~ '[ぁ-ヿ一-龯]' or r->>'kana' !~ '[ぁ-ヿ]' or r->>'kana' ~ '[一-龯A-Za-z]' then return jsonb_build_object('status',422,'error','invalid_phrase_output');end if;
  settled:=private.ai_trip_request('finish',jsonb_build_object('token',tok,'requestId',j.request_id,'result',r,'usage',p_body->'usage'));if settled ? 'status' then return settled;end if;
  update private.phrase_ai_jobs set status='ready',result=r where operation=op;
  return jsonb_build_object('operation',op,'jobStatus','ready','result',r);
 end if;
 return jsonb_build_object('status',400,'error','invalid_action');
exception when invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('status',400,'error','invalid_request');
end $$;
create or replace function public.phrase_ai_request(p_action text,p_body jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.phrase_ai_request(p_action,p_body);$$;
revoke all on function private.phrase_ai_request(text,jsonb),public.phrase_ai_request(text,jsonb) from public,anon,authenticated;
grant execute on function private.phrase_ai_request(text,jsonb),public.phrase_ai_request(text,jsonb) to service_role;
commit;
