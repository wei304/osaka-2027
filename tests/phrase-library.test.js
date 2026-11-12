import test from 'node:test';
import assert from 'node:assert/strict';
import {PHRASES} from '../phrases.js';
import {phraseFields,validateCustom,mergePhraseImport,searchPhrases} from '../phrase-core.js';
import {phraseAIInput,validatePhraseAI} from '../phrase-ai-core.js';
import {makeAIHandler} from '../supabase/functions/ai-trip/handler.js';
const custom=(over={})=>({id:'custom:11111111-1111-4111-8111-111111111111',category:'自定义',zh:'五个人，两份。',ja:'5人です。二つお願いします。',kana:'ごにんです。ふたつおねがいします。',pinned:false,archived:false,version:1,updatedAt:'2026-11-12T00:00:00Z',...over});
test('140 readonly templates preserve all 60 legacy aliases and have stable unique keys',()=>{
 assert.equal(PHRASES.length,140);assert.equal(new Set(PHRASES.map(p=>p.key)).size,140);for(let id=0;id<60;id++)assert.equal(PHRASES.filter(p=>p.id===id).length,1);assert.ok(PHRASES.every(Object.isFrozen));assert.throws(()=>{PHRASES[0].ja='overwrite';});
 for(const category of ['USJ／门票','景点／拍照','医疗／紧急','便利店／支付','天气／冬季'])assert.equal(PHRASES.filter(p=>p.category===category).length,8);
 assert.equal(new Set(PHRASES.map(p=>p.ja)).size,140);assert.ok(PHRASES.every(p=>p.zh&&p.ja&&p.kana&&!/[一-龯]/.test(p.kana)));
});
test('snowboard requests are explicit, while ski appears only in an explicit negation',()=>{
 const rows=PHRASES.filter(p=>p.category==='滑雪');assert.ok(rows.some(p=>p.ja.includes('板とブーツだけ')));assert.ok(rows.some(p=>p.ja.includes('ウェアとゴーグルは持って')));for(const p of rows)if(p.ja.includes('スキー'))assert.match(p.ja,/スキーではありません/);
});
test('local import is all-or-nothing, deduplicates content and never overwrites ID collisions',()=>{
 const old=custom(),changed=custom({ja:'二つです。'}),backup={kind:'local-phrase-library',schema:1,phrases:[old,changed]};const r=mergePhraseImport([old],backup,()=> '22222222-2222-4222-8222-222222222222');assert.equal(r.added,1);assert.equal(r.duplicates,1);assert.equal(r.rows[0].ja,old.ja);assert.notEqual(r.rows[1].id,old.id);assert.equal(mergePhraseImport(r.rows,backup).added,0);
 assert.throws(()=>mergePhraseImport([old],{...backup,phrases:[changed,{...old,id:'builtin:0'}]}));assert.equal(old.ja,custom().ja);assert.throws(()=>validateCustom({...old,ja:'x'.repeat(801)}));
});
test('custom categories, pinned and archived search; untrusted text remains plain data',()=>{
 const a=custom({category:'我自己的场景',ja:'<img src=x onerror=alert(1)>東京'}),b=custom({id:'custom:22222222-2222-4222-8222-222222222222',pinned:true}),c=custom({archived:true});assert.equal(phraseFields(a).ja,a.ja);assert.equal(searchPhrases([a,b],{query:'東京',category:'我自己的场景'})[0].id,a.id);assert.equal(searchPhrases([a,b],{scope:'pinned'})[0].id,b.id);assert.equal(searchPhrases([c],{scope:'archived'}).length,1);assert.throws(()=>phraseFields({...a,ja:'\0'}));
});
const result={zh:'请给我两份。',ja:'二つお願いします。',kana:'ふたつおねがいします。',sourceLanguage:'zh',targetLanguage:'ja'};
test('phrase model input is an exact one-phrase allowlist and output has strict language markers',()=>{
 const input=phraseAIInput({...custom(),password:'secret',itinerary:[{private:'hidden'}]},'translate');assert.deepEqual(Object.keys(input.phrase),['category','zh','ja','kana']);assert.ok(!JSON.stringify(input).includes('secret'));assert.deepEqual(validatePhraseAI(result,'translate'),result);for(const over of [{sql:'delete'},{targetLanguage:'en'},{kana:'二つ'},{ja:'<b>こんにちは</b>'},{zh:'x'.repeat(501)}])assert.throws(()=>validatePhraseAI({...result,...over},'translate'));
});
const req=b=>new Request('https://synthetic.invalid',{method:'POST',headers:{'X-Trip-Session':'a'.repeat(64)},body:JSON.stringify(b)});
test('phrase AI requires consent, does not request itinerary context, and replays without model calls',async()=>{
 let models=0;const calls=[];const h=makeAIHandler({enabled:true,rpc:async(a,b)=>{calls.push(a);if(a==='phrase_status')return {enabled:true};if(a==='phrase_prepare')return {claimed:true};if(a==='phrase_finish')return {jobStatus:'ready',result:b.result};if(a==='phrase_recover')return {jobStatus:'ready',result};throw Error(a);},complete:async({input})=>{models++;assert.ok(!input.includes('USER_DATA'));return {content:JSON.stringify(result),finish:'stop',usage:{total_tokens:100}};}});
 const input=phraseAIInput(custom(),'translate'),body={action:'phrase_generate',operation:crypto.randomUUID(),input};assert.equal((await h(req(body))).status,400);assert.equal(models,0);assert.equal((await h(req({...body,consent:true}))).status,200);assert.equal(models,1);await h(req({action:'phrase_recover',operation:body.operation}));assert.equal(models,1);assert.ok(!calls.some(a=>['snapshot','apply','confirm'].includes(a)));
});
test('malformed phrase AI fails its existing reservation without overwriting any phrase',async()=>{
 const calls=[];const h=makeAIHandler({enabled:true,rpc:async a=>{calls.push(a);return a==='phrase_status'?{enabled:true}:a==='phrase_prepare'?{claimed:true}:{};},complete:async()=>({finish:'stop',content:JSON.stringify({...result,html:'oops'})})});const r=await h(req({action:'phrase_generate',operation:crypto.randomUUID(),input:phraseAIInput(custom(),'translate'),consent:true}));assert.equal(r.status,422);assert.ok(calls.includes('phrase_fail'));assert.ok(!calls.includes('phrase_finish'));
});
