begin;
create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
grant usage on schema private to authenticated;
alter function public.is_trip_member(text) set schema private;
create or replace function private.is_trip_member(p_trip text) returns boolean
language sql stable security definer set search_path=public as $$
 select auth.uid() is not null and exists(select 1 from public.trip_members where trip_id=p_trip and email=lower((select auth.jwt())->>'email'));
$$;
create or replace function public.is_trip_member(p_trip text) returns boolean
language sql stable security invoker set search_path='' as $$ select private.is_trip_member(p_trip); $$;
revoke all on function public.is_trip_member(text) from public,anon;
grant execute on function public.is_trip_member(text) to authenticated;
revoke all on function private.is_trip_member(text) from public,anon;
grant execute on function private.is_trip_member(text) to authenticated;
alter function public.apply_trip_change(text,text,jsonb,integer,uuid) set schema private;
create or replace function public.apply_trip_change(p_trip text,p_id text,p_payload jsonb,p_expected integer,p_operation uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.apply_trip_change(p_trip,p_id,p_payload,p_expected,p_operation); $$;
revoke all on function public.apply_trip_change(text,text,jsonb,integer,uuid) from public,anon;
grant execute on function public.apply_trip_change(text,text,jsonb,integer,uuid) to authenticated;
revoke all on function private.apply_trip_change(text,text,jsonb,integer,uuid) from public,anon;
grant execute on function private.apply_trip_change(text,text,jsonb,integer,uuid) to authenticated;
alter function public.limit_trip_members() set schema private;
alter policy member_reads_self on public.trip_members using(email=lower((select auth.jwt())->>'email'));
commit;
