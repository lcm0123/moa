import {fmpRequest,fmpCacheTtl} from './fmp-client.mjs';
import {digest} from './finviz-client.mjs';
import {getPolicy} from './base.mjs';
import {usMarketSession} from '../us-market-session.mjs';

// Symbols and names verified against FMP Stable /index-list on 2026-09-25.
export const fmpIndexTargets=Object.freeze([
 {id:'SPX',name:'S&P 500',symbol:'^GSPC',providerName:'S&P 500'},
 {id:'COMP',name:'나스닥 종합',symbol:'^IXIC',providerName:'NASDAQ Composite'},
 {id:'NDX',name:'나스닥 100',symbol:'^NDX',providerName:'NASDAQ 100'},
 {id:'DJI',name:'다우 산업평균',symbol:'^DJI',providerName:'Dow Jones Industrial Average'}
]);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const day=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\d$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const normalized=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function fmpCatalogMatches(rows,target){return Array.isArray(rows)&&rows.filter(r=>r.symbol===target.symbol&&normalized(r.name)===normalized(target.providerName)&&r.currency==='USD').length===1;}
export function fmpDailyPoints(response,target,now=Date.now()){
 if(response.error||response.httpStatus!==200||!Array.isArray(response.data))return [];
 const through=completedDay(now);if(!through)return [];
 const points=new Map();
 for(const r of response.data){if(r.symbol!==target.symbol||!day(r.date)||r.date>through||!finite(r.price)||r.price<=0)continue;if(points.has(r.date)&&points.get(r.date)!==r.price)return [];points.set(r.date,r.price);}
 return [...points].sort(([a],[b])=>a.localeCompare(b)).map(([at,value])=>({at,value}));
}
export function parseFmpQuote(response,target,now=Date.now()){
 if(response.error||response.httpStatus!==200)return {error:response.error||'provider_error'};
 if(!Array.isArray(response.data)||response.data.length!==1)return {error:'invalid_response'};
 const q=response.data[0];
 if(q.symbol!==target.symbol||normalized(q.name)!==normalized(target.providerName)||q.exchange!=='INDEX')return {error:'identity_unverified'};
 if(!finite(q.price)||q.price<=0)return {error:'invalid_values'};
 if(!finite(q.timestamp)||q.timestamp<=0||q.timestamp*1000>now+300000||!Number.isFinite(+new Date(q.timestamp*1000)))return {error:'invalid_timestamp'};
 return {item:{id:target.id,name:target.name,providerSymbol:target.symbol,instrumentType:'cash_index',value:q.price,
  change:finite(q.change)?q.change:null,changePct:finite(q.changePercentage)?q.changePercentage:null,
  previousClose:finite(q.previousClose)&&q.previousClose>0?q.previousClose:null,
  asOf:new Date(q.timestamp*1000).toISOString(),asOfKind:'quote',mode:'unverified',receivedAt:response.receivedAt}};
}
function completedDay(now){
 const s=usMarketSession(now),close=s.earlyClose?'13:00':'16:00';
 for(let offset=0;offset<12;offset++){
  const date=new Date(Date.parse(s.dateEt)+-offset*86400000).toISOString().slice(0,10);
  if(offset===0&&s.timeEt<close)continue;
  if(usMarketSession(date+'T16:00:00Z').id==='regular')return date;
 }
 return null;
}
function closeLabel(date,now){return date===completedDay(now)?(date<usMarketSession(now).dateEt?'전일 종가':'종가'):'과거 종가';}
export function composeFmpItem(quote,daily,target,now=Date.now()){
 const parsed=parseFmpQuote(quote,target,now),points=fmpDailyPoints(daily,target,now),last=points.at(-1);
 let item=parsed.item;
 if(item){
  const quoteDay=usMarketSession(item.asOf).dateEt;
  // EOD values may have fewer decimals than /quote. Compare only to the supplied
  // EOD record; never derive missing change or substitute a stock/ETF quote.
  if(last&&quoteDay===last.at&&Math.abs(item.value-last.value)<=0.005){item.mode='previous_close';item.closeDate=last.at;item.closeLabel=closeLabel(last.at,now);}
  else if(quoteDay<usMarketSession(now).dateEt)item.valueLabel='과거 시세';
 }else if(last){item={id:target.id,name:target.name,providerSymbol:target.symbol,instrumentType:'cash_index',value:last.value,change:null,changePct:null,previousClose:null,asOf:last.at,asOfKind:'date',mode:'previous_close',closeDate:last.at,closeLabel:closeLabel(last.at,now),receivedAt:daily.receivedAt};}
 if(item){item.history=points.slice(-60);item.historyKind='daily';item.historyAsOf=last?.at||null;}
 return {item,error:parsed.error,quoteReturned:!!parsed.item};
}
const messages={access_denied:'현재 요금제에서 제공하지 않음',authentication_error:'FMP 키 인증 실패',rate_limited:'FMP 조회 한도 대기',daily_limit:'FMP 하루 호출 한도 대기',identity_unverified:'현물지수 구분 확인 필요',invalid_values:'지수값 확인 필요',invalid_timestamp:'시세 기준 시각 확인 필요',empty:'반환된 데이터 없음',not_found:'데이터 연결 필요',provider_error:'데이터 조회 오류',connection_error:'데이터 연결 오류'};
export async function fmpIndexHistory(env,id){
 const target=fmpIndexTargets.find(t=>t.id===id),policy=env.LOCAL_PREVIEW===true?{display:true,chart:true}:getPolicy(env,'FMP_INDICES');
 const base={source:'FMP',historyKind:'daily',points:[],policy};
 if(!target)return {...base,status:'empty',message:'지원하는 현물지수가 아닙니다.'};
 if(!policy.display||!policy.chart)return {...base,status:'restricted',message:'차트 표시 권한 확인 필요'};
 if(!env.FMP_API_KEY?.trim()||!env.DB)return {...base,status:'disconnected',message:'지수 데이터 연결 필요'};
 const key=(await digest(env.FMP_API_KEY.trim()))+':history:'+id;
 const saved=(await env.DB.prepare('SELECT payload FROM fmp_last_good WHERE cache_key=?').bind(key).all()).results[0];
 const catalog=await request(env,'/stable/index-list',{});
 let response,points=[];
 if(!catalog.error&&fmpCatalogMatches(catalog.data,target)){
  response=await request(env,'/stable/historical-price-eod/light',{symbol:target.symbol});
  points=fmpDailyPoints(response,target);
 }
 if(points.length){
  const result={...base,status:'ready',name:target.name,points,asOf:points.at(-1).at,receivedAt:response.receivedAt};
  await env.DB.prepare('INSERT INTO fmp_last_good(cache_key,payload) VALUES(?,?) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload').bind(key,JSON.stringify(result)).run();
  return result;
 }
 if(saved)return {...JSON.parse(saved.payload),stale:true,message:'갱신 실패 · 마지막 정상 이력'};
 return {...base,status:'unavailable',message:messages[response?.error||catalog.error]||'제공된 과거 가격이 없습니다.'};
}
async function request(env,path,params){try{return await fmpRequest(env,path,params);}catch(e){return {error:e.code||'connection_error',httpStatus:null,data:null,receivedAt:null};}}
export async function fmpIndexProvider(env){
 const policy=env.LOCAL_PREVIEW===true?{display:true,chart:true,ranking:false,treemap:false}:getPolicy(env,'FMP_INDICES');
 const base={source:'FMP',configured:!!env.FMP_API_KEY?.trim(),policy,items:[],checks:[],asOf:null,session:'unknown'};
 if(!base.configured)return {...base,status:'disconnected',message:'FMP 키 설정 필요'};
 if(!policy.display)return {...base,status:'restricted',message:'FMP 공개 표시 권한 설정 필요'};
 if(!env.DB)return {...base,status:'error',message:'FMP 캐시 저장소 연결 필요'};
 const now=Date.now(),keyHash=await digest(env.FMP_API_KEY.trim()),catalog=await request(env,'/stable/index-list',{}),result={...base,status:'incomplete',receivedAt:new Date(now).toISOString()};
 for(const target of fmpIndexTargets){
  const cacheKey=keyHash+':index:'+target.id,saved=(await env.DB.prepare('SELECT payload FROM fmp_last_good WHERE cache_key=?').bind(cacheKey).all()).results[0];
  let item,error=catalog.error,quote,daily;
  if(!error&&fmpCatalogMatches(catalog.data,target)){
   quote=await request(env,'/stable/quote',{symbol:target.symbol});
   // Daily access is also needed to distinguish a supplied closing quote from
   // intraday data. Do not call the denied 5-minute endpoint from the dashboard.
   daily=await request(env,'/stable/historical-price-eod/light',{symbol:target.symbol});
   const composed=composeFmpItem(quote,daily,target,now);item=composed.item;error=composed.error;
   // On a failed quote keep its last validated snapshot and quote timestamp.
   if(!composed.quoteReturned&&saved)item={...JSON.parse(saved.payload),stale:true};
   else if(item)await env.DB.prepare('INSERT INTO fmp_last_good(cache_key,payload) VALUES(?,?) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload').bind(cacheKey,JSON.stringify(item)).run();
  }else error=error||'identity_unverified';
  if(!item&&saved)item={...JSON.parse(saved.payload),stale:true};
  if(item){if(!policy.chart)delete item.history;result.items.push(item);}
  result.checks.push({id:target.id,name:target.name,providerSymbol:target.symbol,status:item?(item.stale?'stale':'ready'):error||'empty',message:item?(item.stale?'갱신 실패 · 마지막 정상 데이터':item.closeLabel||'시세 지연 여부 미확인'):messages[error]||'데이터 연결 필요',quoteHttpStatus:quote?.httpStatus??null,dailyHttpStatus:daily?.httpStatus??null,quoteAsOf:item?.asOf||null,mode:item?.mode||null});
 }
 result.status=result.items.length?'ready':catalog.error?'error':'incomplete';
 result.stale=result.items.length>0&&result.items.every(x=>x.stale);
 result.mode=result.items.length&&result.items.every(x=>x.mode==='previous_close')?'previous_close':'unverified';
 result.asOf=result.items.reduce((last,item)=>!last||Date.parse(item.asOf)>Date.parse(last)?item.asOf:last,null);
 result.session=usMarketSession(now).id==='regular'?'open':'closed';
 result.refresh={quoteSeconds:fmpCacheTtl('/stable/quote',now)/1000,dailySeconds:86400,rollingDayLimit:240};
 const omitted=result.checks.filter(c=>c.status!=='ready'&&c.status!=='stale').map(c=>c.name+' · '+c.message);
 result.message='FMP · 일봉 기준'+(omitted.length?' · '+omitted.join(' / '):'')+(result.stale?' · 갱신 실패, 마지막 정상 데이터 표시':'');
 return result;
}
