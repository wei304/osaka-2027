import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createFavoritesFixture} from './favorites-fixture.mjs';
import {makeHandler} from '../supabase/functions/shared-trip/handler.js';
import {batchEntries} from '../favorite-days-batch-core.js';
export async function testBatchDaysSQL(){const f=await createFavoritesFixture(),token='a'.repeat(64);try{
 const sql=fs.readFileSync(new URL('../supabase/v1_11_favorite_batch_days.sql',import.meta.url),'utf8');await f.db.exec(sql);await f.db.exec(sql);
 const h=makeHandler({networkHash:async()=>'',rpc:async(a,b)=>{try{return await f.call(a.slice(10),b);}catch(e){console.error(e.message,e.where);throw e;}}}),call=async(body,t=token)=>{const r=await h(new Request('https://synthetic.invalid',{method:'POST',headers:{'Content-Type':'application/json','X-Trip-Session':t},body:JSON.stringify({action:'favorites_link_days_batch',...body})}));return {status:r.status,...await r.json()};};
 const rows=Array.from({length:94},(_,n)=>({name:'Synthetic date '+n,url:`https://www.google.com/maps/!1s0xdd:0x${n+1}`,key:`google:fid:0xdd:0x${n+1}`,note:'',labels:'购物',comment:''})),input={token,rows,source:'Synthetic dates',fileHash:'d'.repeat(64)},pre=await f.call('preview',input);assert.equal((await f.call('import',{...input,...pre,confirmed:true,operation:crypto.randomUUID()})).ok,true);
 let snap=await f.call('rows',{token});const id=snap.places[0].id;
 await f.call('link_days',{token,id,expected:snap.places[0].version,days:['2027-01-11'],operation:crypto.randomUUID()});snap=await f.call('rows',{token});
 const build=()=>batchEntries(snap.places,snap.links,snap.places.map(p=>({id:p.id,mode:'add',targets:['2027-01-15','2027-01-16']}))).map(({id,expected,days})=>({id,expected,days}));
 const entries=build(),operation=crypto.randomUUID(),payload={entries,operation,confirmed:true};assert.equal((await call(payload,'bad')).status,401);assert.equal((await call({...payload,confirmed:false})).status,400);
 // One concurrent device changes the last place. The complete batch must reject, not partially apply.
 const last=snap.places.at(-1);await f.call('link_days',{token,id:last.id,expected:last.version,days:['2027-01-12'],operation:crypto.randomUUID()});
 const before=JSON.stringify((await f.call('rows',{token})).links);assert.equal((await call(payload)).status,409);assert.equal(JSON.stringify((await f.call('rows',{token})).links),before);
 snap=await f.call('rows',{token});const fresh={entries:build(),operation:crypto.randomUUID(),confirmed:true};const result=await call(fresh);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.changed,94);assert.equal(result.added,188);assert.equal(result.removed,0);assert.equal((await call(fresh)).replayed,true);assert.equal((await call({...fresh,entries:fresh.entries.slice(1)})).error,'operation_reused');
 snap=await f.call('rows',{token});assert.equal(snap.places.length,94);assert.ok(snap.links.some(l=>l.place_id===id&&l.day==='2027-01-11'&&l.active));assert.ok(snap.links.some(l=>l.place_id===last.id&&l.day==='2027-01-12'&&l.active));assert.equal((await f.db.query('select count(*)::int n from public.trip_revisions')).rows[0].n,0);
 const noopVersions=snap.places.map(p=>p.version);const noop=await call({operation:crypto.randomUUID(),confirmed:true,entries:snap.places.map(p=>({id:p.id,expected:p.version,days:snap.links.filter(l=>l.place_id===p.id&&l.active).map(l=>l.day)}))});assert.equal(noop.unchanged,94);assert.deepEqual((await f.call('rows',{token})).places.map(p=>p.version),noopVersions);
 const pair=snap.places.slice(0,2),replace=pair.map(p=>({id:p.id,expected:p.version,days:['2027-01-17']})),beforeRollback=JSON.stringify(await f.call('rows',{token}));
 await f.db.exec(`create function private.date_audit_fail() returns trigger language plpgsql as $$begin if new.place_id='${pair[1].id}' then raise exception 'synthetic audit failure' using errcode='23514';end if;return new;end$$;create trigger date_audit_fail before insert on private.favorite_revisions for each row execute function private.date_audit_fail();`);
 assert.equal((await call({entries:replace,confirmed:true,operation:crypto.randomUUID()})).status,400);assert.equal(JSON.stringify(await f.call('rows',{token})),beforeRollback);await f.db.exec('drop trigger date_audit_fail on private.favorite_revisions;drop function private.date_audit_fail();');
 const concurrency=await Promise.all([call({entries:replace,confirmed:true,operation:crypto.randomUUID()}),call({entries:replace,confirmed:true,operation:crypto.randomUUID()})]);assert.deepEqual(concurrency.map(r=>r.status).sort(),[200,409]);
 snap=await f.call('rows',{token});const clear=pair.map(p=>({id:p.id,expected:snap.places.find(x=>x.id===p.id).version,days:[]}));assert.equal((await call({entries:clear,confirmed:true,operation:crypto.randomUUID()})).changed,2);
 assert.equal((await call({entries:[{...clear[0],days:['2027-01-18']}],confirmed:true,operation:crypto.randomUUID()})).status,400);
 assert.equal((await f.db.query("select has_table_privilege('anon','private.favorite_day_batches','select') a,has_function_privilege('authenticated','public.favorite_request(text,jsonb)','execute') b")).rows[0].a,false);

 // Daily recommendations are invalidated when the formal itinerary scope changes.
 await f.setTripRows([{id:'synthetic-context',day:'2027-01-15',title:'Synthetic region day',time:'10:00',category:'spot',version:1}]);const aiPlan=await f.ai('plan',{token}),pr=aiPlan.profiles.find(p=>p.day==='2027-01-15');assert.equal((await f.ai('profile',{token,day:pr.day,scopeHash:pr.scopeHash,expected:pr.version,regions:['天王寺 / 阿倍野'],operation:crypto.randomUUID(),confirmed:true})).ok,true);
 assert.equal((await f.call('days_context',{token})).profiles[0].valid,true);await f.setTripRows([{id:'synthetic-context',day:'2027-01-15',title:'Changed itinerary',time:'11:00',category:'spot',version:2}]);assert.equal((await f.call('days_context',{token})).profiles[0].valid,false);
 assert.equal((await f.call('link_days',{token,operation:fresh.operation,id,expected:1,days:[]})).error,'operation_reused');
 const history=await f.call('history',{token,id:pair[0].id});assert.ok(history.revisions.some(r=>r.action==='link_days'&&r.before_data.day_links&&r.after_data.day_links));
 console.log('PASS batch dates SQL + real Edge: synthetic94 atomic add, preserved old days, stale all-or-none, UUID replay, noops, second-row audit rollback, concurrency, explicit replacement/removal, history, grants and no itinerary writes.');
 }finally{await f.close();}}
