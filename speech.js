import {PHRASES} from './phrases.js';
export function japaneseVoices(synth){try{return (synth?.getVoices()||[]).filter(v=>/^ja(?:[-_]|$)/i.test(v.lang||'')).sort((a,b)=>Number(b.localService)-Number(a.localService));}catch{return [];}}

// Keep the utterance alive; all terminal callbacks belong to one playback only.
export function createSpeechPlayer({synth=globalThis.speechSynthesis,Utterance=globalThis.SpeechSynthesisUtterance,notify,setTimer=setTimeout,clearTimer=clearTimeout}){
 let current=null,timer=null,generation=0;
 function clearWatch(){if(timer!==null)clearTimer(timer);timer=null;}
 function cancel(){const active=!!current;generation++;clearWatch();if(current){current.onstart=current.onend=current.onerror=null;}current=null;try{if(synth&&(active||synth.speaking||synth.pending))synth.cancel();}catch{}}
 function play(text,voice,id){cancel();if(!synth||!Utterance){notify({id,state:'error',message:'此浏览器不支持设备朗读，请复制日文或展示给工作人员。'});return;}if(!voice){notify({id,state:'error',message:'尚未找到日语声音。请在手机设置中搜索“文字转语音”，下载日语声音后点“重新检测声音”。'});return;}
  const g=generation;let started=false;
  const finish=(state,message)=>{if(g!==generation)return;clearWatch();current=null;notify({id,state,message});};
  try{const u=new Utterance(text);current=u;u.lang='ja-JP';u.voice=voice;u.rate=1;u.pitch=1;u.volume=1;
   u.onstart=()=>{if(g!==generation)return;started=true;clearWatch();notify({id,state:'speaking',message:'已开始朗读日语。若听不到，请调高媒体音量并检查蓝牙耳机。'});};
   u.onend=()=>finish('done','朗读已结束。');
   u.onerror=e=>{const reason=e?.error;finish('error',reason==='not-allowed'?'浏览器未允许播放，请再次手动点击朗读，并检查网站声音设置。':['language-unavailable','voice-unavailable'].includes(reason)?'这份日语声音不可用，请切换另一种声音，或下载系统日语语音包。':reason==='network'?'此声音需要网络。请联网重试，或选择已下载的本机日语声音。':'日语朗读失败（'+(reason||'语音服务未响应')+'）。请重新检测或切换日语声音。');};
   notify({id,state:'loading',message:'正在请求手机日语语音…'});
   timer=setTimer(()=>{if(g!==generation||started)return;cancel();notify({id,state:'error',message:'手机语音服务在8秒内没有启动。请切换日语声音、检查媒体音量与语音包；也可用Chrome打开同一手册测试。'});},8000);
   if(synth.paused)synth.resume();
   // Stay inside the user's click: mobile browsers can reject delayed playback.
   synth.speak(u);
  }catch{finish('error','手机无法启动朗读。请重新检测日语声音，或使用复制日文。');}
 }
 return {play,stop(){cancel();notify({state:'idle',message:'已停止朗读。'});}};
}

export function installSpeech({toast,refresh}){
 const synth=globalThis.speechSynthesis,$=s=>document.querySelector(s);let root=null,last=null;
 function feedback(event){last=event;const el=$('#speech-status');if(el)el.textContent=event.message;if(root){root.querySelectorAll('[data-speech-feedback]').forEach(el=>{el.textContent=String(event.id)===el.dataset.speechFeedback?event.message:'';});root.querySelectorAll('[data-speak-phrase]').forEach(b=>{const active=String(event.id)===b.dataset.speakPhrase;b.textContent=active&&event.state==='loading'?'准备声音…':active&&event.state==='speaking'?'正在朗读…':'朗读';b.setAttribute('aria-pressed',String(active&&['loading','speaking'].includes(event.state)));});}if(event.state==='error')toast(event.message);}
 const player=createSpeechPlayer({synth,notify:feedback});
 function status(){const voices=japaneseVoices(synth),select=$('#speech-voice'),previous=select?.value;if(select){select.replaceChildren();for(const voice of voices){const o=document.createElement('option');o.value=voice.voiceURI||voice.name;o.textContent=voice.name+(voice.localService?' · 本机':' · 可能需要网络');select.append(o);}if(!voices.length){const o=document.createElement('option');o.value='';o.textContent='未检测到日语声音';select.append(o);}if(voices.some(v=>(v.voiceURI||v.name)===previous))select.value=previous;select.disabled=!voices.length;}
  if(!last||!['loading','speaking','error'].includes(last.state)){const el=$('#speech-status');if(el)el.textContent=!synth?'此浏览器不支持设备语音，可复制或展示日文。':voices.length?`找到${voices.length}种日语声音。点朗读后会检查是否实际启动；本机声音是否已下载取决于系统设置。`:'未检测到日语声音。朗读按钮可显示设置指引，不会改用英语朗读。';}
 }
 function voice(){const voices=japaneseVoices(synth),value=$('#speech-voice')?.value;return voices.find(v=>(v.voiceURI||v.name)===value)||voices[0];}
 function bind(target){root=target;status();root.querySelectorAll('[data-speak-phrase]').forEach(b=>{b.disabled=false;b.onclick=()=>{const phrase=PHRASES.find(p=>p.id===Number(b.dataset.speakPhrase));if(phrase)player.play(phrase.ja,voice(),phrase.id);};});if(last)feedback({...last,state:last.state==='error'?'notice':last.state});}
 synth?.addEventListener?.('voiceschanged',()=>{status();refresh();});
 $('#stop-speech').onclick=()=>player.stop();
 $('#refresh-speech')?.addEventListener('click',()=>{player.stop();last=null;status();refresh();toast(japaneseVoices(synth).length?'已重新检测日语声音，请点测试。':'仍未检测到日语声音，请查看下方设置指引。');});
 $('#test-speech')?.addEventListener('click',()=>player.play('こんにちは。日本語の音声テストです。',voice(),'test'));
 $('#speech-voice')?.addEventListener('change',()=>player.stop());status();
 return {bind,stop(){player.stop();last=null;}};
}
