-- Stage 2: additive private favorites. Existing itinerary, ledger and history remain untouched.
begin;
create table if not exists private.favorite_places(
 id uuid primary key default gen_random_uuid(),trip_id text not null default 'osaka-2027' check(trip_id='osaka-2027'),
 place_key text not null,source_name text not null,original_url text not null,source_note text not null default '',
 region text not null default '待确认地区',place_type text not null default '其他',user_note text not null default '',manual_fields jsonb not null default '{}',
 archived boolean not null default false,version int not null default 1 check(version>0),updated_at timestamptz not null default now(),unique(trip_id,place_key),
 check(length(source_name) between 1 and 300),check(length(region) between 1 and 80),check(length(user_note)<=4000),
 check(place_type in ('餐厅','咖啡厅 / 甜品','景点','购物','娱乐体验','交通','其他')));
create table if not exists private.favorite_sources(id uuid primary key default gen_random_uuid(),trip_id text not null default 'osaka-2027' check(trip_id='osaka-2027'),name text not null check(length(name) between 1 and 160),version int not null default 1,created_at timestamptz not null default now(),unique(trip_id,name));
create table if not exists private.favorite_source_items(source_id uuid not null references private.favorite_sources(id),place_id uuid not null references private.favorite_places(id),raw jsonb not null,row_hash text not null,active boolean not null default true,version int not null default 1,primary key(source_id,place_id));
-- Relations and AI cache are reserved for later stages; this RPC cannot write them.
create table if not exists private.favorite_day_links(place_id uuid not null references private.favorite_places(id),day date not null check(day between date '2027-01-09' and date '2027-01-17'),active boolean not null default true,version int not null default 1,primary key(place_id,day));
create table if not exists private.favorite_import_batches(operation uuid primary key,source_id uuid references private.favorite_sources(id),request_hash text not null,file_hash text not null,status text not null check(status in ('completed','failed','undone')),undo_operation uuid unique,undo_request_hash text,stats jsonb not null default '{}',changes jsonb not null default '[]',error text,response jsonb,created_at timestamptz not null default now());
create table if not exists private.favorite_revisions(id uuid primary key default gen_random_uuid(),place_id uuid not null references private.favorite_places(id),operation uuid not null,request_hash text not null,action text not null,before_data jsonb,after_data jsonb not null,version int not null,created_at timestamptz not null default now(),unique(place_id,version));
create index if not exists favorite_revisions_operation on private.favorite_revisions(operation);
create table if not exists private.favorite_ai_results(id uuid primary key default gen_random_uuid(),place_id uuid not null references private.favorite_places(id),fingerprint text not null,task text not null,result jsonb not null,version int not null,created_at timestamptz not null default now(),unique(place_id,task,fingerprint,version));
create index if not exists favorite_source_items_place on private.favorite_source_items(place_id);
create index if not exists favorite_batches_created on private.favorite_import_batches(created_at desc);
create index if not exists favorite_batches_source on private.favorite_import_batches(source_id);
create index if not exists favorite_places_normalized_name on private.favorite_places(lower(regexp_replace(source_name,'[^[:alnum:]]','','g')));
alter table private.favorite_places enable row level security;
alter table private.favorite_sources enable row level security;
alter table private.favorite_source_items enable row level security;
alter table private.favorite_day_links enable row level security;
alter table private.favorite_import_batches enable row level security;
alter table private.favorite_revisions enable row level security;
alter table private.favorite_ai_results enable row level security;
revoke all on private.favorite_places,private.favorite_sources,private.favorite_source_items,private.favorite_day_links,private.favorite_import_batches,private.favorite_revisions,private.favorite_ai_results from public,anon,authenticated;

create or replace function private.favorite_url_key(u text) returns text language plpgsql immutable set search_path='' as $$
declare fid text;
begin
 if u is null or length(u)>8192 or u !~ '^https://((www\.)?google\.(com|co\.jp)/maps([/?]|$)|maps\.google\.com/|maps\.app\.goo\.gl/)' or u ~ '[[:cntrl:]]' then raise exception 'invalid_map_url';end if;
 fid:=substring(split_part(u,'#',1) from '!1s(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)');
 return case when fid is not null then 'google:fid:'||lower(fid) else 'google:url:'||split_part(u,'#',1) end;
end $$;
create or replace function private.favorite_state_hash() returns text language sql stable set search_path='' as $$
 select encode(extensions.digest(jsonb_build_object(
 'places',(select jsonb_agg(jsonb_build_array(id,version) order by id) from private.favorite_places),
 'sources',(select jsonb_agg(jsonb_build_array(id,version) order by id) from private.favorite_sources),
 'source_items',(select jsonb_agg(jsonb_build_array(source_id,place_id,version) order by source_id,place_id) from private.favorite_source_items))::text,'sha256'),'hex');
$$;
create or replace function private.favorite_plan(p_rows jsonb,p_source text) returns jsonb language plpgsql stable set search_path='' as $$
declare r jsonb; seen text[]:='{}'; total int; fresh int:=0; changed int:=0; existing int:=0; candidates jsonb:='[]'; p private.favorite_places; si private.favorite_source_items; src uuid; rowhash text;
begin
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 1000 or coalesce(length(trim(p_source)),0) not between 1 and 160 then raise exception 'invalid_import';end if;
 select id into src from private.favorite_sources where name=p_source and trip_id='osaka-2027';total:=jsonb_array_length(p_rows);
 for r in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(r) is distinct from 'object' or r-array['name','url','key','note','labels','comment']<>'{}'::jsonb
   or jsonb_typeof(r->'name') is distinct from 'string' or length(trim(r->>'name')) not between 1 and 300
   or jsonb_typeof(r->'url') is distinct from 'string' or jsonb_typeof(r->'key') is distinct from 'string'
   or jsonb_typeof(r->'note') is distinct from 'string' or length(r->>'note')>4000
   or jsonb_typeof(r->'labels') is distinct from 'string' or length(r->>'labels')>1000
   or jsonb_typeof(r->'comment') is distinct from 'string' or length(r->>'comment')>2000
   or (r->>'key') is distinct from private.favorite_url_key(r->>'url') or (r->>'key')=any(seen) then raise exception 'invalid_import_row';end if;
  seen:=array_append(seen,r->>'key');select * into p from private.favorite_places where trip_id='osaka-2027' and place_key=r->>'key';
  if not found then fresh:=fresh+1;else existing:=existing+1;select * into si from private.favorite_source_items where source_id=src and place_id=p.id;rowhash:=encode(extensions.digest(r::text,'sha256'),'hex');if si.place_id is null or si.row_hash<>rowhash or not si.active then changed:=changed+1;end if;end if;
  if exists(select 1 from private.favorite_places f where f.place_key<>r->>'key' and lower(regexp_replace(f.source_name,'[^[:alnum:]]','','g'))=lower(regexp_replace(r->>'name','[^[:alnum:]]','','g'))) or exists(select 1 from jsonb_array_elements(p_rows) other where other->>'key'<>r->>'key' and lower(regexp_replace(other->>'name','[^[:alnum:]]','','g'))=lower(regexp_replace(r->>'name','[^[:alnum:]]','','g'))) then candidates:=candidates||jsonb_build_array(jsonb_build_object('name',r->>'name','key',r->>'key'));end if;
 end loop;
 if (select count(*) from private.favorite_places)+fresh>5000 then raise exception 'favorite_limit';end if;
 return jsonb_build_object('total',total,'new',fresh,'existing',existing,'changed',changed,'unchanged',existing-changed,'possibleDuplicates',jsonb_array_length(candidates),'candidates',candidates,'unrecognized',0);
end $$;

create or replace function private.favorite_request(p_action text,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $favorite$
declare gate private.shared_gate;tok text;op uuid;hash text;guard text;expires bigint;stats jsonb;r jsonb;p private.favorite_places;before_p jsonb;src private.favorite_sources;si private.favorite_source_items;before_si jsonb;rowhash text;changes jsonb:='[]';prior private.favorite_import_batches;rev private.favorite_revisions;result jsonb;patch jsonb;change jsonb;wanted private.favorite_places;
begin
 if p_body is null or jsonb_typeof(p_body)<>'object' or length(p_body::text)>1048576 then return jsonb_build_object('status',400,'error','invalid_request');end if;
 -- Same gate row lock as itinerary operations: authorization cannot race password rotation.
 select * into gate from private.shared_gate where trip_id='osaka-2027' for update;tok:=p_body->>'token';
 if gate.password_hash is null or tok is null or tok !~ '^[a-f0-9]{64}$' or not exists(select 1 from private.shared_sessions where token_hash=extensions.digest(tok,'sha256') and generation=gate.generation and expires_at>now()) then return jsonb_build_object('status',401,'error','locked');end if;
 if p_action='rows' then return jsonb_build_object('places',coalesce((select jsonb_agg(to_jsonb(f) order by id) from private.favorite_places f),'[]'), 'sources',coalesce((select jsonb_agg(to_jsonb(f) order by name) from private.favorite_sources f),'[]'),'sourceItems',coalesce((select jsonb_agg(to_jsonb(f)) from private.favorite_source_items f),'[]'),'links',coalesce((select jsonb_agg(to_jsonb(f)) from private.favorite_day_links f),'[]'),'batches',coalesce((select jsonb_agg(x) from (select b.operation,b.source_id,b.status,b.stats,b.error,b.created_at from private.favorite_import_batches b order by b.created_at desc limit 30) x),'[]'));end if;
 if p_action='history' then return jsonb_build_object('revisions',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from private.favorite_revisions where place_id=(p_body->>'id')::uuid order by version desc limit 50) x),'[]'));end if;
 if p_action in ('preview','import') then
  if coalesce(p_body->>'fileHash','') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('status',400,'error','invalid_import');end if;
  if p_action='import' then
   if p_body->'confirmed' is distinct from 'true'::jsonb then return jsonb_build_object('status',400,'error','confirmation_required');end if;
   op:=(p_body->>'operation')::uuid;hash:=encode(extensions.digest(jsonb_build_array(p_action,p_body-'token')::text,'sha256'),'hex');
   select * into prior from private.favorite_import_batches where operation=op;
   if found then if prior.request_hash<>hash then return jsonb_build_object('status',400,'error','operation_reused');end if;if prior.status in ('completed','undone') then return prior.response;end if;end if;
   if exists(select 1 from private.favorite_import_batches where undo_operation=op) or exists(select 1 from private.favorite_revisions where operation=op) then return jsonb_build_object('status',400,'error','operation_reused');end if;
  end if;
  begin stats:=private.favorite_plan(p_body->'rows',p_body->>'source');exception when others then return jsonb_build_object('status',400,'error','invalid_import');end;
  expires:=case when p_action='preview' then floor(extract(epoch from now())*1000)::bigint+900000 else (p_body->>'expires')::bigint end;
  guard:=encode(extensions.digest(jsonb_build_array(p_body->'rows',p_body->>'source',p_body->>'fileHash',expires,private.favorite_state_hash(),tok)::text,'sha256'),'hex');
  if p_action='preview' then return jsonb_build_object('stats',stats,'guard',guard,'expires',expires);end if;
  if expires<floor(extract(epoch from now())*1000)::bigint or expires>floor(extract(epoch from now())*1000)::bigint+900000 or p_body->>'guard' is distinct from guard then return jsonb_build_object('status',409,'error','preview_stale');end if;
  begin
   insert into private.favorite_sources(name) values(p_body->>'source') on conflict(trip_id,name) do nothing;
   select * into src from private.favorite_sources where name=p_body->>'source' and trip_id='osaka-2027';
   for r in select value from jsonb_array_elements(p_body->'rows') loop
    select * into p from private.favorite_places where place_key=r->>'key' and trip_id='osaka-2027';before_p:=case when found then to_jsonb(p) else null end;
    if p.id is null then insert into private.favorite_places(place_key,source_name,original_url,source_note) values(r->>'key',r->>'name',r->>'url',r->>'note') returning * into p;end if;
    select * into si from private.favorite_source_items where source_id=src.id and place_id=p.id;before_si:=case when found then to_jsonb(si) else null end;rowhash:=encode(extensions.digest(r::text,'sha256'),'hex');
    if before_si is not null and si.row_hash=rowhash and si.active then continue;end if;
    if before_p is not null then update private.favorite_places set source_name=r->>'name',source_note=r->>'note',version=version+1,updated_at=now() where id=p.id returning * into p;end if;
    insert into private.favorite_source_items(source_id,place_id,raw,row_hash) values(src.id,p.id,r,rowhash) on conflict(source_id,place_id) do update set raw=excluded.raw,row_hash=excluded.row_hash,active=true,version=private.favorite_source_items.version+1 returning * into si;
    insert into private.favorite_revisions(place_id,operation,request_hash,action,before_data,after_data,version) values(p.id,op,hash,'import',before_p,to_jsonb(p),p.version);
    changes:=changes||jsonb_build_array(jsonb_build_object('id',p.id,'before',before_p,'beforeSource',before_si,'version',p.version,'sourceVersion',si.version));
   end loop;
   if jsonb_array_length(changes)>0 then update private.favorite_sources set version=version+1 where id=src.id;end if;
   result:=jsonb_build_object('ok',true,'batchId',op,'stats',stats);
   insert into private.favorite_import_batches(operation,source_id,request_hash,file_hash,status,stats,changes,response) values(op,src.id,hash,p_body->>'fileHash','completed',stats,changes,result) on conflict(operation) do update set status='completed',source_id=excluded.source_id,stats=excluded.stats,changes=excluded.changes,response=excluded.response,error=null;
  exception when others then
   -- Inner transaction rolls back every place/source/revision before recording a safe error.
   insert into private.favorite_import_batches(operation,request_hash,file_hash,status,error) values(op,hash,p_body->>'fileHash','failed','import_rejected') on conflict(operation) do nothing;
   return jsonb_build_object('status',400,'error','import_rejected');
  end;return result;
 end if;
 if p_action not in ('edit','restore','undo_import') then return jsonb_build_object('status',400,'error','invalid_action');end if;
 op:=(p_body->>'operation')::uuid;hash:=encode(extensions.digest(jsonb_build_array(p_action,p_body-'token')::text,'sha256'),'hex');
 if exists(select 1 from private.favorite_import_batches where operation=op) then return jsonb_build_object('status',400,'error','operation_reused');end if;
 select * into prior from private.favorite_import_batches where undo_operation=op;if found then if p_action='undo_import' and prior.undo_request_hash=hash then return jsonb_build_object('ok',true,'replayed',true);else return jsonb_build_object('status',400,'error','operation_reused');end if;end if;
 select * into rev from private.favorite_revisions where operation=op limit 1;
 if found then if rev.request_hash<>hash then return jsonb_build_object('status',400,'error','operation_reused');end if;return jsonb_build_object('ok',true,'replayed',true);end if;
 if p_action='undo_import' then
  select * into prior from private.favorite_import_batches where operation=(p_body->>'batchId')::uuid and status='completed';if not found then return jsonb_build_object('status',409,'error','batch_not_available');end if;
  for change in select value from jsonb_array_elements(prior.changes) loop
   select * into p from private.favorite_places where id=(change->>'id')::uuid;
   select * into si from private.favorite_source_items where source_id=prior.source_id and place_id=p.id;
   if p.version is distinct from (change->>'version')::int or si.version is distinct from (change->>'sourceVersion')::int or exists(select 1 from private.favorite_day_links where place_id=p.id and active) then return jsonb_build_object('status',409,'error','favorite_conflict');end if;
  end loop;
  for change in select value from jsonb_array_elements(prior.changes) loop
   select * into p from private.favorite_places where id=(change->>'id')::uuid;before_p:=to_jsonb(p);
   if change->'before'='null'::jsonb then update private.favorite_places set archived=true,version=version+1,updated_at=now() where id=p.id returning * into p;
   else wanted:=jsonb_populate_record(null::private.favorite_places,change->'before');update private.favorite_places set source_name=wanted.source_name,source_note=wanted.source_note,region=wanted.region,place_type=wanted.place_type,user_note=wanted.user_note,manual_fields=wanted.manual_fields,archived=wanted.archived,version=version+1,updated_at=now() where id=p.id returning * into p;end if;
   if change->'beforeSource'='null'::jsonb then update private.favorite_source_items set active=false,version=version+1 where source_id=prior.source_id and place_id=p.id;
   else update private.favorite_source_items set raw=change->'beforeSource'->'raw',row_hash=change->'beforeSource'->>'row_hash',active=(change->'beforeSource'->>'active')::boolean,version=version+1 where source_id=prior.source_id and place_id=p.id;end if;
   insert into private.favorite_revisions(place_id,operation,request_hash,action,before_data,after_data,version) values(p.id,op,hash,'undo_import',before_p,to_jsonb(p),p.version);
  end loop;
  update private.favorite_sources set version=version+1 where id=prior.source_id;update private.favorite_import_batches set status='undone',undo_operation=op,undo_request_hash=hash where operation=prior.operation;
  return jsonb_build_object('ok',true);
 end if;
 select * into p from private.favorite_places where id=(p_body->>'id')::uuid and trip_id='osaka-2027';if not found then return jsonb_build_object('status',404,'error','favorite_not_found');end if;
 if p.version is distinct from (p_body->>'expected')::int then return jsonb_build_object('status',409,'error','favorite_conflict');end if;before_p:=to_jsonb(p);
 if p_action='restore' then
  select * into rev from private.favorite_revisions where id=(p_body->>'revision')::uuid and place_id=p.id;if not found then return jsonb_build_object('status',404,'error','revision_not_found');end if;
  patch:=jsonb_build_object('region',rev.after_data->'region','type',rev.after_data->'place_type','user_note',rev.after_data->'user_note','archived',rev.after_data->'archived');
 else patch:=p_body->'patch';end if;
 if jsonb_typeof(patch) is distinct from 'object' or patch-array['region','type','user_note','archived']<>'{}'::jsonb or jsonb_typeof(patch->'region') is distinct from 'string' or length(patch->>'region') not between 1 and 80 or jsonb_typeof(patch->'user_note') is distinct from 'string' or length(patch->>'user_note')>4000 or jsonb_typeof(patch->'archived') is distinct from 'boolean' or patch->>'type' not in ('餐厅','咖啡厅 / 甜品','景点','购物','娱乐体验','交通','其他') then return jsonb_build_object('status',400,'error','invalid_favorite');end if;
 update private.favorite_places set region=patch->>'region',place_type=patch->>'type',user_note=patch->>'user_note',archived=(patch->>'archived')::boolean,manual_fields=manual_fields||'{"region":true,"type":true,"user_note":true}'::jsonb,version=version+1,updated_at=now() where id=p.id returning * into p;
 insert into private.favorite_revisions(place_id,operation,request_hash,action,before_data,after_data,version) values(p.id,op,hash,p_action,before_p,to_jsonb(p),p.version);
 return jsonb_build_object('ok',true);
exception when invalid_text_representation or numeric_value_out_of_range or not_null_violation or check_violation then return jsonb_build_object('status',400,'error','invalid_request');
end $favorite$;
revoke all on function private.favorite_url_key(text),private.favorite_state_hash(),private.favorite_plan(jsonb,text),private.favorite_request(text,jsonb) from public,anon,authenticated;
create or replace function public.favorite_request(p_action text,p_body jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.favorite_request(p_action,p_body);$$;
revoke all on function public.favorite_request(text,jsonb) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.favorite_request(text,jsonb),public.favorite_request(text,jsonb) to service_role;
commit;
