import {TRIP} from './core.js';
export class Cloud{
 constructor(config,session,onSession){this.config=config;this.session=session;this.onSession=onSession;}
 async request(path,{method='GET',body,auth=true,retry=true}={}){
  if(auth&&this.session&&this.session.expires_at*1000<Date.now()+30000)await this.refresh();
  const response=await fetch(this.config.url+path,{method,headers:{apikey:this.config.key,'Content-Type':'application/json',...(auth&&this.session?{Authorization:'Bearer '+this.session.access_token}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});
  const data=await response.json().catch(()=>null);
  if(response.status===401&&auth&&retry&&this.session?.refresh_token){await this.refresh();return this.request(path,{method,body,auth,retry:false});}
  if(!response.ok){const error=Error(data?.msg||data?.message||data?.error_description||`连接失败 (${response.status})`);error.status=response.status;error.code=data?.code||data?.error_code;error.retryAfter=Number(response.headers.get('Retry-After'))||0;throw error;}
  return data;
 }
 async refresh(){if(this.refreshPromise)return this.refreshPromise;this.refreshPromise=(async()=>{try{const data=await this.request('/auth/v1/token?grant_type=refresh_token',{method:'POST',auth:false,body:{refresh_token:this.session.refresh_token}});this.setSession(data);}catch(error){if([400,401].includes(error.status)){this.session=null;this.onSession(null);}throw error;}finally{this.refreshPromise=null;}})();return this.refreshPromise;}
 setSession(data){this.session={...data,expires_at:data.expires_at||Math.floor(Date.now()/1000)+data.expires_in};this.onSession(this.session);}
 async signIn(email){return this.request('/auth/v1/otp?redirect_to='+encodeURIComponent(location.origin+location.pathname),{method:'POST',auth:false,body:{email,create_user:true}});}
 async signInWithPassword(email,password){
  const data=await this.request('/auth/v1/token?grant_type=password',{method:'POST',auth:false,body:{email,password}});
  const candidate=new Cloud(this.config,data,()=>{});
  const members=await candidate.members();
  if(!members.length){const error=Error('当前邮箱尚未加入旅行成员名单，请联系项目管理员。');error.code='not_a_member';throw error;}
  return data;
 }
 async updatePassword(password,currentPassword=''){const body={password};if(currentPassword)body.current_password=currentPassword;const data=await this.request('/auth/v1/user',{method:'PUT',body});this.setSession({...this.session,user:data.user||data});}
 async user(){return this.request('/auth/v1/user');}
 async members(){return this.request(`/rest/v1/trip_members?trip_id=eq.${TRIP}&select=email`);}
 async rows(){const rows=await this.request(`/rest/v1/trip_items?trip_id=eq.${TRIP}&select=id,payload,version&order=id&limit=1000`);return rows.map(r=>({...r.payload,id:r.id,version:r.version}));}
 async apply(op){const data=await this.request('/rest/v1/rpc/apply_trip_change',{method:'POST',body:{p_trip:TRIP,p_id:op.item.id,p_payload:op.item,p_expected:op.baseVersion,p_operation:op.id}});return {...data,row:data.row?{...data.row.payload,id:data.row.id,version:data.row.version}:null};}
 async history(){const rows=await this.request(`/rest/v1/trip_revisions?trip_id=eq.${TRIP}&select=id,item_id,payload,version,created_at,actor&order=created_at.desc&limit=100`);return rows.map(r=>({id:r.id,item:{...r.payload,id:r.item_id},at:r.created_at,actor:r.actor,version:r.version,action:r.payload.deleted?'删除':'保存',cloud:true}));}
}
