await import('./migration-v192.mjs');
import {createFavoritesFixture} from './favorites-fixture.mjs';
import {makeHandler} from '../supabase/functions/shared-trip/handler.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const f=await createFavoritesFixture(),token='a'.repeat(64);
try{
 const sql=fs.readFileSync(new URL('../supabase/v1_9_3_favorite_regions.sql',import.meta.url),'utf8');await f.db.exec(sql);await f.db.exec(sql);
 const rpc=async(action,b)=>(await f.db.query('select public.favorite_region_request($1,$2::jsonb) r',[b.regionAction,JSON.stringify(b)])).rows[0].r;
 const h=makeHandler({rpc,networkHash:async()=>''});
 const call=async(action,b={},t=token)=>{const r=await h(new Request('https://synthetic.invalid',{method:'POST',headers:{'Content-Type':'application/json','X-Trip-Session':t},body:JSON.stringify({action,...b})}));return {status:r.status,...await r.json()};};
 const rows=[0,1,2,3].map(n=>({name:'Synthetic region '+n,url:`https://www.google.com/maps/!1s0x99:0x${n+1}`,key:`google:fid:0x99:0x${n+1}`,note:'',labels:'',comment:''}));
 const input={token,rows,source:'Synthetic region CSV',fileHash:'d'.repeat(64)},pre=await f.call('preview',input);await f.call('import',{...input,...pre,confirmed:true,operation:crypto.randomUUID()});
 let places=(await f.call('rows',{token})).places.sort((a,b)=>a.source_name.localeCompare(b.source_name));
 for(const [n,p]of places.entries()){if(n===3)continue;await f.ai('evidence',{token,id:p.id,expected:p.version,operation:crypto.randomUUID(),evidence:{verified:true,region:n===2?'人工自定义地区':'',address:n===0?'大阪市中央区難波1丁目':n===1?'大阪市北区梅田1丁目':'京都市中京区',source:'https://example.org/verified-address-'+n}});}
 places=(await f.call('rows',{token})).places.sort((a,b)=>a.source_name.localeCompare(b.source_name));const [a,b,manual,unknown]=places;
 await f.call('link_days',{token,id:a.id,expected:a.version,days:['2027-01-10','2027-01-11'],operation:crypto.randomUUID()});
 const linksBefore=JSON.stringify((await f.call('rows',{token})).links);
 const snapshotBefore=await f.db.query('select count(*)::int n from public.trip_revisions');
 assert.equal((await call('favorites_regions_plan',{},'bad')).status,401);
 const plan=await call('favorites_regions_plan');assert.equal(plan.items.find(p=>p.id===manual.id).status,'protected');assert.equal(plan.items.find(p=>p.id===unknown.id).region,null);
 assert.equal((await call('favorites_regions_preview',{ids:[manual.id],operation:crypto.randomUUID()})).status,409);
 const operation=crypto.randomUUID(),preview=await call('favorites_regions_preview',{ids:[a.id,b.id],operation});assert.equal(preview.status,200);assert.equal((await f.call('rows',{token})).places.find(p=>p.id===a.id).region,'待确认地区');
 assert.equal((await call('favorites_regions_confirm',{operation,confirmed:false})).status,400);
 let p=(await f.call('rows',{token})).places.find(p=>p.id===b.id);await f.call('edit',{token,id:p.id,expected:p.version,operation:crypto.randomUUID(),patch:{region:p.region,type:p.place_type,user_note:'New manual note',archived:false}});
 assert.equal((await call('favorites_regions_confirm',{operation,confirmed:true})).status,409);assert.equal((await f.call('rows',{token})).places.find(p=>p.id===a.id).region,'待确认地区');
 const op2=crypto.randomUUID();await call('favorites_regions_preview',{ids:[a.id,b.id],operation:op2});
 // Deliberate second-row audit failure proves the first update rolls back too.
 await f.db.exec(`create function private.region_test_fail() returns trigger language plpgsql as $$begin if new.place_id='${b.id}'::uuid and new.action='region_confirm' then raise exception 'synthetic rollback' using errcode='23514';end if;return new;end$$;create trigger region_test_fail before insert on private.favorite_revisions for each row execute function private.region_test_fail();`);
 assert.equal((await call('favorites_regions_confirm',{operation:op2,confirmed:true})).status,400);assert.equal((await f.call('rows',{token})).places.find(p=>p.id===a.id).region,'待确认地区');await f.db.exec('drop trigger region_test_fail on private.favorite_revisions;drop function private.region_test_fail()');
 const confirmed=await call('favorites_regions_confirm',{operation:op2,confirmed:true});assert.equal(confirmed.count,2);assert.deepEqual(await call('favorites_regions_confirm',{operation:op2,confirmed:true}),confirmed);
 const after=await f.call('rows',{token});assert.equal(JSON.stringify(after.links),linksBefore);assert.equal(after.places.find(p=>p.id===a.id).region,'难波 / 心斋桥');assert.equal(after.places.find(p=>p.id===b.id).user_note,'New manual note');assert.equal(after.places.find(p=>p.id===manual.id).geo_evidence.region,'人工自定义地区');assert.equal(after.places.find(p=>p.id===a.id).geo_evidence.verified,true);assert.ok(after.places.find(p=>p.id===a.id).geo_evidence.confirmed_at);
 assert.equal((await f.db.query("select count(*)::int n from private.favorite_revisions where action='region_confirm'")).rows[0].n,2);
 assert.equal((await f.db.query('select count(*)::int n from public.trip_revisions')).rows[0].n,snapshotBefore.rows[0].n);
 // Reimport retains the human result and dates; absent old rows remain present.
 const again={...input,rows:[rows[0]]},importPre=await f.call('preview',again);await f.call('import',{...again,...importPre,confirmed:true,operation:crypto.randomUUID()});assert.equal((await f.call('rows',{token})).places.length,4);assert.equal((await f.call('rows',{token})).places.find(p=>p.id===a.id).region,'难波 / 心斋桥');assert.equal(JSON.stringify((await f.call('rows',{token})).links),linksBefore);
 const billBefore=(await f.db.query('select count(*)::int n from private.ai_usage')).rows[0].n;
 const u=(await f.call('rows',{token})).places.find(p=>p.id===unknown.id);await f.ai('evidence',{token,id:u.id,expected:u.version,operation:crypto.randomUUID(),evidence:{verified:true,region:'',address:'奈良市登大路町',source:'https://example.org/nara-address'}});
 const expired=crypto.randomUUID();await call('favorites_regions_preview',{ids:[u.id],operation:expired});await f.db.query("update private.favorite_region_reviews set expires_at=now()-interval '1 second' where operation=$1",[expired]);assert.equal((await call('favorites_regions_confirm',{operation:expired,confirmed:true})).status,409);
 const op3=crypto.randomUUID(),op4=crypto.randomUUID();await call('favorites_regions_preview',{ids:[u.id],operation:op3});await call('favorites_regions_preview',{ids:[u.id],operation:op4});const race=await Promise.all([call('favorites_regions_confirm',{operation:op3,confirmed:true}),call('favorites_regions_confirm',{operation:op4,confirmed:true})]);assert.deepEqual(race.map(x=>x.status).sort(),[200,409]);assert.equal((await f.db.query('select count(*)::int n from private.ai_usage')).rows[0].n,billBefore);
 assert.equal((await f.db.query("select relrowsecurity from pg_class where oid='private.favorite_region_reviews'::regclass")).rows[0].relrowsecurity,true);
 for(const role of ['anon','authenticated'])assert.equal((await f.db.query("select has_function_privilege($1,'public.favorite_region_request(text,jsonb)','execute') ok",[role])).rows[0].ok,false);
 await f.db.query("insert into private.shared_sessions values(extensions.digest($1,'sha256'),1,now()+interval '1 hour')",['b'.repeat(64)]);assert.equal((await call('favorites_regions_confirm',{operation:op2,confirmed:true},'b'.repeat(64))).status,404);
 console.log('PASS region SQL + Edge: protected manual fields, current evidence candidates, confirm-only writes, stale whole-batch rejection, second-row failure rollback, idempotence, audit, untouched dates/itinerary, reimport preservation and role/session denial.');
}finally{await f.close();}
