import {makeShareHandler} from './handler.js';
const url=Deno.env.get('SUPABASE_URL')||'';let keys:Record<string,string>={};try{keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');}catch{}
const key=keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const rpc=async(action:string,body:unknown)=>{const r=await fetch(url+'/rest/v1/rpc/share_trip_request',{method:'POST',headers:{apikey:key,'Content-Type':'application/json',...(key.startsWith('ey')?{Authorization:'Bearer '+key}:{})},body:JSON.stringify({p_action:action,p_body:body}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error();return r.json();};
Deno.serve(makeShareHandler({rpc}));
