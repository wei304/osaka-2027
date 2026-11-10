export const TRIP='osaka-2027';
export const DAYS=[['09','六','出发准备'],['10','日','泉佐野 · 新世界'],['11','一','难波 · 心斋桥'],['12','二','环球影城'],['13','三','京都散策'],['14','四','琵琶湖滑雪'],['15','五','胜尾寺 · 大阪湾'],['16','六','梅田购物'],['17','日','返程']].map(([day,week,title])=>({date:`2027-01-${day}`,day,week,title}));
export const CATEGORIES={spot:'景点',food:'餐饮',shopping:'购物',transport:'交通',stay:'住宿',note:'备忘'};
export const STATUSES={pending:'待确认',confirmed:'已确认',booked:'已预订'};
export const uuid=()=>crypto.randomUUID?crypto.randomUUID():([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>(Number(c)^crypto.getRandomValues(new Uint8Array(1))[0]&15>>Number(c)/4).toString(16));
export function emptyState(){return {schema:1,items:[],queue:[],history:[]};}
export function validateItem(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('安排格式不正确');
  const text=(key,max)=>{if(raw[key]!=null&&typeof raw[key]!=='string')throw Error('文字字段格式不正确');return (raw[key]||'').trim().slice(0,max);};
  const day=text('day',10),title=text('title',160),id=text('id',100)||uuid();
  if(!title||!DAYS.some(d=>d.date===day))throw Error('每条安排需要名称与 1 月 9–17 日内的日期');
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw Error('安排编号格式不正确');
  const time=text('time',5);if(time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error('时间格式不正确');
  return {id,day,title,ja:text('ja',160),time,category:CATEGORIES[raw.category]?raw.category:'note',status:STATUSES[raw.status]?raw.status:'pending',notes:text('notes',6000),order:Number.isFinite(raw.order)?raw.order:999,deleted:raw.deleted===true};
}
export function visibleItems(state){const map=new Map(state.items.map(i=>[i.id,i]));for(const op of state.queue)for(const entry of op.entries||[{item:op.item,baseVersion:op.baseVersion}])map.set(entry.item.id,{...entry.item,version:entry.baseVersion});return [...map.values()].filter(i=>!i.deleted);}
export function enqueue(state,raw,inflight=null){const item=validateItem(raw);const before=visibleItems(state).find(i=>i.id===item.id);const base=state.items.find(i=>i.id===item.id);let prior=null;for(const q of [...state.queue].reverse()){if(q.entries?.some(e=>e.item.id===item.id))break;if(q.item.id===item.id&&q.id!==inflight&&!q.conflict){prior=q;break;}}const op={id:uuid(),item,baseVersion:base?.version||0,before:before?validateItem(before):{...item,deleted:true},createdAt:new Date().toISOString()};if(prior){op.baseVersion=prior.baseVersion;op.before=prior.before||op.before;state.queue.splice(state.queue.indexOf(prior),1,op);}else state.queue.push(op);state.history.unshift({id:uuid(),item,at:op.createdAt,actor:'本机',action:item.deleted?'删除':'保存'});return op;}

export function acceptResult(state,op,remote){mergeRemote(state,[remote]);state.queue=state.queue.filter(q=>q.id!==op.id);for(const next of state.queue.filter(q=>q.item.id===remote.id&&!q.conflict))next.baseVersion=remote.version;}
export function mergeRemote(state,rows){const map=new Map(state.items.map(i=>[i.id,i]));for(const row of rows){const old=map.get(row.id);if(!old||old.version<=row.version)map.set(row.id,row);}state.items=[...map.values()];}
export function enqueueBatch(state,raw,options={}){const items=raw.map(validateItem);if(!items.length||items.length>50||new Set(items.map(i=>i.id)).size!==items.length)throw Error('一次批量操作需包含1至50条不同安排。');if(state.queue.some(q=>(q.entries||[{item:q.item}]).some(e=>items.some(i=>i.id===e.item.id))))throw Error('相关安排还有待同步修改，请先同步再排序或撤销。');const before=items.map(i=>{const old=state.items.find(x=>x.id===i.id);return old?validateItem(old):{...i,deleted:true};}),entries=items.map(item=>({item,baseVersion:options.versions?.[item.id]??state.items.find(i=>i.id===item.id)?.version??0}));const op={id:uuid(),item:items[0],entries,before,noUndo:options.noUndo===true,createdAt:new Date().toISOString()};state.queue.push(op);for(const i of items)state.history.unshift({id:uuid(),item:i,at:op.createdAt,actor:'本机',action:options.noUndo?'撤销':'批量保存'});return op;}
export function acceptBatchResult(state,op,rows){mergeRemote(state,rows);state.queue=state.queue.filter(q=>q.id!==op.id);for(const q of state.queue)for(const row of rows){if(q.entries){for(const e of q.entries)if(e.item.id===row.id)e.baseVersion=row.version;}else if(q.item.id===row.id)q.baseVersion=row.version;}}
