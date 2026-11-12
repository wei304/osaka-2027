import {createDictation,appendDictation} from './dictation.js';
export function installDictation({onEdit,toast}){
 const $=s=>document.querySelector(s);let disabled=false,controller;
 const toggle=$('#enable-dictation'),panel=$('#ai-dictation-controls'),key='osaka-2027-dictation-enabled';
 try{toggle.checked=localStorage.getItem(key)==='true';}catch{}
 panel.hidden=!toggle.checked;
 toggle.onchange=()=>{controller.clear();panel.hidden=!toggle.checked;try{localStorage.setItem(key,String(toggle.checked));}catch{} };
 function render(s){const active=['starting','listening','stopping'].includes(s.phase);$('#ai-voice-status').textContent=s.message;$('#ai-voice-preview').textContent=s.final+(s.interim?'\n（识别中）'+s.interim:'');$('#ai-voice-start').disabled=disabled||active||!controller?.supported;$('#ai-voice-stop').disabled=!active||s.phase==='stopping';$('#ai-voice-language').disabled=disabled||active;$('#ai-voice-use').disabled=disabled||active||!s.final;$('#ai-voice-cancel').disabled=disabled||(!active&&!s.final&&!s.interim);$('#ai-voice-start').setAttribute('aria-pressed',String(active));}
 controller=createDictation({Recognition:window.SpeechRecognition||window.webkitSpeechRecognition,secure:window.isSecureContext,onState:render});render(controller.state);
 $('#ai-voice-start').onclick=()=>{if(toggle.checked&&!disabled)controller.start($('#ai-voice-language').value);};
 $('#ai-voice-stop').onclick=()=>controller.stop();$('#ai-voice-cancel').onclick=()=>controller.clear();
 $('#ai-voice-use').onclick=()=>{try{$('#ai-prompt').value=appendDictation($('#ai-prompt').value,controller.state.final);onEdit();controller.clear();$('#ai-voice-status').textContent='已追加到输入框。请核对，再勾选同意并手动发送。';$('#ai-prompt').focus();}catch(e){toast(e.message);}};
 document.addEventListener('visibilitychange',()=>{if(document.hidden)controller.clear();});window.addEventListener('pagehide',()=>controller.clear());
 return {clear:()=>controller.clear(),setDisabled(value){disabled=value;if(value)controller.clear();render(controller.state);}};
}
