export function passwordError(password,confirmation){
 if(password.length<10)return '请设置至少 10 位的密码，建议混合字母、数字和符号。';
 if(password.length>128)return '密码请控制在 128 位以内。';
 if(password!==confirmation)return '两次输入的密码不一致。';
 return '';
}
export function authError(error){
 const message=error.message||'',code=error.code||'';
 if(error.status===429||/rate.limit|too many requests/i.test(message))return '登录或邮件请求过于频繁，请稍后重试。已设置密码的旅伴可使用密码登录；请勿反复发送邮件。';
 if(code==='invalid_credentials'||/invalid login credentials/i.test(message))return '邮箱或密码不正确。如果还没设置密码，请展开“首次使用 / 忘记密码”，先用邮件登录一次。';
 if(code==='email_not_confirmed'||/email not confirmed/i.test(message))return '请先通过邮件验证这个邮箱，再使用密码登录。';
 if(code==='same_password')return '新密码与当前密码相同，无需修改。';
 if(code==='weak_password')return '这个密码不符合要求，请换一个更长、更难猜的密码。';
 if(code==='reauthentication_needed'||/reauthentication|nonce/i.test(message))return '这次设置密码需要重新验证身份。请先用邮件重新登录，再设置密码。';
 if(code==='refresh_token_not_found'||code==='refresh_token_already_used')return '登录已过期，请使用邮箱和密码重新登录。';
 if(error.name==='TimeoutError'||error.name==='AbortError')return '连接超时，请检查网络后重试。';
 if(error instanceof TypeError)return '暂时无法连接，请检查网络后重试。';
 return message||'暂时无法登录，请稍后重试。';
}
export function installAuth({getCloud,getSession,commitSession,onSignedIn,namespace}){
 const $=selector=>document.querySelector(selector),email=$('#email'),message=$('#auth-message');
 let busy=false,cooldownUntil=0;
 const safeRead=key=>{try{return localStorage.getItem(key);}catch{return null;}};
 const safeWrite=(key,value)=>{try{localStorage.setItem(key,value);}catch{}};
 email.value=safeRead(namespace+'-email')||'';
 cooldownUntil=Math.min(Number(safeRead(namespace+'-email-next'))||0,Date.now()+3600000);
 const announce=(text,success=false)=>{message.textContent=text;message.hidden=!text;message.classList.toggle('success',success);};
 function render(){const loggedIn=!!getSession();$('#signed-out').hidden=loggedIn;$('#signed-in').hidden=!loggedIn;const remaining=Math.max(0,Math.ceil((cooldownUntil-Date.now())/1000));$('#send-link').disabled=busy||remaining>0;$('#send-link').textContent=remaining?`${remaining} 秒后可重新发送`:'发送一次登录链接';$('#password-login').disabled=busy;$('#save-password').disabled=busy;$('#logout').disabled=busy;}
 const rememberEmail=()=>safeWrite(namespace+'-email',email.value.trim().toLowerCase());
 const requireCloud=()=>{const client=getCloud();if(!client)throw Error('连接尚未准备好，请联网刷新，或检查高级连接设置。');return client;};
 $('#login-form').onsubmit=async event=>{
  event.preventDefault();if(busy)return;
  busy=true;announce('正在登录…');render();
  try{const client=requireCloud();const data=await client.signInWithPassword(email.value.trim().toLowerCase(),$('#login-password').value);await commitSession(data,client);rememberEmail();announce('登录成功。这台设备会保持登录。',true);onSignedIn();}
  catch(error){announce(authError(error));}
  finally{$('#login-password').value='';busy=false;render();}
 };
 $('#send-link').onclick=async()=>{
  if(busy||Date.now()<cooldownUntil||!email.reportValidity())return;
  busy=true;announce('正在发送登录链接…');render();
  try{await requireCloud().signIn(email.value.trim().toLowerCase());rememberEmail();cooldownUntil=Date.now()+60000;safeWrite(namespace+'-email-next',String(cooldownUntil));announce('登录链接已发送。请在这台设备的同一浏览器中打开邮件链接，登录后设置密码。',true);}
  catch(error){if(error.status===429||/rate.limit/i.test(error.message)){cooldownUntil=Date.now()+Math.max(60,error.retryAfter||0)*1000;safeWrite(namespace+'-email-next',String(cooldownUntil));}announce(authError(error));}
  finally{busy=false;render();}
 };
 $('#set-password-form').onsubmit=async event=>{
  event.preventDefault();if(busy)return;
  const password=$('#new-password').value,confirmation=$('#confirm-password').value;
  const invalid=passwordError(password,confirmation);if(invalid)return announce(invalid);
  if(!getSession())return announce('请先登录，再设置自己的密码。');
  busy=true;announce('正在保存密码…');render();
  try{await requireCloud().updatePassword(password,$('#current-password').value);announce('密码已设置。下次可直接用邮箱和密码登录，不需要登录邮件。',true);$('#password-settings').open=false;}
  catch(error){announce(authError(error));}
  finally{$('#new-password').value='';$('#confirm-password').value='';$('#current-password').value='';busy=false;render();}
 };
 const clearSecrets=()=>{for(const id of ['login-password','new-password','confirm-password','current-password'])$('#'+id).value='';announce('');};
 for(const button of document.querySelectorAll('[data-toggle-password]'))button.onclick=()=>{const input=document.getElementById(button.dataset.togglePassword);const reveal=input.type==='password';input.type=reveal?'text':'password';button.textContent=reveal?'隐藏':'显示';button.setAttribute('aria-pressed',String(reveal));};
 setInterval(render,1000);render();
 return {render,clearSecrets,get busy(){return busy;}};
}
