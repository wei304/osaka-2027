import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
export const SYSTEM_MIGRATIONS=['shared_gate.sql','v1_1_upgrade.sql','v1_2_upgrade.sql','v1_2_exchange.sql','v1_2_shared_rpc.sql','v1_3_ai.sql','v1_4_ai_routes.sql','v1_4_1_ai_cny_budget.sql','v1_7_favorites.sql','v1_8_favorite_days.sql','v1_9_favorite_ai.sql','v1_9_1_ai_no_changes.sql','v1_9_2_phrase_ai.sql','v1_9_3_favorite_regions.sql','v1_10_favorite_bulk.sql','v1_11_favorite_batch_days.sql','v1_12_favorite_day_sort.sql','v2_0_ai_chat.sql'];
export async function createSystemFixture(){
 const db=new PGlite();
 // Crypto/auth/storage infrastructure stubs only; all business RPCs below are
 // real repository SQL, including shared_trip_request/apply_batch/history.
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema private;create schema extensions;create schema auth;create schema storage;
 create function extensions.digest(text,text) returns bytea language sql immutable as $$select decode(md5($1)||md5($1),'hex')$$;
 create function extensions.gen_random_bytes(int) returns bytea language sql as $$select decode(repeat('ab',$1),'hex')$$;
 create function extensions.crypt(text,text) returns text language sql as $$select $1$$;
 create function extensions.gen_salt(text,int) returns text language sql as $$select 'isolated-test-salt'::text$$;
 create function auth.uid() returns uuid language sql as $$select null::uuid$$;
 create function auth.jwt() returns jsonb language sql as $$select '{}'::jsonb$$;
 create table public.trip_items(trip_id text,id text,payload jsonb,version int,updated_at timestamptz default now(),primary key(trip_id,id));
 create table public.trip_revisions(id uuid primary key,trip_id text,item_id text,payload jsonb,version int,actor text,created_at timestamptz default now());
 create table public.trip_members(trip_id text,email text);
 create table private.shared_gate(trip_id text primary key,password_hash text,setup_hash bytea,setup_expires timestamptz,generation int default 1);
 create table private.shared_sessions(token_hash bytea primary key,generation int,expires_at timestamptz);
 create table private.shared_attempts(bucket text,started_at timestamptz,attempts int,primary key(bucket,started_at));
 create function public.is_trip_member(text) returns boolean language sql as $$select false$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(bucket_id text,name text);alter table storage.objects enable row level security;
 insert into private.shared_gate(trip_id,password_hash) values('osaka-2027','synthetic-only-not-a-production-password');`);
 for(const file of SYSTEM_MIGRATIONS)await db.exec(fs.readFileSync(new URL('../supabase/'+file,import.meta.url),'utf8'));
 const token='a'.repeat(64),other='b'.repeat(64);for(const t of [token,other])await db.query("insert into private.shared_sessions values(extensions.digest($1,'sha256'),1,now()+interval '1 hour')",[t]);
 const shared=async(action,body={})=>(await db.query('select public.shared_trip_request($1,$2::jsonb,\'\') r',[action,JSON.stringify({token,...body})])).rows[0].r;
 const favorite=async(action,body={})=>(await db.query('select public.favorite_request($1,$2::jsonb) r',[action,JSON.stringify({token,...body})])).rows[0].r;
 const rpc=async(action,body)=>{
  if(action==='finish_no_changes')return (await db.query('select public.ai_no_changes_finish($1::jsonb) r',[JSON.stringify(body)])).rows[0].r;
  const group=action.startsWith('favorites_')?['favorite_ai_request',10]:action.startsWith('chat_')?['ai_chat_request',5]:action.startsWith('phrase_')?['phrase_ai_request',7]:['ai_trip_request',0];
  return (await db.query('select public.'+group[0]+'($1,$2::jsonb) r',[action.slice(group[1]),JSON.stringify(body)])).rows[0].r;
 };
 return {db,token,other,shared,favorite,rpc,close:()=>db.close()};
}
