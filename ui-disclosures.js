// Progressive disclosure only. Existing controls retain their event handlers.
export function installDisclosures(){
 const $=s=>document.querySelector(s);
 function fold(id,title,nodes){const d=document.createElement('details');d.id=id;d.className='panel advanced-disclosure';const summary=document.createElement('summary');summary.textContent=title;d.append(summary);nodes[0].before(d);for(const n of nodes)d.append(n);return d;}
 const speech=$('.speech-controls'),help=speech.nextElementSibling;
 // Playback status and stop remain visible; diagnostics move behind one disclosure.
 const status=$('#speech-status'),stop=$('#stop-speech');speech.before(status,stop);
 fold('speech-advanced','无法播放？声音与高级设置',[speech,help]);
 const helpers=$('#tools .settings-grid');fold('travel-helpers','汇率、交通与安装工具',[helpers]);
 const budget=$('#ai-budget-summary').closest('article');const budgetDetails=fold('ai-budget-settings','AI 开关、共用预算与费用说明',[budget]);$('#ai').append(budgetDetails);
 const overview=$('#ai-local-brief').closest('article');const overviewDetails=fold('ai-local-overview','本机行程概览 · 无需 AI',[overview]);$('#ai').append(overviewDetails);
 const statusPanel=$('#ai-status').closest('article'),explanation=statusPanel.querySelector('.hint');fold('ai-help','AI 使用范围与说明',[explanation]);
 const mode=$('#ai-mode-panel');const modeDetails=fold('ai-mode-settings','高级路线参数',[mode]);modeDetails.hidden=true;
 const budgetConsent=$('#ai-budget').closest('label');fold('ai-extra-data','可选发送参数',[budgetConsent]);
 const preview=$('#ai-data-preview').closest('details'),privacy=preview.nextElementSibling;preview.append(privacy);
 const dictation=$('.dictation-controls');dictation.id='ai-dictation-controls';dictation.hidden=true;
 const settings=document.createElement('details');settings.id='dictation-settings';settings.className='panel advanced-disclosure';settings.innerHTML='<summary>高级输入设置</summary><label class="filter"><input id="enable-dictation" type="checkbox">启用浏览器语音听写（本机）</label><p class="hint">默认关闭。现场中日双向对话建议使用专业翻译软件；手册保留文字提问、离线短句和日语朗读。</p>';$('#settings').append(settings);
 const option=$('#ai-task option[value="optimize"]');option.hidden=true;
 const advanced=document.createElement('button');advanced.type='button';advanced.id='advanced-ai-route';advanced.textContent='高级 AI 路线草案';advanced.dataset.openTab='ai';$('#routes .section-title').after(advanced);
 advanced.addEventListener('click',()=>{option.hidden=false;$('#ai-task').value='optimize';$('#ai-task').dispatchEvent(new Event('change'));$('#ai-mode-settings').hidden=false;$('#ai-mode-settings').open=true;});
 $('#ai-task').addEventListener('change',()=>{if($('#ai-task').value!=='optimize'){option.hidden=true;$('#ai-mode-settings').open=false;$('#ai-mode-settings').hidden=true;}});
}
