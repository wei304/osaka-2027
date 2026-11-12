import {FAVORITE_TYPES} from './favorites-core.js';
import {verifiedRegion} from './favorite-days-batch-core.js';
import {normalizeRegion} from './favorite-region-core.js';
export const DAY_SORT_MODES=Object.freeze({smart:'智能',region:'地区',type:'类型',name:'名称',manual:'手动'});
const text=s=>String(s??'').normalize('NFKC').toLowerCase();
const cmp=(a,b)=>text(a)<text(b)?-1:text(a)>text(b)?1:0;
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const stable=v=>JSON.stringify(canonical(v));
export function localDayScope(items,day){return items.filter(i=>i.day===day&&!i.deleted&&!/^(tool-|ticket-|ledger-|plan-choice-)/.test(i.id)).map(i=>({id:i.id,version:i.version??0,title:(i.title??'').slice(0,160),time:i.time??null,category:i.category??null})).sort((a,b)=>cmp(a.id,b.id));}
export function currentDayProfile(profile,items,day){if(!profile||profile.day!==day||profile.valid!==true||!Array.isArray(profile.scope)||!Array.isArray(profile.regions))return null;return stable([...profile.scope].sort((a,b)=>cmp(a.id,b.id)))===stable(localDayScope(items,day))?profile:null;}
export function regionMatch(place,profile){const p=verifiedRegion(place);if(!p||!profile)return {kind:'none',region:p?.region||''};let grouped=false;
 for(const raw of profile.regions){if(typeof raw!=='string')continue;const r=normalizeRegion(raw);if(!r||r.ambiguous||/^(大阪|大阪府|大阪市|日本|关西|関西|其他地区|其他|待确认地区)$/.test(r.region))continue;
  if(p.raw===raw.trim()||p.key===r.key&&(!p.region.includes(' / ')||p.raw!==p.region&&raw.trim()!==r.region))return {kind:'exact',region:p.region};
  if(p.region===r.region&&(p.raw===p.region||raw.trim()===r.region))grouped=true;
 }
 return {kind:grouped?'group':'none',region:p.region};
}
export function rankDayFavorite(place,profile,prefs={}){const match=regionMatch(place,profile),pinned=(prefs.pinned||[]).includes(place.id),known=!!verifiedRegion(place);
 const base=match.kind==='exact'?400:match.kind==='group'?350:pinned?300:known?200:100;
 const reason=match.kind==='exact'?'与当天核实地区一致':match.kind==='group'?'与当天已核实地区分组匹配（不代表相邻）':pinned?`本机当天优先${known?'':'；地区仍待核实'}`:known?'其他当天已关联收藏':'地区待核实，不作地区匹配';
 return {id:place.id,score:base+(pinned&&base>300?5:0),reason:reason+(pinned&&base>300?'；本机当天优先':''),region:match.region,known,pinned};
}
export function sortDayFavorites(places,profile,prefs={}){const mode=Object.hasOwn(DAY_SORT_MODES,prefs.sort)?prefs.sort:'smart',order=new Map((prefs.order||[]).map((id,n)=>[id,n])),byId=new Map(places.map(p=>[p.id,p])),manual=id=>order.get(id)??Number.MAX_SAFE_INTEGER;
 return places.map(p=>rankDayFavorite(p,profile,prefs)).sort((a,b)=>{
  const p=byId.get(a.id),q=byId.get(b.id);let result=0;
  if(mode==='smart')result=b.score-a.score||manual(a.id)-manual(b.id);
  if(mode==='region')result=Number(b.known)-Number(a.known)||cmp(a.region,b.region);
  if(mode==='type')result=FAVORITE_TYPES.indexOf(p.place_type)-FAVORITE_TYPES.indexOf(q.place_type);
  if(mode==='manual')result=manual(a.id)-manual(b.id);
  return result||cmp(p.source_name,q.source_name)||cmp(a.id,b.id);
 });}
export function createDayFavoriteSelector(){const cache=new Map();let computations=0;return {get computations(){return computations;},clear(){cache.clear();},select({places,links,day,profile,items,prefs={}}){
 const ids=new Set(links.filter(l=>l.active&&l.day===day).map(l=>l.place_id)),linked=places.filter(p=>!p.archived&&ids.has(p.id)),current=currentDayProfile(profile,items,day);
 const key=stable({places:linked.map(p=>({id:p.id,name:p.source_name,type:p.place_type,region:p.region,evidence:p.geo_evidence,manualRegion:p.manual_fields?.region})).sort((a,b)=>cmp(a.id,b.id)),profile:profile?{valid:profile.valid,regions:profile.regions,scope:profile.scope}:null,local:localDayScope(items,day),prefs});
 if(cache.get(day)?.key!==key){computations++;cache.set(day,{key,result:{rows:sortDayFavorites(linked,current,prefs),verified:!!current,total:linked.length}});}return cache.get(day).result;
 }};}
export function moveInVisibleOrder(order,visible,id,delta){const next=[...order],at=visible.indexOf(id),other=visible[at+delta];if(at<0||!other)return next;const a=next.indexOf(id),b=next.indexOf(other);if(a<0||b<0)return next;[next[a],next[b]]=[next[b],next[a]];return next;}
