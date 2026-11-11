-- Read-only verification only. Keep all favorite data, relations, revisions and compatibility RPCs.
-- Disable the new UI if necessary; never DROP tables or overwrite later user edits.
select count(*) as favorite_places from private.favorite_places;
select count(*) as favorite_revisions from private.favorite_revisions;
select status,count(*) from private.favorite_import_batches group by status;
select count(*) as original_items from public.trip_items;
select count(*) as original_revisions from public.trip_revisions;
