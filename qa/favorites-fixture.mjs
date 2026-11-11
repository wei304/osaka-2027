import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
export async function createFavoritesFixture(){
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema private;create schema extensions;
 create function extensions.digest(text,text) returns bytea language sql immutable as $$select decode(md5($1)||md5($1),'hex')$$;
 create table private.shared_gate(trip_id text primary key,password_hash text,generation int);
 create table private.shared_sessions(token_hash bytea primary key,generation int,expires_at timestamptz);
 insert into private.shared_gate values('osaka-2027','synthetic-only',1);
 insert into private.shared_sessions values(extensions.digest(repeat('a',64),'sha256'),1,now()+interval '1 hour');`);
 await db.exec(fs.readFileSync(new URL('../supabase/v1_7_favorites.sql',import.meta.url),'utf8'));
 await db.exec(fs.readFileSync(new URL('../supabase/v1_8_favorite_days.sql',import.meta.url),'utf8'));
 await db.exec(`create table public.trip_items(trip_id text,id text,payload jsonb,version int,updated_at timestamptz default now(),primary key(trip_id,id));create table public.trip_revisions(id uuid primary key,trip_id text,item_id text,payload jsonb,version int,actor text,created_at timestamptz default now());create function private.shared_trip_request(text,jsonb,text) returns jsonb language plpgsql as $$declare g private.shared_gate;begin select * into g from private.shared_gate where trip_id='osaka-2027' for update;if not exists(select 1 from private.shared_sessions where token_hash=extensions.digest($2->>'token','sha256') and generation=g.generation and expires_at>now()) then return jsonb_build_object('status',401,'error','locked');end if;return jsonb_build_object('ok',true);end$$;`);
 for(const name of ['v1_3_ai.sql','v1_4_ai_routes.sql','v1_4_1_ai_cny_budget.sql','v1_9_favorite_ai.sql'])await db.exec(fs.readFileSync(new URL('../supabase/'+name,import.meta.url),'utf8'));
 return {db,ai:async(action,body)=>(await db.query('select private.favorite_ai_request($1,$2::jsonb) r',[action,JSON.stringify(body)])).rows[0].r,setTripRows:async rows=>db.query("insert into public.trip_items(trip_id,id,payload,version) select 'osaka-2027',x->>'id',x,(x->>'version')::int from jsonb_array_elements($1::jsonb) x on conflict(trip_id,id) do update set payload=excluded.payload,version=excluded.version",[JSON.stringify(rows)]),call:async(action,body)=>(await db.query('select private.favorite_request($1,$2::jsonb) r',[action,JSON.stringify(body)])).rows[0].r,close:()=>db.close()};
}
