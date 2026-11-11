-- Non-destructive pause. Retains drafts, usage, all itinerary and all histories.
-- Also leave TRIP_AI_ENABLED unset/false in Edge secrets.
begin;
update private.ai_policy set enabled=false where id=true;
commit;
-- Do not DROP tables or restore an old whole-database snapshot over new edits.
