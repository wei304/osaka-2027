import {AIClient} from './ai-client.js';
import {phrasePending,claimPhraseRequest} from './phrase-store.js';
import {validatePhraseAI} from './phrase-ai-core.js';
export class PhraseAIClient{
 constructor(getCloud){this.api=new AIClient(getCloud);}
 clear(){this.api.clear();}
 status(){return this.api.request('phrase_status');}
 pending(){return phrasePending();}
 async generate(input){const operation=crypto.randomUUID();await claimPhraseRequest({operation,task:input.task});const r=await this.api.request('phrase_generate',{operation,input,consent:true});if(r.jobStatus==='ready'){r.result=validatePhraseAI(r.result,input.task);await phrasePending(null);}return r;}
 async recover(){const pending=await this.pending();if(!pending)throw Error('没有待核对请求。');const r=await this.api.request('phrase_recover',{operation:pending.operation});if(r.jobStatus==='ready'){r.result=validatePhraseAI(r.result,pending.task);await phrasePending(null);}return r;}
 forget(){return phrasePending(null);}
}
