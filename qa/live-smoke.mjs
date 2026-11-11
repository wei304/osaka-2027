// Public shell and unauthorized requests only. No password, session, AI or writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const version=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
const expected='V'+version.replace(/\.0$/,'')+' ·';
const site='https://wei304.github.io/osaka-2027/';
let html='';for(let i=0;i<9;i++){const r=await fetch(site+'?release='+process.env.GITHUB_SHA,{signal:AbortSignal.timeout(15000)});html=await r.text();if(r.ok&&html.includes(expected))break;await new Promise(resolve=>setTimeout(resolve,10000));}
assert.ok(html.includes(expected),'Pages has not published '+version);
for(const name of ['ai-core.js','ai-client.js','ai-ui.js','route-core.js','route-ui.js','share-client.js','share-ui.js','share.js','share.html'])assert.equal((await fetch(site+name,{signal:AbortSignal.timeout(15000)})).status,200,name);
const base='https://tvdidtuufktglyozwkew.supabase.co/functions/v1/';
for(const name of ['shared-trip','trip-files','ai-trip']){const r=await fetch(base+name,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://wei304.github.io'},body:JSON.stringify({action:name==='shared-trip'?'rows':name==='trip-files'?'list':'generate'}),signal:AbortSignal.timeout(15000)});assert.equal(r.status,401,name+' anonymous read');assert.equal((await r.json()).error,'locked',name+' handler auth');}
const wrong=await fetch(base+'ai-trip',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://invalid.example'},body:'{}',signal:AbortSignal.timeout(15000)});assert.equal(wrong.status,403);
console.log('PASS live '+version+' public shell/assets and unauthorized shared-trip/trip-files/ai-trip requests; wrong-origin denied. No real AI requests or private data access.');

const share=await fetch(base+'share-trip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'view'}),signal:AbortSignal.timeout(15000)});assert.equal(share.status,404);const editShare=await fetch(base+'share-trip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'list'}),signal:AbortSignal.timeout(15000)});assert.equal(editShare.status,401);console.log('PASS share-trip: missing read token and anonymous management denied.');
