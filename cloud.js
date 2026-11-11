function timeoutSignal(ms){const controller=new AbortController();setTimeout(()=>controller.abort(),ms);return controller.signal;}
export class Cloud{
 constructor(config,session,onSession){this.config=config;this.session=session;this.onSession=onSession;}
 async request(action,body={},authenticated=true){
  const token=this.session?.token;
  if(authenticated&&(!token||this.session.expiresAt<=Date.now())){this.setSession(null);throw Object.assign(Error('locked'),{code:'locked',status:401});}
  const response=await fetch(this.config.url+'/functions/v1/shared-trip',{
   method:'POST',headers:{'Content-Type':'application/json',apikey:this.config.key,...(authenticated?{'X-Trip-Session':token}:{}),...(action==='apply_batch'||action.startsWith('favorites_')?{'X-Trip-Batch':'1'}:{})},
   body:JSON.stringify({action,...body}),signal:typeof AbortSignal.timeout==='function'?AbortSignal.timeout(15000):timeoutSignal(15000)
  });
  const data=await response.json().catch(()=>({error:'temporarily_unavailable'}));
  if(!response.ok){if(authenticated&&['locked','not_configured'].includes(data.error)&&this.session?.token===token)this.setSession(null);throw Object.assign(Error(data.error||'temporarily_unavailable'),{code:data.error,status:response.status,retryAfter:Number(response.headers.get('Retry-After'))||data.retryAfter||0});}
  return data;
 }
 setSession(value){this.session=value?{token:value.token,expiresAt:value.expiresAt}:null;this.onSession(this.session);}
 status(){return this.request('status',{},false);}
 async unlock(password){return (await this.request('unlock',{password},false)).session;}
 async setup(setupToken,password){return (await this.request('setup',{setupToken,password},false)).session;}
 async rotate(currentPassword,password){return (await this.request('rotate',{currentPassword,password})).session;}
 check(){return this.request('check');}
 lock(){return this.request('lock');}
 async rows(){const data=await this.request('rows');return data.rows.map(r=>({...r.payload,id:r.id,version:r.version}));}
 async apply(op){if(op.entries){const data=await this.request('apply_batch',{entries:op.entries.map(e=>({item:e.item,expected:e.baseVersion})),operation:op.id});return {...data,rows:(data.rows||[]).map(r=>({...r.payload,id:r.id,version:r.version}))};}const data=await this.request('apply',{item:op.item,expected:op.baseVersion,operation:op.id});return {...data,row:data.row?{...data.row.payload,id:data.row.id,version:data.row.version}:null};}
 async history(){const data=await this.request('history');return data.revisions.map(r=>({id:r.id,item:{...r.payload,id:r.item_id},at:r.created_at,version:r.version,action:r.payload.deleted?'删除':'保存',cloud:true}));}
}
