import test from 'node:test';
import assert from 'node:assert/strict';
import {queueFavoriteDays,queueFavoriteEdit,visibleFavoriteLinks,visibleFavorites} from '../favorites-core.js';
import {favoriteToItem} from '../favorites-days-ui.js';
import {enqueue,visibleItems,emptyState} from '../core.js';
import {Cloud} from '../cloud.js';
test('offline date links coalesce independently from place master and exclude conflicted proposals',()=>{
 const s={places:[{id:'p',version:3,place_type:'其他',region:'待确认地区',archived:false}],links:[{place_id:'p',day:'2027-01-11',active:true}],queue:[]};
 queueFavoriteDays(s,'p',['2027-01-11','2027-01-13']);queueFavoriteDays(s,'p',['2027-01-13']);assert.equal(s.queue.length,1);assert.equal(s.queue[0].expected,3);assert.equal(s.places.length,1);assert.deepEqual(visibleFavoriteLinks(s).map(l=>l.day),['2027-01-13']);assert.equal(visibleFavorites(s)[0].place_type,'其他');assert.throws(()=>queueFavoriteEdit(s,'p',{region:'地区',type:'其他',user_note:'',archived:false}));s.queue[0].conflict=true;assert.deepEqual(visibleFavoriteLinks(s),s.links);assert.throws(()=>queueFavoriteDays(s,'p',[]));
});
test('date association rejects invalid/duplicate dates and archived places',()=>{
 const s={places:[{id:'p',version:1,archived:false}],queue:[]};for(const days of [['2028-01-11'],['2027-01-11','2027-01-11'],['2027-01-18']])assert.throws(()=>queueFavoriteDays(s,'p',days));s.places[0].archived=true;assert.throws(()=>queueFavoriteDays(s,'p',['2027-01-11']));queueFavoriteDays(s,'p',[]);
});
test('promotion creates separate formal payload with stable per-day ID and provenance, only when caller enqueues it',()=>{
 const p={id:'00000000-0000-4000-8000-000000000000',source_name:'Synthetic',original_url:'https://maps.app.goo.gl/synthetic',user_note:'private note'},s=emptyState();
 const args={day:'2027-01-13',time:'12:30',title:'Synthetic lunch',category:'food',notes:p.user_note};const item=favoriteToItem(p,args);assert.equal(visibleItems(s).length,0);assert.equal(item.status,'pending');assert.ok(item.notes.includes(p.original_url));assert.ok(item.notes.includes(p.id));assert.equal(item.id,favoriteToItem(p,args).id);assert.notEqual(item.id,favoriteToItem(p,{...args,day:'2027-01-11'}).id);assert.throws(()=>favoriteToItem(p,{...args,time:''}));enqueue(s,item);assert.equal(visibleItems(s).length,1);assert.equal(p.user_note,'private note');
});
test('queued date kind cannot override authenticated favorites HTTP action',async()=>{
 const saved=globalThis.fetch;let sent;
 try{globalThis.fetch=async(_url,options)=>{sent=JSON.parse(options.body);assert.ok(options.headers['X-Trip-Session']);return new Response('{}',{status:200});};const cloud=new Cloud({url:'https://synthetic.invalid',key:'public-only'},{token:'a'.repeat(64),expiresAt:Date.now()+60000},()=>{});await cloud.request('favorites_link_days',{kind:'link_days',days:['2027-01-13']});assert.equal(sent.action,'favorites_link_days');assert.equal(sent.kind,'link_days');}finally{globalThis.fetch=saved;}
});
