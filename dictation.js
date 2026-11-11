// Browser-managed recognition only. No audio recording, persistence, or AI calls.
const ERRORS={'not-allowed':'麦克风权限被拒绝。请在浏览器的网站权限中允许麦克风，或使用键盘麦克风。','service-not-allowed':'浏览器未开放语音服务，请使用键盘麦克风。','audio-capture':'未能使用麦克风，请检查是否被其他应用占用。','network':'语音识别服务连接失败，请检查网络或使用键盘麦克风。','no-speech':'没有听清声音，请重试或使用键盘麦克风。','language-not-supported':'当前识别服务不支持这个语言，请切换语言或使用键盘麦克风。','aborted':'语音输入已取消。'};
export function createDictation({Recognition,secure=true,onState=()=>{},schedule=setTimeout,unschedule=clearTimeout}){
 let active=null,serial=0,timers=[],snapshot={phase:'idle',final:'',interim:'',message:''};
 const emit=patch=>{snapshot={...snapshot,...patch};onState({...snapshot});};
 const clearTimers=()=>{timers.forEach(unschedule);timers=[];};
 function detach(){const r=active;active=null;serial++;clearTimers();if(r){r.onstart=r.onresult=r.onerror=r.onend=null;try{r.abort();}catch{}}}
 const supported=!!Recognition&&secure;
 function start(lang='zh-CN'){
  if(!supported){emit({phase:'unsupported',message:'此浏览器暂不支持网页语音输入。请点文字框，使用手机键盘上的麦克风。'});return;}
  if(active)return;
  detach();const id=serial;let r;try{r=new Recognition();}catch{emit({phase:'error',message:'无法启动浏览器语音服务，请使用键盘麦克风。'});return;}
  active=r;r.lang=['zh-CN','ja-JP','en-US'].includes(lang)?lang:'zh-CN';r.continuous=false;r.interimResults=true;r.maxAlternatives=1;
  emit({phase:'starting',final:'',interim:'',message:'正在请求麦克风，请允许浏览器使用。'});
  const current=()=>active===r&&serial===id;
  r.onstart=()=>{if(!current()||snapshot.phase==='stopping')return;clearTimers();emit({phase:'listening',message:'正在收音，请说话；完成后点击结束。'});timers.push(schedule(()=>{if(current())stop();},60000));};
  r.onresult=e=>{if(!current())return;let final='',interim='';for(let i=0;i<e.results.length;i++){const text=String(e.results[i]?.[0]?.transcript||'');if(e.results[i].isFinal)final+=text;else interim+=text;}emit({final:final.slice(0,1800),interim:interim.slice(0,1800),message:final.length>1800?'识别内容超过1800字，仅保留前1800字，请核对。':'识别文字尚未放入输入框，也未发送AI。'});};
  r.onerror=e=>{if(!current())return;const message=ERRORS[e.error]||'语音识别暂不可用，请重试或使用键盘麦克风。';detach();emit({phase:'error',interim:'',message});};
  r.onend=()=>{if(!current())return;detach();emit({phase:'ready',interim:'',message:snapshot.final?'收音已结束，请核对文字后点击采用。':'未取得可用文字，请重试或使用键盘麦克风。'});};
  timers.push(schedule(()=>{if(!current())return;detach();emit({phase:'error',message:'语音服务没有响应，请使用键盘麦克风。'});},10000));
  try{r.start();}catch{if(current()){detach();emit({phase:'error',message:'语音服务无法启动，请重试或使用键盘麦克风。'});}}
 }
 function stop(){if(!active||snapshot.phase==='stopping')return;const id=serial;emit({phase:'stopping',message:'正在结束收音，等待最终文字…'});clearTimers();try{active.stop();}catch{detach();emit({phase:'ready',interim:'',message:'收音已停止，请核对已识别的文字。'});return;}timers.push(schedule(()=>{if(serial!==id)return;detach();emit({phase:'ready',interim:'',message:snapshot.final?'收音已停止，请核对文字后采用。':'没有取得最终文字，请使用键盘麦克风。'});},3000));}
 function clear(){detach();emit({phase:'idle',final:'',interim:'',message:supported?'点击语音输入开始；识别后需核对并采用。':'此浏览器暂不支持网页语音输入，请使用手机键盘麦克风。'});}
 clear();return {supported,start,stop,clear,get state(){return {...snapshot};}};
}
export function appendDictation(existing,text,max=1800){const addition=text.trim();if(!addition)throw Error('还没有可采用的最终文字。');const combined=existing+(existing&&!/\s$/.test(existing)?'\n':'')+addition;if(combined.length>max)throw Error('合并后超过1800字，请先缩短输入框内容，或手动复制部分识别文字。');return combined;}
