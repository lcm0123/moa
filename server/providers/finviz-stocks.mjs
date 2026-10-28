import {finvizCsv,parseCsv,csvNumber,requireFinviz,finvizPolicy,digest,FinvizError} from './finviz-client.mjs';
import {unavailable} from './base.mjs';
import {validDay} from '../../dist/js/calendar-model.js';
import {usMarketSession} from '../us-market-session.mjs';
const indexFilters={SP500:'idx_sp500',NASDAQ100:'idx_ndx',DOW30:'idx_dji'};
const expectedSizes={SP500:[400,550],NASDAQ100:[80,125],DOW30:[25,35]};
// Official screener column registry: previous close = 81. Verified export returns
// "Prev Close". Keep price and its comparison close in the same cached response.
const screenerColumns='1,2,3,4,5,6,65,66,67,81';
const asSnapshot=(data,items,policy)=>({status:items.length?'ready':'empty',items,asOf:data.receivedAt,receivedAt:data.receivedAt,asOfKind:'received',mode:'snapshot',session:'unknown',source:'Finviz Elite',policy});
export function turnoverForRanking(stock){
 if(Number.isFinite(stock.turnover)&&stock.turnover>=0)return {...stock,turnoverBasis:'provided'};
 const value=stock.price*stock.volume;
 if(!Number.isFinite(stock.price)||stock.price<=0||!Number.isFinite(stock.volume)||stock.volume<0||!Number.isFinite(value))return {...stock,turnover:null,turnoverBasis:'unavailable'};
 return {...stock,turnover:value,turnoverBasis:'price_times_volume'};
}
export function parseScreener(text){
 return parseCsv(text,['Ticker','Company','Sector','Market Cap','Price','Change','Volume']).map(r=>{
  const id=r.Ticker.trim();if(!/^[A-Z0-9.^/-]{1,24}$/.test(id)||!r.Company.trim())throw new FinvizError('Finviz 종목 식별자 형식 확인 필요');
  const price=csvNumber(r.Price),prior=csvNumber(r['Prev Close']),previousClose=prior>0?prior:null;
  const change=price!==null&&price>=0&&previousClose!==null?Math.round((price-previousClose)*1e8)/1e8:null;
  return {id,ticker:id,name:r.Company,market:'US',currency:'USD',country:r.Country||null,sector:r.Sector.trim(),industry:r.Industry||'',price,previousClose,change,changePct:csvNumber(r.Change),changeBasis:'previous_close',volume:csvNumber(r.Volume),marketCap:csvNumber(r['Market Cap'],1e6),turnover:csvNumber(r['Dollar Volume']),exchange:r.Exchange||null};
 });
}
async function dataset(env,indexId,feature='display',feed='STOCKS'){
 const policy=requireFinviz(env,feature,feed);
 if(indexId&&!indexFilters[indexId])throw new FinvizError('Finviz에서 지원하지 않는 지수 선택','incomplete');
 const data=await finvizCsv(env,'/export/screener',{v:'152',c:screenerColumns,...(indexId?{f:indexFilters[indexId]}:{})},120000);
 const rows=parseScreener(data.text);
 if(new Set(rows.map(r=>r.id)).size!==rows.length)throw new FinvizError('Finviz 중복 종목 식별자 확인 필요');
 if(indexId){const [min,max]=expectedSizes[indexId];if(rows.length<min||rows.length>max)throw new FinvizError('Finviz 지수 필터 응답의 구성종목 수 확인 필요','incomplete');}
 return {rows,data,policy};
}
export function parseHistory(text){
 return parseCsv(text,['Date','Close']).map(row=>{
  const m=row.Date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/),date=m?m[3]+'-'+m[1]+'-'+m[2]:row.Date;
  const close=csvNumber(row.Close),open=csvNumber(row.Open),high=csvNumber(row.High),low=csvNumber(row.Low),volume=csvNumber(row.Volume);
  const completeOHLC=[open,high,low].every(n=>n!==null);
  if(!validDay(date)||close===null||[close,open,high,low,volume].some(n=>n!==null&&n<0)||(completeOHLC&&(high<Math.max(open,close)||low>Math.min(open,close))))throw new FinvizError('Finviz 일봉 형식 확인 필요');
  return {date,at:date,value:close,open,high,low,volume};
 }).sort((a,b)=>a.date.localeCompare(b.date));
}
export async function finvizStocks(env,params={},feature='display'){
 try{
  const {rows,data,policy}=await dataset(env,params.indexId,feature);
  let selected=rows;
  if(params.id)selected=rows.filter(r=>r.id===params.id);
  if(params.q){const q=params.q.toLowerCase();selected=rows.filter(r=>(r.name+' '+r.ticker).toLowerCase().includes(q)).sort((a,b)=>(a.ticker.toLowerCase()===q?0:a.ticker.toLowerCase().startsWith(q)?1:2)-(b.ticker.toLowerCase()===q?0:b.ticker.toLowerCase().startsWith(q)?1:2)).slice(0,30);}
  if(['turnover','volume'].includes(params.sort)){
   if(params.sort==='turnover')selected=selected.map(turnoverForRanking);
   selected=selected.filter(s=>Number.isFinite(s[params.sort])&&s[params.sort]>=0).sort((a,b)=>b[params.sort]-a[params.sort]||a.ticker.localeCompare(b.ticker));
   if(params.limit)selected=selected.slice(0,Math.min(100,Math.max(1,params.limit)));
  }
  const quoteSession=usMarketSession(data.receivedAt),currentSession=usMarketSession(Date.now());
  const items=selected.map(r=>({...r,asOf:data.receivedAt,asOfKind:'received',mode:'snapshot',quoteSession,currentSession}));
  if(params.id&&items[0]&&policy.chart&&feature==='display'&&!params.quotesOnly){
   try{const bars=await finvizCsv(env,'/export/stock',{t:params.id,p:'d'},300000);items[0].history=parseHistory(bars.text);items[0].historyInterval='daily';items[0].historySource='Finviz 일봉 · 미국 거래일 기준';items[0].historyReceivedAt=bars.receivedAt;}
   catch(error){items[0].history=[];items[0].historyError=error.message;}
  }
  return {...asSnapshot(data,items,policy),...(params.sort==='turnover'?{turnoverEstimated:items.some(s=>s.turnoverBasis==='price_times_volume'),turnoverNote:'추정 거래대금 = 동일 조회 응답의 현재가 × 거래량 · 실제 체결대금 합계와 다를 수 있음'}:{})};
 }catch(error){return unavailable(error instanceof FinvizError?error.message:'Finviz 종목 데이터를 처리하지 못했습니다.',error.status||'error',finvizPolicy(env));}
}
export async function finvizClassifications(env,indexId){
 try{const {rows,data,policy}=await dataset(env,indexId,'treemap','CLASSIFICATIONS');return asSnapshot(data,rows.filter(r=>r.sector).map(r=>({id:r.id,market:'US',sectorId:r.sector,sectorName:r.sector,industryName:r.industry?.trim()||null,classification:'Finviz Sector / Industry',mappingSource:'Finviz Screener · Sector / Industry'})),policy);}
 catch(e){return unavailable(e.message,e.status||'error',finvizPolicy(env,'CLASSIFICATIONS'));}
}
export async function finvizCapitalization(env,indexId){
 try{const {rows,data,policy}=await dataset(env,indexId,'treemap','CAPITALIZATION');return asSnapshot(data,rows.filter(r=>r.marketCap>0).map(r=>({id:r.id,market:'US',marketCap:r.marketCap,currency:'USD',asOf:data.receivedAt,asOfKind:'received'})),policy);}
 catch(e){return unavailable(e.message,e.status||'error',finvizPolicy(env,'CAPITALIZATION'));}
}
async function observeMembership(env,indexId,ids,version,observedAt){
 if(!env.DB)return {changes:[],changeNote:'구성 변경 이력 저장소 연결 필요'};
 const result=await env.DB.prepare('SELECT version,members,changes,observed_at FROM finviz_memberships WHERE index_id=?').bind(indexId).all();
 const previous=result.results[0];let changes=previous?JSON.parse(previous.changes):[];
 if(previous&&previous.version!==version){const old=JSON.parse(previous.members);changes=[...ids.filter(id=>!old.includes(id)).map(id=>'추가 '+id),...old.filter(id=>!ids.includes(id)).map(id=>'제외 '+id)];}
 await env.DB.prepare('INSERT INTO finviz_memberships(index_id,version,members,changes,observed_at) VALUES(?,?,?,?,?) ON CONFLICT(index_id) DO UPDATE SET version=excluded.version,members=excluded.members,changes=excluded.changes,observed_at=excluded.observed_at').bind(indexId,version,JSON.stringify(ids),JSON.stringify(changes),observedAt).run();
 return {changes,changeNote:previous?'사이트 관측 목록 간 변경 · 공식 편입·편출 적용일 미제공':'최초 관측 · 이후 목록 변경부터 기록'};
}
export async function finvizConstituents(env,indexId){
 try{
  const {rows,data,policy}=await dataset(env,indexId,'treemap','CONSTITUENTS'),ids=rows.map(r=>r.id).sort(),version='observed-'+(await digest(ids.join('\n'))).slice(0,12);
  const observation=await observeMembership(env,indexId,ids,version,data.receivedAt);
  return {...asSnapshot(data,rows.map(r=>({id:r.id,ticker:r.ticker,name:r.name,market:'US'})),policy),indexId,verified:true,version,effectiveAt:null,observedAt:data.receivedAt,source:'Finviz Screener · '+indexFilters[indexId],...observation};
 }catch(e){return unavailable(e instanceof FinvizError?e.message:'Finviz 구성종목 및 변경 이력을 처리하지 못했습니다.',e.status||'error',finvizPolicy(env,'CONSTITUENTS'));}
}
