import {phraseAIInput,validatePhraseAI,PHRASE_AI_SYSTEM} from '../../../phrase-ai-core.js';
export async function handlePhraseAI({body:b,token,rpc,complete,enabled,modelName}){
 const call=(action,fields={})=>rpc('phrase_'+action,{token,...fields});
 if(b.action==='phrase_recover')return call('recover',{operation:b.operation});
 const s=await call('status');if(s.status)return s;
 if(b.action==='phrase_status')return {...s,enabled:enabled&&s.enabled};
 if(b.action!=='phrase_generate')return {status:400,error:'invalid_request'};
 if(!enabled||!s.enabled)return {status:503,error:'ai_disabled'};
 if(b.consent!==true)return {status:400,error:'confirmation_required'};
 const input=phraseAIInput(b.input?.phrase,b.input?.task);if(b.input?.version!==1)return {status:400,error:'invalid_phrase_input'};
 const text=JSON.stringify(input),inputBytes=new TextEncoder().encode(PHRASE_AI_SYSTEM+text).length;
 const prepared=await call('prepare',{operation:b.operation,input,model:modelName,inputBytes});if(prepared.status||!prepared.claimed)return prepared;
 let finished=false;try{const response=await complete({system:PHRASE_AI_SYSTEM,input:text,maxTokens:1200});if(response.finish!=='stop')throw Error('incomplete_output');const result=validatePhraseAI(JSON.parse(response.content),input.task);const done=await call('finish',{operation:b.operation,result,usage:response.usage||{}});if(done.status)return done;finished=true;return done;}finally{if(!finished)await call('fail',{operation:b.operation}).catch(()=>{});}
}
