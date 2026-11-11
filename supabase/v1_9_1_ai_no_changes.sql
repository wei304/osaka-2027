-- Settle a valid clarification without creating a writable itinerary draft.
begin;
create or replace function private.ai_no_changes_finish(p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare checked jsonb;u private.ai_usage;r jsonb;charged int;
begin
 if p_body is null or jsonb_typeof(p_body)<>'object' or length(p_body::text)>24000 then return jsonb_build_object('status',400,'error','invalid_request');end if;
 checked:=private.shared_trip_request('check',jsonb_build_object('token',p_body->>'token'),'');if checked->>'ok' is distinct from 'true' then return checked;end if;
 perform 1 from private.ai_policy where id=true for update;
 select * into u from private.ai_usage where id=(p_body->>'requestId')::uuid and token_hash=extensions.digest(p_body->>'token','sha256') for update;
 if not found then return jsonb_build_object('status',404,'error','request_not_found');end if;
 if u.status<>'pending' then return jsonb_build_object('status',409,'error','request_finished');end if;
 if u.task not in ('edit','organize') then return jsonb_build_object('status',400,'error','invalid_task');end if;
 if u.created_at<now()-interval '90 seconds' then return jsonb_build_object('status',409,'error','request_expired');end if;
 r:=p_body->'result';
 if jsonb_typeof(r) is distinct from 'object' or r-array['answer','warnings','noChanges']<>'{}'::jsonb or r->'noChanges' is distinct from 'true'::jsonb or jsonb_typeof(r->'answer') is distinct from 'string' or length(trim(r->>'answer')) not between 1 and 5000 or jsonb_typeof(r->'warnings') is distinct from 'array' or jsonb_array_length(r->'warnings')>10 or exists(select 1 from jsonb_array_elements(r->'warnings')w where jsonb_typeof(w)<>'string' or length(w#>>'{}')>400) then return jsonb_build_object('status',422,'error','invalid_ai_output');end if;
 charged:=u.reserved_tokens;if coalesce(p_body->'usage'->>'total_tokens','')~'^[0-9]{1,7}$' then charged:=least(u.reserved_tokens,greatest(1,(p_body->'usage'->>'total_tokens')::int));end if;
 update private.ai_usage set status='done',result=r,snapshot='[]',charged_tokens=charged,charged_usd=reserved_usd*charged/u.reserved_tokens,charged_cny=reserved_cny*charged/u.reserved_tokens where id=u.id;
 return jsonb_build_object('ok',true);
exception when invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('status',400,'error','invalid_request');
end $$;
create or replace function public.ai_no_changes_finish(p_body jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.ai_no_changes_finish(p_body);$$;
revoke all on function private.ai_no_changes_finish(jsonb),public.ai_no_changes_finish(jsonb) from public,anon,authenticated;
grant execute on function private.ai_no_changes_finish(jsonb),public.ai_no_changes_finish(jsonb) to service_role;
commit;
