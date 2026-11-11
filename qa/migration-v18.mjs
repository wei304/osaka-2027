await import('./migration-v17.mjs');
import {createFavoritesFixture} from './favorites-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const f=await createFavoritesFixture(),token='a'.repeat(64),call=(a,b={})=>f.call(a,{token,...b});
try{
 const row={name:'Synthetic day place',url:'https://www.google.com/maps/place/test/data=!1s0x8:0x9',key:'google:fid:0x8:0x9',note:'source',labels:'',comment:''},input={rows:[row],source:'Synthetic days',fileHash:'c'.repeat(64)};
 const preview=await call('preview',input),batch=crypto.randomUUID();assert.equal((await call('import',{...input,...preview,operation:batch,confirmed:true})).ok,true);
 let state=await call('rows'),p=state.places[0];
 const req={id:p.id,expected:p.version,days:['2027-01-11','2027-01-13'],operation:crypto.randomUUID()};
 assert.equal((await call('link_days',{...req,token:'bad'})).error,'locked');
 for(const days of [null,{},['2027-02-01'],['2027-01-11','2027-01-11'],[123]])assert.equal((await call('link_days',{...req,days})).error,'invalid_days');
 assert.equal((await call('link_days',req)).ok,true);assert.equal((await call('link_days',req)).replayed,true);
 assert.equal((await call('link_days',{...req,days:[]})).error,'operation_reused');
 state=await call('rows');assert.equal(state.places.length,1);assert.deepEqual(state.links.filter(l=>l.active).map(l=>l.day).sort(),req.days);
 assert.equal(state.places[0].source_name,p.source_name);assert.equal(state.places[0].user_note,p.user_note);
 assert.equal((await call('import',{...input,...preview,operation:crypto.randomUUID(),confirmed:true})).error,'preview_stale');
 assert.equal((await call('undo_import',{batchId:batch,operation:crypto.randomUUID()})).error,'favorite_conflict');
 assert.equal((await call('link_days',{...req,operation:crypto.randomUUID()})).error,'favorite_conflict');
 p=state.places[0];const remove={id:p.id,expected:p.version,days:['2027-01-13'],operation:crypto.randomUUID()};assert.equal((await call('link_days',remove)).ok,true);
 state=await call('rows');assert.equal(state.links.length,2,'relations are tombstones, not deleted');assert.deepEqual(state.links.filter(l=>l.active).map(l=>l.day),['2027-01-13']);
 p=state.places[0];assert.equal((await call('link_days',{...remove,expected:p.version,days:[],operation:crypto.randomUUID()})).ok,true);
 assert.equal((await call('rows')).links.filter(l=>l.active).length,0);
 const history=await call('history',{id:p.id});assert.equal(history.revisions[0].action,'link_days');assert.ok(history.revisions[0].before_data.day_links.some(l=>l.active));
 // Any failure after relation writes must roll back relations, master version and audit together.
 state=await call('rows');p=state.places[0];const before=JSON.stringify(state);
 await f.db.exec(`create function private.reject_day_audit() returns trigger language plpgsql as $$begin if new.action='link_days' then raise check_violation;end if;return new;end$$;create trigger reject_day_audit before insert on private.favorite_revisions for each row execute function private.reject_day_audit();`);
 assert.equal((await call('link_days',{...req,expected:p.version,operation:crypto.randomUUID()})).error,'invalid_request');assert.equal(JSON.stringify(await call('rows')),before,'failed date write left partial state');
 await f.db.exec('drop trigger reject_day_audit on private.favorite_revisions');
 await f.db.exec(fs.readFileSync(new URL('../supabase/v1_8_favorite_days.sql',import.meta.url),'utf8'));
 await f.db.exec('set role service_role');assert.equal((await f.db.query('select public.favorite_request($1,$2::jsonb) r',['link_days',JSON.stringify({token,...req,expected:p.version,operation:crypto.randomUUID()})])).rows[0].r.ok,true);await f.db.exec('reset role');
 for(const role of ['anon','authenticated']){assert.equal((await f.db.query('select has_function_privilege($1,$2,$3) ok',[role,'public.favorite_request(text,jsonb)','EXECUTE'])).rows[0].ok,false);}
 await f.db.exec('update private.shared_gate set generation=2');assert.equal((await call('link_days',req)).error,'locked');
 console.log('PASS stage 3 SQL: authorization, multi-day relations, unlink tombstones, optimistic conflicts, idempotent replay, preview invalidation, import undo protection, atomic rollback and migration reapply.');
}finally{await f.close();}
