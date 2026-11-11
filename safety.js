import {DAYS} from './core.js';
import {toolData,toolItem,tripItems} from './travel.js';
import {plan,chosenItem} from './schedule.js';
import {ticketData,detectConflicts} from './advanced.js';
export const EMERGENCY_FIELDS={person:80,hotel:160,address:400,contact:160,phone:60,allergyZh:300,allergyJa:300,medical:400};
export function emergencyData(i){const d=toolData(i);return d?.type==='emergency'?d:null;}
export function emergencyItem(id,input){const d={type:'emergency'};for(const [key,max]of Object.entries(EMERGENCY_FIELDS)){if(typeof input[key]!=='string'||input[key].length>max)throw Error('请检查紧急卡文字长度。');d[key]=input[key].trim();}if(!d.person)throw Error('请填写适用旅伴。');d.verified=input.verified===true;return toolItem(id,'紧急卡 · '+d.person,d);}
export function emergencyText(d){return `この情報を確認してください。\n旅伴 / 氏名：${d.person}\n宿泊先：${d.hotel||'未填写 / 未記入'}\n住所：${d.address||'未填写 / 未記入'}\n緊急連絡先：${d.contact||'未填写 / 未記入'} ${d.phone||''}\nアレルギー：${d.verified&&d.allergyJa?d.allergyJa:'未确认 / 未確認'}\n中文过敏说明：${d.allergyZh||'未填写'}\n其他说明：${d.medical||'未填写'}\n${d.verified?'资料由旅伴手动核对；请现场再次确认。':'资料待旅伴核对。'}`;}
export function japaneseAnswer(answer){const m=String(answer||'').match(/(?:^|\n)日文[：:]\s*([\s\S]*?)(?=\n\s*(?:假名|中文)[：:]|$)/);const text=m?.[1]?.trim()||'';return /[\u3041-\u30ff]/.test(text)&&text.length<=1600?text:'';}
export function readinessReport(items,{files=null,offline=null,queue=[],shell=null}={}){
 const issues=[],add=(group,id,label,severity='pending')=>issues.push({group,id,label,severity});
 const checks=items.filter(i=>toolData(i)?.type==='checklist');if(!checks.length)add('准备','', '尚未建立准备清单；请添加并核对基础项目。');for(const i of checks)if(!toolData(i).done)add('准备',i.id,i.title+'：未完成');
 const seen=new Set();for(const i of tripItems(items)){const p=plan(i);if(p.done||['blocked','reference'].includes(p.state))continue;if(p.group&&p.kind==='alternative'){const chosen=chosenItem(items,i.day,p.group);if(!chosen){const key=i.day+p.group;if(!seen.has(key)){seen.add(key);add('预约',i.id,`${i.day} ${p.group}：备选尚未选定（不是每家都要预约）。`);}continue;}if(i.id!==chosen)continue;}if(i.status==='pending')add('预约',i.id,`${i.day} ${i.title}：安排／预约待确认。`);}
 const tickets=items.filter(i=>ticketData(i));if(!tickets.length)add('票券','','尚无票券记录，请核对机票及实际订单；不会视作已购买。');for(const i of tickets){const d=ticketData(i);if(d.booking==='used')continue;if(d.booking==='pending')add('票券',i.id,i.title+'：票券待购买／确认');if(files===null){add('票券',i.id,i.title+'：附件列表待联网核对');continue;}const ready=files.filter(f=>f.ticketId===i.id&&f.status==='ready');if(!ready.length)add('票券',i.id,i.title+'：最近附件列表没有可用文件');for(const f of ready){const saved=offline?.find(s=>s.id===f.id&&s.version===f.version);if(!saved?.available)add('离线',i.id,`${i.title} · ${f.name}：${offline===null?'本机缓存待检测':'当前版本未下载供离线使用'}`);}}
 for(const day of DAYS)for(const conflict of detectConflicts(items,day.date))add('时间',conflict.ids[0],day.date+' '+conflict.message,conflict.severity==='severe'?'severe':'pending');
 if(shell!==true)add('离线','',shell===false?'手册页面缓存未就绪，请联网刷新后重新检查。':'手册页面缓存待本机检测。');if(queue.length)add('同步','',`${queue.length}项本机修改待同步${queue.some(q=>q.conflict)?'，其中有冲突需处理':''}。`,queue.some(q=>q.conflict)?'severe':'pending');
 const cards=items.filter(emergencyData);if(!cards.length)add('紧急卡','','尚未填写旅伴紧急卡。');for(const i of cards){const d=emergencyData(i);if(!d.verified||!d.hotel||!d.address||!d.contact||!d.phone)add('紧急卡',i.id,i.title+'：资料未完整填写或未核对。');}
 return issues;
}
