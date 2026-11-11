import {validateItem} from '../../../core.js';
import {normalizeFavoriteRow,validateFavoriteEdit} from '../../../favorites-core.js';
const ORIGIN='https://wei304.github.io';
const ACTIONS=new Set(['status','setup','unlock','check','rows','history','apply','apply_batch','exchange_rate','rotate','lock','favorites_rows','favorites_preview','favorites_import','favorites_edit','favorites_history','favorites_restore','favorites_undo_import']);
const SECRET_ACTIONS=new Set(['setup','unlock','rotate']);
const MAX_BYTES=48000;
async function readBody(request){
 const limit=request.headers.get('x-trip-batch')==='1'?1048576:MAX_BYTES;
 if(Number(request.headers.get('content-length'))>limit)throw Object.assign(Error('invalid_request'),{status:413});
 const reader=request.body?.getReader();if(!reader)return {};
 let bytes=0;const chunks=[];
 while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>limit){await reader.cancel();throw Object.assign(Error('invalid_request'),{status:413});}chunks.push(value);}
 const buffer=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}
 try{const data=JSON.parse(new TextDecoder().decode(buffer));if(!data||Array.isArray(data)||typeof data!=='object')throw Error();return data;}catch{throw Object.assign(Error('invalid_request'),{status:400});}
}
export function makeHandler({rpc,networkHash}){
 return async request=>{
  const origin=request.headers.get('origin');
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'content-type,apikey,x-trip-session,x-trip-batch','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Vary':'Origin'};
  const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...headers,...(data.retryAfter?{'Retry-After':String(data.retryAfter)}:{})}});
  if(origin&&origin!==ORIGIN)return reply({error:'origin_not_allowed'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(!['GET','POST'].includes(request.method))return reply({error:'invalid_method'},405);
  try{
   const data=request.method==='GET'?{action:'status'}:await readBody(request);
   const {action,...body}=data;
   if(!ACTIONS.has(action))return reply({error:'invalid_action'},400);
   if(request.method==='POST'&&!request.headers.get('content-type')?.includes('application/json'))return reply({error:'invalid_content_type'},415);
   if(!['status','setup','unlock'].includes(action)){
    const token=request.headers.get('x-trip-session')||'';
    if(!/^[a-f0-9]{64}$/.test(token))return reply({error:'locked'},401);
    body.token=token;
   }else delete body.token;
   if(SECRET_ACTIONS.has(action)){
    if(typeof body.password!=='string'||new TextEncoder().encode(body.password).length>72)return reply({error:'invalid_password_length'},400);
    if(action!=='unlock'&&body.password.length<10)return reply({error:'invalid_password_length'},400);
    if(action==='setup'&&(typeof body.setupToken!=='string'||!/^[A-Za-z0-9_-]{40,100}$/.test(body.setupToken)))return reply({error:'invalid_setup_link'},403);
    if(action==='rotate'&&(typeof body.currentPassword!=='string'||new TextEncoder().encode(body.currentPassword).length>72))return reply({error:'invalid_password_length'},400);
   }
   if(action==='apply_batch'){
 if(!Array.isArray(body.entries)||body.entries.length<1||body.entries.length>50||new Set(body.entries.map(e=>e.item?.id)).size!==body.entries.length||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.operation||''))return reply({error:'invalid_batch'},400);
 try{body.entries=body.entries.map(e=>{if(!e.item?.id||!Number.isSafeInteger(e.expected)||e.expected<0||e.expected>999999999)throw Error();return {item:validateItem(e.item),expected:e.expected};});}catch{return reply({error:'invalid_batch'},400);}
 }
 if(action==='apply'){
    if(!Number.isSafeInteger(body.expected)||body.expected<0||body.expected>999999999||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.operation||''))return reply({error:'invalid_item'},400);
    try{if(!body.item?.id)return reply({error:'invalid_item'},400);body.item=validateItem(body.item);}catch{return reply({error:'invalid_item'},400);}
   }
   if(action==='favorites_preview'||action==='favorites_import'){
    try{if(!Array.isArray(body.rows)||body.rows.length<1||body.rows.length>1000||typeof body.source!=='string'||!body.source.trim()||body.source.length>160||!/^[a-f0-9]{64}$/.test(body.fileHash||''))throw Error();body.source=body.source.trim();body.rows=body.rows.map(normalizeFavoriteRow);}catch{return reply({error:'invalid_import'},400);}
   }
   if(action==='favorites_edit'){try{body.patch=validateFavoriteEdit(body.patch);}catch{return reply({error:'invalid_favorite'},400);}}
   const result=await rpc(action,body,SECRET_ACTIONS.has(action)?await networkHash(request):'');
   const {status=200,...payload}=result;return reply(payload,status);
  }catch(error){if(error.status)return reply({error:error.message},error.status);return reply({error:'temporarily_unavailable'},503);}
 };
}
