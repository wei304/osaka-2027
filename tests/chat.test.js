import test from 'node:test';import assert from 'node:assert/strict';
import {chatContext,validateChat} from '../chat-core.js';import {safeLink} from '../chat-markdown.js';import {chatSources} from '../supabase/functions/ai-trip/chat.js';
const days=['2027-01-11'],uuid=()=>crypto.randomUUID();
test('chat history is bounded, task/date isolated and never accepts system roles',()=>{
 const messages=Array.from({length:20},(_,n)=>({id:uuid(),role:n%2?'assistant':'user',text:'文'.repeat(900),status:'done',days,task:'ask'}));messages.push({id:uuid(),role:'user',text:'PRIVATE OTHER DAY',status:'done',days:['2027-01-12'],task:'ask'});
 const recent=chatContext(messages,days,'ask');assert.equal(recent.length,6);assert.ok(recent.every(m=>m.text.length<=600));assert.ok(!JSON.stringify(recent).includes('PRIVATE'));
 const c={conversation_id:uuid(),message_id:uuid(),operation:uuid(),recent};assert.equal(validateChat(c,days,'ask').recent.length,6);
 assert.throws(()=>validateChat({...c,recent:[{...recent[0],role:'system'}]},days,'ask'));
 assert.throws(()=>validateChat({...c,recent:[{...recent[0],days:['2027-01-12']}]},days,'ask'));
 assert.throws(()=>validateChat({...c,recent:Array(7).fill(recent[0])},days,'ask'));
 assert.throws(()=>validateChat({...c,recent:[{...recent[0],text:'请改成1月12日'}]},days,'ask'));
});
test('Markdown link protocol, credentials, encoded and raw script attacks are rejected',()=>{for(const s of ['javascript:alert(1)','data:text/html,abc','file:///secret','https://name:pass@example.com','//example.com','jav&#97;script:alert(1)'])assert.equal(safeLink(s),null);assert.equal(safeLink('https://example.com/a'),'https://example.com/a');});
test('chat favorites excludes guesses, private notes and unrelated places; keeps linked/related separate',()=>{
 const p={id:uuid(),version:2,source_name:'店铺',region:'难波',geo_evidence:{verified:true,region:'难波',address:'大阪府大阪市浪速区難波',source:'https://example.com/proof'},notes:'PRIVATE',manual_fields:{}};
 const data={places:[p,{...p,id:uuid(),geo_evidence:{verified:false,region:'难波'}}],links:[{place_id:p.id,day:days[0],active:true}],dayContext:{profiles:[]}};
 const result=chatSources(data,days);assert.equal(result.length,1);assert.deepEqual(result[0].linked,days);assert.deepEqual(result[0].related,[]);assert.ok(!JSON.stringify(result).includes('PRIVATE'));assert.equal(chatSources(data,['2027-01-12']).length,0);
});
