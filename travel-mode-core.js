import {tripItems,executionItems,isFlightRecord,japanClock} from './travel.js';
import {plan,timelineBlocks,chosenItem} from './schedule.js';
import {ticketData,detectConflicts} from './advanced.js';
import {verifiedPoint} from './route-core.js';
export function mapsTarget(item){
 const original=(item.notes||'').match(/^原始链接：([^\n]+)$/m)?.[1]||(item.notes||'').match(/^【地图定位】([^\n]+)$/m)?.[1];
 if(original)try{const u=new URL(original.trim()),host=u.hostname.toLowerCase();if(u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&((['www.google.com','google.com','maps.google.com'].includes(host)&&u.pathname.startsWith('/maps'))||(host==='maps.app.goo.gl'&&u.pathname.length>1)||(host==='goo.gl'&&u.pathname.startsWith('/maps/')))){
  if(['url','redirect','continue'].some(k=>u.searchParams.has(k)))throw Error('unsafe redirect');const search=(/\/(?:search|dir)(?:\/|$)/.test(u.pathname)||u.pathname==='/maps')&&!u.searchParams.has('query_place_id')&&!u.searchParams.has('destination_place_id')&&!u.searchParams.has('cid');return {url:u.href,reliable:!search,label:search?'原始 Maps 搜索（请核对地点）':'打开原始 Maps 地点 ↗'};
 }}catch{}
 if(verifiedPoint(item)){const p=plan(item);return {url:'https://www.google.com/maps/dir/?'+new URLSearchParams({api:'1',destination:p.lat+','+p.lng,travelmode:p.transport==='walking'?'walking':'transit'}),reliable:true,label:'导航至已核实坐标 ↗'};}
 const name=(item.ja||item.title||'').trim();return name?{url:'https://www.google.com/maps/search/?'+new URLSearchParams({api:'1',query:name+' 日本'}),reliable:false,label:'名称搜索备用（位置未核实） ↗'}:null;
}
const validTime=s=>/^([01]\d|2[0-3]):[0-5]\d$/.test(s||'');
export function travelNext(items,day,manualId='',now=new Date()){
 const eligible=executionItems(items.filter(i=>!i.deleted),day).filter(i=>!isFlightRecord(i));
 const timed=eligible.filter(i=>validTime(i.time)).sort((a,b)=>a.time.localeCompare(b.time)||(a.order||0)-(b.order||0)||a.id.localeCompare(b.id));
 const manual=eligible.find(i=>i.id===manualId),clock=japanClock(now);let item=manual||null,label=manual?'本机手动指定（不代表已到达）':'所选日期首项未完成安排';
 const issues=detectConflicts(items,day),warnings=[];
 if(!item){if(day===clock.date){const current=timed.filter(i=>i.time<=clock.time&&validTime(plan(i).end)&&plan(i).end>clock.time);item=current[0]||timed.find(i=>i.time<=clock.time)||timed.find(i=>i.time>clock.time)||null;label=current.length?'按计划时段候选（请核对实际状态）':item?.time<=clock.time?'未标完成的较早安排（请核对）':'下一项定时安排';}else item=timed[0]||null;}
 if(manualId&&!manual)warnings.push('原手动下一站已完成、移日、删除或不再可执行；已恢复本日自动候选。');
 if(eligible.some(i=>!validTime(i.time)))warnings.push('有安排未定有效时间，不参与自动下一站判断。');
 if(issues.length)warnings.push('当天有时间或安排风险，请展开日程核对；下一站不是路线可行性保证。');
 if(item&&!validTime(item.time))warnings.push('手动指定项目时间待定。');
 return {item,label,warnings,eligible,issues,manual:!!manual};
}
export function travelTimeline(items,day){return timelineBlocks(tripItems(items).filter(i=>!i.deleted&&i.day===day)).map(b=>({...b,selected:b.meta.group?chosenItem(items,day,b.meta.group):null}));}
export function dayTickets(items,day){return items.filter(i=>!i.deleted).flatMap(i=>{const data=ticketData(i);if(!data)return [];const linked=items.find(p=>!p.deleted&&p.id===data.linkedItemId&&!ticketData(p)),linkedDay=linked?.day;if(data.useDate!==day&&linkedDay!==day)return [];return [{item:i,data,dateConflict:!!linkedDay&&!!data.useDate&&linkedDay!==data.useDate,linkedDay}];});}
export function attachmentSummary(ticketId,files,offline){if(!Array.isArray(files)||!Array.isArray(offline))return '附件状态尚未核对；不能保证离线打开';const ready=files.filter(f=>f.ticketId===ticketId&&f.status==='ready'),available=ready.filter(f=>offline.some(s=>s.id===f.id&&s.version===f.version&&s.available));return `${ready.length}份可用附件 · 本机已缓存${available.length}份${ready.length>available.length?'（其余需联网）':''}`;}
