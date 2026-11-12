// Browser-driven, finite serial executor. No service worker, background cron or paid retry.
export class FavoriteBulkRunner{
 constructor({request,savePending,onState,wait=ms=>new Promise(r=>setTimeout(r,ms))}){Object.assign(this,{request,savePending,onState,wait});this.stopped=true;this.running=false;this.epoch=0;}
 pause(){this.stopped=true;}
 clear(){this.pause();this.epoch++;}
 async run(taskId,executor){
  if(this.running)throw Error('任务已在本页面运行。');this.running=true;this.stopped=false;const epoch=this.epoch;
  try{for(let n=0;n<30&&!this.stopped;n++){
   const state=await this.request('status',{taskId});if(epoch!==this.epoch)return;this.onState(state);
   if(state.pending||state.state!=='running')return;
   const operation=crypto.randomUUID();await this.savePending({taskId,operation});if(this.stopped)return;
   const result=await this.request('step',{taskId,executor,operation,consent:true});
   if(epoch!==this.epoch)return;const checked=await this.request('status',{taskId});if(epoch!==this.epoch)return;this.onState(checked);
   if(checked.pending)return;await this.savePending(null);
   if(this.stopped||checked.state!=='running'||result.recoverFirst||result.noWork)return;
   if(result.result?.some(r=>r.engine==='ai'))await this.wait(10100);
  }}finally{this.stopped=true;this.running=false;}
 }
}
