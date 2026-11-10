-- Safe feature rollback retains the V1.2 data protocol and all private objects.
-- If a feature fails, publish a targeted forward fix on the V1.2 protocol.
-- Hide only its entry controls; retain queue processing and private cache cleanup.
-- Do not replace this backend with V1.1 while batch queues are outstanding.
-- Never restore the entire old snapshot over newer traveller edits.
begin read only;
select count(*) as retained_items from public.trip_items where trip_id='osaka-2027';
select count(*) as retained_revisions from public.trip_revisions where trip_id='osaka-2027';
select public=false as bucket_is_private from storage.buckets where id='osaka-tickets';
select to_regprocedure('private.apply_trip_batch(jsonb)') is not null as batch_protocol_retained;
select not has_function_privilege('anon','public.trip_file_request(text,jsonb)','execute') as files_not_public;
commit;
