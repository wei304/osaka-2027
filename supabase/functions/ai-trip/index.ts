import {completeJSON} from './provider.js';
import {makeAIHandler} from './handler.js';
const url=Deno.env.get('SUPABASE_URL')||'';let keys:Record<string,string>={};try{keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');}catch{}
const service=keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',apiKey=Deno.env.get('DEEPSEEK_API_KEY')||'',model=Deno.env.get('DEEPSEEK_MODEL')||'deepseek-flash';
const rpc=async(action:string,body:unknown)=>{const r=await fetch(url+'/rest/v1/rpc/'+(action==='finish_no_changes'?'ai_no_changes_finish':action.startsWith('favorites_')?'favorite_ai_request':action.startsWith('phrase_')?'phrase_ai_request':'ai_trip_request'),{method:'POST',headers:{apikey:service,'Content-Type':'application/json',...(service.startsWith('ey')?{Authorization:'Bearer '+service}:{})},body:JSON.stringify(action==='finish_no_changes'?{p_body:body}:{p_action:action.startsWith('favorites_')?action.slice(10):action.startsWith('phrase_')?action.slice(7):action,p_body:body}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('database_unavailable');return r.json();};
const complete=({system,input,maxTokens}:{system:string,input:string,maxTokens:number})=>completeJSON({key:apiKey,model,system,input,maxTokens});
Deno.serve(makeAIHandler({rpc,complete,modelName:model,enabled:Deno.env.get('TRIP_AI_ENABLED')==='true'&&!!apiKey&&model==='deepseek-flash'}));
