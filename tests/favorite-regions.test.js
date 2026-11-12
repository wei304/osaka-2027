import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRegion,regionFromAddress,inspectMapsIdentity,regionProposal,regionPlan} from '../favorite-region-core.js';
import {makeHandler} from '../supabase/functions/shared-trip/handler.js';
const id='11111111-1111-4111-8111-111111111111',source='https://example.org/verified-source';
const place=(over={})=>({id,version:1,source_name:'名称不能证明地区',original_url:'https://www.google.com/maps/place/example/!1s0x1:0x2',geo_evidence:{},manual_fields:{},region:'待确认地区',archived:false,...over});
test('Chinese/Japanese aliases retain current buckets, hierarchy and custom names',()=>{
 for(const [a,b]of [['難波','难波 / 心斋桥'],['心斎橋','难波 / 心斋桥'],['道頓堀','道顿堀 / 日本桥'],['大阪駅','梅田 / 大阪站'],['阿倍野区','天王寺 / 阿倍野'],['USJ','环球影城周边'],['京都府','京都'],['奈良県','奈良']])assert.equal(normalizeRegion(a).region,b);
 assert.equal(normalizeRegion('日本橋').ambiguous,true);assert.equal(normalizeRegion('日本橋',{address:'大阪市／東京都中央区'}).ambiguous,true);assert.equal(normalizeRegion('日本橋',{city:'大阪市'}).region,'道顿堀 / 日本桥');assert.equal(normalizeRegion('我的自定地区').custom,true);assert.equal(normalizeRegion('待确认地区'),null);assert.ok(normalizeRegion('心斎橋').path.includes('大阪市'));
});
test('verified address parsing requires explicit city and never equates a whole ward to a neighbourhood',()=>{
 for(const [a,b]of [['大阪府大阪市中央区難波1-2-3','难波 / 心斋桥'],['大阪市中央区心斋桥筋1丁目','难波 / 心斋桥'],['大阪市中央区道頓堀1丁目','道顿堀 / 日本桥'],['大阪市浪速区日本橋3丁目','道顿堀 / 日本桥'],['大阪市北区梅田1丁目','梅田 / 大阪站'],['大阪市阿倍野区阿倍野筋1丁目','天王寺 / 阿倍野'],['大阪市港区海岸通1-1-10','大阪湾 / 天保山'],['大阪市此花区桜島2丁目1番33号','环球影城周边'],['京都市中京区日本橋','京都'],['奈良市登大路町','奈良']])assert.equal(regionFromAddress(a).region?.region,b,a);
 for(const a of ['東京都中央区日本橋','東京都港区','大阪市北区天神橋','大阪市港区弁天','大阪市港区海岸通4丁目','大阪市北区梅田という店名','中央区日本橋','大阪府池田市','大阪市此花区島屋1丁目','大阪市北区梅田／東京都港区'])assert.equal(regionFromAddress(a).region,null,a);
});
test('Maps identities, names, query fields and viewport coordinates never become region evidence or Places IDs',()=>{
 for(const url of ['https://www.google.com/maps?q=梅田&place_id=anything','https://maps.app.goo.gl/example','https://www.google.com/maps/place/難波/@34.67,135.5,15z/!1s0x1:0x2']){assert.equal(inspectMapsIdentity(url).placesId,null);assert.equal(regionProposal(place({source_name:'梅田大阪店',original_url:url})).status,'unresolved');}
 assert.equal(inspectMapsIdentity('https://www.google.com/maps/!1s0x1:0x2').kind,'google_feature_id');
});
test('manual/verified regions are immutable and address-derived candidates remain unverified until confirmation',()=>{
 const manual=place({region:'自定义原地区',manual_fields:{region:true},geo_evidence:{verified:true,region:'自定义原地区',address:'大阪市北区梅田',source}});const before=structuredClone(manual);assert.equal(regionProposal(manual).status,'protected');assert.deepEqual(manual,before);
 const p=regionProposal(place({geo_evidence:{verified:true,region:'',address:'大阪市北区梅田1丁目',source}}));assert.equal(p.status,'candidate');assert.equal(p.eligible,true);assert.equal(p.evidence.verified,false);assert.equal(p.evidence.source_time,null);
 assert.equal(regionProposal(place({geo_evidence:{verified:false,address:'大阪市北区梅田',source}})).status,'unresolved');
});
test('history is reused conservatively, conflicts block confirmation and archived places cannot be batch-selected',()=>{
 const h=(region,address='')=>({evidence:{verified:true,region,address,source},at:'2026-11-12T00:00:00Z'});
 assert.equal(regionProposal(place(),{history:[h('京都')]}).eligible,false);assert.equal(regionProposal(place(),{history:[h('京都'),h('奈良')]}).status,'conflict');assert.equal(regionProposal(place(),{history:[h('日本橋')]}).status,'unresolved');
 assert.equal(regionProposal(place({archived:true,geo_evidence:{verified:true,region:'',address:'大阪市北区梅田',source}})).status,'archived');
 const plan=regionPlan({places:[place()],sources:[{id:'s',name:'清单A'}],sourceItems:[{place_id:id,source_id:'s',active:true}],regionHistory:[]});assert.deepEqual(plan[0].sources,['清单A']);
});
const request=(body,token='a'.repeat(64))=>new Request('https://synthetic.invalid',{method:'POST',headers:{'Content-Type':'application/json','X-Trip-Session':token},body:JSON.stringify(body)});
test('Edge rejects unauthenticated requests, regenerates candidates and ignores forged region payloads',async()=>{
 const calls=[];const h=makeHandler({networkHash:async()=>'',rpc:async(a,b)=>{calls.push([a,b]);if(b.regionAction==='snapshot')return {places:[place({geo_evidence:{verified:true,region:'',address:'大阪市北区梅田',source}})],sources:[],sourceItems:[],regionHistory:[]};return {entries:b.entries};}});
 assert.equal((await h(request({action:'favorites_regions_plan'},''))).status,401);assert.equal(calls.length,0);
 const r=await h(request({action:'favorites_regions_preview',operation:crypto.randomUUID(),ids:[id],entries:[{region:'东京'}]}));assert.equal(r.status,200);const preview=await r.json();assert.equal(preview.entries[0].region,'梅田 / 大阪站');assert.equal(preview.entries[0].evidence.verified,false);assert.equal(calls.at(-1)[0],'favorites_regions_rpc');
});
test('bulk preview requires reliable evidence per row; historical evidence needs explicit per-row review',async()=>{
 const h=makeHandler({networkHash:async()=>'',rpc:async(a,b)=>b.regionAction==='snapshot'?{places:[place()],sources:[],sourceItems:[],regionHistory:[{place_id:id,evidence:{verified:true,region:'京都',source}}]}:{entries:b.entries}});
 const body={action:'favorites_regions_preview',operation:crypto.randomUUID(),ids:[id]};assert.equal((await h(request(body))).status,409);assert.equal((await h(request({...body,reviewed:[id]}))).status,200);
});
