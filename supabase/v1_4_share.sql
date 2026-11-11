-- Additive: public snapshots and independent, revocable read-only tokens.
begin;
create table if not exists private.share_policy(id boolean primary key default true check(id),enabled boolean not null default true);
insert into private.share_policy(id) values(true) on conflict do nothing;
create table if not exists private.trip_shares(id uuid primary key,token_hash bytea not null unique,generation int not null,title text not null,days jsonb not null,fields jsonb not null,snapshot jsonb not null,request_hash text not null,expires_at timestamptz not null,revoked_at timestamptz,created_at timestamptz not null default now(),version int not null default 1);
create table if not exists private.share_revisions(id uuid primary key default gen_random_uuid(),share_id uuid not null references private.trip_shares(id),action text not null,version int not null,created_at timestamptz not null default now());
alter table private.share_policy enable row level security;
alter table private.trip_shares enable row level security;
alter table private.share_revisions enable row level security;
revoke all on private.share_policy,private.trip_shares,private.share_revisions from public,anon,authenticated;
create or replace function private.share_clean(value text) returns text language sql immutable set search_path='' as $$select left(regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(value,''),'(sb_(secret|publishable)_|sk-)[A-Za-z0-9_-]+','[已隐藏密钥]','g'),'[A-Fa-f0-9]{32,}','[已隐藏凭证]','g'),'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|https?://[^[:space:]]+','[已隐藏联系资料]','g'),'[0-9]{6,}','[长号码已隐藏]','g'),160)$$;
create or replace function private.share_selection(p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare days jsonb:=p_body->'days';ids jsonb:=p_body->'ids';fields jsonb:=p_body->'fields';rows jsonb;result jsonb:='[]';r jsonb;v jsonb;k text;
begin
 if jsonb_typeof(days) is distinct from 'array' or jsonb_array_length(days) not between 1 and 9 or exists(select 1 from jsonb_array_elements_text(days)x where x !~ '^2027-01-(09|1[0-7])$') or jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids) not between 1 and 100 or (select count(distinct x) from jsonb_array_elements_text(ids)x)<>jsonb_array_length(ids) or jsonb_typeof(fields) is distinct from 'array' or jsonb_array_length(fields) not between 2 and 5 or (select count(distinct x) from jsonb_array_elements_text(fields)x)<>jsonb_array_length(fields) or not fields ? 'status' or not fields ? 'title' or exists(select 1 from jsonb_array_elements_text(fields)x where x not in ('title','ja','time','category','status')) then return jsonb_build_object('status',400,'error','invalid_selection');end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'payload',payload,'version',version) order by payload->>'day',payload->>'time',id),'[]') into rows from public.trip_items where trip_id='osaka-2027' and ids ? id and days ? (payload->>'day') and id !~ '^(tool-|ticket-|ledger-|plan-choice-)' and payload->>'category' in ('spot','food','shopping') and not coalesce((payload->>'deleted')::boolean,false);
 if jsonb_array_length(rows)<>jsonb_array_length(ids) then return jsonb_build_object('status',422,'error','selection_changed_or_private');end if;
 for r in select * from jsonb_array_elements(rows) loop
  v:=jsonb_build_object('day',r->'payload'->>'day');for k in select * from jsonb_array_elements_text(fields) loop v:=v||jsonb_build_object(k,private.share_clean(r->'payload'->>k));end loop;result:=result||jsonb_build_array(v);
 end loop;
 return jsonb_build_object('snapshot',result,'guard',md5(rows::text||days::text||fields::text));
end$$;
create or replace function private.share_trip_request(p_action text,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $share$
declare r private.trip_shares; enabled boolean; generation_now int; checked jsonb; selection jsonb; signature text; share_id uuid; hours int; listing jsonb;
begin
 if p_body is null or jsonb_typeof(p_body)<>'object' or length(p_body::text)>32000 then return jsonb_build_object('status',400,'error','invalid_request');end if;
 select p.enabled into enabled from private.share_policy p where id=true;
 if p_action='view' then
  if not coalesce(enabled,false) or coalesce(p_body->>'secret','') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('status',404,'error','share_unavailable');end if;
  select s.* into r from private.trip_shares s join private.shared_gate g on g.trip_id='osaka-2027' and g.generation=s.generation where s.token_hash=extensions.digest('read-only:'||(p_body->>'secret'),'sha256') and s.revoked_at is null and s.expires_at>now();
  if not found then return jsonb_build_object('status',404,'error','share_unavailable');end if;
  return jsonb_build_object('title',r.title,'days',r.days,'fields',r.fields,'items',r.snapshot,'createdAt',r.created_at,'expiresAt',r.expires_at);
 end if;
 checked:=private.shared_trip_request('check',jsonb_build_object('token',p_body->>'token'),'');if checked->>'ok' is distinct from 'true' then return checked;end if;
 select generation into generation_now from private.shared_gate where trip_id='osaka-2027';
 if p_action='list' then select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'days',s.days,'fields',s.fields,'expiresAt',s.expires_at,'createdAt',s.created_at,'revoked',s.revoked_at is not null or s.generation<>generation_now,'version',s.version) order by s.created_at desc),'[]') into listing from private.trip_shares s;return jsonb_build_object('enabled',enabled,'shares',listing);end if;
 if p_action='revoke' then
  select * into r from private.trip_shares where id=(p_body->>'id')::uuid for update;if not found then return jsonb_build_object('status',404,'error','share_unavailable');end if;
  if r.revoked_at is not null then return jsonb_build_object('ok',true,'version',r.version);end if;
  if (p_body->>'expected')::int is distinct from r.version then return jsonb_build_object('status',409,'error','share_changed');end if;
  update private.trip_shares set revoked_at=now(),version=version+1 where id=r.id returning * into r;insert into private.share_revisions(share_id,action,version) values(r.id,'revoke',r.version);return jsonb_build_object('ok',true,'version',r.version);
 end if;
 if not coalesce(enabled,false) then return jsonb_build_object('status',503,'error','sharing_disabled');end if;
 if p_action not in ('preview','create') then return jsonb_build_object('status',400,'error','invalid_action');end if;
 selection:=private.share_selection(p_body);if selection ? 'status' then return selection;end if;
 if p_action='preview' then return selection;end if;
 if p_body->>'confirmed' is distinct from 'true' or p_body->>'guard' is distinct from selection->>'guard' then return jsonb_build_object('status',409,'error','share_preview_stale');end if;
 if coalesce(p_body->>'secret','') !~ '^[a-f0-9]{64}$' or p_body->>'secret'=p_body->>'token' or exists(select 1 from private.shared_sessions where token_hash=extensions.digest(p_body->>'secret','sha256')) then return jsonb_build_object('status',400,'error','invalid_share_token');end if;
 share_id:=(p_body->>'id')::uuid;hours:=(p_body->>'hours')::int;if hours is null or hours not between 1 and 168 then return jsonb_build_object('status',400,'error','invalid_expiry');end if;
 signature:=md5(jsonb_build_object('title',private.share_clean(p_body->>'title'),'days',p_body->'days','fields',p_body->'fields','ids',p_body->'ids','hours',hours,'guard',p_body->>'guard')::text);
 select * into r from private.trip_shares where id=share_id;
 if found then if r.request_hash<>signature or r.token_hash<>extensions.digest('read-only:'||(p_body->>'secret'),'sha256') then return jsonb_build_object('status',409,'error','operation_reused');end if;return jsonb_build_object('id',r.id,'expiresAt',r.expires_at,'version',r.version);end if;
 if (select count(*) from private.trip_shares where revoked_at is null and expires_at>now() and generation=generation_now)>=20 then return jsonb_build_object('status',429,'error','share_quota');end if;
 insert into private.trip_shares(id,token_hash,generation,title,days,fields,snapshot,request_hash,expires_at) values(share_id,extensions.digest('read-only:'||(p_body->>'secret'),'sha256'),generation_now,left(private.share_clean(p_body->>'title'),80),p_body->'days',p_body->'fields',selection->'snapshot',signature,now()+make_interval(hours=>hours)) returning * into r;
 insert into private.share_revisions(share_id,action,version) values(r.id,'create',1);return jsonb_build_object('id',r.id,'expiresAt',r.expires_at,'version',r.version);
exception when invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('status',400,'error','invalid_request');
end $share$;
revoke all on function private.share_clean(text),private.share_selection(jsonb),private.share_trip_request(text,jsonb) from public,anon,authenticated;
create or replace function public.share_trip_request(p_action text,p_body jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.share_trip_request(p_action,p_body);$$;
revoke all on function public.share_trip_request(text,jsonb) from public,anon,authenticated;
grant execute on function private.share_trip_request(text,jsonb),public.share_trip_request(text,jsonb) to service_role;
commit;
