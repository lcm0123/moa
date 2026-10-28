import {securityKey} from './security-identity.mjs';
import {providers} from './providers/registry.mjs';
import {dartFinancials} from './providers/dart-financials.mjs';
import {finvizFinancialSnapshot} from './providers/finviz-financial-snapshot.mjs';
import {finvizFinancials} from './providers/finviz-financials.mjs';
import {workbenchIdentity,readStoredFinancials} from './stock-workbench-api.mjs';
const json=(d,status=200)=>new Response(JSON.stringify(d),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store'}});
export async function financialApi(request,env){
 const u=new URL(request.url),market=u.searchParams.get('market'),ticker=u.searchParams.get('ticker');if(request.method!=='GET')return json({message:'Method not allowed'},405);if(!securityKey(market,ticker))return json({message:'종목을 확인해 주세요.'},400);
 if(u.searchParams.get('stored')==='1'){
  const basic={profile:{ticker},annual:[],quarterly:[],ratios:[],updatedAt:null,collectionMode:'stored_only'};
  if(!env.DB)return json({...basic,status:'unavailable',message:'재무 저장소 연결 필요'});
  try{
   const {identity,asset}=await workbenchIdentity(env,market,ticker),profile={ticker,name:identity.name,exchange:identity.exchange};
   if(!asset)return json({...basic,identity,profile,status:'mapping_error',identityStatus:'unverified',message:'기업 식별 정보 연결 필요 · 시세와 차트는 별도로 확인할 수 있습니다.'});
   const data=await readStoredFinancials(env,asset);
   return json({...basic,...data,identity,masterIdentityStatus:identity.status,profile:{...profile,...data.profile}});
  }catch{return json({...basic,status:'error',message:'저장 재무 자료 조회 중 오류가 발생했습니다. 다시 확인해 주세요.'},500);}
 }
 const quote=await providers.stocks[market](env,{id:ticker,quotesOnly:true}),stock=quote.items?.find(s=>s.ticker===ticker),profile=stock?Object.fromEntries(['name','ticker','exchange','country','currency','sector','industry','marketCap','sharesOutstanding','yearHigh','yearLow','dividendYield','description'].filter(k=>stock[k]!=null&&stock[k]!=='').map(k=>[k,stock[k]])):{ticker};
 const basic={profile,quoteAsOf:stock?.asOf||quote.asOf,quoteSource:stock?.source||quote.source,quoteMode:quote.mode,quoteBaseDate:stock?.baseDate||quote.baseDate||null,quoteSyncedAt:stock?.syncedAt||quote.syncedAt||null,quoteStale:Boolean(stock?.stale||quote.stale),source:market==='US'?'Finviz · FactSet':'OpenDART',annual:[],quarterly:[],ratios:[],updatedAt:null};
 if(stock?.industry==='Exchange Traded Fund'||['ETF','ETN','ELW'].includes(stock?.type))return json({...basic,status:'not_applicable',message:'증권상품에는 일반 기업 재무제표를 적용하지 않습니다.'});
 if(market==='KR'){try{const data=await dartFinancials(env,ticker,u.searchParams.get('interval')==='quarter'?'quarter':'annual');return json({...basic,...data,profile:{...profile,...data.profile}});}catch{return json({...basic,status:'unavailable',message:'OpenDART 종목 고유번호 또는 재무 응답 확인 필요',identityStatus:'unverified'});}}
 basic.finvizSnapshot=await finvizFinancialSnapshot(env,ticker);
 try{return json({...basic,...await finvizFinancials(env,ticker)});}
 catch(error){return json({...basic,status:error.status||'unavailable',message:error.message||'Finviz 재무 데이터 연결 확인 필요',identityStatus:'unverified'});}
}
