import {placeKey} from './favorites-core.js';
export const REGION_RULE_VERSION=1;
// Leaves retain the existing collection buckets. A ward alone is NOT a neighbourhood.
export const REGION_NODES=Object.freeze([
 ['namba','难波','难波 / 心斋桥','大阪','大阪市','浪速区／中央区',['難波','なんば','Namba']],
 ['shinsaibashi','心斋桥','难波 / 心斋桥','大阪','大阪市','中央区',['心斎橋','Shinsaibashi']],
 ['dotonbori','道顿堀','道顿堀 / 日本桥','大阪','大阪市','中央区',['道頓堀','Dotonbori']],
 ['nipponbashi','日本桥','道顿堀 / 日本桥','大阪','大阪市','浪速区／中央区',['日本橋','Nipponbashi']],
 ['umeda','梅田','梅田 / 大阪站','大阪','大阪市','北区',['Umeda']],
 ['osaka-station','大阪站','梅田 / 大阪站','大阪','大阪市','北区',['大阪駅','Osaka Station']],
 ['tennoji','天王寺','天王寺 / 阿倍野','大阪','大阪市','天王寺区',['天王寺区','Tennoji']],
 ['abeno','阿倍野','天王寺 / 阿倍野','大阪','大阪市','阿倍野区',['阿倍野区','Abeno']],
 ['osaka-bay','大阪湾','大阪湾 / 天保山','大阪','大阪市','湾岸',['大阪ベイエリア','Osaka Bay']],
 ['tempozan','天保山','大阪湾 / 天保山','大阪','大阪市','港区',['Tempozan']],
 ['usj','USJ 周边','环球影城周边','大阪','大阪市','此花区',['USJ','环球影城周边','ユニバーサル・スタジオ・ジャパン','ユニバーサルシティ','Universal City']],
 ['kyoto','京都','京都','京都','京都市／京都府','',['Kyoto','京都市','京都府']],
 ['nara','奈良','奈良','奈良','奈良市／奈良県','',['Nara','奈良市','奈良県','奈良县']],
 ['other','其他','其他地区','','','',['其他地区','その他']]
].map(([key,name,region,prefecture,city,ward,aliases])=>Object.freeze({key,name,region,path:[prefecture,city,ward,name].filter(Boolean),aliases:Object.freeze([name,...aliases])})));
const compact=s=>String(s||'').normalize('NFKC').replace(/\s+/g,'').toLocaleLowerCase();
export function normalizeRegion(value,context={}){const raw=String(value||'').normalize('NFKC').trim();if(!raw||['待确认','待确认地区'].includes(raw))return null;if(['日本橋','日本桥','Nipponbashi','Nihonbashi'].some(a=>compact(a)===compact(raw))&&(!/大阪/.test(context.city||context.address||'')||/東京|东京|京都|奈良/.test(context.city||context.address||'')))return {key:'custom:'+raw,name:raw,region:raw,path:[context.city||'城市待核实',raw],custom:true,ambiguous:true};const n=REGION_NODES.find(n=>[n.region,...n.aliases].some(a=>compact(a)===compact(raw)));return n?{...n,custom:false}:{key:'custom:'+raw,name:raw,region:raw,path:[raw],custom:true};}
export function inspectMapsIdentity(raw){
 try{const key=placeKey(raw),u=new URL(raw);return {key,kind:key.startsWith('google:fid:')?'google_feature_id':u.hostname==='maps.app.goo.gl'?'short_link':'maps_url',placesId:null,hasViewCenter:/\/@-?\d/.test(u.pathname),explanation:'仅作原始链接／去重线索；不把FID、CID或任意查询字段当作Places API place_id，不由中心坐标推断地区。'};}catch{return {kind:'invalid',placesId:null,explanation:'链接格式不受支持，保留原记录供人工核对。'};}
}
export function regionFromAddress(raw){
 const a=String(raw||'').normalize('NFKC').replace(/\s+/g,'').replaceAll('东京','東京').replaceAll('难波','難波').replaceAll('心斋桥','心斎橋').replaceAll('道顿堀','道頓堀').replaceAll('日本桥','日本橋'),hits=[];
 // Multiple explicit cities/prefectures are a conflict, even if a familiar district occurs.
 const cities=[/大阪(?:府|市)/.test(a)&&'大阪',/京都(?:府|市)/.test(a)&&'京都',/奈良(?:県|县|市)/.test(a)&&'奈良',/東京(?:都|市)/.test(a)&&'東京'].filter(Boolean);
 if(new Set(cities).size>1)return {region:null,conflict:'地址含多个城市／都府县，请逐项核对。'};
 if(cities.includes('東京'))return {region:null,conflict:'这是东京地址，不归入大阪同名地区。'};
 if(cities.includes('京都'))return {region:normalizeRegion('京都'),conflict:''};
 if(cities.includes('奈良'))return {region:normalizeRegion('奈良'),conflict:''};
 if(!/大阪市/.test(a))return {region:null,conflict:'缺少明确城市结构，不能凭行政区或店名归类。'};
 if(/大阪市(?:中央区|浪速区)(?:難波|難波中|なんば)(?:[0-9一二三四五六七八九十]|$)/.test(a))hits.push('namba');
 if(/大阪市中央区(?:心斎橋筋|東心斎橋|西心斎橋)(?:[0-9一二三四五六七八九十]|$)/.test(a))hits.push('shinsaibashi');
 if(/大阪市中央区道頓堀(?:[0-9一二三四五六七八九十]|$)/.test(a))hits.push('dotonbori');
 if(/大阪市(?:中央区|浪速区)(?:日本橋|日本橋東|日本橋西)(?:[0-9一二三四五六七八九十]|$)/.test(a))hits.push('nipponbashi');
 if(/大阪市北区梅田(?:[0-9一二三四五六七八九十]|$)/.test(a))hits.push('umeda');
 if(/大阪市天王寺区/.test(a))hits.push('tennoji');
 if(/大阪市阿倍野区/.test(a))hits.push('abeno');
 if(/大阪市港区(?:築港[34](?:丁目|[-番])|海岸通1(?:丁目|[-番]))/.test(a))hits.push('tempozan');
 if(/大阪市此花区桜島2(?:丁目|[-番])/.test(a))hits.push('usj');
 const keys=[...new Set(hits)];return keys.length===1?{region:REGION_NODES.find(n=>n.key===keys[0]),conflict:''}:{region:null,conflict:keys.length?'地址对应多个地区，请人工核实。':'只有宽泛行政区或未知街区；不足以判定具体收藏地区。'};
}
const known=s=>typeof s==='string'&&s.trim()&&!['待确认','待确认地区'].includes(s.trim());
const sourceOK=s=>{try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
export function regionProtected(p){return p.geo_evidence?.verified===true&&known(p.geo_evidence.region)||p.manual_fields?.region===true&&known(p.region);}
export function regionProposal(place,{history=[],sources=[]}={}){
 const identity=inspectMapsIdentity(place.original_url),current=place.geo_evidence||{},base={id:place.id,version:place.version,name:place.source_name,url:place.original_url,archived:place.archived===true,identity,sources,status:'unresolved',region:null,evidence:null,eligible:false,conflicts:[],ruleVersion:REGION_RULE_VERSION};
 if(regionProtected(place))return {...base,status:'protected',region:normalizeRegion(current.verified&&known(current.region)?current.region:place.region),evidence:{...current,type:'existing_manual',verified:current.verified===true},conflicts:current.verified&&known(current.region)&&known(place.region)&&normalizeRegion(current.region)?.region!==normalizeRegion(place.region)?.region?['人工地区与核实地区不一致；保留两者，不批量改写。']:[]};
 const evaluate=(e,type,time)=>{if(e?.verified!==true||!sourceOK(e.source))return null;const address=regionFromAddress(e.address);if(address.region)return {region:address.region,evidence:{region:address.region.region,address:e.address,source:e.source,type,source_time:e.confirmed_at||e.verified_at||time||null,verified:false,upstreamVerified:true},eligible:type==='verified_address'};return {region:null,conflict:address.conflict};};
 const verifiedAddress=evaluate(current,'verified_address',null);
 if(verifiedAddress?.region){const different=history.some(h=>{const e=h.evidence||{};if(e.verified!==true||!sourceOK(e.source))return false;const r=known(e.region)?normalizeRegion(e.region,{address:e.address}):regionFromAddress(e.address).region;return r&&!r.ambiguous&&r.region!==verifiedAddress.region.region;});if(different)return {...base,...verifiedAddress,status:'conflict',eligible:false,conflicts:['当前地址与历史核实地区不同，请逐条核对并明确保存当前依据。']};return {...base,...verifiedAddress,status:place.archived?'archived':'candidate',eligible:!place.archived};}
 // Current unresolvable/conflicting evidence is not bypassed with an older revision.
 if(current.verified===true&&current.address)return {...base,conflicts:[verifiedAddress?.conflict||'已核实地址尚不能解析，需人工补充。']};
 const prior=[];for(const h of history){const e=h.evidence||{};if(e.verified!==true||!sourceOK(e.source))continue;const parsed=known(e.region)?{region:normalizeRegion(e.region,{address:e.address}),evidence:{...e,type:'history_verified',source_time:h.at,verified:false,upstreamVerified:true},eligible:false}:evaluate(e,'history_verified',h.at);if(parsed?.region&&!parsed.region.ambiguous)prior.push(parsed);}
 const unique=[...new Set(prior.map(x=>x.region.region))];
 if(unique.length>1)return {...base,status:'conflict',conflicts:['历史核实证据指向不同地区，请重新核对当前资料。']};
 if(prior.length)return {...base,...prior[0],status:place.archived?'archived':'candidate',eligible:false,conflicts:['历史证据不自动继承为当前已核实；必须逐条核对仍然有效。']};
 return {...base,conflicts:['名称、原始地图链接与去重标识不能证明地区。请补充地址和可靠来源后核实。']};
}
export function regionPlan(snapshot){return snapshot.places.map(p=>regionProposal(p,{history:(snapshot.regionHistory||[]).filter(h=>h.place_id===p.id),sources:(snapshot.sourceItems||[]).filter(s=>s.place_id===p.id&&s.active).map(s=>snapshot.sources.find(x=>x.id===s.source_id)?.name).filter(Boolean)}));}
