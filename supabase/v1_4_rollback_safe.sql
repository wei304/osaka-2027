-- Non-destructive pause. Never drop drafts/shares or restore over newer edits.
begin;
update private.route_policy set enabled=false where id=true;
update private.share_policy set enabled=false where id=true;
update private.ai_policy set enabled=false where id=true;
commit;
