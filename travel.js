import {DAYS,CATEGORIES,validateItem} from './core.js';
import {plan,withPlan,isChoice,chosenItem,timelineBlocks} from './schedule.js';
import {isLedger} from './features.js';
export const TOOL_PREFIX='【旅行工具 v1】\n';
export const TRAVEL_MODES={walking:'步行',subway:'地铁',jr:'JR',bus:'巴士',taxi:'出租车',flight:'飞机',other:'其他／待定'};
export function isTool(i){return typeof i?.id==='string'&&i.id.startsWith('tool-');}
export function toolData(i){try{return isTool(i)&&i.notes?.startsWith(TOOL_PREFIX)?JSON.parse(i.notes.slice(TOOL_PREFIX.length)):null;}catch{return null;}}
export function toolItem(id,title,data,day=DAYS[0].date){const notes=TOOL_PREFIX+JSON.stringify(data);if(notes.length>6000)throw Error('资料太长，请缩短后保存。');return validateItem({id,day,title,notes,time:'',ja:'',category:'note',status:'confirmed',order:Date.now()});}
export function tokyoDate(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).reduce((o,p)=>(o[p.type]=p.value,o),{});}
export function japanClock(now=new Date()){const p=tokyoDate(now),date=`${p.year}-${p.month}-${p.day}`,time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);return {date,time};}
export function tripCountdown(now=new Date()){const {date}=japanClock(now),start=DAYS[0].date,end=DAYS.at(-1).date;if(date<start)return `距出发 ${Math.round((Date.parse(start+'T00:00:00Z')-Date.parse(date+'T00:00:00Z'))/86400000)} 天`;if(date>end)return '这趟旅行已结束 · 回忆继续留存';return `旅行第 ${Math.round((Date.parse(date+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000)+1} 天 · 祝旅途愉快`;}
export function tripItems(items){return items.filter(i=>!isTool(i)&&!isLedger(i)&&!isChoice(i)&&!i.id.startsWith('ticket-'));}
export function executionItems(items,day){return timelineBlocks(tripItems(items).filter(i=>i.day===day)).flatMap(b=>{if(b.meta.group&&b.meta.kind==='alternative'){const selected=chosenItem(items,day,b.meta.group);return b.items.filter(i=>i.id===selected);}return b.items;}).filter(i=>!plan(i).done&&!['blocked','reference'].includes(plan(i).state)&&(plan(i).state!=='conditional'||i.status!=='pending'));}
export function isFlightRecord(i){return plan(i).transport==='flight'||i.category==='transport'&&/\b(?:[A-Z][A-Z0-9]|[0-9][A-Z])\s?\d{2,4}\b/i.test(i.notes||'');}
export function nextActivity(items,day,now=new Date()){const candidates=executionItems(items,day).filter(i=>i.time&&!isFlightRecord(i)),clock=japanClock(now);if(day!==clock.date)return {item:candidates[0]||null,label:'所选日期的下一项未完成安排'};const current=candidates.filter(i=>i.time<=clock.time&&plan(i).end&&plan(i).end>clock.time).sort((a,b)=>b.time.localeCompare(a.time))[0];if(current)return {item:current,label:'此刻进行中'};const overdue=candidates.filter(i=>i.time<=clock.time).sort((a,b)=>a.time.localeCompare(b.time));return {item:overdue[0]||candidates.find(i=>i.time>clock.time)||null,label:overdue.length?'尚未完成 · 请确认是否已结束':'下一站'};}
export function searchTrip(items,query){const q=query.trim().toLowerCase();return tripItems(items).filter(i=>`${i.title} ${i.ja} ${i.notes} ${i.day} ${Number(i.day.slice(5,7))}月${Number(i.day.slice(8))}日 ${CATEGORIES[i.category]}`.toLowerCase().includes(q));}
export function updateExecution(item,changes){return withPlan(item,{...plan(item),...changes});}
export function manualRate(items){const d=toolData(items.find(i=>i.id==='tool-rate'));return d?.type==='rate'&&Number.isFinite(d.yenPerMyr)&&d.yenPerMyr>0?d:null;}
export function convertYen(value,rate){if(!rate)throw Error('请先填写手动汇率。');const yen=Number(value);if(!String(value).trim()||!Number.isFinite(yen)||yen<0||yen>1e10)throw Error('请输入有效日元金额。');return Math.round(yen/rate.yenPerMyr*100)/100;}
export function safeLink(raw){try{const u=new URL(raw);return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}}
