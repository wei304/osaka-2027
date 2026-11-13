import {verifiedRegion,recommendedDays} from '../../../favorite-days-batch-core.js';
import {redact} from '../../../ai-core.js';
export function chatSources(data,days){
 const profiles=(data.dayContext?.profiles||[]).filter(p=>p.valid&&days.includes(p.day));
 return (data.places||[]).filter(p=>!p.archived&&verifiedRegion(p)).map(p=>{
  const linked=(data.links||[]).filter(l=>l.place_id===p.id&&l.active&&days.includes(l.day)).map(l=>l.day).sort();
  const related=recommendedDays(p,profiles).filter(d=>days.includes(d));
  return {id:p.id,version:p.version,name:redact(p.source_name).slice(0,100),region:verifiedRegion(p).region,linked,related};
 }).filter(p=>p.linked.length||p.related.length).slice(0,50);
}
