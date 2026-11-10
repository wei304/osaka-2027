import {makeFileHandler} from './handler.js';
const url=Deno.env.get('SUPABASE_URL')||'';let modern:Record<string,string>={};try{modern=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');}catch{}
const key=modern.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const auth=()=>({apikey:key,...(key.startsWith('ey')?{Authorization:'Bearer '+key}:{})});
const rpc=async(action:string,body:unknown)=>{if(!key||!url)throw Error();const name=action==='check'?'shared_trip_request':'trip_file_request';const response=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{...auth(),'Content-Type':'application/json'},body:JSON.stringify({p_action:action,p_body:body,...(name==='shared_trip_request'?{p_network:''}:{})}),signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error();return response.json();};
const objectUrl=(path:string)=>url+'/storage/v1/object/osaka-tickets/'+path.split('/').map(encodeURIComponent).join('/');
const put=async(path:string,bytes:Uint8Array,type:string)=>{const response=await fetch(objectUrl(path),{method:'POST',headers:{...auth(),'Content-Type':type,'x-upsert':'false'},body:bytes,signal:AbortSignal.timeout(30000)});if(response.ok)return; // Retry after a lost upload response: never overwrite the object.
 const existing=await fetch(objectUrl(path),{method:'HEAD',headers:auth(),signal:AbortSignal.timeout(15000)});if(!existing.ok||Number(existing.headers.get('content-length'))!==bytes.length)throw Error();};
const get=(path:string)=>fetch(objectUrl(path),{headers:auth(),signal:AbortSignal.timeout(30000)});
Deno.serve(makeFileHandler({rpc,put,get}));
