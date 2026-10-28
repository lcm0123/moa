import {CatalystStore,one,rows} from './catalyst/store.mjs';
import {profileAsset,readBusinessProfile,profileSafeUrl,issuerKey} from './catalyst/business-profile.mjs';
import {securityKey} from './security-identity.mjs';
import {finvizPolicy,requireFinviz} from './providers/finviz-client.mjs';
import {savedChatReports} from './catalyst/chat-reports.mjs';
import {readerSession,applyReadState} from './research-events.mjs';
import {readReportDocumentStates} from './document-state-api.mjs';
import {withMargins} from '../dist/js/financial-dashboard.js';

const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',...headers}});
const missing=message=>({status:'empty',message,annual:[],quarterly:[],updatedAt:null});
const normIssuer=(market,id)=>market==='US'?String(Number(id)):String(id);
const validInstrument=(market,ticker)=>typeof ticker==='string'&&/^[A-Z0-9][A-Z0-9.^_/-]{0,29}$/.test(ticker)&&!ticker.includes('..')&&securityKey(market,ticker)===market+':'+ticker;

// Instrument identity is kept separate from the issuer. Unmapped instruments
// can still use the quote/history API; no name-based financial matching occurs.
export async function workbenchIdentity(env,market,ticker){
 const key=securityKey(market,ticker);
 if(!validInstrument(market,ticker))throw Error('INVALID_SECURITY');
 const store=new CatalystStore(env.DB),asset=await profileAsset(store,market,ticker);
 const identity={key,market,ticker,instrumentId:asset?.id||key,issuerId:asset?.issuerId||null,assetType:'STOCK',exchange:asset?.exchange||null,name:asset?.name||ticker,currency:null,status:asset?'verified':'mapping_error'};
 if(!asset||asset.identityStatus!=='verified'){identity.status='mapping_error';identity.issuerId=null;return {identity,asset:null};}
 const link=await one(env.DB,'SELECT issuer_id FROM issuer_links WHERE market=? AND ticker=?',market,ticker);
 if(link&&normIssuer(market,link.issuer_id)!==normIssuer(market,asset.issuerId)){identity.status='mapping_error';identity.issuerId=null;return {identity,asset:null};}
 return {identity,asset:{...asset,market}};
}

// Reuse collector-normalized records, never call the provider/cache loader.
// The exact point (including fiscal period, original filing and derivation)
// is shared by the workbench and comparison API.
export async function readStoredFinancials(env,asset){
 if(!asset)return {...missing('기업 식별 정보가 부족해 재무를 연결하지 못했습니다.'),status:'mapping_error'};
 const market=asset.market|| (asset.kind==='KR_STOCK'?'KR':'US');
 if(market==='US'&&!finvizPolicy(env).display)return {...missing('Finviz 자료 표시 권한 확인 필요'),status:'restricted'};
 const keys=market==='US'?['finviz:statements:v1:'+asset.symbol]:['dart:financials:v7:'+asset.issuerId+':quarter','dart:financials:v7:'+asset.issuerId+':annual'];
 const packets=[];
 for(const key of keys){const row=await one(env.DB,'SELECT payload,updated_at FROM research_cache WHERE cache_key=?',key);if(!row)continue;const value=JSON.parse(row.payload);if(value.corpCode&&String(value.corpCode)!==String(asset.issuerId)||value.profile?.ticker&&value.profile.ticker!==asset.symbol)continue;packets.push({value,at:row.updated_at});}
 if(!packets.length)return missing('저장된 재무 자료가 없습니다. 시세·사업·자료는 각각 확인할 수 있습니다.');
 const result={...packets[0].value,annual:[],quarterly:[],cacheProvenance:{},identityStatus:market==='US'?'provider_ticker':'verified',masterIdentityStatus:'verified',updatedAt:packets.map(p=>p.at).sort().at(-1),source:packets[0].value.source,collectionMode:'stored_only'};
 if(market==='US'){const limitation='Finviz 티커로 저장된 재무입니다. 현재 기업 매핑과 별개로 과거 자료의 발행인 식별자는 미확인입니다.';result.message=[result.message,limitation].filter(Boolean).join(' ');result.limitations=[...new Set([...(result.limitations||[]),limitation])];}
 result.ratios=(packets[0].value.ratios||[]).map(ratio=>({...ratio,cacheRetrievedAt:packets[0].at}));
 for(const type of ['annual','quarterly']){
  const selected=packets.filter(p=>p.value[type]?.length).sort((a,b)=>String(b.at).localeCompare(String(a.at)))[0];
  result[type]=withMargins((selected?.value[type]||[]).filter(r=>r.end<=new Date().toISOString().slice(0,10)).slice(-24)).map(row=>({...row,cacheRetrievedAt:selected.at,cacheDataAsOf:row.end}));
  result.cacheProvenance[type]={cacheRetrievedAt:selected?.at||null,cacheDataAsOf:result[type].at(-1)?.end||null};
 }
 result.status=result.annual.length||result.quarterly.length?'ready':'empty';
 result.freshness=Date.now()-Date.parse(result.updatedAt)>86400000?'stored_older':'stored';
 result.dataAsOf=[...result.annual,...result.quarterly].map(r=>r.end).sort().at(-1)||null;
 return result;
}

export async function readStoredDocuments(env,asset,owner){
 const market=asset.market,ticker=asset.symbol,key=market+':'+ticker,items=[],coverage={};
 const tasks=[
  ['reports',async()=>{
   if(env.LOCAL_PREVIEW!==true&&env.TELEGRAM_REPORTS_PUBLIC_DISPLAY!=='true'){coverage.reports='restricted';return;}
   // Existing report extractor requires exact ticker; also require issuer map
   // equality rather than matching a company name mentioned in the report.
   const link=await one(env.DB,'SELECT * FROM issuer_links WHERE market=? AND ticker=?',market,ticker);
   if(!link||normIssuer(market,link.issuer_id)!==normIssuer(market,asset.issuerId)){coverage.reports='mapping_error';return;}
   for(const r of await savedChatReports(new CatalystStore(env.DB),market,ticker,8,link))items.push({id:r.id,kind:'report',title:r.title,publishedAt:r.publishedAt||r.postedAt?.slice(0,10),precision:'date',source:r.broker||'증권사 리포트',url:profileSafeUrl(r.url),href:r.reportPath,revision:r.revision||r.observedAt,fetchedAt:r.observedAt});
   coverage.reports='stored';
  }],
  ['filings',async()=>{
   if(market==='KR'){
    const data=await rows(env.DB,'SELECT receipt,title,received_date,submitter,updated_at,badges,event_id FROM dart_filings WHERE ticker=? AND corp_code=? ORDER BY received_date DESC,receipt DESC LIMIT 12',ticker,asset.issuerId);
    for(const r of data)items.push({id:r.receipt,eventId:r.event_id,kind:'filing',title:r.title,publishedAt:r.received_date,precision:'date',source:'OpenDART · '+r.submitter,url:'https://dart.fss.or.kr/dsaf001/main.do?rcpNo='+r.receipt,href:'/stock/KR/'+ticker+'?tab=filings&receipt='+r.receipt,revision:r.receipt,fetchedAt:r.updated_at,badges:JSON.parse(r.badges||'[]')});
   }else{
    if(!finvizPolicy(env).display){coverage.filings='restricted';return;}
    const data=await rows(env.DB,"SELECT f.* FROM sec_filings f JOIN sec_filing_issuers i ON i.accession=f.accession WHERE CAST(i.cik AS INTEGER)=? AND i.relation NOT IN ('unverified','pending') AND f.topic!='manager' ORDER BY f.filed_date DESC,f.accession DESC LIMIT 12",Number(asset.issuerId));
    for(const r of data)items.push({id:r.accession,kind:'filing',title:r.title_ko||r.form,publishedAt:r.accepted_at||r.filed_date,precision:r.accepted_at?'instant':'date',source:'SEC · '+r.form,url:profileSafeUrl(r.source_url),href:'/stock/US/'+encodeURIComponent(ticker)+'?tab=filings&accession='+r.accession,revision:r.source_hash||r.accession,fetchedAt:r.updated_at,amended:!!r.amended});
   }
   coverage.filings='stored';
  }],
  ['earnings',async()=>{
   if(market==='US'){try{requireFinviz(env,'calendar','EARNINGS');}catch{coverage.earnings='restricted';return;}}
   const data=await rows(env.DB,"SELECT e.* FROM research_events e JOIN research_securities s ON s.security_key=e.security_key WHERE e.security_key=? AND s.issuer_id=? AND e.kind='earnings' AND e.merged_into IS NULL ORDER BY e.event_date DESC LIMIT 12",key,asset.issuerId);
   for(const r of data){const p=JSON.parse(r.payload);items.push({id:r.id,eventId:r.id,eventRevision:r.revision,kind:'earnings',title:p.title||'실적 발표',publishedAt:p.at||p.date,precision:p.precision||'date',date:p.date,source:p.source||'저장된 실적 일정',href:'/stock/'+market+'/'+encodeURIComponent(ticker)+'?tab=financial',url:profileSafeUrl(p.sources?.[0]?.url),revision:r.revision,fetchedAt:r.collected_at||r.last_seen_at,timing:p.timing||p.session||null,scheduleStatus:p.status||'미확인'});}
   coverage.earnings='stored';
  }]
 ];
 for(const [name,read]of tasks)try{await read();}catch{coverage[name]='error';}
 // Resolve only previously persisted event IDs; a prefetch never creates one.
 const events=await rows(env.DB,"SELECT e.id,e.revision,e.kind,e.payload FROM research_events e JOIN research_securities s ON s.security_key=e.security_key WHERE e.security_key=? AND s.issuer_id=? AND e.kind IN ('report','filing') AND e.merged_into IS NULL ORDER BY e.event_date DESC LIMIT 100",key,asset.issuerId);
 for(const event of events){let p;try{p=JSON.parse(event.payload);}catch{continue;}const item=items.find(i=>i.eventId===event.id||i.kind===event.kind&&i.id===String(p.reportId||p.receipt||p.accession||''));if(item){item.eventId=event.id;item.eventRevision=event.revision;}}
 // Loading is not reading: this is a SELECT-only projection of existing marks.
 const marked=owner?await applyReadState(env.DB,items.filter(x=>x.eventId&&x.eventRevision),owner):[],readMap=new Map(marked.map(x=>[x.eventId,!x.unread]));
 for(const item of items)if(readMap.has(item.eventId))item.read=readMap.get(item.eventId);
 const documentStates=await readReportDocumentStates(env.DB,items.filter(i=>i.kind==='report').map(i=>i.id),owner);
 for(const item of items)if(item.kind==='report'&&documentStates.has(item.id)){const state=documentStates.get(item.id);item.read=!state.unread;item.reading=state;}
 items.sort((a,b)=>String(b.publishedAt||'').localeCompare(String(a.publishedAt||''))||a.id.localeCompare(b.id));
 return {items,coverage,dataAsOf:items.map(i=>i.publishedAt).filter(Boolean).sort().at(-1)||null,status:Object.values(coverage).includes('error')?'partial':items.length?'ready':'empty',message:items.length?'저장된 자료만 표시합니다.':'저장된 종목 자료가 없습니다. 새 수집은 시작하지 않습니다.'};
}

export async function stockWorkbenchApi(request,env){
 if(request.method!=='GET')return json({message:'조회만 지원합니다.'},405);
 if(!env.DB)return json({status:'error',message:'자료 저장소 연결 오류'},503);
 const p=new URL(request.url).searchParams,market=p.get('market'),ticker=p.get('ticker'),panel=p.get('panel')||'business';
 if(!validInstrument(market,ticker)||!['business','financial','documents'].includes(panel))return json({message:'종목과 정보 종류를 확인해 주세요.'},400);
 try{
  const {identity,asset}=await workbenchIdentity(env,market,ticker),fetchedAt=new Date().toISOString();
  if(!asset)return json({identity,panel,status:'mapping_error',message:'기업 식별 정보 연결 필요 · 시세와 차트는 별도로 확인할 수 있습니다.',data:null,fetchedAt});
  const reader=panel==='documents'?await readerSession(request):null;
  const data=panel==='business'?await readBusinessProfile(new CatalystStore(env.DB),asset,{sourceAllowed:env.CATALYST_SOURCE_ALLOWED}):panel==='financial'?await readStoredFinancials(env,asset):await readStoredDocuments(env,asset,reader.hash);
  const status=panel==='business'?(Object.values(data.groups).some(g=>g.datasets.length)||data.descriptions.length?'ready':'empty'):data.status;
  return json({identity:{...identity,issuer:issuerKey(asset),currency:data.currency||null},panel,status,message:data.message|| (status==='empty'?'아직 저장된 기업 자료가 없습니다.':null),data,dataAsOf:data.dataAsOf||null,fetchedAt,source:'기존 저장 자료'},200,reader?.headers);
 }catch{return json({status:'error',message:'저장 자료 조회 중 오류가 발생했습니다. 다시 시도해 주세요.'},500);}
}
