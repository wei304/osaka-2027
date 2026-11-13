// Public shell and unauthorized requests only. No password, session, AI or writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const version=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
const expected='V'+version.replace(/\.0$/,'')+' ·';
const site='https://wei304.github.io/osaka-2027/';
let html='';for(let i=0;i<9;i++){const r=await fetch(site+'?release='+process.env.GITHUB_SHA,{signal:AbortSignal.timeout(15000)});html=await r.text();if(r.ok&&html.includes(expected))break;await new Promise(resolve=>setTimeout(resolve,10000));}
assert.ok(html.includes(expected),'Pages has not published '+version);
for(const name of ['favorite-bulk-client.js','favorite-bulk-ui.js','favorite-days-batch-core.js','favorite-days-batch-ui.js','favorite-day-order-core.js','ui-navigation.js','ui-disclosures.js','navigation.css','phrase-core.js','phrase-store.js','phrase-ui.js','phrase-ai-core.js','phrase-ai-client.js','phrase-ai-ui.js','phrases-extra.js','phrases.css','favorite-region-core.js','favorite-regions-ui.js','favorite-ai-core.js','favorite-ai-ui.js','favorites-days-ui.js','favorites-core.js','favorites-client.js','favorites-ui.js','favorites.css','takeout.js','ai-core.js','ai-client.js','ai-ui.js','route-core.js','route-ui.js','share-client.js','share-ui.js','share.js','share.html'])assert.equal((await fetch(site+name,{signal:AbortSignal.timeout(15000)})).status,200,name);
const base='https://tvdidtuufktglyozwkew.supabase.co/functions/v1/';
for(const name of ['shared-trip','trip-files','ai-trip']){const r=await fetch(base+name,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://wei304.github.io'},body:JSON.stringify({action:name==='shared-trip'?'rows':name==='trip-files'?'list':'generate'}),signal:AbortSignal.timeout(15000)});assert.equal(r.status,401,name+' anonymous read');assert.equal((await r.json()).error,'locked',name+' handler auth');}
const wrong=await fetch(base+'ai-trip',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://invalid.example'},body:'{}',signal:AbortSignal.timeout(15000)});assert.equal(wrong.status,403);
console.log('PASS live '+version+' public shell/assets and unauthorized shared-trip/trip-files/ai-trip requests; wrong-origin denied. No real AI requests or private data access.');

const share=await fetch(base+'share-trip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'view'}),signal:AbortSignal.timeout(15000)});assert.equal(share.status,404);const editShare=await fetch(base+'share-trip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'list'}),signal:AbortSignal.timeout(15000)});assert.equal(editShare.status,401);console.log('PASS share-trip: missing read token and anonymous management denied.');

const favoriteDenied=await fetch(base+'shared-trip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'favorites_rows'}),signal:AbortSignal.timeout(15000)});assert.equal(favoriteDenied.status,401);assert.equal((await favoriteDenied.json()).error,'locked');console.log('PASS anonymous favorites access denied without private data or AI calls.');

const favoriteAIDenied=await fetch(base+'ai-trip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'favorites_plan'}),signal:AbortSignal.timeout(15000)});assert.equal(favoriteAIDenied.status,401);

for(const [name,action]of [['shared-trip','favorites_regions_plan'],['ai-trip','phrase_status']]){const r=await fetch(base+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action}),signal:AbortSignal.timeout(15000)});assert.equal(r.status,401);assert.equal((await r.json()).error,'locked');}console.log('PASS new phrase/region anonymous denial; zero model calls.');

for(const [name,action]of [['ai-trip','favorites_bulk_list'],['ai-trip','favorites_bulk_step'],['shared-trip','favorites_days_context'],['shared-trip','favorites_link_days_batch']]){const r=await fetch(base+name,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://wei304.github.io'},body:JSON.stringify({action}),signal:AbortSignal.timeout(15000)});assert.equal(r.status,401,action);assert.equal((await r.json()).error,'locked',action);}
for(const [file,marker]of [['favorite-bulk-ui.js','一键智能整理'],['favorite-days-batch-ui.js','days-batch-confirm'],['favorites-days-ui.js','favorite-day-sort'],['sw.js','osaka-shell-v21-system-rc1']])assert.ok((await(await fetch(site+file,{signal:AbortSignal.timeout(15000)})).text()).includes(marker),file);
console.log('PASS V1.11 bulk/date/sort release assets and new anonymous denial, zero model calls.');

for(const name of ['chat-core.js','chat-store.js','chat-controller.js','chat-markdown.js','chat-shell.js','chat.css','travel-mode-core.js','travel-mode-ui.js','travel-mode.css'])assert.equal((await fetch(site+name,{signal:AbortSignal.timeout(15000)})).status,200,name);
for(const action of ['chat_sources','chat_recover']){const r=await fetch(base+'ai-trip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action}),signal:AbortSignal.timeout(15000)});assert.equal(r.status,401,action);}
console.log('PASS V2.1 chat/travel shell and anonymous denial only. This is not authenticated production acceptance.');
