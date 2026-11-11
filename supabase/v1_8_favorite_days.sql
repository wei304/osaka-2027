-- Stage 3, additive to v1_7. Apply only during the approved deployment stage.
begin;
-- Keep the reviewed stage 2 implementation as a delegate. Safe to reapply.
do $$begin
 if to_regprocedure('private.favorite_request_v17(text,jsonb)') is null then
  alter function private.favorite_request(text,jsonb) rename to favorite_request_v17;
 end if;
end $$;
create or replace function private.favorite_state_hash() returns text language sql stable set search_path='' as $$
 select encode(extensions.digest(jsonb_build_object(
 'places',(select jsonb_agg(jsonb_build_array(id,version) order by id) from private.favorite_places),
 'sources',(select jsonb_agg(jsonb_build_array(id,version) order by id) from private.favorite_sources),
 'source_items',(select jsonb_agg(jsonb_build_array(source_id,place_id,version) order by source_id,place_id) from private.favorite_source_items),
 'links',(select jsonb_agg(jsonb_build_array(place_id,day,version,active) order by place_id,day) from private.favorite_day_links))::text,'sha256'),'hex');
$$;
create or replace function private.favorite_request(p_action text,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare gate private.shared_gate;tok text;p private.favorite_places;op uuid;h text;r private.favorite_revisions;before_p jsonb;before_links jsonb;d date;days jsonb;
begin
 if p_action is distinct from 'link_days' then return private.favorite_request_v17(p_action,p_body);end if;
 if p_body is null or jsonb_typeof(p_body)<>'object' or length(p_body::text)>48000 then return jsonb_build_object('status',400,'error','invalid_request');end if;
 select * into gate from private.shared_gate where trip_id='osaka-2027' for update;tok:=p_body->>'token';
 if gate.password_hash is null or tok is null or tok !~ '^[a-f0-9]{64}$' or not exists(select 1 from private.shared_sessions where token_hash=extensions.digest(tok,'sha256') and generation=gate.generation and expires_at>now()) then return jsonb_build_object('status',401,'error','locked');end if;
 op:=(p_body->>'operation')::uuid;
 if op is null then return jsonb_build_object('status',400,'error','invalid_request');end if;
 h:=encode(extensions.digest(jsonb_build_array(p_action,p_body-'token')::text,'sha256'),'hex');
 select * into r from private.favorite_revisions where operation=op limit 1;
 if found then
  if r.action<>p_action or r.request_hash<>h then return jsonb_build_object('status',400,'error','operation_reused');end if;
  return jsonb_build_object('ok',true,'replayed',true);
 end if;
 if exists(select 1 from private.favorite_import_batches where operation=op or undo_operation=op) then return jsonb_build_object('status',400,'error','operation_reused');end if;
 days:=p_body->'days';
 if jsonb_typeof(days) is distinct from 'array' or jsonb_array_length(days)>9 then return jsonb_build_object('status',400,'error','invalid_days');end if;
 if exists(select 1 from jsonb_array_elements(days) x where jsonb_typeof(x)<>'string' or x#>>'{}' not in ('2027-01-09','2027-01-10','2027-01-11','2027-01-12','2027-01-13','2027-01-14','2027-01-15','2027-01-16','2027-01-17')) or (select count(distinct x) from jsonb_array_elements(days) x)<>jsonb_array_length(days) then return jsonb_build_object('status',400,'error','invalid_days');end if;
 select * into p from private.favorite_places where id=(p_body->>'id')::uuid and trip_id='osaka-2027';
 if not found then return jsonb_build_object('status',404,'error','favorite_not_found');end if;
 if p.version is distinct from (p_body->>'expected')::int then return jsonb_build_object('status',409,'error','favorite_conflict');end if;
 if p.archived and jsonb_array_length(days)>0 then return jsonb_build_object('status',400,'error','favorite_archived');end if;
 before_p:=to_jsonb(p);select coalesce(jsonb_agg(to_jsonb(l) order by day),'[]') into before_links from private.favorite_day_links l where place_id=p.id;
 update private.favorite_day_links set active=false,version=version+1 where place_id=p.id and active and not(days ? day::text);
 for d in select value::date from jsonb_array_elements_text(days) loop
  insert into private.favorite_day_links(place_id,day) values(p.id,d) on conflict(place_id,day) do update set active=true,version=private.favorite_day_links.version+1 where not private.favorite_day_links.active;
 end loop;
 update private.favorite_places set version=version+1,updated_at=now() where id=p.id returning * into p;
 insert into private.favorite_revisions(place_id,operation,request_hash,action,before_data,after_data,version)
 values(p.id,op,h,p_action,before_p||jsonb_build_object('day_links',before_links),to_jsonb(p)||jsonb_build_object('day_links',coalesce((select jsonb_agg(to_jsonb(l) order by day) from private.favorite_day_links l where place_id=p.id),'[]')),p.version);
 return jsonb_build_object('ok',true);
exception when invalid_text_representation or numeric_value_out_of_range or not_null_violation or check_violation then return jsonb_build_object('status',400,'error','invalid_request');
end $$;
-- Rebind the public wrapper: SQL functions may retain the renamed delegate's OID.
create or replace function public.favorite_request(p_action text,p_body jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.favorite_request(p_action,p_body);$$;
revoke all on function private.favorite_request(text,jsonb),private.favorite_request_v17(text,jsonb),public.favorite_request(text,jsonb) from public,anon,authenticated;
grant execute on function private.favorite_request(text,jsonb),public.favorite_request(text,jsonb) to service_role;
commit;
