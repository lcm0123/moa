import {one,rows} from './store.mjs';
import {hash} from './core.mjs';
import {chatPolicy as p,validToolCall} from './chat-contract.mjs';
import {businessProfileForResearch} from './company-research-profile.mjs';
import {searchBusinessProfiles} from './profile-search.mjs';
import {ResearchSearchProvider} from './research-search.mjs';
import {publicSourceUrl} from './research-delivery.mjs';
import {catalog as macroSeries,topics} from '../macro/catalog.mjs';
import {savedChatReports} from './chat-reports.mjs';
const parse=s=>{try{return JSON.parse(s);}catch{return null;}};
const now=()=>new Date().toISOString();
const safe=publicSourceUrl;
function companyEvidenceView(s){
 if(!s.id)return s;
 // URLs/hashes stay in the server registry. The model needs observations and
 // qualifiers, not repeated provenance blobs for every row of the same table.
 const {id,title,kind,publishedAt,observedAt,text,coverage,note}=s;
 const data=s.data?{...s.data}:undefined;if(data?.quote)data.quote={text:data.quote.text,truncated:data.quote.truncated};
 const numbers=s.numbers?.map(({id,asset,metric,value,unit,period,start,basis,interval,display})=>({id,asset,metric,value,unit,period,start,basis,interval,display}));
 return {id,title,kind,publishedAt,observedAt,text,coverage,note,data,numbers};
}
// Context windows preserve complete paragraphs and neighbouring qualifications.
export function excerpt(text,focus='',limit=2200){
 text=String(text||'');const at=focus?text.toLowerCase().indexOf(focus.toLowerCase()):-1;
 let start=at>0?Math.max(0,text.lastIndexOf('\n',Math.max(0,at-400))):0;
 if(at>limit&&start===0)start=Math.max(0,at-400);
 let end=Math.min(text.length,start+limit),breakAt=text.lastIndexOf('\n',end);if(breakAt>start+limit*.6)end=breakAt;
 return {text:text.slice(start,end),truncated:start>0||end<text.length,range:[start,end]};
}
export function calculateObservation(operation,a,b){
 if(!a||!b||!Number.isFinite(a.value)||!Number.isFinite(b.value)||a.unit!==b.unit||a.basis!==b.basis||a.interval!==b.interval||a.asset!==b.asset)throw Error('INCOMPARABLE_VALUES');
 if(operation==='ratio_pct'&&a.period!==b.period)throw Error('PERIOD_MISMATCH');
 if(operation!=='ratio_pct'&&a.metric!==b.metric)throw Error('METRIC_MISMATCH');
 if(operation==='growth_pct'&&(b.value<=0||a.value<0))throw Error('NONPOSITIVE_GROWTH_BASE');
 if(operation==='ratio_pct'&&b.value<=0)throw Error('NONPOSITIVE_DENOMINATOR');
 const value=operation==='growth_pct'?(a.value/b.value-1)*100:operation==='ratio_pct'?a.value/b.value*100:a.value-b.value;
 return {value:Math.round(value*100)/100,unit:operation==='difference'?(a.unit==='%'?'%p':a.unit):'%',formula:operation==='growth_pct'?'(a / b - 1) × 100':operation==='ratio_pct'?'a / b × 100':'a - b',a,b};
}
export async function createChatTools(env,store,job,{history=[],reader,news,sourceAllowed=()=>false,search}={}){
 const evidence=new Map(),references=new Map(),observations=new Map(),assets=new Map(),memo=new Map(),documents=new Map(),coverage=new Map();let searches=0,reads=0,number=0,toolCalls=0;
 search||=new ResearchSearchProvider({...env,ENABLE_OPENAI_WEB_SEARCH:'false'},store,job);
 async function add(s){
  if(s.url&&!await sourceAllowed(s))return null;
  if(s.sourceUrls&&!(await Promise.all(s.sourceUrls.map(url=>sourceAllowed({url})))).every(Boolean))return null;
  const same=[...evidence.values()].findLast(x=>x.key===s.key);
  const value=({id,observedAt,...observation})=>JSON.stringify(observation);
  // A saved row can be corrected in place. Preserve its old evidence and add
  // the new observation instead of silently returning the baseline value.
  if(same&&value(same)===value(s))return same;
  if(evidence.size>=p.maxSources)return null;
  const id='E'+(++number),item={...s,id,observedAt:s.observedAt||now()};evidence.set(id,item);
  for(const o of item.numbers||[])observations.set(o.id,o);return item;
 }
 // Stored public evidence can be reused; an earlier AI answer is never added here.
 for(const turn of history.slice(-2)){
  for(const a of turn.result?.assets||[]){const current=await store.asset(a.id);if(current)assets.set(a.id,current);}
 }
 // Reserve half the registry for fresh evidence in a follow-up. The latest
 // snapshot already contains retained earlier evidence; do not load it twice.
 for(const turn of history.slice(-1)){
  const mapping=new Map(),calculations=[];
  for(const s of (turn.result?.contextEvidence||[]).slice(-Math.floor(p.maxSources/2))){const copy={...s};delete copy.id;const e=await add(copy);if(e){mapping.set(s.id,e.id);if(s.inputRefs)calculations.push({e,refs:s.inputRefs});}}
  for(const {e,refs} of calculations){e.inputRefs=refs.map(id=>mapping.get(id)).filter(Boolean);if(e.inputRefs.length!==refs.length)evidence.delete(e.id);}
 }
 observations.clear();for(const s of evidence.values())for(const o of s.numbers||[])observations.set(o.id,o);
 const ref=(url,title,extra={})=>{url=safe(url);if(!url)return null;const known=[...references].find(([,v])=>v.url===url);if(known)return {reference:known[0],...known[1]};const id='D'+(references.size+1);references.set(id,{url,title,...extra});return {reference:id,url,title,...extra};};
 for(const s of evidence.values())if(s.url)ref(s.url,s.title,{publishedAt:s.publishedAt});
 async function find_assets({query,market}){
  const kind=market==='ALL'?null:market==='CRYPTO'?'CRYPTO':market+'_STOCK';
  const q=query.trim().toLowerCase(),tokens=' '+q.replace(/[^\p{L}\p{N}.-]+/gu,' ')+' ',found=await rows(store.db,"SELECT id FROM catalyst_assets WHERE (? IS NULL OR kind=?) AND (lower(symbol)=? OR instr(lower(name),?)>0 OR instr(?,' '||lower(name)||' ')>0 OR instr(?,' '||lower(symbol)||' ')>0 OR id IN (SELECT asset_id FROM catalyst_aliases WHERE instr(lower(alias),?)>0)) ORDER BY CASE WHEN lower(symbol)=? OR lower(name)=? THEN 0 WHEN instr(?,' '||lower(symbol)||' ')>0 THEN 1 ELSE 2 END LIMIT 6",kind,kind,q,q,tokens,tokens,q,q,q,tokens);
  const list=[];for(const f of found){const a=await store.asset(f.id);assets.set(a.id,a);list.push({id:a.id,name:a.name,ticker:a.symbol,kind:a.kind,issuerId:a.issuerId});}
  if(!list.length&&market!=='CRYPTO')for(const a of await searchBusinessProfiles(store,query,{market:kind?market:null,limit:4,sourceAllowed})){assets.set(a.assetId,await store.asset(a.assetId));list.push({id:a.assetId,name:a.name,ticker:a.ticker,kind:a.market+'_STOCK',match:'saved business text; read business evidence before concluding'});}
  return {assets:list,status:list.length?'found':'not_in_saved_index',note:'Ticker ambiguity requires user selection; absence does not imply no relevant companies.'};
 }
 async function read_data({asset_ids,dataset,period,fields=[]},limits={}){
  if(dataset==='company'){
   if(asset_ids.length>2)return {status:'company_limit',items:[],note:'Read at most two companies together; use the exact requested tickers.'};
   const items=[],sections=[];
   for(const id of [...new Set(asset_ids)]){
    const a=await store.asset(id);if(!a||!['KR_STOCK','US_STOCK'].includes(a.kind)){sections.push({asset:id,status:'stock_identity_required'});continue;}
    // Keep all three types within the existing source/token budget. A failed
    // section cannot discard the other stored data; this tool never collects.
    for(const part of ['business','financials','reports']){
     let r;try{r=await read_data({asset_ids:[id],dataset:part,period,fields},{businessRows:asset_ids.length===1?4:2,financialRows:2,reportRows:asset_ids.length===1?2:1,includeCompanyTotal:false});}catch{r={status:'read_failed',items:[]};}
     const ids=r.items.filter(e=>e.id&&evidence.has(e.id)).map(e=>e.id),status=ids.length?'available':r.status==='read_failed'?'read_failed':evidence.size>=p.maxSources?'evidence_limit':'not_available';
     const section={asset:id,name:a.name,dataset:part,status,refs:ids};coverage.set(id+':'+part,section);sections.push(section);items.push(...r.items.map(companyEvidenceView));
    }
   }
   return {status:items.some(e=>e.id&&evidence.has(e.id))?'read':'no_saved_evidence',sections,items,
    note:'Stored DB only. Combine business exposure, realized financials and attributed report opinions in analysis. Missing means unavailable in this bounded snapshot, NOT not disclosed. Broader segment share is not the share of a narrower product. Report forecasts are NOT actual results.'};
  }
  const out=[];for(const id of asset_ids){const before=out.length,asset=await store.asset(id);if(!asset){out.push({id,status:'identity_not_found'});continue;}assets.set(id,asset);const market=asset.kind==='KR_STOCK'?'KR':asset.kind==='US_STOCK'?'US':'CRYPTO';
   if(dataset==='financials'){
    const keys=market==='US'?['finviz:statements:v1:'+asset.symbol,'sec:financials:v3:'+asset.issuerId]:market==='KR'?['dart:financials:v7:'+asset.issuerId+':'+period]:[];
    let saved;for(const key of keys){const r=await one(store.db,'SELECT payload,updated_at FROM research_cache WHERE cache_key=?',key);if(r){const v=parse(r.payload);if((v?.[period==='quarter'?'quarterly':'annual']||[]).length){saved={...r,value:v};break;}}}
    if(!saved){out.push({asset:id,status:'financials_not_collected',note:'Credit/CDS not connected. No invented values.'});continue;}
    const selected=saved.value[period==='quarter'?'quarterly':'annual'].slice().sort((a,b)=>String(a.end).localeCompare(String(b.end))).slice(-(limits.financialRows||4));
    const metrics=['revenue','operatingIncome','netIncome','eps','operatingCashFlow','capitalExpenditure','freeCashFlow'].filter(m=>(fields.length?fields:['revenue','operatingIncome','operatingCashFlow','freeCashFlow']).includes(m));
    for(const row of selected){const numbers=[];for(const metric of metrics){const v=row.values?.[metric];if(!v||!Number.isFinite(v.value))continue;const oid='N'+(await hash(JSON.stringify([id,metric,v]))).slice(0,12);numbers.push({id:oid,asset:id,metric,value:v.value,unit:v.unit,period:v.end||row.end,start:v.start,basis:v.basis||'unknown',interval:v.interval||period,filedAt:v.filedAt,display:v.unit==='USD'?(v.value/1e6).toLocaleString('en-US',{maximumFractionDigits:4})+' million USD':v.unit==='KRW'?(v.value/1e8).toLocaleString('ko-KR',{maximumFractionDigits:4})+'억원':v.value+' '+v.unit});}
     if(!numbers.length)continue;
     const first=Object.values(row.values||{}).find(x=>x?.url),e=await add({key:id+':financial:'+period+':'+row.end+':'+metrics.join(',')+':'+saved.updated_at,title:asset.name+' '+row.label,url:safe(first?.url),publishedAt:first?.filedAt,observedAt:saved.updated_at,numbers,data:{asset:id,periodEnd:row.end,relativePosition:row===selected.at(-1)?'latest_saved':'earlier_saved'},kind:'financials',freshness:'stored snapshot; not live'});if(e)out.push(e);
    }
   }else if(dataset==='business'){
    const profile=await businessProfileForResearch(store,asset,{sourceAllowed});
    const candidates=period==='quarter'?profile.calculations.quarters:profile.observations.filter(x=>x.period?.type==='ANNUAL');
    const records=(candidates.length?candidates:profile.observations).slice().sort((a,b)=>String(b.period?.end).localeCompare(String(a.period?.end)));
    const latest=records[0]?.period?.end,selected=records.filter(x=>x.period?.end===latest).slice(0,limits.businessRows||4);
    for(const item of [...profile.descriptions.slice(0,1),...selected]){const url=item.sourceUrl||item.url||item.source?.url;if(!safe(url))continue;
     const data={asset:id,label:item.label,dimension:item.dimension,amount:item.amountExact??item.amount,percent:item.percent,unit:item.unit,period:item.period,scope:item.scope,basis:item.basis,amountOrigin:item.valueOrigin,shareOrigin:item.shareOrigin,totalRevenue:item.totalRevenueExact??item.totalRevenue,denominator:item.denominatorLabel,revenueDefinition:item.revenueDefinition,comparisonReview:item.comparabilityReview,formula:item.formula,quote:excerpt(item.quote||'', '',600)};
     if(item.dimension)data.shareCalculation=item.percent===null||item.percent===undefined||item.comparabilityReview?'BLOCKED':'STORED_VALUE_ONLY';
     const s=await add({key:'business:'+(item.id||item.claimId),title:asset.name+' 사업·매출',url:safe(url),sourceUrls:item.inputs?.map(x=>x.sourceUrl).filter(Boolean),documentHash:item.documentHash,publishedAt:item.publishedAt,observedAt:profile.updatedAt,kind:'business',data});if(s)out.push(s);}
    const total=profile.companyRevenue.find(r=>selected.some(x=>r.period.start===x.period.start&&r.period.end===x.period.end&&r.scope===x.scope));
    if(total&&limits.includeCompanyTotal!==false){const e=await add({key:'business-total:'+id+':'+total.accession+':'+total.period.end,title:asset.name+' 전체 매출 대조',url:total.sourceUrl,publishedAt:total.publishedAt,observedAt:total.cacheUpdatedAt,kind:'business',data:{...total,asset:id,shareCalculation:'BLOCKED',restriction:'CROSSCHECK ONLY. This company total does NOT authorize dividing segment revenue. Segment consolidation/elimination scope is unverified.'}});if(e)out.push(e);}
    out.push({asset:id,status:selected.length?'partial_business_snapshot':'business_not_collected',returnedRows:selected.length,availableRows:records.length,requestedPeriod:period,note:'Bounded latest-period view, NOT the entire DB. Missing share does not prove missing total revenue. Company revenue is crosscheck only: scope/internal revenue differences can prevent a valid share. Preserve DISCLOSED vs DERIVED, quarter vs YTD.'});
   }else if(dataset==='filings'){
    const filings=market==='KR'?await rows(store.db,'SELECT title,received_date date,receipt ref FROM dart_filings WHERE ticker=? ORDER BY received_date DESC LIMIT 5',asset.symbol):market==='US'?await rows(store.db,'SELECT f.title_ko title,f.filed_date date,f.source_url url,f.form FROM sec_filings f JOIN sec_filing_issuers i ON i.accession=f.accession WHERE i.cik=? ORDER BY f.filed_date DESC LIMIT 5',asset.issuerId):[];
    out.push(...filings.map(f=>ref(f.url||'https://dart.fss.or.kr/dsaf001/main.do?rcpNo='+f.ref,f.title,{publishedAt:f.date,assetId:id})).filter(Boolean));
   }else if(dataset==='reports'){
    for(const r of await savedChatReports(store,market,asset.symbol,limits.reportRows||3)){const url=safe(r.url);if(!url)continue;
     const e=await add({key:'report:'+r.id+':'+r.revision,title:r.title,url,publishedAt:r.publishedAt,observedAt:r.observedAt,kind:'report_notice',...excerpt(r.text,'',1200),data:{asset:id,broker:r.broker,postedAt:r.postedAt,fields:r.fields},reportPath:r.reportPath,coverage:r.coverage,
      sourceUrls:r.duplicateSources.map(s=>safe(s.url)).filter(Boolean),note:'Attributed broker opinion/forecast, not company actual results or consensus. No full PDF text.'});if(e)out.push(e);}
   }else if(dataset==='market'){
    if(market==='CRYPTO'){const r=await one(store.db,"SELECT payload,received_at FROM cmc_cache WHERE cache_key='binance:spot:snapshot'"),v=parse(r?.payload)?.items?.find(x=>x.symbol?.toLowerCase()===asset.symbol.toLowerCase());if(v){const e=await add({key:'quote:'+id+':'+v.asOf,title:asset.name+' 저장 시세',url:'https://www.binance.com/en/trade/'+v.baseAsset+'_USDT',observedAt:r.received_at,kind:'market',freshness:'stored, NOT current',data:{price:v.price,currency:'USDT',return24h:v.return24h,periodHours:24,asOf:v.asOf}});if(e)out.push(e);}}
    else {const r=await one(store.db,'SELECT payload,verified_at FROM catalyst_facts WHERE asset_id=? AND category=?',id,'market');if(r){const e=await add({key:'quote:'+id+':'+r.verified_at,title:asset.name+' 저장 시세',url:null,kind:'market',data:parse(r.payload),observedAt:r.verified_at,freshness:'stored, NOT current'});if(e)out.push(e);}}
    if(!out.length)out.push({asset:id,status:'market_not_collected',note:'Use dated sources; do not invent live quotes.'});
   }else if(dataset==='exposure'){
    const facts=await rows(store.db,"SELECT payload FROM catalyst_claims WHERE subject_id=? AND status IN ('VERIFIED','SUPPORTED') ORDER BY checked_at DESC LIMIT 5",id);
    for(const row of facts){const f=parse(row.payload);for(const sid of f.sourceIds||[]){const s=await one(store.db,'SELECT body,payload FROM catalyst_sources WHERE id=?',sid);if(!s)continue;const v={...parse(s.payload),body:s.body};if(!store.sourceReady?.(v))continue;const e=await add({key:'exposure:'+f.id,title:asset.name+' 저장 근거',url:v.url,documentHash:v.documentHash,kind:'source',...excerpt(f.quote),publishedAt:v.publishedAt,observedAt:v.observedAt,note:'Stored claim is supporting evidence, not a new event or forecast.'});if(e)out.push(e);}}
   }
   if(out.length===before)out.push({asset:id,status:dataset+'_not_collected'});
  }return {items:out,status:out.length?'read':'not_collected'};
 }
 async function read_macro({query}){
  const tokens=query.toLowerCase().split(/\s+/).filter(Boolean),defs=macroSeries.filter(d=>tokens.some(t=>JSON.stringify([d.id,d.name,d.aliases,topics[d.topic],d.topics?.map(t=>topics[t])]).toLowerCase().includes(t))).slice(0,3),items=[];
  for(const def of defs){const m=await one(store.db,'SELECT payload FROM fred_macro_cache WHERE cache_key IN (?,?) AND error_code IS NULL ORDER BY retrieved_at DESC LIMIT 1','meta:v2:'+def.id,'meta:approved:'+def.id),r=await one(store.db,'SELECT * FROM fred_macro_cache WHERE cache_key=?','observations:full:'+def.id);if(!m||!r)continue;const meta=parse(m.payload),data=parse(r.payload)?.observations?.filter(o=>o.value!=='.'&&Number.isFinite(Number(o.value))).slice(-4)||[];
   const numbers=data.map(o=>({id:'N'+def.id+o.date.replaceAll('-',''),asset:def.id,metric:def.id,period:o.date,unit:meta.units,basis:meta.seasonal,interval:meta.frequency,value:Number(o.value)}));
   const e=await add({key:'fred:'+def.id+':'+r.retrieved_at,title:def.name||meta.title,url:'https://fred.stlouisfed.org/series/'+def.id,kind:'macro',data:{id:def.id,unit:meta.units,seasonal:meta.seasonal,frequency:meta.frequency,fredUpdatedAt:meta.lastUpdated,observations:numbers},numbers,observedAt:r.retrieved_at,freshness:r.error_code||'saved observations; observation dates differ from retrieval date'});if(e)items.push(e);
  }return {items,status:items.length?'read':'no_saved_series',note:'US FRED only. Search individual series IDs if a broad term did not match.'};
 }
 async function search_sources({query,scope}){
  const cached=await rows(store.db,"SELECT id,url,title,published_at,observed_at,payload FROM catalyst_sources WHERE instr(lower(title),lower(?))>0 ORDER BY observed_at DESC LIMIT 4",query);
  const local=[];for(const s of cached){const v=parse(s.payload);if(store.sourceReady?.(v)&&await sourceAllowed(v))local.push(ref(s.url,s.title,{sourceId:s.id,publishedAt:s.published_at}));}
  if(local.length||scope==='stored')return {status:local.length?'cached':'no_stored_matches',items:local};
  if(++searches>p.maxSearches)return {status:'search_budget_exhausted',items:[]};
  let r;if(scope==='news')r=await news?.(query)||{status:'news_provider_unavailable',items:[]};else r=await search.search({query:query+(scope==='official'?' official filing investor relations':''),language:/[가-힣]/.test(query)?'ko':'en',maxResults:4},{stage:'discovery'});
  const items=[];for(const s of r.items||[])if(await sourceAllowed(s)){const d=ref(s.url||s.link,s.title,{publishedAt:s.publishedHint||s.publishedAt||null});if(d)items.push(d);}
  return {status:r.status||'discovered',items,note:'Discovery only. Read original before citing facts. No result is not proof of absence.'};
 }
 async function read_document({reference,focus}){
  const item=references.get(reference);if(!item)return {status:'reference_not_authorized'};
  if(++reads>p.maxDocumentReads)return {status:'document_budget_exhausted'};
  let s=documents.get(item.url);if(!s){if(item.sourceId){const r=await one(store.db,'SELECT payload,body FROM catalyst_sources WHERE id=?',item.sourceId);s={...parse(r?.payload),body:r?.body};}
   else s=await reader?.(item,{asset:item.assetId?await store.asset(item.assetId):null,purpose:'STATIC_ARTICLE'});
   documents.set(item.url,s||{status:'read_failed'});
  }
  if(!s||s.status==='read_failed'||!store.sourceReady?.(s)||!await sourceAllowed(s))return {status:'read_failed',code:s?.code||'source_not_ready'};
  const e=await add({key:'document:'+s.url+':'+s.contentHash,title:s.title||item.title,url:s.url,documentHash:s.documentHash,kind:'source',publishedAt:s.publishedAt,observedAt:s.observedAt,locator:s.locator,...excerpt(s.body,focus),untrusted:true});return e||{status:'evidence_limit'};
 }
 async function calculate({operation,a,b}){try{const v=calculateObservation(operation,observations.get(a),observations.get(b)),parents=[...evidence.values()].filter(s=>s.numbers?.some(n=>n.id===a||n.id===b)),e=await add({key:'calc:'+operation+':'+a+':'+b,title:'기간·수치 비교',url:null,kind:'calculation',data:v,inputRefs:parents.map(s=>s.id),sourceUrls:parents.map(s=>s.url).filter(Boolean)});return e||{status:'evidence_limit'};}catch(e){return {status:e.message};}}
 const handlers={find_assets,read_data,read_macro,search_sources,read_document,calculate};
 return {evidence,assets,references,async execute(name,args){
  if(!validToolCall(name,args))return {status:'invalid_tool_arguments'};
  if(++toolCalls>p.maxToolCalls)return {status:'tool_budget_exhausted'};
  const key=JSON.stringify([name,args]);if(memo.has(key))return {...memo.get(key),reused:true};
  let result;try{result=await handlers[name](args);}catch(e){result={status:'tool_failed',code:/^[A-Z_0-9]+$/.test(e.message)?e.message:'DATA_READ_FAILED'};}memo.set(key,result);return result;
 },snapshot(){return {evidence:[...evidence.values()],coverage:[...coverage.values()],references:[...references].map(([reference,s])=>({reference,...s})),assets:[...assets.values()].filter(Boolean).map(a=>({id:a.id,name:a.name,symbol:a.symbol,kind:a.kind})),searches,reads,toolCalls};}};
}
