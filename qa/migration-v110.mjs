import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createFavoritesFixture} from './favorites-fixture.mjs';
import {makeAIHandler} from '../supabase/functions/ai-trip/handler.js';
export async function testBulkSQL(){
 const f=await createFavoritesFixture(),token='a'.repeat(64),other='b'.repeat(64),sql=fs.readFileSync(new URL('../supabase/v1_10_favorite_bulk.sql',import.meta.url),'utf8');let calls=0,hold=null,failProvider=false;
 try{
 await f.db.exec(sql);await f.db.exec(sql);
 await f.db.exec(`insert into private.shared_sessions values(extensions.digest('${other}','sha256'),1,now()+interval '1 hour');update private.ai_policy set enabled=true,normal_budget_cny=10,travel_budget_cny=10,daily_requests=100,daily_tokens=1000000;`);
 const h=makeAIHandler({enabled:true,rpc:async(a,b)=>{try{return await f.ai(a.slice(10),b);}catch(e){console.error(a,e.message,e.where);throw e;}},complete:async({input})=>{calls++;if(hold)await hold;if(failProvider)throw Error('Synthetic provider failure');return {content:JSON.stringify({places:JSON.parse(input).USER_DATA.map(p=>({id:p.id,type:'购物',confidence:'medium',days:[]}))}),finish:'stop',usage:{total_tokens:100}};}});
 const call=async(action,b={},t=token)=>{const r=await h(new Request('https://synthetic.invalid',{method:'POST',headers:{'Content-Type':'application/json','X-Trip-Session':t},body:JSON.stringify({action:'favorites_bulk_'+action,...b})}));return {status:r.status,...await r.json()};};
 const rows=Array.from({length:94},(_,n)=>({name:'Synthetic bulk '+n,url:`https://www.google.com/maps/!1s0x99:0x${(n+1).toString(16)}`,key:`google:fid:0x99:0x${(n+1).toString(16)}`,note:'PRIVATE NOTE',labels:n<20?'餐厅':'',comment:''}));
 const input={token,rows,source:'Synthetic bulk CSV',fileHash:'c'.repeat(64)},pre=await f.call('preview',input);assert.ok(pre.guard);assert.equal((await f.call('import',{...input,...pre,confirmed:true,operation:crypto.randomUUID()})).ok,true);
 const before=JSON.stringify((await f.call('rows',{token})).places),taskId=crypto.randomUUID(),executor=crypto.randomUUID();
 assert.equal((await call('preview',{taskId,mode:'pending'},'bad')).status,401);
 const p=await call('preview',{taskId,mode:'pending'});assert.equal(p.status,200);assert.equal(p.items.length,94);assert.equal(p.rulePlaces,20);assert.equal(p.modelPlaces,74);
 assert.equal((await call('authorize',{taskId,executor})).status,400);
 assert.equal((await call('authorize',{taskId,executor,guard:p.guard,capCny:2,capRequests:30,confirmed:true,automatic:true})).status,200);
 assert.equal((await call('resume',{taskId,executor:crypto.randomUUID(),confirmed:true,automatic:true},other)).status,409);
 let state=p;while(state.done.length<94){await f.db.exec("update private.ai_usage set created_at=now()-interval '11 seconds'");const step=await call('step',{taskId,executor,operation:crypto.randomUUID(),consent:true});assert.equal(step.status,200,JSON.stringify(step));state=await call('status',{taskId});assert.equal(state.status,200);assert.equal(JSON.stringify((await f.call('rows',{token})).places),before,'unreviewed results wrote favorites');}
 assert.equal(state.state,'review');assert.equal(state.done.length,94);assert.equal(state.requests,15);assert.equal(calls,15);assert.equal(state.batches.length,19);assert.equal((await f.db.query('select count(*)::int n from public.trip_revisions')).rows[0].n,0);
 const entry=state.batches[0].result[0],operation=crypto.randomUUID(),payload={taskId,operation,confirmed:true,entries:[{id:entry.id,type:entry.type,days:[]}]};
 assert.equal((await call('confirm',payload)).status,200);assert.equal((await call('confirm',payload)).status,200);
 assert.equal((await f.db.query("select count(*)::int n from private.favorite_revisions where action='ai_bulk_confirm'")).rows[0].n,1);
 assert.equal((await f.ai('confirm',{token,operation:state.batches[0].operation,confirmed:true})).error,'bulk_review_required');
 // A new task reuses all unreviewed model caches without another provider call.
 const cachedId=crypto.randomUUID(),cp=await call('preview',{taskId:cachedId,mode:'pending'});assert.equal(cp.cachedPlaces,74);assert.equal(cp.modelPlaces,0);
 assert.equal((await call('authorize',{taskId:cachedId,executor,guard:cp.guard,capCny:0,capRequests:0,confirmed:true,automatic:true})).status,200);
 assert.equal((await call('pause',{taskId:cachedId,executor})).state,'paused');assert.equal((await call('step',{taskId:cachedId,executor,operation:crypto.randomUUID(),consent:true})).status,409);
 assert.equal((await call('resume',{taskId:cachedId,executor,confirmed:true,automatic:true})).status,200);assert.equal((await call('step',{taskId:cachedId,executor,operation:crypto.randomUUID(),consent:true})).status,200);assert.equal(calls,15);
 await call('stop',{taskId:cachedId});

 // Task cap and global 10-second throttle must stop new reservations.
 await f.db.exec('delete from private.favorite_ai_results');
 const ids=cp.items.filter(i=>i.baseType==='其他').slice(-20).map(i=>i.id);
 const start=async(ids,capCny=2,capRequests=10)=>{const taskId=crypto.randomUUID(),executor=crypto.randomUUID(),p=await call('preview',{taskId,mode:'selected',ids});assert.equal(p.status,200,JSON.stringify(p));const a=await call('authorize',{taskId,executor,guard:p.guard,capCny,capRequests,confirmed:true,automatic:true});assert.equal(a.status,200,JSON.stringify(a));return {taskId,executor};};
 const cap=await start(ids.slice(0,10),0.128,1);await f.db.exec("update private.ai_usage set created_at=now()-interval '11 seconds'");
 assert.equal((await call('step',{...cap,operation:crypto.randomUUID(),consent:true})).status,200);await call('status',cap);const paid=calls;
 assert.equal((await call('step',{...cap,operation:crypto.randomUUID(),consent:true})).error,'bulk_budget_limit');assert.equal(calls,paid);assert.equal((await call('status',cap)).state,'paused');await call('stop',cap);
 const concurrent=await start(ids.slice(10,20));
 assert.equal((await call('step',{...concurrent,operation:crypto.randomUUID(),consent:true})).error,'ai_rate_limit');assert.equal(calls,paid);
 assert.equal((await call('resume',{...concurrent,confirmed:true,automatic:true})).error,'bulk_failure_needs_review');
 assert.equal((await call('resume',{...concurrent,confirmed:true,automatic:true,acknowledgeFailure:true})).status,200);
 await f.db.exec("update private.ai_usage set created_at=now()-interval '11 seconds'");
 let release;hold=new Promise(r=>release=r);
 // The fake provider is held after its ONE reservation.
 const originalCallCount=calls,operation2=crypto.randomUUID();
 const inFlight=call('step',{...concurrent,operation:operation2,consent:true});
 for(let n=0;n<100&&calls===originalCallCount;n++)await new Promise(r=>setTimeout(r,2));assert.equal(calls,originalCallCount+1);
 const parallel=await call('step',{...concurrent,operation:crypto.randomUUID(),consent:true});assert.equal(parallel.recoverFirst,true);assert.equal(calls,originalCallCount+1);
 assert.equal((await call('resume',{taskId:concurrent.taskId,executor:crypto.randomUUID(),confirmed:true,automatic:true},other)).error,'bulk_executor_busy');
 assert.equal((await call('pause',concurrent)).state,'paused');release();hold=null;await inFlight;
 const recovered=await call('status',concurrent,other);assert.equal(recovered.done.length,5);assert.equal(calls,originalCallCount+1,'lost response recovery charged twice');
 const newExecutor=crypto.randomUUID();assert.equal((await call('resume',{taskId:concurrent.taskId,executor:newExecutor,confirmed:true,automatic:true},other)).status,200);
 // Failure remains charged conservatively; same request is recoverable, never auto retried.
 await f.db.exec("update private.ai_usage set created_at=now()-interval '11 seconds'");failProvider=true;
 assert.equal((await call('step',{taskId:concurrent.taskId,executor:newExecutor,operation:crypto.randomUUID(),consent:true},other)).status,503);failProvider=false;
 const failed=await call('status',concurrent);assert.equal(failed.state,'paused');assert.equal(failed.skipped.length,5);assert.ok(failed.reservedCny>0);const failedCalls=calls;
 assert.equal((await call('step',{...concurrent,operation:crypto.randomUUID(),consent:true})).status,409);assert.equal(calls,failedCalls);await call('stop',concurrent);
 // All-or-none review rollback on a deliberately failed second audit insert.
 const reviewRows=state.batches[1].result.slice(0,2).map(r=>({id:r.id,type:r.type,days:[]}));
 const beforeAtomic=JSON.stringify((await f.call('rows',{token})).places);
 await f.db.exec(`create function private.bulk_audit_fail() returns trigger language plpgsql as $$begin if new.action='ai_bulk_confirm' and new.place_id='${reviewRows[1].id}' then raise exception 'synthetic rollback' using errcode='23514';end if;return new;end$$;create trigger bulk_audit_fail before insert on private.favorite_revisions for each row execute function private.bulk_audit_fail();`);
 assert.equal((await call('confirm',{taskId,operation:crypto.randomUUID(),confirmed:true,entries:reviewRows})).status,400);assert.equal(JSON.stringify((await f.call('rows',{token})).places),beforeAtomic);
 await f.db.exec('drop trigger bulk_audit_fail on private.favorite_revisions;drop function private.bulk_audit_fail();');
 // Protect existing manual region/type/days/notes, including editing a suggested type.
 const manualId=ids[0];await f.db.query("update private.favorite_places set manual_fields='{\"region\":true,\"type\":true,\"days\":true}',region='人工自定义',place_type='交通',user_note='PRIVATE MANUAL NOTE',version=version+1 where id=$1",[manualId]);
 let mp=(await f.call('rows',{token})).places.find(p=>p.id===manualId);await f.call('link_days',{token,id:manualId,expected:mp.version,days:['2027-01-11'],operation:crypto.randomUUID()});
 const manualTask=await start([manualId],0,0);assert.equal((await call('step',{...manualTask,operation:crypto.randomUUID(),consent:true})).status,200);await call('status',manualTask);
 assert.equal((await call('confirm',{...manualTask,operation:crypto.randomUUID(),confirmed:true,entries:[{id:manualId,type:'购物',days:[]}]})).status,200);
 const mr=await f.call('rows',{token}),protectedPlace=mr.places.find(p=>p.id===manualId);assert.equal(protectedPlace.region,'人工自定义');assert.equal(protectedPlace.place_type,'交通');assert.equal(protectedPlace.user_note,'PRIVATE MANUAL NOTE');assert.ok(mr.links.some(l=>l.place_id===manualId&&l.day==='2027-01-11'&&l.active));
 const expired=await call('preview',{taskId:crypto.randomUUID(),mode:'pending'});await f.db.query("update private.favorite_bulk_tasks set expires_at=now()-interval '1 second' where id=$1",[expired.id]);assert.equal((await call('authorize',{taskId:expired.id,executor,guard:expired.guard,capCny:1,capRequests:10,confirmed:true,automatic:true})).error,'bulk_expired');

 // Stale context, changed shared budget and payload reuse cannot cause another charge.
 const contextTask=await start([ids[1]],1,5);await f.db.query("update private.favorite_places set source_name=source_name||' changed',version=version+1 where id=$1",[ids[1]]);assert.equal((await call('step',{...contextTask,operation:crypto.randomUUID(),consent:true})).error,'draft_stale');await call('stop',contextTask);
 const policyTask=await start([ids[2]],1,5);await f.db.exec('update private.ai_policy set budget_version=budget_version+1');assert.equal((await call('step',{...policyTask,operation:crypto.randomUUID(),consent:true})).error,'budget_changed');await call('stop',policyTask);
 const replayTask=await start([ids[3]],1,5);assert.equal((await call('step',{...replayTask,operation:state.batches[0].operation,consent:true})).error,'operation_reused');await call('stop',replayTask);
 // New imports cannot extend an already authorized scope, even on resume.
 const frozen=await start([ids[4]],1,5),newRows=[{name:'Synthetic later import',url:'https://www.google.com/maps/!1s0xee:0x1',key:'google:fid:0xee:0x1',note:'',labels:'购物',comment:''}],newInput={token,rows:newRows,source:'Synthetic later',fileHash:'f'.repeat(64)},newPre=await f.call('preview',newInput);await f.call('import',{...newInput,...newPre,operation:crypto.randomUUID(),confirmed:true});assert.equal((await call('status',frozen)).items.length,1);await call('stop',frozen);

 // Simulate a worker lost after reservation: timeout recovery never invokes provider again.
 await f.db.exec('delete from private.favorite_ai_results');const timed=await start(ids.slice(10,15));await f.db.exec("update private.ai_usage set created_at=now()-interval '11 seconds'");const timedOp=crypto.randomUUID(),timedPlan=await f.ai('bulk_next',{token,...timed,operation:timedOp});assert.equal((await f.ai('bulk_prepare',{token,...timed,operation:timedOp,guard:timedPlan.guard,model:'deepseek-flash',inputBytes:3000})).items.length,5);
 await f.db.query("update private.favorite_ai_jobs set created_at=now()-interval '91 seconds' where operation=$1",[timedOp]);const beforeTimeoutCalls=calls,timedStatus=await call('status',timed,other);assert.equal(timedStatus.state,'paused');assert.equal(timedStatus.skipped.length,5);assert.ok(timedStatus.reservedCny>0);assert.equal(calls,beforeTimeoutCalls);assert.equal((await call('status',timed)).skipped.length,5);await call('stop',timed);
 const idle=await start([ids[8]]);await f.db.query("update private.favorite_bulk_tasks set lease_until=now()-interval '1 second' where id=$1",[idle.taskId]);assert.equal((await call('status',idle)).state,'paused');assert.equal((await call('resume',{taskId:idle.taskId,executor:crypto.randomUUID(),confirmed:true,automatic:true},other)).status,200);await call('stop',idle);
 // The real public invoker entrypoint reaches the wrapped task API; client grants remain denied.
 const pub=await f.db.query('select public.favorite_ai_request($1,$2::jsonb) r',['bulk_list',JSON.stringify({token})]);assert.ok(Array.isArray(pub.rows[0].r.tasks));
 console.log('PASS bulk task cap/global rate, in-flight dual-device exclusion, pause, cross-session recovery, failure accounting/skip, atomic audit rollback, manual protection and expiry.');
 const grants=await f.db.query("select has_function_privilege('anon','private.favorite_ai_request(text,jsonb)','execute') a,has_table_privilege('authenticated','private.favorite_bulk_tasks','select') t");assert.equal(grants.rows[0].a,false);assert.equal(grants.rows[0].t,false);
 console.log('PASS bounded favorite SQL + real Edge: synthetic 94 / 19 batches / 15 model calls, zero unreviewed writes, cache reuse, lease isolation, pause/resume, idempotent review and private grants.');
 }finally{await f.close();}
}
if(process.argv[1]&&new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll('\\','/')))await testBulkSQL();
