const ORIGIN='https://wei304.github.io';
const LIMIT=5242880;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function fileType(bytes){if(bytes[0]===0x25&&bytes[1]===0x50&&bytes[2]===0x44&&bytes[3]===0x46&&bytes[4]===0x2d)return 'application/pdf';if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'image/jpeg';if([137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))return 'image/png';if(new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP')return 'image/webp';return '';}
export function makeFileHandler({rpc,put,get}){return async request=>{
 const headers={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'content-type,apikey,x-trip-session','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'};
 const reply=(d,status=200)=>new Response(JSON.stringify(d),{status,headers:{...headers,'Content-Type':'application/json'}});
 if(request.headers.get('origin')&&request.headers.get('origin')!==ORIGIN)return reply({error:'origin_not_allowed'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});if(request.method!=='POST')return reply({error:'invalid_method'},405);
 const token=request.headers.get('x-trip-session')||'';if(!/^[a-f0-9]{64}$/.test(token))return reply({error:'locked'},401);
 try{
  const check=await rpc('check',{token});if(check.status||check.ok!==true)return reply({error:check.error||'locked'},check.status||401);
  if(Number(request.headers.get('content-length'))>LIMIT+65536)return reply({error:'file_too_large'},413);
  const reader=request.body?.getReader();if(!reader)return reply({error:'invalid_request'},400);let count=0;const chunks=[];while(true){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>LIMIT+65536){await reader.cancel();return reply({error:'file_too_large'},413);}chunks.push(value);}const bytes=new Uint8Array(count);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  if(request.headers.get('content-type')?.includes('multipart/form-data')){
   const form=await new Response(bytes,{headers:{'Content-Type':request.headers.get('content-type')}}).formData(),file=form.get('file'),ticketId=form.get('ticketId'),fileId=form.get('fileId');
   if(!(file instanceof File)||file.size<1||file.size>LIMIT||!UUID.test(String(fileId))||!/^ticket-[a-zA-Z0-9_-]{1,93}$/.test(String(ticketId)))return reply({error:'invalid_file'},400);
   const content=new Uint8Array(await file.arrayBuffer()),type=fileType(content);if(!type||type!==file.type)return reply({error:'unsupported_file_type'},400);
   const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',content))].map(n=>n.toString(16).padStart(2,'0')).join('');
   const extension={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[type],name=(file.name.replace(/[\r\n\x00-\x1f/\\]/g,'').replace(/\.[^.]{1,12}$/,'').slice(0,140)||'ticket')+'.'+extension;
   const result=await rpc('reserve',{token,fileId,ticketId,type,bytes:file.size,name,hash});if(result.status)return reply({error:result.error},result.status);
   if(result.file.status!=='ready'){
    await put(result.file.storage_path,content,type);
    const final=await rpc('finalize',{token,fileId});if(final.status)return reply({error:final.error},final.status);
   }
   return reply({ok:true,fileId});
  }
  if(count>16000)return reply({error:'invalid_request'},413);
  let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{return reply({error:'invalid_request'},400);}
  if(!['list','download','remove','restore'].includes(body.action))return reply({error:'invalid_action'},400);
  if(body.action!=='list'&&!UUID.test(body.fileId||''))return reply({error:'invalid_file'},400);
  const result=await rpc(body.action==='download'?'get':body.action,{token,fileId:body.fileId,expected:body.expected});if(result.status)return reply({error:result.error},result.status);
  if(body.action==='download'){const object=await get(result.file.storage_path);if(!object.ok)return reply({error:'file_unavailable'},404);return new Response(object.body,{headers:{...headers,'Content-Type':result.file.mime_type,'Content-Length':String(result.file.bytes),'Content-Disposition':'attachment; filename="ticket"'}});}
  if(body.action==='list')return reply({files:result.files});return reply({ok:true});
 }catch{return reply({error:'file_service_unavailable'},503);}
};}
