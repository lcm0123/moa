import {CatalystStore} from './catalyst/store.mjs';
import {readBusinessProfile,issuerKey} from './catalyst/business-profile.mjs';
import {workbenchIdentity,readStoredFinancials,readStoredDocuments} from './stock-workbench-api.mjs';
import {parseComparisonSymbols,compareObservations,comparisonVersion,safeComparisonUrl} from '../dist/js/comparison-model.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const metrics=['revenue','operatingIncome','operatingMargin','operatingCashFlow','freeCashFlow','eps'];
export function financialObservation(identity,key,p,row,data,interval){
 if(!p||!Number.isFinite(p.value))return null;
 const dart=['CFS','OFS'].includes(p.basis),scope=dart?(p.basis==='CFS'?'CONSOLIDATED':'SEPARATE'):p.basis==='consolidated'?'CONSOLIDATED':p.consolidationScope||'UNKNOWN';
 // Finviz supplies FCF directly; its OCF-capex formula verifies that supplied
 // value. Only the separately calculated margins/derived quarters are derived.
 const suppliedFinviz=p.basis==='Finviz-FactSet'&&/^Finviz:/.test(p.tag||'')&&Number.isFinite(p.rawValue);
 const derived=p.derived||!suppliedFinviz&&(p.formula||p.inputs?.length);
 const fetchedAt=row.cacheRetrievedAt||data.updatedAt||null;
 return {instrumentId:identity.instrumentId,issuerId:identity.issuerId,metricId:key,value:p.value,unit:p.unit,scale:1,periodStart:p.start||null,periodStartDerived:!!p.startDerived,periodEnd:p.end||row.end,periodLabel:row.label,periodKind:interval==='quarter'?'SINGLE_QUARTER':'ANNUAL',fiscalYear:p.fy??row.fy??null,fiscalQuarter:p.quarter||null,consolidationScope:scope,accountingBasis:dart?'K-IFRS':p.basis==='consolidated'?'US-GAAP':p.accountingBasis||'UNKNOWN',sourceId:p.accession||null,sourceLocator:p.tag||null,sourceUrl:safeComparisonUrl(p.url),sourcePublishedAt:p.filedAt||null,dataAsOf:p.end||row.end,fetchedAt,valueOrigin:derived?'DERIVED':'DISCLOSED',availability:'available',freshness:fetchedAt&&Date.now()-Date.parse(fetchedAt)>86400000?'stored_older':data.freshness||'stored',calculationVersion:comparisonVersion,yoy:p.unit!=='%'&&Number.isFinite(p.yoy)?p.yoy:null,formula:p.formula||null};
}
export function projectComparisonFinancials(identity,data,interval='quarter'){
 const rows=data[interval==='quarter'?'quarterly':'annual']||[],row=rows.at(-1),observations=Object.fromEntries(metrics.map(key=>[key,financialObservation(identity,key,row?.values?.[key],row,data,interval)]));
 return {status:data.status,message:data.message||null,observations,period:row?{label:row.label,end:row.end}:null,source:data.source||null,updatedAt:row?.cacheRetrievedAt||data.updatedAt||null,currency:data.currency||null,limitations:data.limitations||[],fcfDefinition:data.fcfDefinition||null,valuation:(data.ratios||[]).filter(r=>Number.isFinite(r.value)).map(r=>({label:r.label,value:r.value,unit:r.unit,basis:r.basis,formula:r.formula,sourceUrl:safeComparisonUrl(r.sourceUrl),dataAsOf:r.dataAsOf||r.periodEnd||null,priceAsOf:r.priceAsOf||r.quoteAsOf||null,fetchedAt:r.cacheRetrievedAt||data.ratiosCacheRetrievedAt||data.updatedAt||null}))};
}
export async function comparisonApi(request,env){
 if(request.method!=='GET')return json({message:'조회만 지원합니다.'},405);
 if(!env.DB)return json({message:'자료 저장소 연결 오류'},503);
 let keys;const url=new URL(request.url),interval=url.searchParams.get('interval')||'quarter';
 try{keys=parseComparisonSymbols(url.searchParams.get('symbols'));if(keys.length<2||!['annual','quarter'].includes(interval))throw Error();}catch{return json({message:'국내·미국 종목 2~4개와 기간을 확인해 주세요.'},400);}
 try{
  const store=new CatalystStore(env.DB),businessByIssuer=new Map(),items=[];
  for(const key of keys){const [market,ticker]=key.split(':'),{identity,asset}=await workbenchIdentity(env,market,ticker),item={key,identity,business:null,financials:null,earnings:null,errors:{}};
   if(!asset){item.errors.identity='기업 매핑 확인 필요 · 시세 차트는 별도로 조회합니다.';items.push(item);continue;}
   const issuer=issuerKey(asset);
   if(!businessByIssuer.has(issuer))businessByIssuer.set(issuer,readBusinessProfile(store,asset,{sourceAllowed:env.CATALYST_SOURCE_ALLOWED}).catch(()=>null));
   const parts=await Promise.allSettled([businessByIssuer.get(issuer),readStoredFinancials(env,asset),readStoredDocuments(env,asset,null)]);
   if(parts[0].status==='fulfilled'&&parts[0].value)item.business=parts[0].value;else item.errors.business='사업 자료 조회 오류';
   if(parts[1].status==='fulfilled')item.financials=projectComparisonFinancials(identity,parts[1].value,interval);else item.errors.financials='재무 자료 조회 오류';
   if(parts[2].status==='fulfilled'){const today=new Date().toISOString().slice(0,10);item.earnings=parts[2].value.items.filter(e=>e.kind==='earnings').sort((a,b)=>String(a.date||a.publishedAt).localeCompare(String(b.date||b.publishedAt))).find(e=>(e.date||e.publishedAt)>=today)||null;}
   else item.errors.earnings='저장된 실적 일정 조회 오류';
   items.push(item);
  }
  return json({items,interval,version:comparisonVersion,metrics:metrics.map(metricId=>({metricId,...compareObservations(items.map(i=>i.financials?.observations[metricId]||null))})),notice:'기업별 최근 저장기간을 나란히 표시합니다. 기간·통화·회계 범위가 다르면 같은 기준 순위나 우열을 계산하지 않습니다.',collectionMode:'stored_only',fetchedAt:new Date().toISOString()});
 }catch{return json({message:'기업 비교 자료를 불러오지 못했습니다. 다시 시도해 주세요.'},500);}
}
