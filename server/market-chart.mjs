import {fmpIndexHistory} from './providers/fmp-indices.mjs';
import {providers} from './providers/registry.mjs';
import {ecosFeed} from './providers/ecos.mjs';
import {fxFeed,fxHistory} from './providers/usdkrw.mjs';

export async function marketChart(env,market,kind,id,{resolution='daily'}={}){
 if(kind==='macro'&&market==='KR'&&id==='USDKRW'&&env.TWELVE_DATA_API_KEY){const fx=await fxFeed(env);if(fx.status==='ready')return fxHistory(env,resolution);}
 if(market==='US'&&kind==='indices'&&env.FMP_API_KEY)return fmpIndexHistory(env,id);
 const feed=kind==='macro'?await ecosFeed(env):await providers[kind][market](env),item=[...(feed.items||[]),...(feed.references||[])].find(x=>x.id===id);
 if(!feed.policy?.display||!feed.policy?.chart)return {status:'restricted',points:[],message:'차트 데이터 연결 또는 표시 권한 확인 필요'};
 const points=(item?.history||[]).filter(p=>Number.isFinite(p.value)&&Number.isFinite(Date.parse(p.at)));
 return {status:points.length?'ready':'unavailable',source:feed.source,historyKind:item?.historyKind||'provided',name:item?.name,points,asOf:item?.historyAsOf||item?.asOf,stale:feed.stale||item?.stale||item?.historyStale,mode:feed.mode,unit:item?.unit,basis:item?.basis,baseDate:item?.baseDate,syncedAt:item?.syncedAt,message:points.length?'':kind==='futures'?'현재 선물 연결에는 과거 가격 이력이 없습니다.':feed.message||'제공된 과거 가격이 없습니다.'};
}
