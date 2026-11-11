import {FAVORITE_LIMITS,decodeCSV,parseCSV} from './favorites-core.js';
const view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
export function zipDirectory(bytes){
 if(bytes.length>FAVORITE_LIMITS.zip)throw Error('ZIP不能超过10MiB。');const v=view(bytes);let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50&&i+22+v.getUint16(i+20,true)===bytes.length){end=i;break;}
 if(end<0)throw Error('ZIP目录损坏或不是有效ZIP。');const count=v.getUint16(end+10,true),start=v.getUint32(end+16,true),size=v.getUint32(end+12,true);
 if(v.getUint16(end+4,true)||v.getUint16(end+6,true)||v.getUint16(end+8,true)!==count||count>FAVORITE_LIMITS.entries||start+size>end)throw Error('不支持多卷、ZIP64或超过100个文件的压缩包。');
 let at=start,total=0;const entries=[],names=new Set();
 for(let n=0;n<count;n++){if(at+46>end||v.getUint32(at,true)!==0x02014b50)throw Error('ZIP目录损坏。');const flags=v.getUint16(at+8,true),method=v.getUint16(at+10,true),compressed=v.getUint32(at+20,true),expanded=v.getUint32(at+24,true),len=v.getUint16(at+28,true),extra=v.getUint16(at+30,true),comment=v.getUint16(at+32,true),offset=v.getUint32(at+42,true);if(at+46+len+extra+comment>start+size)throw Error('ZIP文件名损坏。');
  const raw=bytes.slice(at+46,at+46+len);let name;try{name=new TextDecoder('utf-8',{fatal:true}).decode(raw);}catch{throw Error('ZIP文件名不是UTF-8，请单独上传CSV。');}name=name.replace(/\\/g,'/');
  if(name.startsWith('/')||name.split('/').some(p=>p==='..')||/^[a-z]:/i.test(name)||name.includes('\0')||names.has(name)||flags&1||![0,8].includes(method)||compressed===0xffffffff||expanded===0xffffffff)throw Error('ZIP包含不安全路径、重复文件、加密或不支持的格式。');names.add(name);total+=expanded;if(total>FAVORITE_LIMITS.expanded)throw Error('解压总量不能超过20MiB。');
  if(/\.csv$/i.test(name)){if(expanded>FAVORITE_LIMITS.csv)throw Error('单个CSV不能超过2MiB。');entries.push({name,size:expanded,compressed,method,offset,crc:v.getUint32(at+16,true),flags});}at+=46+len+extra+comment;
 }
 if(at!==start+size)throw Error('ZIP目录长度不正确。');if(!entries.length)throw Error('ZIP中没有CSV清单。');return entries;
}
export function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
export async function unzipCSV(bytes,entry){
 const v=view(bytes),at=entry.offset;if(at+30>bytes.length||v.getUint32(at,true)!==0x04034b50||v.getUint16(at+8,true)!==entry.method||v.getUint16(at+6,true)&1)throw Error('ZIP本地文件头损坏。');const nameLen=v.getUint16(at+26,true),extra=v.getUint16(at+28,true),start=at+30+nameLen+extra;if(start+entry.compressed>bytes.length)throw Error('ZIP文件内容不完整。');
 let localName;try{localName=new TextDecoder('utf-8',{fatal:true}).decode(bytes.slice(at+30,at+30+nameLen)).replace(/\\/g,'/');}catch{throw Error('ZIP本地文件名损坏。');}if(localName!==entry.name)throw Error('ZIP本地文件名与目录不一致。');
 let data=bytes.slice(start,start+entry.compressed);
 if(entry.method===8){let stream;try{stream=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));}catch{throw Error('此浏览器不支持ZIP解压，请上传已解压的CSV。');}const reader=stream.getReader(),parts=[];let size=0;try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>entry.size||size>FAVORITE_LIMITS.csv){await reader.cancel();throw Error('ZIP解压大小超出声明。');}parts.push(r.value);}}catch(e){await reader.cancel().catch(()=>{});throw Error('ZIP解压失败：'+e.message);}data=new Uint8Array(size);let pos=0;for(const p of parts){data.set(p,pos);pos+=p.length;}}
 if(data.length!==entry.size||crc32(data)!==entry.crc)throw Error('CSV大小或CRC校验失败。');return data;
}
export async function openTakeout(file){
 if(!file||file.size>FAVORITE_LIMITS.zip)throw Error('文件过大，ZIP最多10MiB、CSV最多2MiB。');const bytes=new Uint8Array(await file.arrayBuffer());
 if(/\.zip$/i.test(file.name)){const entries=zipDirectory(bytes);return {entries,read:entry=>unzipCSV(bytes,entry)};}
 if(!/\.csv$/i.test(file.name)||bytes.length>FAVORITE_LIMITS.csv)throw Error('请上传ZIP或2MiB以内的CSV。');return {entries:[{name:file.name,size:bytes.length}],read:async()=>bytes};
}
export function readTakeoutCSV(bytes,encoding='auto'){const d=decodeCSV(bytes,encoding);return {...parseCSV(d.text),encoding:d.encoding};}
