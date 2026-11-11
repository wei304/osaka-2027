import {FAVORITE_AI_SYSTEM,favoriteAIInput,validateFavoriteAI,localFavoriteSuggestion} from '../../../favorite-ai-core.js';
// Called only after the main handler's body cap, CORS and session header checks.
export async function handleFavoriteAI({body:b,token,rpc,complete,enabled,modelName}){
 const call=(action,body={})=>rpc('favorites_'+action,{...body,token});
 if(b.action==='favorites_plan'){const r=await call('plan');return {...r,serverReady:enabled};}
 if(b.action==='favorites_evidence')return call('evidence',{id:b.id,expected:b.expected,evidence:b.evidence,operation:b.operation});
 if(b.action==='favorites_profile')return call('profile',{day:b.day,regions:b.regions,expected:b.expected,scopeHash:b.scopeHash,confirmed:b.confirmed,operation:b.operation});
 if(b.action==='favorites_discard')return call('discard',{operation:b.operation});
 if(b.action==='favorites_recover')return call('recover',{operation:b.operation});
 if(b.action==='favorites_confirm'){if(b.confirmed!==true)return {status:400,error:'confirmation_required'};return call('confirm',{operation:b.operation,confirmed:true});}
 if(b.consent!==true)return {status:400,error:'consent_or_input_required'};
 const plan=await call('plan');if(plan.status)return plan;
 // Old operations are recovered before checking new input or reserving another request.
 const existing=await call('recover',{operation:b.operation});if(!existing.status)return existing;
 if(existing.error!=='favorite_ai_not_found')return existing;
 if(plan.items.some(p=>p.needsAI)&&!enabled)return {status:503,error:'ai_disabled'};
 const input=favoriteAIInput(plan.items.filter(p=>p.needsAI)),inputBytes=new TextEncoder().encode(FAVORITE_AI_SYSTEM+input).length;
 if(inputBytes>14000)return {status:400,error:'context_too_large'};
 const prepared=await call('prepare',{operation:b.operation,guard:b.guard,model:modelName,inputBytes});if(prepared.status)return prepared;
 let finished=false;try{
  const pending=prepared.items.filter(p=>p.needsAI);let proposed=[],usage={};
  if(pending.length){const r=await complete({system:FAVORITE_AI_SYSTEM,input:favoriteAIInput(pending),maxTokens:1200});if(r.finish!=='stop')throw Error('incomplete_output');proposed=validateFavoriteAI(JSON.parse(r.content),pending);usage=r.usage||{};}
  const suggestions=prepared.items.map(p=>p.needsAI?proposed.find(r=>r.id===p.id):p.cached||localFavoriteSuggestion(p));
  const done=await call('finish',{operation:b.operation,suggestions,usage});finished=true;return done;
 }finally{if(!finished)await call('fail',{operation:b.operation}).catch(()=>{});}
}
