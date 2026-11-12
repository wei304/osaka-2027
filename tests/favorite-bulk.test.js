import test from 'node:test';
import assert from 'node:assert/strict';
import {FavoriteBulkRunner} from '../favorite-bulk-client.js';
test('finite executor persists UUID before sending, recovers before next request and waits after model use',async()=>{
 let steps=0,saves=[],waits=[];const r=new FavoriteBulkRunner({request:async(a,b)=>{if(a==='status')return {state:steps===2?'review':'running',pending:null};steps++;assert.equal(saves.at(-1).operation,b.operation);return {result:[{engine:'ai'}]};},savePending:async p=>saves.push(p),onState:()=>{},wait:async ms=>waits.push(ms)});await r.run('task','executor');assert.equal(steps,2);assert.equal(waits.length,1);assert.ok(waits[0]>=10000);assert.equal(saves.at(-1),null);
});
test('uncertain response and offline errors stop without retrying or losing pending UUID',async()=>{
 let steps=0,pending;const r=new FavoriteBulkRunner({request:async a=>{if(a==='status')return {state:'running'};steps++;throw Error('offline');},savePending:async p=>pending=p,onState:()=>{}});await assert.rejects(r.run('t','e'));assert.equal(steps,1);assert.ok(pending.operation);assert.equal(r.running,false);
});
test('pause during a sent batch prevents a second model request; clear suppresses late private responses',async()=>{
 let release,steps=0,notifications=0;const gate=new Promise(r=>release=r);const r=new FavoriteBulkRunner({request:async a=>{if(a==='status')return {state:'running'};steps++;await gate;return {result:[]};},savePending:async()=>{},onState:()=>notifications++});const task=r.run('t','e');while(!steps)await new Promise(r=>setTimeout(r,0));r.clear();release();await task;assert.equal(steps,1);assert.equal(notifications,1);
});
test('runner cannot loop forever even on a malformed never-completing status',async()=>{
 let steps=0;const r=new FavoriteBulkRunner({request:async a=>a==='status'?{state:'running'}:(steps++,{result:[]}),savePending:async()=>{},onState:()=>{}});await r.run('t','e');assert.equal(steps,30);
});
