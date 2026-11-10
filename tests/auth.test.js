import test from 'node:test';
import assert from 'node:assert/strict';
import {Cloud} from '../cloud.js';
import {authError,passwordError,installAuth} from '../auth.js';
const config={url:'https://test.supabase.co',key:'public-test-key'};
const activeSession=()=>({access_token:'test-access-token',refresh_token:'test-refresh-token',expires_at:Math.floor(Date.now()/1000)+3600,user:{email:'member@example.invalid'}});
const response=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...headers}});
test('password login checks member access before returning a session',async t=>{
 const calls=[],updates=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return response(calls.length===1?activeSession():[{email:'member@example.invalid'}]);});
 const cloud=new Cloud(config,null,s=>updates.push(s));const result=await cloud.signInWithPassword('member@example.invalid','test-password-only');
 assert.equal(result.user.email,'member@example.invalid');assert.equal(updates.length,0);assert.equal(cloud.session,null);
 assert.match(calls[0].url,/grant_type=password$/);assert.deepEqual(JSON.parse(calls[0].options.body),{email:'member@example.invalid',password:'test-password-only'});
 assert.equal(calls[1].options.headers.Authorization,'Bearer test-access-token');
});
test('wrong password never requests itinerary or stores a session',async t=>{
 let count=0;t.mock.method(globalThis,'fetch',async()=>{count++;return response({code:'invalid_credentials',msg:'Invalid login credentials'},400);});
 const updates=[],cloud=new Cloud(config,null,s=>updates.push(s));await assert.rejects(cloud.signInWithPassword('member@example.invalid','wrong'),error=>{assert.equal(error.status,400);assert.match(authError(error),/邮箱或密码不正确/);return true;});assert.equal(count,1);assert.equal(updates.length,0);
});
test('valid account outside the member list cannot complete handbook login',async t=>{
 let count=0;t.mock.method(globalThis,'fetch',async()=>response(++count===1?activeSession():[]));const updates=[],cloud=new Cloud(config,null,s=>updates.push(s));await assert.rejects(cloud.signInWithPassword('outsider@example.invalid','test-password-only'),{code:'not_a_member'});assert.equal(updates.length,0);assert.equal(cloud.session,null);
});
test('password changes use the signed-in token and never put the password in saved session',async t=>{
 let sent;t.mock.method(globalThis,'fetch',async(url,options)=>{sent={url,options};return response({id:'test-member',email:'member@example.invalid'});});
 const updates=[],cloud=new Cloud(config,activeSession(),s=>updates.push(s));await cloud.updatePassword('a-new-test-password','an-old-test-password');assert.equal(sent.options.method,'PUT');assert.equal(sent.options.headers.Authorization,'Bearer test-access-token');assert.deepEqual(JSON.parse(sent.options.body),{password:'a-new-test-password',current_password:'an-old-test-password'});assert.equal(JSON.stringify(updates).includes('a-new-test-password'),false);
});
test('parallel requests refresh a remembered session only once',async t=>{
 let refreshes=0;t.mock.method(globalThis,'fetch',async url=>{if(url.includes('/token?')){refreshes++;await new Promise(r=>setTimeout(r,5));return response(activeSession());}return response([]);});
 const cloud=new Cloud(config,{...activeSession(),expires_at:0},()=>{});await Promise.all([cloud.members(),cloud.rows()]);assert.equal(refreshes,1);
});
test('a revoked refresh token clears the session; temporary network errors preserve it',async t=>{
 const updates=[];const mocked=t.mock.method(globalThis,'fetch',async()=>response({code:'refresh_token_not_found',msg:'Invalid refresh token'},400));
 const cloud=new Cloud(config,activeSession(),s=>updates.push(s));await assert.rejects(cloud.refresh());assert.equal(cloud.session,null);assert.deepEqual(updates,[null]);
 mocked.mock.mockImplementation(async()=>{throw new TypeError('network error');});const other=new Cloud(config,activeSession(),()=>assert.fail('must preserve session'));await assert.rejects(other.refresh());assert.ok(other.session);
});
test('password validation and email-limit guidance are understandable',()=>{assert.match(passwordError('short','short'),/至少 10 位/);assert.match(passwordError('long-enough-password','different-password'),/不一致/);assert.equal(passwordError('long-enough-password','long-enough-password'),'');assert.match(authError({message:'email rate limit exceeded',status:429}),/请勿反复发送邮件/);});
function uiEnvironment(t){
 const elements=new Map(),saved=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{value:'',hidden:false,disabled:false,textContent:'',open:true,type:'password',classList:{toggle(){}},reportValidity:()=>true});return elements.get(id);};
 t.mock.method(globalThis,'setInterval',()=>0);
 t.mock.method(globalThis,'setTimeout',()=>0);
 const oldDocument=globalThis.document,oldStorage=globalThis.localStorage;
 globalThis.document={querySelector:s=>element(s),querySelectorAll:()=>[]};globalThis.localStorage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)};
 t.after(()=>{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;if(oldStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=oldStorage;});
 return {element,saved};
}
test('login form remembers only email and session, clears password, and switches to signed-in view',async t=>{
 const {element,saved}=uiEnvironment(t);let session=null,signIns=0;const client={signInWithPassword:async(email,password)=>{assert.equal(email,'member@example.invalid');assert.equal(password,'ui-only-password');return activeSession();}};
 installAuth({getCloud:()=>client,getSession:()=>session,namespace:'test',commitSession:async data=>{session=data;saved.set('session',JSON.stringify(data));},onSignedIn:()=>signIns++});element('#email').value='MEMBER@example.invalid';element('#login-password').value='ui-only-password';await element('#login-form').onsubmit({preventDefault(){}});
 assert.equal(signIns,1);assert.equal(element('#login-password').value,'');assert.equal(element('#signed-out').hidden,true);assert.equal(element('#signed-in').hidden,false);assert.equal(saved.get('test-email'),'member@example.invalid');assert.equal(JSON.stringify([...saved]).includes('ui-only-password'),false);
});
test('email button cooldown prevents repeat sends and a wrong password preserves the local session state',async t=>{
 const {element,saved}=uiEnvironment(t);let sends=0;const client={signIn:async()=>{sends++;},signInWithPassword:async()=>{throw Object.assign(Error('Invalid login credentials'),{code:'invalid_credentials'});}};
 installAuth({getCloud:()=>client,getSession:()=>null,namespace:'test',commitSession:()=>assert.fail('must not save'),onSignedIn:()=>assert.fail('must not sign in')});element('#email').value='member@example.invalid';await element('#send-link').onclick();await element('#send-link').onclick();assert.equal(sends,1);assert.equal(element('#send-link').disabled,true);assert.ok(saved.get('test-email-next'));element('#login-password').value='wrong-password';await element('#login-form').onsubmit({preventDefault(){}});assert.match(element('#auth-message').textContent,/邮箱或密码不正确/);assert.equal(element('#login-password').value,'');
});
test('setting a password validates confirmation and clears all secret fields after success',async t=>{
 const {element,saved}=uiEnvironment(t);let updates=0;const client={updatePassword:async(password,current)=>{updates++;assert.equal(password,'new-ui-test-password');assert.equal(current,'current-ui-test-password');}};
 installAuth({getCloud:()=>client,getSession:()=>activeSession(),namespace:'test',commitSession:()=>{},onSignedIn:()=>{}});
 element('#new-password').value='new-ui-test-password';element('#confirm-password').value='mismatch';await element('#set-password-form').onsubmit({preventDefault(){}});assert.equal(updates,0);assert.match(element('#auth-message').textContent,/不一致/);
 element('#confirm-password').value='new-ui-test-password';element('#current-password').value='current-ui-test-password';await element('#set-password-form').onsubmit({preventDefault(){}});assert.equal(updates,1);for(const id of ['#new-password','#confirm-password','#current-password'])assert.equal(element(id).value,'');assert.equal(element('#password-settings').open,false);assert.match(element('#auth-message').textContent,/密码已设置/);assert.equal(JSON.stringify([...saved]).includes('new-ui-test-password'),false);
});
