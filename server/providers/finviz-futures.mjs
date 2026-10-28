import {finvizCsv,parseCsv,csvNumber,requireFinviz,finvizPolicy,FinvizError} from './finviz-client.mjs';
import {unavailable} from './base.mjs';
import {finvizFuturesQuotes} from './finviz-futures-quotes.mjs';
// Finviz supplies root symbols, not dated exchange contracts. Keep them separate.
const symbols={ES:'@ES',NQ:'@NQ',YM:'@YM'};
// Elite FAQ says 20 minutes, while its footer says 15. CSV has neither quote
// timestamp nor delay metadata: retain delayed mode without claiming exact latency.
export function parseFuturesPerformance(text,receivedAt){
 const rows=parseCsv(text,['Ticker','Name','Price','Performance (Day)']);
 return Object.entries(symbols).flatMap(([id,symbol])=>{
  const matches=rows.filter(row=>row.Ticker===symbol);
  if(matches.length>1)throw new FinvizError('Finviz 선물 심볼 중복 응답');
  const row=matches[0];if(!row)return [];
  const value=csvNumber(row.Price),changePct=csvNumber(row['Performance (Day)']);
  if(value===null||value<=0||changePct===null)return [];
  return [{id,symbol,name:row.Name,value,changePct,change:null,contractName:null,contractMonth:null,
   instrumentType:'futures_reference',contractStatus:'unverified',asOf:receivedAt,asOfKind:'received',
   mode:'delayed',delayMinutes:null,history:[]}];
 });
}
export async function finvizFutures(env){
 try{
  const policy=requireFinviz(env,'display','FUTURES');
  try{
   const quotes=await finvizFuturesQuotes(env);
   return {...unavailable('Finviz 선물 참고시세 · 실제 계약명·계약월과 시세 기준시각은 미제공','incomplete',policy),
    references:quotes.items,referenceStatus:'ready',asOf:quotes.receivedAt,receivedAt:quotes.receivedAt,
    asOfKind:'received',mode:'delayed',delayMinutes:null,session:'unknown',source:'Finviz · Futures Prices',stale:quotes.stale,
    changeBasis:'provider_daily',changeNote:'공급사 제공 일간 변동 · 포인트 기준 · 전일 종가/정산가 구분은 응답에 없음'};
  }catch{/* Keep the verified Elite performance export as a fallback. */}
  const data=await finvizCsv(env,'/export/futures/performance',{},120000);
  const references=parseFuturesPerformance(data.text,data.receivedAt);
  return {...unavailable('Finviz 선물 참고시세 · 실제 계약명·계약월과 시세 기준시각은 미제공','incomplete',policy),
   references,referenceStatus:references.length?'ready':'empty',asOf:data.receivedAt,receivedAt:data.receivedAt,
   asOfKind:'received',mode:'delayed',delayMinutes:null,session:'unknown',source:'Finviz Elite · Futures Performance'};
 }catch(e){return unavailable(e instanceof FinvizError?e.message:'Finviz 선물 데이터를 처리하지 못했습니다.',e.status||'error',finvizPolicy(env,'FUTURES'));}
}
