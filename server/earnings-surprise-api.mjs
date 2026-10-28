import {securityKey} from './security-identity.mjs';
import {cachedResearch} from './research-cache.mjs';
import {loadEarningsConsensus} from './providers/earnings-consensus.mjs';
import {calculateEarningsSurprise} from './earnings-surprise.mjs';
import config from '../config/earnings-surprise.json' with {type:'json'};
import {requireFinviz,finvizPolicy} from './providers/finviz-client.mjs';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
export async function earningsSurpriseApi(request,env,{load=loadEarningsConsensus}={}){
 const url=new URL(request.url),market=url.searchParams.get('market'),ticker=url.searchParams.get('ticker');
 if(request.method!=='GET')return json({message:'Method not allowed'},405);
 if(!securityKey(market,ticker))return json({message:'종목을 확인해 주세요.'},400);
 try{
  if(market==='US')requireFinviz(env,'calendar','EARNINGS');
  const cacheKey='earnings-surprise:'+config.version+':'+market+':'+ticker;let result;
  if(url.searchParams.get('stored')==='1'){
   if(!env.DB)return json({status:'unavailable',analysis:null,collectionMode:'stored_only',message:'실적 예상치 저장소 연결 필요'});
   const saved=(await env.DB.prepare('SELECT payload,updated_at FROM research_cache WHERE cache_key=?').bind(cacheKey).all()).results[0];
   if(!saved)return json({status:'unavailable',analysis:null,collectionMode:'stored_only',message:'저장된 발표 전 예상치·실제 실적 비교 자료가 없습니다.'});
   const value=JSON.parse(saved.payload);
   if(value.market&&value.market!==market||value.ticker&&value.ticker!==ticker||value.analysis?.market&&value.analysis.market!==market||value.analysis?.ticker&&value.analysis.ticker!==ticker)return json({status:'error',analysis:null,message:'저장된 실적 종목 식별 정보가 일치하지 않습니다.'},500);
   result={...value,cacheUpdatedAt:saved.updated_at,collectionMode:'stored_only',stale:!!value.stale||Date.now()-Date.parse(saved.updated_at)>config.cacheMs};
  }else result=await cachedResearch(env,cacheKey,config.cacheMs,async()=>{
   const data=await load(env,market,ticker);return {...data,quarters:undefined,analysis:data.quarters.length?calculateEarningsSurprise(data):null};
  });
  // Recheck policy even when a previously permitted result comes from cache.
  if(market==='US'&&!finvizPolicy(env,'STOCKS').chart&&result.analysis){const a=result.analysis;return json({...result,analysis:{...a,latest:{...a.latest,priceReaction:null},points:a.points.map(p=>({...p,priceReaction:null})),signals:a.signals.filter(s=>!['EARNINGS_BEAT_PRICE_DOWN','MISS_PRICE_UP'].includes(s.id))}});}
  return json(result);
 }catch(e){return json({status:e.status==='restricted'?'restricted':e.status==='disconnected'?'disconnected':'error',analysis:null,message:e.status==='restricted'||e.status==='disconnected'?e.message:'실적 예상치 연결 오류 · 잠시 후 다시 확인해 주세요.'});}
}
