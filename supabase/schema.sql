-- Run once in the Supabase SQL Editor. No service_role key belongs in the website.
begin;
create table if not exists public.trip_members (
 trip_id text not null default 'osaka-2027',
 email text not null check (email=lower(trim(email)) and position('@' in email)>1),
 primary key(trip_id,email)
);
create or replace function public.limit_trip_members() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.trip_id,0));
 if (select count(*) from public.trip_members where trip_id=new.trip_id)>=5 then
  raise exception 'Each trip supports at most five members';
 end if;
 return new;
end $$;
drop trigger if exists limit_members on public.trip_members;
create trigger limit_members before insert on public.trip_members for each row execute function public.limit_trip_members();
create or replace function public.is_trip_member(p_trip text) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.trip_members where trip_id=p_trip and email=lower(auth.jwt()->>'email'));
$$;
create table if not exists public.trip_items (
 trip_id text not null,
 id text not null,
 payload jsonb not null,
 version integer not null check(version>0),
 updated_at timestamptz not null default now(),
 primary key(trip_id,id)
);
create table if not exists public.trip_revisions (
 id uuid primary key,
 trip_id text not null,
 item_id text not null,
 payload jsonb not null,
 version integer not null,
 actor text not null,
 created_at timestamptz not null default now(),
 unique(trip_id,item_id,version)
);
create index if not exists trip_revisions_time on public.trip_revisions(trip_id,created_at desc);
alter table public.trip_members enable row level security;
alter table public.trip_items enable row level security;
alter table public.trip_revisions enable row level security;
drop policy if exists member_reads_self on public.trip_members;
create policy member_reads_self on public.trip_members for select to authenticated using(email=lower(auth.jwt()->>'email'));
drop policy if exists member_reads_items on public.trip_items;
create policy member_reads_items on public.trip_items for select to authenticated using(public.is_trip_member(trip_id));
drop policy if exists member_reads_history on public.trip_revisions;
create policy member_reads_history on public.trip_revisions for select to authenticated using(public.is_trip_member(trip_id));
revoke all on public.trip_members,public.trip_items,public.trip_revisions from anon,authenticated;
grant select on public.trip_members,public.trip_items,public.trip_revisions to authenticated;
create or replace function public.apply_trip_change(p_trip text,p_id text,p_payload jsonb,p_expected integer,p_operation uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare current_row public.trip_items; old_revision public.trip_revisions; result_row public.trip_items;
begin
 if auth.uid() is null or not public.is_trip_member(p_trip) then raise exception 'Not a trip member' using errcode='42501'; end if;
 if p_id !~ '^[a-zA-Z0-9_-]{1,100}$' or p_payload->>'id' is distinct from p_id
  or jsonb_typeof(p_payload) is distinct from 'object'
  or length(p_payload::text)>24000
  or coalesce(length(trim(p_payload->>'title')),0) not between 1 and 160
  or coalesce(p_payload->>'day','') not in ('2027-01-10','2027-01-11','2027-01-12','2027-01-13','2027-01-14','2027-01-15','2027-01-16','2027-01-17')
  or coalesce(p_payload->>'status','') not in ('pending','confirmed','booked')
 then raise exception 'Invalid itinerary data'; end if;
 -- Per-trip lock covers first insertion, and makes operation retries idempotent.
 perform pg_advisory_xact_lock(hashtextextended(p_trip,1));
 select * into old_revision from public.trip_revisions where id=p_operation;
 if found then
  if old_revision.trip_id<>p_trip or old_revision.item_id<>p_id or old_revision.payload<>p_payload then raise exception 'Operation ID reused'; end if;
  return jsonb_build_object('conflict',false,'row',jsonb_build_object('id',p_id,'payload',old_revision.payload,'version',old_revision.version));
 end if;
 select * into current_row from public.trip_items where trip_id=p_trip and id=p_id;
 if coalesce(current_row.version,0)<>p_expected then return jsonb_build_object('conflict',true,'row',case when current_row.id is null then null else to_jsonb(current_row) end); end if;
 if current_row.id is null and (select count(*) from public.trip_items where trip_id=p_trip)>=500 then raise exception 'Trip has reached 500 items'; end if;
 insert into public.trip_items(trip_id,id,payload,version) values(p_trip,p_id,p_payload,p_expected+1)
 on conflict(trip_id,id) do update set payload=excluded.payload,version=excluded.version,updated_at=now()
 returning * into result_row;
 insert into public.trip_revisions(id,trip_id,item_id,payload,version,actor) values(p_operation,p_trip,p_id,p_payload,result_row.version,lower(auth.jwt()->>'email'));
 return jsonb_build_object('conflict',false,'row',to_jsonb(result_row));
end $$;
revoke all on function public.apply_trip_change(text,text,jsonb,integer,uuid) from public,anon;
grant execute on function public.apply_trip_change(text,text,jsonb,integer,uuid) to authenticated;
revoke all on function public.is_trip_member(text) from public,anon;
grant execute on function public.is_trip_member(text) to authenticated;
revoke all on function public.limit_trip_members() from public,anon,authenticated;
commit;
-- After installing, add each member email using the Table Editor (trip_members).
-- trip_id = osaka-2027 ; email = their lowercase email address.
-- Keep five rows total. Never commit actual emails into this public repository.
