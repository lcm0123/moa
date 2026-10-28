import {hash,norm,safeUrl} from './core.mjs';
import {one,rows} from './store.mjs';
import {sourceAuthority,validationStages} from './claim-validation.mjs';
import {businessSourceMatchesAsset} from './beneficiary-extraction.mjs';
import {decimal,calculateProfile} from './profile-calculations.mjs';
import {indexBusinessProfile} from './profile-search.mjs';
import {cachedCompanyRevenue} from './profile-company-revenue.mjs';
import {adjustedRevenueTableObservations} from './profile-adjusted-tables.mjs';
import {periodAvailableAtSource} from './profile-column-period.mjs';
export const businessProfileVersion='business-profile-1';
export const profileDimensions=['BUSINESS_SEGMENT','PRODUCT','END_MARKET','DOMESTIC_EXPORT','GEOGRAPHY','CUSTOMER'];
export const issuerKey=a=>a.issuerId&&['KR','US'].includes(a.market)?a.market+':'+String(a.market==='US'?Number(a.issuerId):a.issuerId):null;
export const profileRequestKey=a=>'business-profile-request:'+issuerKey(a);
// Apply on both ingestion and projection: older stored claims remain auditable,
// but reporting policies, forecasts and management opinions are not an overview.
export function businessDescriptionContentAllowed(value){
 const quote=String(value||'');
 return !/\b(?:will|would|expects?|plans?|intends?|aims?|forecasts?|anticipates?|could|may|believes?|not|no longer)\b|예정|예상|전망|목표|계획|않습니다|않는다|생각합|판단합/i.test(quote)
  &&!/\b(?:revenue|net income|operating income|EBITDA|EPS|leading|leader|largest|best.in.class|GAAP|IFRS|accounting|financial (?:reporting|statements?|condition|results|performance|measures?)|supplemental information)\b|매출액|영업이익|순이익|재무제표|회계기준|업계\s*최고/i.test(quote);
}
export async function profileAsset(store,market,ticker){
 const found=await rows(store.db,'SELECT id FROM catalyst_assets WHERE kind=? AND symbol=? AND issuer_id IS NOT NULL',market==='KR'?'KR_STOCK':'US_STOCK',ticker);
 return found.length===1?store.asset(found[0].id):null;
}
export function profilePeriod(label,title='',explicit=null){
 if(explicit?.start&&explicit?.end)return {...explicit,label:explicit.label||label,dateConfidence:explicit.dateConfidence||'EXPLICIT'};
 const year=/(20\d{2})/.exec(label||'')?.[1],report=/(20\d{2})\.(\d{2})/.exec(title),y=year||report?.[1];
 if(!y)return {label:label||'기간 미확인',start:null,end:null,type:'UNKNOWN'};
 const m=/1\s*[~–-]\s*(\d{1,2})월/.exec(label)?.[1]||(/반기|H1/i.test(label)?'06':/연간|annual/i.test(label)?'12':report?.[1]===y?report[2]:null);
 if(!m)return {label,start:null,end:null,type:'UNKNOWN'};
 const month=String(m).padStart(2,'0'),day=new Date(Date.UTC(+y,+m,0)).getUTCDate();
 return {label,start:y+'-01-01',end:`${y}-${month}-${day}`,type:month==='12'?'ANNUAL':'YTD',fiscalYear:+y,fiscalQuarter:[3,6,9,12].includes(+m)?+m/3:null,dateConfidence:'REPORT_LABEL'};
}
export function comparableShare(n,d){
 if(!n||!d||![n.amount,d.amount].every(Number.isFinite)||n.amount<0||d.amount<=0)return null;
 const keys=['issuer','periodStart','periodEnd','periodType','scope','currency','unit','revenueDefinition'];
 if(keys.some(k=>!n[k]||['UNKNOWN','UNSPECIFIED'].includes(n[k])||n[k]!==d[k]))return null;
 return n.amount/d.amount<=1?n.amount/d.amount*100:null;
}
export function profileSafeUrl(value){try{if(!safeUrl(value))return null;const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!/^(localhost|127\.|10\.|192\.168\.)/.test(u.hostname)?u.href:null;}catch{return null;}}
export async function persistProfileObservations(store,asset,source,observations){
 if(!issuerKey(asset)||source.assetId!==asset.id||!sourceAuthority(source,asset)||!businessSourceMatchesAsset(source,asset)||source.securityVersion!=='security-1'||!source.documentId||!source.documentHash||!profileSafeUrl(source.url))return [];
 const output=[];let signedRows=null;
 for(const candidate of observations){
  let o=candidate;const negative=String(decimal(o.amountExact??o.value)||'').startsWith('-')||o.reportedPercent<0;
  if(negative||o.headerEvidence?.signedTable){
   signedRows??=adjustedRevenueTableObservations(source);
   const proven=signedRows.find(r=>r.locator===o.locator&&r.label===o.label&&r.amountExact===decimal(o.amountExact??o.value)&&r.reportedPercent===o.reportedPercent&&r.totalRevenueExact===decimal(o.totalRevenueExact??o.totalRevenue));
   if(!proven)continue;o=proven;
  }
  if(!profileDimensions.includes(o.dimension)||!o.label||!o.rowQuote||!norm(source.body).includes(norm(o.rowQuote)))continue;
  if(o.value!==null&&decimal(o.amountExact??o.value)===null||o.reportedPercent!==null&&(!Number.isFinite(o.reportedPercent)||o.reportedPercent<0&&!o.isAdjustment||o.reportedPercent>100&&!o.headerEvidence?.signedTable))continue;
  const period=profilePeriod(o.period,source.title,o.explicitPeriod),key=o.locator,category='profile:'+o.dimension;
  if(!periodAvailableAtSource(period,source))continue;
  const id=await hash([businessProfileVersion,issuerKey(asset),source.id,key].join('|')),claimId=await hash('profile-claim:'+id),checkedAt=new Date().toISOString();
  const checks=Object.fromEntries(validationStages.map(k=>[k,{status:'PASS',reason:'Official issuer section; exact row, disclosed period, unit and scope retained'}]));
  const record={id,issuer:issuerKey(asset),assetId:asset.id,metric:o.metric||'REVENUE_COMPOSITION',dimension:o.dimension,label:o.label,parent:o.parent||null,amount:o.value,percent:o.reportedPercent??o.calculatedShare??null,unit:o.unit,currency:/USD|dollar/i.test(o.unit)?'USD':/KRW|원/.test(o.unit)?'KRW':null,period,scope:o.scope||'UNSPECIFIED',denominatorKind:o.denominatorKind||'UNKNOWN',denominatorLabel:o.denominatorLabel||null,totalRevenue:o.totalRevenue??null,basis:o.basis||'DISCLOSED',geographyBasis:o.geographyBasis||'UNKNOWN',revenueDefinition:o.revenueDefinition||'DISCLOSED_OTHER',complete:false,tableKey:o.tableKey||key,sourceId:source.id,claimId,locator:key,sourceUrl:source.url,sourceTitle:source.title,publishedAt:source.publishedAt||null,collectedAt:source.observedAt||null,checkedAt,quote:o.rowQuote,verificationStatus:'VERIFIED',version:businessProfileVersion,extractionVersion:'revenue-table-2',documentHash:source.documentHash,correction:/정정|amend|(?:10-[QK]|20-F|6-K|40-F)\/A\b/i.test(source.title||'')};
  Object.assign(record,{amountExact:decimal(o.amountExact??o.value),totalRevenueExact:decimal(o.totalRevenueExact??o.totalRevenue),reportedShare:o.reportedPercent,calculatedShare:o.calculatedShare??(record.basis==='DERIVED'?record.percent:null),shareOrigin:o.shareOrigin||(record.percent===null?null:record.basis==='DERIVED'?'DERIVED':'DISCLOSED'),valueOrigin:record.basis==='RESEARCH_ESTIMATE'?'ESTIMATED':'DISCLOSED',businessItemId:await hash([record.issuer,record.dimension,record.parent,record.label,o.classificationVersion||'original-label-v1'].join('|')),entityScope:o.entityScope||record.issuer,classificationVersion:o.classificationVersion||'original-label-v1',normalizedConceptId:o.normalizedConceptId||null,revisionGroup:o.revisionGroup||'ORIGINAL',multiplier:o.multiplier??(/trillion/.test(record.unit)?1000000000000:/billion/.test(record.unit)?1000000000:/백만원|million/.test(record.unit)?1000000:/천원|thousand/.test(record.unit)?1000:/억원/.test(record.unit)?100000000:1),documentId:source.documentId,extractionVersion:o.extractionVersion||'revenue-table-2',rights:{provider:'OFFICIAL_ISSUER',display:'SOURCE_FACTS_ONLY',fullDocumentRedistribution:false}});
  record.comparabilityReview=!!o.comparabilityReview||/(?:segment|reporting unit).{0,80}(?:reorganiz|realign|recast)|(?:사업부문|부문별).{0,40}(?:개편|재작성|변경)/i.test(source.body||'');if(record.comparabilityReview&&!o.revisionGroup)record.revisionGroup='SCOPE_REVIEW:'+source.documentHash;
  record.scopeNotes=Array.isArray(o.scopeNotes)?o.scopeNotes.slice(0,4):[];
  record.isAdjustment=o.isAdjustment===true;record.adjustmentType=record.isAdjustment?o.adjustmentType:null;
  record.headerEvidence=o.headerEvidence||null;record.xbrl=o.context?{concept:o.concept,context:o.context,sign:o.sign,scale:o.scale,decimals:o.decimals}:null;
  record.numerator={issuer:record.issuer,amount:record.amount,amountExact:record.amountExact,period,scope:record.scope,currency:record.currency,unit:record.unit,sourceId:source.id,locator:key};record.denominator={...record.numerator,amount:record.totalRevenue,amountExact:record.totalRevenueExact,definition:record.revenueDefinition,label:record.denominatorLabel};
  const claim={id:claimId,type:'revenue_share',subject:asset.id,predicate:'DISCLOSED_'+record.metric,value:record.quote,object:record.label,quote:record.quote,status:'VERIFIED',confidence:'HIGH',period,scope:{consolidation:record.scope},sourceIds:[source.id],asOf:source.publishedAt,validationVersion:businessProfileVersion,validationChecks:checks,sourceEvidence:[{sourceId:source.id,quote:record.quote,locator:key,independenceKey:source.independenceKey||source.id,status:'VERIFIED',version:businessProfileVersion,checks}],tableEvidence:record,securityVersion:'security-1'};
  await store.saveClaim(claim,'business-profile:'+issuerKey(asset));
  await store.db.batch([
   store.db.prepare(`INSERT INTO company_metadata_facts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET category=excluded.category,period=excluded.period,lifecycle_status='ACTIVE',payload=excluded.payload,revenue_value=excluded.revenue_value,revenue_ratio=excluded.revenue_ratio,last_verified_at=excluded.last_verified_at,verification_status=excluded.verification_status`).bind(id,asset.id,category,key,'DISCLOSED',record.metric,record.amount,record.percent,JSON.stringify(period),'VERIFIED',JSON.stringify([claimId]),checkedAt,source.id,source.publishedAt||null,'ACTIVE',JSON.stringify(record)),
   store.db.prepare('INSERT OR IGNORE INTO company_metadata_claims VALUES(?,?)').bind(id,claimId)
  ]);output.push(record);
 }
 return output;
}
export async function storedProfileObservations(store,asset,sourceId=null){
 const list=await rows(store.db,`SELECT f.payload FROM company_metadata_facts f JOIN catalyst_assets a ON a.id=f.company_id WHERE a.kind=? AND a.issuer_id=? AND f.category LIKE 'profile:%' AND f.verification_status='VERIFIED' AND f.lifecycle_status='ACTIVE' ${sourceId?'AND f.source_id=?':''} ORDER BY f.source_date DESC LIMIT 600`,asset.kind,asset.issuerId,...sourceId?[sourceId]:[]);
 return list.map(r=>JSON.parse(r.payload));
}
export async function readBusinessProfile(store,asset,{sourceAllowed=()=>false,now=Date.now()}={}){
 const request=await store.runtime(profileRequestKey(asset)),data=[],sources=new Map();
 for(const r of await storedProfileObservations(store,asset)){
  if(!periodAvailableAtSource(r.period,{publishedAt:r.publishedAt,observedAt:r.collectedAt},{now}))continue;
  if(!sources.has(r.sourceId))sources.set(r.sourceId,await one(store.db,"SELECT id,url,json_extract(payload,'$.securityVersion') securityVersion,json_extract(payload,'$.documentHash') documentHash FROM catalyst_sources WHERE id=?",r.sourceId));
  const s=sources.get(r.sourceId);if(!s||s.securityVersion!=='security-1'||s.documentHash!==r.documentHash||!await sourceAllowed(s))continue;
  const claim=await one(store.db,'SELECT status FROM catalyst_claims WHERE id=?',r.claimId);if(claim?.status!=='VERIFIED')continue;
  data.push(r);
 }
 const groups={};for(const dimension of profileDimensions){
  const values=data.filter(r=>r.dimension===dimension),sets=new Map();
  for(const r of values){const k=r.tableKey;if(!sets.has(k))sets.set(k,{key:k,period:r.period,scope:r.scope,sourceUrl:r.sourceUrl,sourceTitle:r.sourceTitle,publishedAt:r.publishedAt,correction:r.correction,denominator:r.denominatorLabel,items:[],complete:false});sets.get(k).items.push(r);}
  const datasets=[...sets.values()].sort((a,b)=>(b.period.type==='ANNUAL')-(a.period.type==='ANNUAL')||String(b.period.end).localeCompare(String(a.period.end))||String(b.publishedAt).localeCompare(String(a.publishedAt)));
  // Keep prior filings as history; newest revision wins within the same period + scope.
  const seen=new Set();for(const ds of datasets){const k=[ds.period.end||ds.period.label,ds.period.type,ds.scope,ds.denominator].join('|');ds.historical=seen.has(k);seen.add(k);}
  const stale=datasets[0]?.period.end&&now-Date.parse(datasets[0].period.end)>550*86400000;
  groups[dimension]={status:datasets.length?(datasets[0].items.every(r=>r.metric==='NON_DISCLOSURE')?'NOT_DISCLOSED':request?.status==='FETCH_FAILED'||stale?'STALE':'PARTIAL'):request?.status==='FETCH_FAILED'?'FETCH_FAILED':request?.completedAt?'PARTIAL':'NOT_COLLECTED',datasets};
 }
 const descriptions=[];
 const facts=await rows(store.db,`SELECT c.id,c.quote,c.source_ids FROM catalyst_claims c JOIN catalyst_assets a ON a.id=c.subject_id WHERE a.kind=? AND a.issuer_id=? AND c.claim_type='business' AND c.status IN ('VERIFIED','SUPPORTED') ORDER BY c.checked_at DESC LIMIT 40`,asset.kind,asset.issuerId);
 const summaryPriority=f=>(/^(?:당사는|we (?:provide|manufacture|sell))/i.test(f.quote)?8:0)+(/제조업체|제조하고|manufactur|we provide/i.test(f.quote)?4:0)-(/예정|전망|will |\.\.\./i.test(f.quote)?5:0);
 facts.sort((a,b)=>summaryPriority(b)-summaryPriority(a));
 for(const f of facts){if(descriptions.length===2)break;if(f.quote.length<20||f.quote.length>800||!businessDescriptionContentAllowed(f.quote)||descriptions.some(d=>d.quote===f.quote))continue;for(const sid of JSON.parse(f.source_ids)){const s=await one(store.db,"SELECT id,url,title,asset_id,body,published_at,observed_at,json_extract(payload,'$.securityVersion') securityVersion,json_extract(payload,'$.documentHash') documentHash FROM catalyst_sources WHERE id=?",sid);if(s&&s.securityVersion==='security-1'&&businessSourceMatchesAsset(s,await store.asset(s.asset_id)||asset)&&norm(s.body).includes(norm(f.quote))&&await sourceAllowed(s)){descriptions.push({quote:f.quote,url:profileSafeUrl(s.url),title:s.title||null,publishedAt:s.published_at||null,observedAt:s.observed_at||null,claimId:f.id,sourceId:s.id,documentHash:s.documentHash});break;}}}
 const extras=await rows(store.db,`SELECT f.payload FROM company_metadata_facts f JOIN catalyst_assets a ON a.id=f.company_id WHERE a.kind=? AND a.issuer_id=? AND f.category IN ('customers','order_exposure','capex_exposure') AND f.verification_status='VERIFIED' AND f.lifecycle_status='ACTIVE' LIMIT 12`,asset.kind,asset.issuerId);
 const additional=[];for(const x of extras){const f=JSON.parse(x.payload),s=await one(store.db,"SELECT id,url,json_extract(payload,'$.securityVersion') securityVersion,json_extract(payload,'$.documentHash') documentHash FROM catalyst_sources WHERE id=?",f.source_id);if(s&&s.securityVersion==='security-1'&&await sourceAllowed(s))additional.push({label:f.fact_key,quote:f.quote,url:profileSafeUrl(f.source_url),publishedAt:f.source_date});}
 const calculations=calculateProfile(data),companyRevenue=await cachedCompanyRevenue(store,asset);
 return {asset:{market:asset.market,ticker:asset.symbol,name:asset.name},issuer:issuerKey(asset),version:businessProfileVersion,status:data.length?'PARTIAL':request?.status==='FETCH_FAILED'?'FETCH_FAILED':request?.completedAt?'PARTIAL':'NOT_COLLECTED',descriptions,groups,additional,calculations,companyRevenue,request:request?{status:request.status,requestedAt:request.requestedAt,completedAt:request.completedAt,error:request.error||null}:null,updatedAt:request?.completedAt||data[0]?.checkedAt||null,notice:'공시 항목별 구성입니다. 사업부·제품·지역 비중은 서로 합산하지 않습니다.'};
}

// Called by collectors, never by GET. Rebuild projections without deleting source facts.
export async function projectBusinessProfile(store,asset,sourceAllowed){
 const profile=await readBusinessProfile(store,asset,{sourceAllowed});
 await indexBusinessProfile(store,asset,profile);
 for(const r of [...profile.calculations.quarters,...profile.calculations.ttm].filter(x=>x.basis==='DERIVED'))await store.db.prepare('INSERT OR REPLACE INTO business_profile_derived VALUES(?,?,?,?,?,?,?,?,?)').bind(r.id,profile.issuer,r.businessItemId,r.period.end,r.period.type,r.calculationVersion,JSON.stringify(r.inputIds),JSON.stringify(r),new Date().toISOString()).run();
 return profile;
}
