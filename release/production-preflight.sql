-- Read-only review aid. No setup, unlock, apply, generate or business RPC calls.
begin read only;
select to_regprocedure('public.ai_chat_request(text,jsonb)') as chat_rpc,
       to_regclass('private.ai_chat_receipts') as chat_receipts;
select n.nspname,c.relname,c.relrowsecurity,
       has_table_privilege('anon',c.oid,'select,insert,update,delete') as anon_any,
       has_table_privilege('authenticated',c.oid,'select,insert,update,delete') as authenticated_any
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where c.relkind='r' and (n.nspname='private' or n.nspname='public' and c.relname in ('trip_items','trip_revisions'))
order by 1,2;
select (select count(*) from private.favorite_places) favorites,
       (select count(*) from public.trip_items) trip_items,
       (select count(*) from public.trip_revisions) trip_revisions,
       (select count(*) from private.ai_usage) ai_usage;
select enabled,normal_budget_cny,travel_budget_cny,max_price_per_million_cny,budget_version from private.ai_policy;
select status,count(*) from private.ai_usage where created_at>now()-interval '90 seconds' group by status;
select id,public,file_size_limit,allowed_mime_types from storage.buckets;
commit;
