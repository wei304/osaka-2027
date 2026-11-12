// Presentation only: move existing nodes; keep their IDs, handlers and data models.
export const SECTIONS=['favorites','days','review','maps','ledger','preparation','resources','tickets','tools','ai','routes','sharing','essentials','history','settings','departure'];
export function installNavigation(){
 const $=s=>document.querySelector(s),menu=$('#all-sections');
 const buttons=new Map([...menu.querySelectorAll('[data-tab]')].map(b=>[b.dataset.tab,b]));
 const group=(title,names,folded=false)=>{const node=document.createElement(folded?'details':'section');node.className='menu-group';const heading=document.createElement(folded?'summary':'h3');heading.textContent=title;node.append(heading);const grid=document.createElement('div');grid.className='menu-grid';for(const name of names)grid.append(buttons.get(name));node.append(grid);return node;};
 const departure=document.createElement('section');departure.id='departure';departure.hidden=true;
 departure.innerHTML='<div class="section-title"><h2>出发前待办</h2></div><p class="hint">准备完成、安排确认与订单核实分别记录，互不替代。</p>';
 const readiness=$('#departure-checks').closest('article');
 for(const [id,title,node] of [['readiness-group','检查总览 · 预约、时间、离线与同步',readiness],['preparation-group','准备清单',$('#preparation')],['review-group','待确认安排与日期风险',$('#review')]]){const d=document.createElement('details');d.id=id;d.className='panel departure-group';d.innerHTML='<summary></summary>';d.firstChild.textContent=title;node.hidden=false;d.append(node);departure.append(d);}
 $('#app-main').append(departure);
 const todo=document.createElement('button');todo.type='button';todo.dataset.tab='departure';todo.textContent='出发前待办';buttons.set('departure',todo);
 buttons.get('tools').textContent='日语与旅行工具';buttons.get('routes').textContent='核实路线与时段比较';buttons.get('maps').textContent='完整地图路线';buttons.get('sharing').textContent='只读行程分享';
 menu.replaceChildren(group('常用',['days','tickets','favorites','ledger','ai']),group('随身资料',['resources','essentials','tools','departure']),group('高级工具',['maps','routes','preparation','review'],true),group('分享',['sharing'],true),group('记录与设置',['history','settings'],true));
 // Keep old tab buttons accessible under More, but avoid repeating them on the home page.
 $('#open-menu').textContent='更多';
 const bottom=$('#mobile-nav'),icons=new Map([...bottom.querySelectorAll('[data-main-tab]')].map(b=>[b.dataset.mainTab,b.querySelector('svg').cloneNode(true)]));for(const [old,name,label] of [['resources','tickets','票券'],['ledger','favorites','收藏'],['ai','ledger','费用'],['more','ai','AI']]){const b=bottom.querySelector('[data-main-tab="'+old+'"]');b.dataset.mainTab=name;b.querySelector('span').textContent=label;}
 bottom.querySelector('[data-main-tab=ledger] svg').replaceWith(icons.get('ledger'));bottom.querySelector('[data-main-tab=ai] svg').replaceWith(icons.get('ai'));
 bottom.querySelector('[data-main-tab=favorites] svg').outerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg>';
 // The original five slots now follow the daily-use order. More remains in the top bar.
 const secondary=document.createElement('button');secondary.type='button';secondary.id='daily-map';secondary.textContent='当天地图路线 ↗';secondary.dataset.openTab='maps';$('#itinerary-controls .itinerary-controls-body').prepend(secondary);
 for(const name of ['favorites','resources','tickets']){const nav=document.createElement('nav');nav.className='collection-nav';nav.setAttribute('aria-label','收藏与资料分类');for(const [target,label] of [['favorites','地图地点'],['resources','参考资料'],['tickets','票券附件']]){const b=document.createElement('button');b.type='button';b.dataset.openTab=target;b.textContent=label;b.setAttribute('aria-current',String(target===name));nav.append(b);}$('#'+name).prepend(nav);}
 $('#resources .quick-section')?.remove();
 const shortcuts=$('#travel-shortcuts');shortcuts.querySelector('[data-open-tab=tickets]').hidden=true;const cards=[...shortcuts.querySelectorAll('[data-jump=emergency-section]')];cards[0].textContent='住宿与紧急卡';cards.slice(1).forEach(b=>b.hidden=true);
 const select=name=>{if(!SECTIONS.includes(name))return false;const todo=['departure','preparation','review'].includes(name);for(const id of SECTIONS)$('#'+id).hidden=todo?!['departure','preparation','review'].includes(id):id!==name;if(todo){const id=name==='departure'?'readiness-group':name+'-group';$('#'+id).open=true;}return true;};
 return {select};
}
