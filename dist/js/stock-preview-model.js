import {analysisData} from './analysis-chart-model.js';
export const previewKey=stock=>stock.market+':'+(stock.id||stock.ticker);
// A default preview follows the new leader; deliberate row selections persist
// only while that security remains in the active ranking universe.
export function rankingPreviewChoice(rows,choice){
 const remembered=choice?.manual&&rows.find(stock=>previewKey(stock)===choice.key);
 return remembered?{stock:remembered,manual:true}:{stock:rows[0]||null,manual:false};
}

// Browser-only bounded cache. Selection tokens guard even transports that ignore abort.
export function createPreviewLoader({fetcher=fetch,delay=280,ttl=300000,limit=12,onState}){
 const cache=new Map();let timer,controller,version=0,selected=null,disposed=false;
 function cancel(){++version;clearTimeout(timer);timer=null;controller?.abort();controller=null;}
 async function load(stock,token,force){
  const key=previewKey(stock),cached=cache.get(key);
  if(token!==version)return;if(!force&&cached&&cached.until>Date.now()){onState({...cached.value,stock:{...cached.value.stock,...stock},key});return;}
  controller=new AbortController();const current=controller;
  try{
   const response=await fetcher('/api/stock?'+new URLSearchParams({market:stock.market,id:stock.id||stock.ticker}),{signal:AbortSignal.any([current.signal,AbortSignal.timeout(20000)])});
   if(!response.ok)throw new Error('조회 실패');const feed=await response.json();
   if(feed.status==='error')throw new Error('종목 데이터 조회 실패');
   const item=feed.items?.find(s=>previewKey(s)===key);
   if(!item){if(token===version)onState({status:'empty',stock,key,message:feed.message||'조회 가능한 종목 데이터가 없습니다.'});return;}
   const model=analysisData(item,feed);if(!model.bars.length&&model.historyWarning)throw new Error('일봉 조회 실패');
   const value={status:model.bars.length?'ready':'empty',stock:item,feed,model,key,stale:model.stale,message:model.message};
   if(token!==version)return;cache.delete(key);cache.set(key,{value,until:Date.now()+ttl});while(cache.size>limit)cache.delete(cache.keys().next().value);
   if(token===version)onState(value);
  }catch(error){if(token!==version)return;if(cached)onState({...cached.value,key,stale:true,message:'갱신 실패 · 마지막 조회값'});else onState({status:'error',stock,key,message:'차트를 불러오지 못했습니다.'});}
  finally{if(controller===current)controller=null;}
 }
 return {isFresh(stock){return !disposed&&(cache.get(previewKey(stock))?.until||0)>Date.now();},select(stock,{immediate=false,force=false}={}){if(disposed)return;if(selected&&previewKey(selected)===previewKey(stock)&&(timer||controller)){selected=stock;return;}cancel();selected=stock;const token=version;onState({status:'loading',stock,key:previewKey(stock)});if(immediate)void load(stock,token,force);else timer=setTimeout(()=>{timer=null;void load(stock,token,force);},delay);},cancel,retry(){if(selected&&!disposed)this.select(selected,{immediate:true,force:true});},destroy(){disposed=true;cancel();selected=null;cache.clear();}};
}
