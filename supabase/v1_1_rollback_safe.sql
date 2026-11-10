-- Safe rollback is an application rollback, keeping additive data compatibility.
-- Repoint Pages to the recorded pre-V1.1 source commit. Keep shared-trip v2,
-- Jan 9 support and merge_plan_notes, so new records remain readable and no
-- completed/transport metadata can be erased by older clients.
-- Do NOT restore the entire old database snapshot over new edits.
begin read only;
select count(*) as retained_items from public.trip_items where trip_id='osaka-2027';
select count(*) as retained_revisions from public.trip_revisions where trip_id='osaka-2027';
select to_regprocedure('private.merge_plan_notes(text,text)') is not null as compatibility_retained;
commit;
