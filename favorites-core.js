export const FAVORITE_TYPES=['餐厅','咖啡厅 / 甜品','景点','购物','娱乐体验','交通','其他'];
export const FAVORITE_REGIONS=['难波 / 心斋桥','道顿堀 / 日本桥','梅田 / 大阪站','天王寺 / 阿倍野','大阪湾 / 天保山','环球影城周边','京都','奈良','其他地区','待确认地区'];
export const FAVORITE_LIMITS={zip:10485760,csv:2097152,expanded:20971520,entries:100,rows:1000};
export function placeKey(raw){
 if(typeof raw!=='string'||raw.length>8192)throw Error('地图链接过长或格式不正确。');
 const original=raw.trim();let u;try{u=new URL(original);}catch{throw Error('缺少有效的 Google Maps 链接。');}
 if(u.protocol!=='https:'||u.username||u.password||u.port||!['www.google.com','google.com','maps.google.com','maps.app.goo.gl','www.google.co.jp','google.co.jp'].includes(u.hostname)||(!u.hostname.startsWith('maps.')&&!u.pathname.startsWith('/maps')))throw Error('只接受 HTTPS Google Maps 链接。');
 const fid=original.split('#')[0].match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i)?.[1];
 return fid?'google:fid:'+fid.toLowerCase():'google:url:'+original.split('#')[0];
}
const text=(value,max,label)=>{if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw Error(label+'格式不正确或过长。');return value;};
export function normalizeFavoriteRow(row){
 if(!row||typeof row!=='object'||Array.isArray(row))throw Error('地点记录格式不正确。');
 const name=text(row.name,300,'地点名称').trim(),url=text(row.url,8192,'地图链接').trim();if(!name)throw Error('地点名称不能为空。');
 return {name,url,key:placeKey(url),note:text(row.note??'',4000,'来源备注'),labels:text(row.labels??'',1000,'来源标签'),comment:text(row.comment??'',2000,'来源评论')};
}
export function validateFavoriteEdit(raw){
 if(!raw||typeof raw!=='object')throw Error('收藏编辑格式不正确。');
 const region=text(raw.region??'待确认地区',80,'地区').trim()||'待确认地区',type=text(raw.type??'其他',30,'地点类型');
 if(!FAVORITE_TYPES.includes(type))throw Error('请选择有效地点类型。');
 return {region,type,user_note:text(raw.user_note??'',4000,'用户备注'),archived:raw.archived===true};
}
export function parseCSV(textValue){
 if(textValue.length>FAVORITE_LIMITS.csv||textValue.includes('\0'))throw Error('CSV过大，或编码不正确。');
 let delimiter=',';const first=textValue.split(/\r?\n/)[0];if(!first.includes(',')&&first.includes('\t'))delimiter='\t';else if(!first.includes(',')&&first.includes(';'))delimiter=';';
 const rows=[];let row=[],field='',quoted=false,closed=false;
 for(let i=0;i<textValue.length;i++){const c=textValue[i];if(quoted){if(c==='"'){if(textValue[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
  if(c==='"'){if(field||closed)throw Error('CSV引号格式不正确。');quoted=true;}
  else if(c===delimiter){row.push(field);field='';closed=false;}
  else if(c==='\n'||c==='\r'){if(c==='\r'&&textValue[i+1]==='\n')i++;row.push(field);rows.push(row);row=[];field='';closed=false;}
  else{if(closed&&!/\s/.test(c))throw Error('CSV引号后存在意外字符。');if(!closed)field+=c;}
 }
 if(quoted)throw Error('CSV包含未闭合引号。');if(field||row.length){row.push(field);rows.push(row);}if(rows.length>FAVORITE_LIMITS.rows+20)throw Error('单次清单最多1000个地点。');
 const header=rows.shift()?.map(h=>h.replace(/^\ufeff/,'').trim().toLowerCase())||[];
 const columns={name:['标题','名称','title','name'],note:['记事','备注','note','notes'],url:['网址','链接','url','google maps url'],labels:['标签','labels','tags'],comment:['评论','comment','comments']};
 const indexes={};for(const [k,aliases]of Object.entries(columns)){const found=header.map((h,n)=>aliases.includes(h)?n:-1).filter(n=>n>=0);if(found.length>1)throw Error('同一字段出现多个列，请核对列名。');indexes[k]=found[0]??-1;}if(indexes.name<0||indexes.url<0)throw Error('找不到名称和网址列，请检查CSV列名。');
 const records=[],errors=[],duplicates=[],seen=new Map();let total=0,blank=0;
 for(const [n,r]of rows.entries()){if(r.every(v=>!v.trim())){blank++;continue;}total++;try{if(r.length!==header.length)throw Error('列数与表头不同。');const raw=Object.fromEntries(Object.keys(columns).map(k=>[k,indexes[k]<0?'':r[indexes[k]]]));const item=normalizeFavoriteRow(raw);if(seen.has(item.key)){duplicates.push({row:n+2,name:item.name});if(JSON.stringify(seen.get(item.key))!==JSON.stringify(item))throw Error('同一地点标识对应不同来源内容，请先核对重复记录。');}else{seen.set(item.key,item);records.push(item);}}catch(e){errors.push({row:n+2,message:e.message});}}
 if(total>FAVORITE_LIMITS.rows)throw Error('单次清单最多1000个地点。');return {header,indexes,total,blank,records,errors,duplicates};
}
export function decodeCSV(bytes,encoding='auto'){
 let selected=encoding;if(selected==='auto'){if(bytes[0]===255&&bytes[1]===254)selected='utf-16le';else if(bytes[0]===254&&bytes[1]===255)selected='utf-16be';else selected='utf-8';}
 if(!['utf-8','utf-16le','utf-16be','gb18030','shift_jis'].includes(selected))throw Error('不支持的编码。');
 try{return {text:new TextDecoder(selected,{fatal:true}).decode(bytes),encoding:selected};}catch{throw Error('无法可靠识别编码，请选择编码并查看预览。');}
}
export function visibleFavorites(state){const map=new Map((state.places||[]).map(p=>[p.id,p]));for(const op of state.queue||[])if(!op.conflict&&map.has(op.id))map.set(op.id,{...map.get(op.id),...(op.patch?{...op.patch,place_type:op.patch.type}:{}),pending:true});return [...map.values()];}
export function queueFavoriteEdit(state,id,patch){const row=state.places.find(p=>p.id===id);if(!row)throw Error('请先同步此收藏。');const prior=state.queue.find(q=>q.id===id);if(prior?.conflict)throw Error('此地点有冲突，请先比较版本。');if(prior?.kind==='link_days')throw Error('请先同步此地点的日期关联，再编辑分类。');const op={operation:crypto.randomUUID(),id,expected:row.version,patch:validateFavoriteEdit(patch)};if(prior)state.queue.splice(state.queue.indexOf(prior),1,op);else state.queue.push(op);return op;}
export function visibleFavoriteLinks(state){let links=[...(state.links||[])];for(const q of state.queue||[])if(q.kind==='link_days'&&!q.conflict){links=links.filter(l=>l.place_id!==q.id);links.push(...q.days.map(day=>({place_id:q.id,day,active:true,pending:true})));}return links;}
export function queueFavoriteDays(state,id,days){const row=state.places.find(p=>p.id===id),prior=state.queue.find(q=>q.id===id);if(!row)throw Error('请先同步此收藏。');if(prior&&(prior.conflict||prior.kind!=='link_days'))throw Error('请先同步此地点的分类修改或处理冲突。');if(!Array.isArray(days)||days.length>9||new Set(days).size!==days.length||days.some(d=>!/^2027-01-(09|1[0-7])$/.test(d)))throw Error('请选择旅行日期。');if(row.archived&&days.length)throw Error('请先取消归档再关联日期。');const op={operation:crypto.randomUUID(),kind:'link_days',id,expected:row.version,days:[...days].sort()};if(prior)state.queue.splice(state.queue.indexOf(prior),1,op);else state.queue.push(op);return op;}
