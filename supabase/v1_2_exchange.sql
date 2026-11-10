begin;
create table if not exists private.reference_rates(id text primary key check(id='ecb-jpy-myr'),quote jsonb not null,fetched_at timestamptz not null default now());
alter table private.reference_rates enable row level security;
revoke all on private.reference_rates from public,anon,authenticated;
create or replace function private.reference_rate_request(p_action text,p_body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $rate$
declare checked jsonb; cached private.reference_rates; q jsonb;
begin
 checked:=private.shared_trip_request('check',jsonb_build_object('token',p_body->>'token'),'');if checked->>'ok' is distinct from 'true' then return checked;end if;
 if p_action='exchange_cache_get' then select * into cached from private.reference_rates where id='ecb-jpy-myr';return jsonb_build_object('quote',case when cached.fetched_at>now()-interval '30 days' then cached.quote else null end,'stale',coalesce(cached.fetched_at<now()-interval '1 hour',true));end if;
 if p_action='exchange_cache_put' then q:=p_body->'quote';if jsonb_typeof(q)<>'object' or coalesce(q->>'yenPerMyr','')!~'^[0-9]+(\.[0-9]+)?$' or (q->>'yenPerMyr')::numeric not between 0.001 and 100000 or coalesce(q->>'quoteDate','')!~'^\d{4}-\d{2}-\d{2}$' then return jsonb_build_object('status',400,'error','invalid_reference');end if;
 insert into private.reference_rates(id,quote,fetched_at) values('ecb-jpy-myr',q,now()) on conflict(id) do update set quote=excluded.quote,fetched_at=now();return jsonb_build_object('ok',true);end if;
 return jsonb_build_object('status',400,'error','invalid_action');
end $rate$;
revoke all on function private.reference_rate_request(text,jsonb) from public,anon,authenticated;
commit;
