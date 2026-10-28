import {percentage} from './data.js';import {reconcile,setText} from './market-client.js';
export function treemapLayout(items,x=0,y=0,width=100,height=100,aspect=1){
 const list=items.filter(s=>Number.isFinite(s.marketCap)&&s.marketCap>0).sort((a,b)=>b.marketCap-a.marketCap||a.id.localeCompare(b.id));
 function split(nodes,x,y,w,h){if(!nodes.length)return [];if(nodes.length===1)return [{...nodes[0],x,y,w,h}];const total=nodes.reduce((n,s)=>n+s.marketCap,0);let sum=0,cut=0;while(cut<nodes.length-1&&sum<total/2){sum+=nodes[cut++].marketCap;}const ratio=sum/total;return w*aspect>=h?[...split(nodes.slice(0,cut),x,y,w*ratio,h),...split(nodes.slice(cut),x+w*ratio,y,w*(1-ratio),h)]:[...split(nodes.slice(0,cut),x,y,w,h*ratio),...split(nodes.slice(cut),x,y+h*ratio,w,h*(1-ratio))];}
 return split(list,x,y,width,height);
}
export function renderTreemap(parent,items,onSelect,stock=false){
 reconcile(parent,treemapLayout(items),s=>s.id,()=>{const b=document.createElement('button');b.className='map-tile';b.innerHTML='<strong></strong><span></span>';b.addEventListener('click',()=>onSelect(b.dataset.key));return b;},(b,s)=>{
  b.style.left=s.x+'%';b.style.top=s.y+'%';b.style.width=s.w+'%';b.style.height=s.h+'%';
  const level=Math.min(5,Math.max(1,Math.ceil(Math.abs(s.changePct))));b.className='map-tile '+(s.changePct>0?'positive':s.changePct<0?'negative-tile':'neutral')+' level-'+level;
  if(s.w*s.h<140)b.classList.add('small-tile');setText(b.querySelector('strong'),s.name);setText(b.querySelector('span'),percentage(s.changePct));b.setAttribute('aria-label',s.name+' '+percentage(s.changePct)+(stock?' 종목 상세로 이동':' 섹터 종목 히트맵 열기'));b.title=s.name+' · '+percentage(s.changePct);
 });
}
