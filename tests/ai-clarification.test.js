import test from 'node:test';
import assert from 'node:assert/strict';
import {aiScopeMismatch,validateAIOutput} from '../ai-core.js';
import {makeAIHandler} from '../supabase/functions/ai-trip/handler.js';
const req=b=>new Request('https://synthetic.invalid',{method:'POST',headers:{'Content-Type':'application/json','X-Trip-Session':'a'.repeat(64)},body:JSON.stringify(b)});
test('explicit requested travel dates must fit the selected edit scope without expanding shared data',()=>{
 for(const prompt of ['10号到大阪后先寄存行李','1月10日去市场','2027-01-10调整行程'])assert.deepEqual(aiScopeMismatch(prompt,['2027-01-09']),['2027-01-10']);
 assert.deepEqual(aiScopeMismatch('9日、10日',['2027-01-09','2027-01-10']),[]);assert.deepEqual(aiScopeMismatch('10号线',['2027-01-09']),[]);assert.deepEqual(aiScopeMismatch('10号怎么说',['2027-01-09'],'translate'),[]);
});
test('valid clarification is accepted but malformed output and read-only writes remain forbidden',()=>{
 const r={answer:'请核对日期后再修改。',warnings:[],operations:[]};assert.equal(validateAIOutput(r,'edit').operations.length,0);assert.throws(()=>validateAIOutput({...r,answer:' '},'edit'));assert.throws(()=>validateAIOutput({...r,operations:{}},'edit'));assert.throws(()=>validateAIOutput({...r,sql:'write'},'edit'));assert.throws(()=>validateAIOutput({...r,operations:[{type:'delete',id:'a'}]},'ask'));
});
test('date mismatch stops before snapshot, fee reservation and model invocation',async()=>{
 const calls=[];const h=makeAIHandler({enabled:true,rpc:async a=>{calls.push(a);return {enabled:true};},complete:async()=>{throw Error('must not call model');}});const r=await h(req({action:'generate',task:'edit',days:['2027-01-09'],prompt:'10号去市场',consent:true}));assert.equal(r.status,400);assert.equal((await r.json()).error,'date_scope_mismatch');assert.deepEqual(calls,['status']);
});
test('clarification settles actual usage with no draft, apply or automatic retry',async()=>{
 const calls=[];let models=0;const h=makeAIHandler({enabled:true,rpc:async(a,b)=>{calls.push(a);if(a==='status')return {enabled:true};if(a==='snapshot')return {rows:[],scopeHash:'synthetic'};if(a==='reserve')return {requestId:'synthetic'};if(a==='finish_no_changes'){assert.equal(b.draft,undefined);assert.equal(b.result.noChanges,true);assert.equal(b.usage.total_tokens,123);return {ok:true};}throw Error('unexpected mutation');},complete:async()=>{models++;return {content:JSON.stringify({answer:'需要先确认抵达时间。',warnings:[],operations:[]}),finish:'stop',usage:{total_tokens:123}};}});const response=await h(req({action:'generate',task:'edit',days:['2027-01-10'],prompt:'调整当天安排',consent:true}));assert.equal(response.status,200);const result=await response.json();assert.equal(result.noChanges,true);assert.equal(result.draftId,undefined);assert.equal(models,1);assert.deepEqual(calls,['status','snapshot','reserve','finish_no_changes']);
});
