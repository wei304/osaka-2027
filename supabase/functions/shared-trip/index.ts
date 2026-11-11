import {loadReference} from './exchange.js';
import {makeHandler} from './handler.js';
const url=Deno.env.get('SUPABASE_URL')||'';
let modernKeys:Record<string,string>={};
try{modernKeys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');}catch{}
const key=modernKeys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const encoder=new TextEncoder();
const hmacKey=key?crypto.subtle.importKey('raw',encoder.encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']):null;
const rpc=async(action:string,body:unknown,network:string)=>{
 if(!url||!key)throw Error('server_not_ready');
 if(action==='exchange_rate')return loadReference({rpc,token:(body as {token:string}).token});
 const favorite=action.startsWith('favorites_');
 const response=await fetch(url+'/rest/v1/rpc/'+(favorite?'favorite_request':'shared_trip_request'),{
  method:'POST',headers:{apikey:key,'Content-Type':'application/json',...(key.startsWith('ey')?{Authorization:'Bearer '+key}:{})},
  body:JSON.stringify(favorite?{p_action:action.slice(10),p_body:body}:{p_action:action,p_body:body,p_network:network}),signal:AbortSignal.timeout(12000)
 });
 if(!response.ok)throw Error('database_unavailable');
 return response.json();
};
const networkHash=async(request:Request)=>{
 if(!hmacKey)throw Error('server_not_ready');
 // Only keep an ephemeral, salted digest for rate limiting; no account or identity.
 const ip=request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim()||request.headers.get('x-real-ip')||'unknown';
 const signed=await crypto.subtle.sign('HMAC',await hmacKey,encoder.encode(ip));
 return [...new Uint8Array(signed)].map(x=>x.toString(16).padStart(2,'0')).join('');
};
Deno.serve(makeHandler({rpc,networkHash}));
