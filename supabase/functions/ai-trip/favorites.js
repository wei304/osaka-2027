import {FAVORITE_AI_SYSTEM,favoriteAIInput,validateFavoriteAI,localFavoriteSuggestion} from '../../../favorite-ai-core.js';
// Called only after the main handler's body cap, CORS and session header checks.
export async function handleFavoriteAI({body:b,token,rpc,complete,enabled,modelName}){
 const call=(action,body={})=>rpc('favorites_'+action,{...body,token});
 const bulk=b.action==='favorites_bulk_step',scope={taskId:b.taskId,executor:b.executor};
 if(b.action.startsWith('favorites_bulk_')&&!bulk){const r=await call(b.action.slice(10),b);return {...r,serverReady:enabled};}
 if(bulk){const recovered=await call('bulk_status',scope);if(recovered.status)return recovered;if(recovered.pending)return {...recovered,recoverFirst:true};}
 if(b.action==='favorites_plan'){const r=await call('plan');return {...r,serverReady:enabled};}
 if(b.action==='favorites_evidence')return call('evidence',{id:b.id,expected:b.expected,evidence:b.evidence,operation:b.operation});
 if(b.action==='favorites_profile')return call('profile',{day:b.day,regions:b.regions,expected:b.expected,scopeHash:b.scopeHash,confirmed:b.confirmed,operation:b.operation});
 if(b.action==='favorites_discard')return call('discard',{operation:b.operation});
 if(b.action==='favorites_recover')return call('recover',{operation:b.operation});
 if(b.action==='favorites_confirm'){if(b.confirmed!==true)return {status:400,error:'confirmation_required'};return call('confirm',{operation:b.operation,confirmed:true});}
 if(b.consent!==true)return {status:400,error:'consent_or_input_required'};
 const plan=await call(bulk?'bulk_next':'plan',scope);if(plan.noWork)return plan;if(plan.status)return plan;
 // Old operations are recovered before checking new input or reserving another request.
 const existing=await call('recover',{operation:b.operation});if(!existing.status)return existing;
 if(existing.error!=='favorite_ai_not_found')return existing;
 if(plan.items.some(p=>p.needsAI)&&!enabled)return {status:503,error:'ai_disabled'};
 const input=favoriteAIInput(plan.items.filter(p=>p.needsAI)),inputBytes=new TextEncoder().encode(FAVORITE_AI_SYSTEM+input).length;
 if(inputBytes>14000)return {status:400,error:'context_too_large'};
 const prepared=await call(bulk?'bulk_prepare':'prepare',{...scope,operation:b.operation,guard:bulk?plan.guard:b.guard,model:modelName,inputBytes});if(prepared.status)return prepared;
 let finished=false;try{
  const pending=prepared.items.filter(p=>p.needsAI);let proposed=[],usage={};
  if(pending.length){const r=await complete({system:FAVORITE_AI_SYSTEM,input:favoriteAIInput(pending),maxTokens:1200});if(r.finish!=='stop')throw Error('incomplete_output');proposed=validateFavoriteAI(JSON.parse(r.content),pending);usage=r.usage||{};}
  const suggestions=prepared.items.map(p=>p.needsAI?proposed.find(r=>r.id===p.id):p.cached||localFavoriteSuggestion(p));
  const done=await call(bulk?'bulk_finish':'finish',{...scope,operation:b.operation,suggestions,usage});finished=!done.status;return done;
 }finally{if(!finished)await call(bulk?'bulk_fail':'fail',{...scope,operation:b.operation}).catch(()=>{});}
}
