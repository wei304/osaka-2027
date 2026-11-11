await import('./migration-v19.mjs');
import {createFavoritesFixture} from './favorites-fixture.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const f=await createFavoritesFixture(),token='a'.repeat(64);
try{
 await f.db.exec(fs.readFileSync(new URL('../supabase/v1_9_1_ai_no_changes.sql',import.meta.url),'utf8'));
 const id=crypto.randomUUID();await f.db.query("insert into private.ai_usage(id,token_hash,task,model_name,days,scope_hash,snapshot,cache_key,cacheable,reserved_tokens,charged_tokens,reserved_usd,charged_usd,currency,reserved_cny,charged_cny) values($1,extensions.digest($2,'sha256'),'edit','deepseek-flash','[\"2027-01-10\"]','synthetic','[]','synthetic',false,4096,4096,0,0,'CNY',0.032768,0.032768)",[id,token]);
 const input={token,requestId:id,result:{answer:'请先核对信息。',warnings:[],noChanges:true},usage:{total_tokens:100}};const call=async b=>(await f.db.query('select public.ai_no_changes_finish($1::jsonb) r',[JSON.stringify(b)])).rows[0].r;
 assert.equal((await call({...input,token:'bad'})).error,'locked');assert.equal((await call({...input,result:{...input.result,operations:[{type:'delete'}]}})).error,'invalid_ai_output');assert.equal((await call(input)).ok,true);assert.equal((await call(input)).error,'request_finished');
 const u=(await f.db.query('select status,charged_tokens,charged_cny::text c from private.ai_usage where id=$1',[id])).rows[0];assert.equal(u.status,'done');assert.equal(u.charged_tokens,100);assert.equal(Number(u.c),0.0008);assert.equal((await f.db.query('select count(*)::int n from private.ai_drafts')).rows[0].n,0);assert.equal((await f.db.query('select count(*)::int n from public.trip_revisions')).rows[0].n,0);
 for(const role of ['anon','authenticated'])assert.equal((await f.db.query("select has_function_privilege($1,'public.ai_no_changes_finish(jsonb)','execute') ok",[role])).rows[0].ok,false);
 console.log('PASS V1.9.1: authenticated no-change settlement, actual usage, malformed-output denial, no drafts or itinerary writes and client-role denial.');
}finally{await f.close();}
