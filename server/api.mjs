import {stockWorkbenchApi} from './stock-workbench-api.mjs';
import {stockEvidenceApi} from './stock-evidence-api.mjs';
import {comparisonApi} from './comparison-api.mjs';
import {documentStateApi} from './document-state-api.mjs';
import {businessProfileApi} from './business-profile-api.mjs';
import {newsCompaniesApi} from './news-companies-api.mjs';
import {reactionGapApi} from './reaction-gap-api.mjs';
import {businessProfileAdminApi} from './business-profile-admin-api.mjs';
import {searchBusinessProfiles,stockBusinessSummaries} from './catalyst/profile-search.mjs';
import {CatalystStore} from './catalyst/store.mjs';
import {earningsFlowApi} from './earnings-flow-api.mjs';
import {earningsSurpriseApi} from './earnings-surprise-api.mjs';
import {notificationApi} from './notifications-api.mjs';
import {dartFilingsApi} from './dart-filings-api.mjs';
import {secFilingsApi} from './sec-filings-api.mjs';
import {macroApi} from './macro-api.mjs';
import {screenerApi} from './screener-api.mjs';
import {monthlyFlow} from './monthly-flow.mjs';
import {krInvestorsApi} from './kr-investors.mjs';
import {cryptoApi} from './crypto-api.mjs';
import {persistResearchEvents} from './research-events.mjs';
import {koreanHistoryProgress} from './korean-sector-history.mjs';
import {attachKoreanDailyHistory} from './providers/korean-chart.mjs';
import {priceEvents} from '../dist/js/research-model.js';
import {readSectorHistory,recordSectorSnapshot} from './sector-history.mjs';
import {researchApi} from './research-api.mjs';
import {financialApi} from './financial-api.mjs';
import {readReconstructedHistory} from './sector-backfill.mjs';
import {reportsApi,reportPdfApi,reportCategoryApi} from './reports.mjs';
import {universes} from './providers/constituents.mjs';
import {marketConfig} from './market-config.mjs';
import {providers} from './providers/registry.mjs';
import {recordSearch,searchRanking} from './search-store.mjs';
import {unavailable} from './providers/base.mjs';
import {calendarApi} from './calendar-api.mjs';
import {marketChart} from './market-chart.mjs';
import {parseWatchSymbols,watchlistQuotes} from './watchlist-api.mjs';
import {stockRanking} from './stock-ranking.mjs';
import {ecosFeed} from './providers/ecos.mjs';
import {domesticMacroFeed} from './providers/usdkrw.mjs';
const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});
function searchRelevance(s,q){const t=s.ticker.toLowerCase(),n=s.name.toLowerCase();return t===q?0:t.startsWith(q)?1:n.startsWith(q)?2:3;}
function marketOf(url){const m=url.searchParams.get('market')||'KR';if(!['KR','US','all'].includes(m))throw new Error('Invalid market');return m;}
export async function api(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(path==='/api/reaction-gap'||path.startsWith('/api/reaction-gap/'))return reactionGapApi(request,env);
 if(path==='/api/news-companies'||path.startsWith('/api/news-companies/'))return newsCompaniesApi(request,env);
 if(path==='/api/stock-workbench')return stockWorkbenchApi(request,env);
 if(path==='/api/stock-evidence')return stockEvidenceApi(request,env);
 if(path==='/api/compare')return comparisonApi(request,env);
 if(path==='/api/business-profile')return businessProfileApi(request,env);
 if(path.startsWith('/api/business-profiles/'))return businessProfileAdminApi(request,env);
 if(path==='/api/catalyst'||path.startsWith('/api/catalyst/')||path==='/api/theses'||path.startsWith('/api/theses/'))return json({status:'removed',code:'INVESTMENT_RESEARCH_REMOVED',message:'투자 리서치 기능이 종료되었습니다.'},410);
 if(path==='/api/notifications'||path.startsWith('/api/notifications/'))return notificationApi(request,env);
 if(['/api/us-observations','/api/competitors','/api/us-kr-links'].includes(path))return json({status:'removed',message:'종료된 기능입니다.'},410);
 if(path==='/api/screener')return screenerApi(request,env);
 if(path==='/api/dart-filings'||['/api/dart-filings/subscriptions','/api/dart-filings/notifications'].includes(path))return dartFilingsApi(request,env);
 if(path==='/api/sec-filings')return secFilingsApi(request,env);
 if(path==='/api/macro'||path.startsWith('/api/macro/'))return macroApi(request,env);
 if(path==='/api/kr-investors')return krInvestorsApi(request,env);
 if(path==='/api/crypto'||path.startsWith('/api/crypto/'))return cryptoApi(request,env);
 if(path==='/api/research'||path==='/api/research/read')return researchApi(request,env);
 if(path==='/api/earnings-flow')return earningsFlowApi(request,env);
 if(path==='/api/earnings-surprise')return earningsSurpriseApi(request,env);
 if(path==='/api/financials')return financialApi(request,env);
 if(path==='/api/managers'||path.startsWith('/api/managers/'))return new Response(JSON.stringify({status:'removed',message:'운용사 보유 현황 제공이 종료되었습니다.'}),{status:410,headers:{'Content-Type':'application/json; charset=utf-8'}});
 if(path==='/api/reports')return reportsApi(request,env);
 const reportState=path.match(/^\/api\/reports\/([^/]+)\/state$/);if(reportState){try{return documentStateApi(request,env,decodeURIComponent(reportState[1]));}catch{return json({error:'Invalid report'},400);}}
 const reportCategory=path.match(/^\/api\/reports\/([^/]+)\/category$/);if(reportCategory){try{return reportCategoryApi(request,env,decodeURIComponent(reportCategory[1]));}catch{return json({error:'Invalid report'},400);}}
 const reportPdf=path.match(/^\/api\/reports\/([^/]+)\/pdf$/);if(reportPdf){try{return reportPdfApi(request,env,decodeURIComponent(reportPdf[1]));}catch{return json({error:'Invalid report'},400);}}
 if(path==='/api/calendar'||path.startsWith('/api/calendar/'))return calendarApi(request,env);
 try{
 if(request.method==='POST'&&path==='/api/search-events'){
  if(request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Invalid request origin'},403);
  if(Number(request.headers.get('Content-Length')||0)>2048)return json({error:'Request too large'},413);
  const body=await request.text();if(body.length>2048)return json({error:'Request too large'},413);const event=JSON.parse(body);
  if(!['KR','US'].includes(event.market)||typeof event.id!=='string'||event.id.length>80||typeof event.eventId!=='string'||!/^[0-9a-f-]{36}$/i.test(event.eventId))return json({error:'Invalid search selection'},400);
  const source=await providers.stocks[event.market](env,{id:event.id},'ranking');const stock=source.items.find(s=>s.id===event.id);if(!stock)return json({error:'검색 집계 가능한 종목 데이터가 없습니다.'},409);
  if(!env.DB)return json({error:'검색 집계 저장소 연결 필요'},503);
  let session=request.headers.get('Cookie')?.match(/(?:^|;\s*)moa_session=([a-f0-9-]{36})(?:;|$)/i)?.[1];const fresh=!session;if(!session)session=crypto.randomUUID();
  const result=await recordSearch(env.DB,{...stock,session});
  return json(result,200,fresh?{'Set-Cookie':`moa_session=${session}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${url.protocol==='https:'?'; Secure':''}`}:{})
 }
 if(request.method!=='GET')return json({error:'Method not allowed'},405);
 if(path==='/api/watchlist'){
  let keys;try{keys=parseWatchSymbols(url.searchParams.get('symbols')||'');}catch{return json({error:'관심종목을 확인해 주세요.'},400);}
  return json(await watchlistQuotes(env,keys,providers.stocks));
 }
 if(path==='/api/market-chart'){
  const market=url.searchParams.get('market'),kind=url.searchParams.get('kind'),id=url.searchParams.get('id'),resolution=url.searchParams.get('resolution')||'daily';
  if(!['daily','intraday'].includes(resolution))return json({error:'차트 간격을 확인해 주세요.'},400);
  if(!['KR','US'].includes(market)||!['indices','futures','macro'].includes(kind)||kind==='macro'&&(market!=='KR'||!['USDKRW','KTB10Y'].includes(id))||!id||!/^[A-Za-z0-9_@^.-]{1,40}$/.test(id))return json({error:'차트 조회 조건을 확인해 주세요.'},400);
  return json(await marketChart(env,market,kind,id,{resolution}));
 }
 if(path==='/api/sector-history'){
  const market=marketOf(url),indexId=url.searchParams.get('indexId'),month=url.searchParams.get('month');
  if(universes[indexId]?.market!==market||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))return json({error:'시장·지수·월을 확인해 주세요.'},400);
  const basis=url.searchParams.get('basis')||'observed';
  if(!['observed','reconstructed'].includes(basis))return json({error:'기록 기준을 확인해 주세요.'},400);
  if(market==='KR'&&basis==='reconstructed'){
   return json({...await readReconstructedHistory(env,market,indexId,month),job:await koreanHistoryProgress(env)});
  }
  return json(await (basis==='reconstructed'?readReconstructedHistory:readSectorHistory)(env,market,indexId,month));
 }
 if(path==='/api/market-config')return json(marketConfig(env));
 if(path==='/api/monthly-flow')return json(await monthlyFlow(env,{market:marketOf(url),indexId:url.searchParams.get('indexId'),month:url.searchParams.get('month'),day:url.searchParams.get('day')}));
 if(path==='/api/domestic-macro')return json(await domesticMacroFeed(env));
 if(path==='/api/indices'||path==='/api/futures'||path==='/api/sectors'){
  const market=marketOf(url);if(market==='all')return json({error:'Select KR or US'},400);const kind=path.slice(5),data=await providers[kind][market](env,url.searchParams.get('indexId')||undefined);if(kind==='sectors')data.historyRecording=await recordSectorSnapshot(env,data,market,data.indexId);return json(data);
 }
 if(path==='/api/ranking'){
  const market=marketOf(url),kind=url.searchParams.get('kind')||'turnover';if(!['turnover','volume','search'].includes(kind))return json({error:'Invalid ranking'},400);
  if(kind==='search'){
   if(!env.DB)return json(unavailable('검색 집계 저장소 연결 필요'));
   const result=await searchRanking(env.DB,market);const markets=market==='all'?['KR','US']:[market];const quotes=await Promise.all(markets.map(m=>providers.stocks[m](env,{},'ranking')));
   result.items=result.items.map(row=>{const quote=quotes.flatMap(q=>q.items).find(s=>s.id===row.id&&s.market===row.market);return {...row,...(quote||{}),quoteAvailable:!!quote};});return json(result);
  }
  const markets=market==='all'?['KR','US']:[market];
  const groups=await Promise.all(markets.map(m=>stockRanking(env,providers.stocks[m],m,kind)));return json({groups,separateMarkets:true});
 }
 if(path==='/api/search'){
  const query=(url.searchParams.get('q')||'').trim().slice(0,100);if(!query)return json({status:'empty',items:[]});const groups=await Promise.all(['KR','US'].map(m=>providers.stocks[m](env,{q:query})));
  const business=env.DB?await searchBusinessProfiles(new CatalystStore(env.DB),query,{limit:12,sourceAllowed:env.CATALYST_SOURCE_ALLOWED}):[]; const q=query.toLowerCase(),items=groups.flatMap(x=>x.items).filter(s=>(s.name+' '+s.ticker).toLowerCase().includes(q)).sort((a,b)=>searchRelevance(a,q)-searchRelevance(b,q)||a.ticker.localeCompare(b.ticker)).slice(0,12);if(env.DB)await stockBusinessSummaries(new CatalystStore(env.DB),items,{sourceAllowed:env.CATALYST_SOURCE_ALLOWED}); for(const b of business)if(!items.some(x=>x.market===b.market&&x.ticker===b.ticker)&&items.length<12)items.push(b);return json({status:items.length?'ready':groups.every(x=>['disconnected','restricted','error'].includes(x.status))?'disconnected':'empty',items,message:items.length?'':'종목 검색 데이터 연결 필요'});
 }
 if(path==='/api/stock'){
  const market=marketOf(url);if(market==='all')return json({error:'Invalid market'},400);const id=url.searchParams.get('id');if(!id||id.length>80)return json({error:'Invalid stock ID'},400);const quotesOnly=url.searchParams.get('quotesOnly')==='1',result=await providers.stocks[market](env,{id,quotesOnly});let items=result.items.filter(s=>s.id===id);if(market==='KR'&&!quotesOnly)items=await Promise.all(items.map(s=>attachKoreanDailyHistory(env,s,result)));if(env.DB&&result.policy?.chart)for(const stock of items){try{await persistResearchEvents(env,priceEvents(stock,result),{identities:[{key:stock.market+':'+stock.ticker,isin:stock.isin||null,source:result.source}]});}catch{}}return json({...result,items});
 }
 return json({error:'Not found'},404);
 }catch{return json(unavailable('데이터 처리 중 오류가 발생했습니다.','error'),500);}
}
