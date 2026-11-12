import {favoriteQueueTouches as batchTouches} from './favorites-core.js';
import {normalizeRegion,regionFromAddress} from './favorite-region-core.js';
export const BATCH_DAY_LIMIT=100;
const valid=d=>typeof d==='string'&&/^2027-01-(09|1[0-7])$/.test(d);
export function dateSet(days){if(!Array.isArray(days)||days.length>9||new Set(days).size!==days.length||days.some(d=>!valid(d)))throw Error('请选择不重复的旅行日期。');return [...days].sort();}
export function dateChange(before,mode,targets){before=dateSet(before);targets=dateSet(targets);if(!['add','replace','remove'].includes(mode))throw Error('请选择日期操作。');const after=mode==='add'?[...new Set([...before,...targets])].sort():mode==='replace'?targets:before.filter(d=>!targets.includes(d));return {before,days:after,added:after.filter(d=>!before.includes(d)),removed:before.filter(d=>!after.includes(d)),mode,targets};}
const broad=v=>/^(大阪|大阪府|大阪市|日本|関西|关西|其他|其他地区|待确认地区|東京|东京|北区|中央区)$/.test(v.trim());
export function verifiedRegion(place){const e=place.geo_evidence;if(e?.verified!==true||typeof e.region!=='string'||!e.region.trim()||broad(e.region))return null;try{const u=new URL(e.source);if(u.protocol!=='https:'||u.username||u.password)return null;}catch{return null;}const n=normalizeRegion(e.region,{address:e.address});if(!n||n.ambiguous||broad(n.region))return null;
 if(place.manual_fields?.region&&normalizeRegion(place.region,{address:e.address})?.region!==n.region)return null;
 if(e.address){const a=regionFromAddress(e.address);if(a.conflict?.includes('东京')||a.conflict?.includes('多个城市'))return null;if(a.region?.path?.[0]&&n.path?.[0]&&a.region.path[0]!==n.path[0])return null;}
 return {...n,raw:e.region.trim()};}
export function recommendedDays(place,profiles=[]){const p=verifiedRegion(place);if(!p||!Array.isArray(profiles))return [];return profiles.filter(d=>d?.valid===true&&Array.isArray(d.regions)&&valid(d.day)&&d.regions.some(value=>{if(typeof value!=='string'||broad(value))return false;const r=normalizeRegion(value);if(!r||r.ambiguous||broad(r.region))return false;return p.key===r.key||(p.region===r.region&&(p.raw===p.region||value.trim()===r.region));})).map(d=>d.day).sort();}
export function batchEntries(places,links,intents){if(!Array.isArray(intents)||!intents.length||intents.length>BATCH_DAY_LIMIT||new Set(intents.map(i=>i.id)).size!==intents.length)throw Error('一次选择1至100个不同地点。');return intents.map(i=>{const p=places.find(p=>p.id===i.id);if(!p)throw Error('地点不存在，请刷新核对。');const before=links.filter(l=>l.place_id===p.id&&l.active).map(l=>l.day),change=dateChange(before,i.mode,i.targets);if(p.archived&&change.days.length)throw Error('请先取消归档，再关联日期。');return {id:p.id,expected:p.version,name:p.source_name,...change};});}
export {batchTouches};
export function queueDayBatch(state,entries,replaceOperation=null){
 if(!Array.isArray(entries)||!entries.length||entries.length>BATCH_DAY_LIMIT)throw Error('一次最多100个地点。');const ids=new Set();
 for(const e of entries){const p=state.places.find(p=>p.id===e.id);if(!p||p.version!==e.expected||ids.has(e.id))throw Error('预览版本已变化，请重新核对。');ids.add(e.id);dateSet(e.days);if(p.archived&&e.days.length)throw Error('请先取消归档。');if(state.queue.some(q=>q.operation!==replaceOperation&&batchTouches(q,e.id)))throw Error('选中地点有待同步修改，请先同步或处理原批次；原修改已保留。');}
 if(replaceOperation&&!state.queue.some(q=>q.operation===replaceOperation&&q.kind==='link_days_batch'&&q.conflict))throw Error('原冲突批次已变化，请重新核对。');
 const changed=entries.filter(e=>e.added.length||e.removed.length);if(!changed.length)return null;
 const q={kind:'link_days_batch',operation:crypto.randomUUID(),entries:structuredClone(changed)};
 if(replaceOperation){const index=state.queue.findIndex(q=>q.operation===replaceOperation&&q.kind==='link_days_batch'&&q.conflict);if(index<0)throw Error('原冲突批次已变化，请重新核对。');state.queue.splice(index,1,q);}else state.queue.push(q);return q;
}
