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
 return {call:async(action,body)=>(await db.query('select private.favorite_request($1,$2::jsonb) r',[action,JSON.stringify(body)])).rows[0].r,close:()=>db.close()};
}
