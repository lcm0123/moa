import {validWatchKey} from './watchlist.js';

export const WORKBENCH_SETTINGS_KEY='moa-stock-workbench-v1';
export const workbenchDefaults={view:'price',sort:'manual',filter:'all',period:'3m',selected:null,panel:'business',panelOpen:false,scrollTop:0,columns:['price','change','time']};
const allowed={view:['price','financial','business','documents'],sort:['manual','gainers','losers','name'],filter:['all','KR','US'],period:['1m','3m','1y','all'],panel:['business','financial','documents']};
function cleanField(key,value){
 if(allowed[key])return allowed[key].includes(value)?value:workbenchDefaults[key];
 if(key==='selected')return validWatchKey(value)?value:null;
 if(key==='panelOpen')return value===true;
 if(key==='scrollTop')return Number.isFinite(value)?Math.min(100000,Math.max(0,value)):0;
 if(key==='columns')return Array.isArray(value)?[...new Set(value.filter(x=>['price','change','time','turnover'].includes(x)))]:workbenchDefaults.columns;
 return undefined;
}
function local(storage){return storage||globalThis.localStorage;}
export function readWorkbenchSettings(storage){
 try{const raw=JSON.parse(local(storage).getItem(WORKBENCH_SETTINGS_KEY)||'null');if(!raw||raw.version!==1)return {...workbenchDefaults,columns:[...workbenchDefaults.columns]};return Object.fromEntries(Object.keys(workbenchDefaults).map(k=>[k,cleanField(k,raw.values?.[k]??workbenchDefaults[k])]));}
 catch{return {...workbenchDefaults,columns:[...workbenchDefaults.columns]};}
}
// Each synchronous write re-reads current storage and changes only the requested
// fields. A stale tab cannot replace unrelated newer settings with its snapshot.
export function patchWorkbenchSettings(patch,storage){
 const target=local(storage),values=readWorkbenchSettings(target);
 for(const [key,value] of Object.entries(patch))if(Object.hasOwn(workbenchDefaults,key))values[key]=cleanField(key,value);
 target.setItem(WORKBENCH_SETTINGS_KEY,JSON.stringify({version:1,values}));
 return values;
}

export const workbenchRequestKey=({market,ticker,id,instrumentId,issuerId},panel,period='stored',permission='current-reader')=>JSON.stringify(['stock',market,instrumentId||id||ticker,issuerId||null,panel,period,'regular','provider-native',permission]);

// Cancellation saves work; generation AND key checks provide correctness even
// if a transport ignores abort or a fulfilled response is already queued.
export function createWorkbenchRequests({fetcher=globalThis.fetch,limit=8,ttl=60000,now=Date.now,onState=()=>{}}={}){
 let generation=0,currentKey=null,currentController=null,pending=null,disposed=false;
 const cache=new Map();
 const valid=(token,key)=>!disposed&&token===generation&&key===currentKey;
 function cancel(){generation++;currentKey=null;currentController?.abort();currentController=null;pending=null;}
 return {
  select(stock,panel,{force=false,permission='current-reader'}={}){
   if(disposed)return;const key=workbenchRequestKey(stock,panel,'stored',permission);
   // Repeated render/selection events share the in-flight request. A different
   // panel, instrument or permission still cancels and advances generation.
   if(pending?.key===key&&currentKey===key&&currentController&&!currentController.signal.aborted)return pending.promise;
   cancel();const token=generation;currentKey=key;
   onState({status:'loading',stock,panel,key});
   const stored=cache.get(key);if(!force&&stored&&stored.until>now()){if(valid(token,key))onState({...stored.value,stock,panel,key});return;}
   const controller=new AbortController();currentController=controller;
   const promise=(async()=>{try{const response=await fetcher('/api/stock-workbench?'+new URLSearchParams({market:stock.market,ticker:stock.ticker,panel}),{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]),cache:'no-store'});
    if(!response.ok){if([401,403].includes(response.status)){cache.delete(key);if(valid(token,key))onState({status:'restricted',stock,panel,key,data:{message:'자료 표시 권한 확인 필요'}});return;}throw Error('PANEL_HTTP_ERROR');}const data=await response.json();
    if(data.identity?.market!==stock.market||data.identity?.ticker!==stock.ticker)throw Error('PANEL_IDENTITY_MISMATCH');
    if(stock.instrumentId&&data.identity.instrumentId&&stock.instrumentId!==data.identity.instrumentId)throw Error('PANEL_IDENTITY_MISMATCH');
    if(stock.issuerId&&data.identity.issuerId&&stock.issuerId!==data.identity.issuerId)throw Error('PANEL_IDENTITY_MISMATCH');
    if(!valid(token,key))return;
    const value={status:data.status||'ready',data};
    if(value.status==='error')throw Error('PANEL_HTTP_ERROR');
    if(['restricted','mapping_error'].includes(value.status))cache.delete(key);
    if(!['error','restricted','mapping_error'].includes(value.status)){cache.delete(key);cache.set(key,{value,until:now()+ttl});while(cache.size>limit)cache.delete(cache.keys().next().value);}
    onState({...value,stock,panel,key});
   }catch(error){if(!valid(token,key))return;if(stored&&error.message!=='PANEL_IDENTITY_MISMATCH'){onState({...stored.value,stock,panel,key,data:{...stored.value.data,stale:true,message:'갱신 실패 · 마지막 저장 자료를 표시합니다. 기준 시각을 확인해 주세요.'}});return;}if(error.message==='PANEL_IDENTITY_MISMATCH')cache.delete(key);onState({status:'error',stock,panel,key,message:error.message==='PANEL_IDENTITY_MISMATCH'?'기업 식별 정보를 확인하지 못했습니다. 다른 종목 자료는 표시하지 않습니다.':'저장 자료를 불러오지 못했습니다. 다시 시도해 주세요.'});}
   finally{if(currentController===controller)currentController=null;}})();
   pending={key,promise};const clearPending=()=>{if(pending?.promise===promise)pending=null;};void promise.then(clearPending,clearPending);return promise;
  },cancel,clear(){cancel();cache.clear();},destroy(){disposed=true;cancel();cache.clear();},stats:()=>({cacheSize:cache.size,activeRequests:currentController?1:0,generation})
 };
}

export function watchlistArrowKey(event){
 if(event.isComposing||event.keyCode===229||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||!['ArrowUp','ArrowDown'].includes(event.key))return 0;
 const target=event.target;
 if(target?.closest?.('input,textarea,select,[contenteditable="true"],[role="textbox"]'))return 0;
 if(!target?.closest?.('[data-watch-select]'))return 0;
 return event.key==='ArrowDown'?1:-1;
}

export function retainedWatchOrder(rows,frozenKeys){
 if(!frozenKeys)return rows;
 const positions=new Map(frozenKeys.map((key,index)=>[key,index]));
 return [...rows].sort((a,b)=>(positions.get(a.key)??Infinity)-(positions.get(b.key)??Infinity));
}
