-- Read-only metadata piggybacked on existing favorites rows synchronization.
begin;
do $$begin if to_regprocedure('private.favorite_request_before_day_sort(text,jsonb)') is null then alter function private.favorite_request(text,jsonb) rename to favorite_request_before_day_sort;end if;end$$;
create or replace function private.favorite_day_sort_context() returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('version',1,'fetchedAt',now(),'profiles',coalesce(jsonb_agg(jsonb_build_object('day',f.day,'regions',f.regions,'valid',f.scope_hash=md5(private.favorite_day_scope(f.day)::text),'version',f.version,'scope',private.favorite_day_scope(f.day)) order by f.day),'[]')) from private.favorite_day_regions f;
$$;
create or replace function private.favorite_request(p_action text,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;begin
 r:=private.favorite_request_before_day_sort(p_action,p_body);if r ? 'status' then return r;end if;
 if p_action='rows' then return r||jsonb_build_object('dayContext',private.favorite_day_sort_context());end if;
 if p_action='days_context' then return private.favorite_day_sort_context();end if;
 return r;
end$$;
create or replace function public.favorite_request(p_action text,p_body jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.favorite_request(p_action,p_body);$$;
revoke all on function private.favorite_request_before_day_sort(text,jsonb),private.favorite_day_sort_context(),private.favorite_request(text,jsonb),public.favorite_request(text,jsonb) from public,anon,authenticated;
grant execute on function private.favorite_request(text,jsonb),public.favorite_request(text,jsonb) to service_role;
commit;
