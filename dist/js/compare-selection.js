import {validWatchKey} from './watchlist.js';
import {escapeHtml as esc} from './components.js';
import {parseComparisonSymbols} from './comparison-model.js';
const storageKey='moa-comparison-work-v1';
const valid=key=>{try{return validWatchKey(key)&&parseComparisonSymbols(key).length===1;}catch{return false;}};
export function cleanCompareItems(input){return [...new Map((Array.isArray(input)?input:[]).filter(x=>valid(x?.key)).map(x=>[x.key,{key:x.key,market:x.key.slice(0,2),ticker:x.key.slice(3),name:String(x.name||x.key.slice(3)).slice(0,120)}])).values()].slice(0,4);}
export function mountCompareSelection({navigate,notify=()=>{}}){
 const abort=new AbortController();let items=[];
 try{items=cleanCompareItems(JSON.parse(sessionStorage.getItem(storageKey)||'[]'));}catch{}
 const root=document.createElement('aside');root.className='compare-selection';root.setAttribute('aria-label','기업 비교 대상');document.body.append(root);
 function save(){try{sessionStorage.setItem(storageKey,JSON.stringify(items));}catch{notify('비교 대상은 현재 화면에서 유지됩니다. 브라우저 저장은 사용할 수 없습니다.');}}
 function publish(){dispatchEvent(new CustomEvent('moa-compare-selection-change',{detail:{source:'tray',items:items.slice()}}));}
 function render(){root.hidden=!items.length;root.innerHTML=`<strong>기업 비교 <span>${items.length}/4</span></strong><div class="compare-selected-items">${items.map(s=>`<button data-remove="${esc(s.key)}" aria-label="${esc(s.name)} 비교에서 제외">${esc(s.name)} <small>${esc(s.key)}</small> ×</button>`).join('')}</div><button class="primary-button" data-open ${items.length<2?'disabled':''}>비교하기</button><button data-clear>비우기</button>`;}
 function add(stock){const key=stock.key||stock.market+':'+(stock.ticker||stock.id);if(!valid(key)){notify('비교할 국내·미국 주식의 식별 정보를 확인해 주세요.');return;}if(items.some(s=>s.key===key)){notify('이미 비교 대상에 있습니다.');return;}if(items.length>=4){notify('최대 4개까지 비교할 수 있습니다. 먼저 비교 대상을 제외해 주세요.');return;}items=cleanCompareItems([...items,{...stock,key}]);save();render();publish();notify((stock.name||key)+' · 비교 대상에 추가했습니다.');}
 root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-remove')){items=items.filter(s=>s.key!==b.dataset.remove);save();render();publish();}else if(b.hasAttribute('data-clear')){items=[];save();render();publish();}else if(b.hasAttribute('data-open')&&items.length>=2)navigate('/compare?'+new URLSearchParams({symbols:items.map(s=>s.key).join(',')}));},{signal:abort.signal});
 addEventListener('moa-compare-add',e=>add(e.detail||{}),{signal:abort.signal});
 addEventListener('moa-compare-selection-change',e=>{if(e.detail?.source!=='page')return;items=cleanCompareItems(e.detail.items);save();render();},{signal:abort.signal});
 render();return {add,items:()=>items.slice(),destroy(){abort.abort();root.remove();}};
}
