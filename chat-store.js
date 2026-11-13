import {CHAT_LIMITS} from './chat-core.js';
// Separate device-only database: no shared session, sync queue or cloud upload.
export class ChatStore{
 async db(){if(!this.opening)this.opening=new Promise((resolve,reject)=>{const r=indexedDB.open('osaka-ai-conversations-v2',1);r.onupgradeneeded=()=>r.result.createObjectStore('conversations',{keyPath:'id'});r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();this.opening=null;};resolve(r.result);};r.onerror=()=>reject(Error('无法保存本机聊天；本次不会调用AI。'));});return this.opening;}
 async list(){const db=await this.db();return new Promise((resolve,reject)=>{const tx=db.transaction('conversations'),r=tx.objectStore('conversations').getAll();tx.oncomplete=()=>resolve(r.result.sort((a,b)=>b.updated-a.updated));tx.onerror=()=>reject(tx.error);});}
 async change(id,mutate,{create=false}={}){const db=await this.db();return new Promise((resolve,reject)=>{const tx=db.transaction('conversations','readwrite'),store=tx.objectStore('conversations'),r=store.get(id);let result;r.onsuccess=()=>{if(!r.result&&!create)return;try{result=mutate(r.result);if(result===null)store.delete(id);else if(result)store.put(result);}catch(e){reject(e);tx.abort();}};tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>reject(tx.error||Error('本机聊天保存失败'));});}
 async create(){if((await this.list()).length>=CHAT_LIMITS.conversations)throw Error('本机最多30个聊天，请先删除不需要的旧聊天。');const id=crypto.randomUUID();return this.change(id,()=>({id,title:'新聊天',updated:Date.now(),messages:[],input:'',task:'ask',days:[]}),{create:true});}
 async update(id,patch){return this.change(id,c=>({...c,...patch,updated:Date.now()}));}
 async append(id,rows){return this.change(id,c=>{if(c.messages.length+rows.length>CHAT_LIMITS.messages)throw Error('本聊天已达200条消息，请新建聊天。');return {...c,messages:[...c.messages,...rows],updated:Date.now()};});}
 async message(id,messageId,patch){return this.change(id,c=>({...c,messages:c.messages.map(m=>m.id===messageId?{...m,...patch}:m),updated:Date.now()}));}
 async remove(id){return this.change(id,()=>null);}
}
