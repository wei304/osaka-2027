export const PHRASE_LIMITS=Object.freeze({zh:500,ja:800,kana:1000,category:40,rows:500,backup:2000000});
export function phraseFields(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('短句格式不正确。');
 const out={};for(const key of ['category','zh','ja','kana']){const value=raw[key];if(typeof value!=='string'||value.length>PHRASE_LIMITS[key]||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw Error('短句字段过长或格式不正确。');out[key]=value.trim();}
 if(!out.category||!out.ja)throw Error('请填写分类和日文；中文和读音可留空后人工核对。');return out;
}
export function validateCustom(raw){
 const fields=phraseFields(raw);if(typeof raw.id!=='string'||!/^custom:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw.id))throw Error('自定义短句编号不正确。');
 if(!Number.isInteger(raw.version)||raw.version<1||!Number.isFinite(Date.parse(raw.updatedAt)))throw Error('短句版本不正确。');
 return {id:raw.id,...fields,pinned:raw.pinned===true,archived:raw.archived===true,version:raw.version,updatedAt:raw.updatedAt};
}
export const phraseFingerprint=p=>JSON.stringify([p.category,p.zh,p.ja,p.kana].map(v=>v.normalize('NFC').trim()));
export function mergePhraseImport(current,backup,makeId=()=>crypto.randomUUID()){
 if(!backup||backup.kind!=='local-phrase-library'||backup.schema!==1||!Array.isArray(backup.phrases)||backup.phrases.length>PHRASE_LIMITS.rows)throw Error('请选择有效的本机短句 JSON 备份。');
 const incoming=backup.phrases.map(validateCustom),rows=current.map(p=>({...p})),seen=new Set(rows.map(phraseFingerprint));let added=0,duplicates=0;
 for(const row of incoming){const fp=phraseFingerprint(row);if(seen.has(fp)){duplicates++;continue;}const collision=rows.some(p=>p.id===row.id);rows.push({...row,id:collision?'custom:'+makeId():row.id});seen.add(fp);added++;}
 if(rows.length>PHRASE_LIMITS.rows)throw Error('本机最多保存500条自定义短句，请先导出并整理。');return {rows,added,duplicates};
}
export function searchPhrases(rows,{query='',category='',scope='all'}={}){const q=query.trim().toLocaleLowerCase();return rows.filter(p=>(scope==='archived'?p.archived:!p.archived)&&(!category||p.category===category)&&(scope!=='custom'||p.id.toString().startsWith('custom:'))&&(scope!=='pinned'||p.pinned)&&(!q||`${p.zh} ${p.ja} ${p.kana}`.toLocaleLowerCase().includes(q))).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned));}
