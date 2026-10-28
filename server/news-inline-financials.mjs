// Uses the existing issuer, official-source ledger and profile facts. No fetching or AI.
import config from '../config/news-financial.json' with {type:'json'};
import {readBusinessProfile} from './catalyst/business-profile.mjs';
import {decimal,ratio} from './catalyst/profile-calculations.mjs';
import {hash} from './catalyst/core.mjs';
import {one,rows} from './catalyst/store.mjs';
import {normalize,safeLink} from './news-companies-model.mjs';
export {config as financialPolicy};
const compact=v=>normalize(v).replace(/\s/g,'').toLowerCase();
const exactProduct=(a,b)=>compact(a)===compact(b)&&!/[、,·/]|\b(?:and|other)\b|등$/.test(b);
const familyProduct=(a,b)=>compact(a)===compact(b)||compact(a)===compact(b).replace(/등$/,'');
const knownScope=v=>['CONSOLIDATED','SEPARATE'].includes(v);
const validPeriod=p=>p?.start&&p.end&&['ANNUAL','YTD','HALF_YEAR','SINGLE_QUARTER'].includes(p.type)&&Date.parse(p.start)<=Date.parse(p.end);
const numericTokens=s=>[...normalize(s).matchAll(/(?<![\d.])[-+]?\d[\d,]*(?:\.\d+)?(?![\d.])/g)].map(m=>decimal(m[0]));
export function scaledDecimal(value,scale){
 const d=decimal(value);if(d===null||!Number.isSafeInteger(scale)||scale<=0)return null;
 const [a,b='']=d.split('.'),n=BigInt(a+b)*BigInt(scale),negative=n<0n,s=(negative?-n:n).toString().padStart(b.length+1,'0');
 return decimal((negative?'-':'')+(b.length?s.slice(0,-b.length)+'.'+s.slice(-b.length):s));
}
export async function financialProfileVersion(db,assetId){
 return hash(JSON.stringify(await rows(db,`SELECT f.id,f.payload,f.lifecycle_status,f.verification_status,c.status,
 s.content_hash,s.payload source_payload FROM company_metadata_facts f
 LEFT JOIN catalyst_claims c ON c.id=json_extract(f.payload,'$.claimId')
 LEFT JOIN catalyst_sources s ON s.id=f.source_id WHERE f.company_id=? AND f.category LIKE 'profile:%' ORDER BY f.id`,assetId)));
}
// A fact can be shown with an explicit table scope without qualifying for company-wide ranking.
export function financialFact(row,source,{asOf,cutoff=null}={}){
 if(!row||row.metric==='NON_DISCLOSURE'||row.verificationStatus!=='VERIFIED'||row.valueOrigin==='ESTIMATED'||row.basis==='RESEARCH_ESTIMATE'||row.isAdjustment||!validPeriod(row.period))return null;
 if(!source||source.assetId!==row.assetId||source.securityVersion!=='security-1'||source.documentHash!==row.documentHash||!safeLink(source.url)||source.userProvided||!normalize(source.body).includes(normalize(row.quote))||!row.quote)return null;
 const published=Date.parse(source.publishedAt),observed=Date.parse(source.observedAt||source.firstObservedAt),at=Date.parse(asOf);
 if(!Number.isFinite(published)||!Number.isFinite(at)||published>at||Date.parse(row.period.end)>published||at-published>config.maxEvidenceAgeDays*86400000)return null;
 if(cutoff&&(!Number.isFinite(observed)||published>Date.parse(cutoff)||observed>Date.parse(cutoff)))return null;
 const amount=decimal(row.amountExact??row.amount),denominator=decimal(row.totalRevenueExact??row.totalRevenue),tokens=numericTokens(row.quote);
 if(amount!==null&&Number(amount)<0)return null;
 const rawValue=amount!==null&&tokens.includes(amount)?amount:null;
 const percents=[...normalize(row.quote).matchAll(/(-?\d[\d,]*(?:\.\d+)?)\s*%/g)].map(m=>decimal(m[1]));
 const reported=row.shareOrigin==='DISCLOSED'&&Number.isFinite(row.percent)&&row.percent>=0&&row.percent<=100&&percents.includes(decimal(row.percent))?row.percent:null;
 const tableTotal=row.headerEvidence?.tableTotal,closed=row.headerEvidence?.closedTable===true;
 const denominatorProven=denominator!==null&&Number(denominator)>0&&numericTokens(source.body).includes(denominator);
 const compatibleDenominator=knownScope(row.scope)&&row.entityScope===row.issuer&&!!row.issuer&&!!row.currency&&!!row.unit&&Number.isSafeInteger(row.multiplier)&&row.multiplier>0&&row.denominatorKind==='COMPANY_TOTAL_REVENUE'&&!row.comparabilityReview;
 const sameTable=closed&&decimal(tableTotal)===denominator&&row.denominatorKind==='DISCLOSED_TABLE_TOTAL';
 const computed=rawValue!==null&&denominatorProven&&(compatibleDenominator||sameTable)?ratio(rawValue,denominator):null;
 // A disclosed percent is retained as disclosed; inconsistent rows are never published.
 if(reported!==null&&computed!==null&&Math.abs(reported-computed)>config.shareTolerancePp)return null;
 const percent=reported??(row.shareOrigin==='DERIVED'&&computed!==null&&Math.abs(computed-row.percent)<=config.shareTolerancePp?computed:null);
 if(rawValue===null&&percent===null||rawValue!==null&&Number(rawValue)<0)return null;
 const warnings=[];
 if(!knownScope(row.scope))warnings.push('연결·별도 범위 미확인');
 if(row.comparabilityReview)warnings.push('범위 변경·비교 기준 확인 필요');
 if(row.denominatorKind!=='COMPANY_TOTAL_REVENUE')warnings.push('공시 사업 매출표 합계 기준');
 const numeratorId=rawValue!==null?row.id+':amount':null,denominatorId=denominatorProven?row.id+':denominator':null;
 const common={period:row.period,scope:row.scope,currency:row.currency,unit:row.unit,scale:row.multiplier,valueKind:'actual',sourceId:source.id,locator:row.locator};
 const componentFacts=[...(numeratorId?[{...common,id:numeratorId,metric:'REVENUE',rawValue,normalizedValue:scaledDecimal(rawValue,row.multiplier)}]:[]),...(denominatorId?[{...common,id:denominatorId,metric:'REVENUE_DENOMINATOR',rawValue:denominator,normalizedValue:scaledDecimal(denominator,row.multiplier),definition:row.denominatorKind}]:[])];
 return {id:row.id,issuer:row.issuer,assetId:row.assetId,metric:'REVENUE',dimension:row.dimension,label:row.label,
  rawValue,normalizedValue:scaledDecimal(rawValue,row.multiplier),unit:row.unit,currency:row.currency,scale:row.multiplier,
  percent,shareOrigin:percent===null?null:reported!==null?'DISCLOSED':'CALCULATED',scope:row.scope,entityScope:row.entityScope,period:row.period,
  geography:row.dimension==='GEOGRAPHY'?row.label:null,geographyBasis:row.geographyBasis||'UNKNOWN',valueKind:'actual',
  numeratorFactId:numeratorId,denominatorFactId:denominatorId,componentFacts,denominatorValue:denominatorProven?denominator:null,
  denominatorKind:row.denominatorKind,denominatorLabel:row.denominatorLabel,formulaId:percent!==null&&reported===null?'same_table_amount / same_table_total * 100':null,
  eligibleForCompanyComparison:compatibleDenominator&&percent!==null,comparabilityReview:!!row.comparabilityReview,
  sourceId:source.id,source:{sourceId:source.id,url:source.url,title:source.title,publishedAt:source.publishedAt,locator:row.locator,quote:row.quote},warnings};
}
export function selectFinancialFacts(facts,candidate,statuses={}){
 const sort=(a,b)=>b.period.end.localeCompare(a.period.end)||String(b.source.publishedAt).localeCompare(String(a.source.publishedAt))||a.id.localeCompare(b.id);
 const ordered=[...facts].sort(sort),terms=candidate.links.filter(l=>l.semanticVerified).map(l=>l.sourceTerm);
 // Never turn a bundle, sector, export total or North America into an exact product/US share.
 let business=ordered.find(f=>f.dimension==='PRODUCT'&&terms.some(t=>exactProduct(t,f.label))),businessMatch=business?'exact_product':null;
 if(!business){business=ordered.find(f=>f.dimension==='PRODUCT'&&terms.some(t=>familyProduct(t,f.label)));if(business)businessMatch='product_group';}
 if(!business){business=ordered.filter(f=>f.dimension==='BUSINESS_SEGMENT').sort((a,b)=>b.period.end.localeCompare(a.period.end)||String(b.source.publishedAt).localeCompare(String(a.source.publishedAt))||Number(b.rawValue)-Number(a.rawValue))[0];if(business)businessMatch='company_segment_context';}
 const us=ordered.find(f=>f.dimension==='GEOGRAPHY'&&/^(미국|미합중국|united states(?: of america)?|u\.?s\.?a?\.?)$/i.test(normalize(f.label)));
 const region=us||ordered.find(f=>f.dimension==='GEOGRAPHY'),exports=ordered.find(f=>f.dimension==='DOMESTIC_EXPORT'&&f.label==='수출');
 return {version:config.version,business:business?{...business,match:businessMatch}:null,region:region||null,exports:exports||null,
  exactProductShare:businessMatch==='exact_product'&&business.eligibleForCompanyComparison?business.percent:null,
  usShare:us?.eligibleForCompanyComparison&&us.geographyBasis!=='UNKNOWN'?us.percent:null,
  states:statuses,notice:'과거 매출 구성입니다. 이번 뉴스의 추가 매출이 아니며 제품·지역 비중은 곱하지 않습니다.'};
}
export function financialConditionRows(financial){
 const convert=f=>({...f,amount:f.rawValue,sourceUrl:f.source.url,quote:f.source.quote,geographicBasis:f.geographyBasis,exactProduct:true});
 return {businessRevenue:financial.exactProductShare!==null?convert(financial.business):null,
  usRevenue:financial.usShare!==null?convert(financial.region):null};
}
export async function attachFinancialEvidence(result,store,{allowed=()=>false}={}){
 result.financialByAsset={};result.financialProfileVersions={};result.financialSources=[];
 const used=new Map();
 for(const c of result.rawCandidates||[]){
  const asset=await store.asset(c.asset.id);if(!asset)continue;
  const before=await financialProfileVersion(store.db,asset.id),profile=await readBusinessProfile(store,asset,{sourceAllowed:allowed,now:Date.parse(result.asOf)}),facts=[],sourceMap=new Map();
  for(const g of Object.values(profile.groups||{}))for(const ds of g.datasets||[]){if(ds.historical)continue;for(const row of ds.items){
   if(!sourceMap.has(row.sourceId)){const s=await one(store.db,'SELECT * FROM catalyst_sources WHERE id=?',row.sourceId);sourceMap.set(row.sourceId,s?{...JSON.parse(s.payload),id:s.id,assetId:s.asset_id,url:s.url,title:s.title,body:s.body,publishedAt:s.published_at,observedAt:s.observed_at}:null);}
   const source=sourceMap.get(row.sourceId);if(!source||!await allowed(source))continue;
   const fact=financialFact(row,source,{asOf:result.asOf,cutoff:result.context?.cutoff});if(fact)facts.push(fact);
  }}
  const statuses=Object.fromEntries(Object.entries(profile.groups||{}).map(([k,g])=>[k,g.status]));
  const financial=selectFinancialFacts(facts,{...c,links:c.links.slice(0,1)},statuses);
  financial.paths=Object.fromEntries(c.links.map(l=>[l.sourceTerm,selectFinancialFacts(facts,{...c,links:[l]},statuses)]));
  const after=await financialProfileVersion(store.db,asset.id);if(before!==after)throw Error('FINANCIAL_EVIDENCE_CHANGED');
  result.financialByAsset[c.asset.id]=financial;result.financialProfileVersions[c.asset.id]=after;
  Object.assign(c,financialConditionRows(financial));
  for(const f of [financial,...Object.values(financial.paths)].flatMap(p=>[p.business,p.region,p.exports]).filter(Boolean)){
   const source=sourceMap.get(f.sourceId),{id,assetId,url,title,publishedAt,observedAt,documentHash,securityVersion,independenceKey}=source;
   // Whitelist metadata; section HTML, raw document paths and bodies stay server-side.
   used.set(id,{id,assetId,url,title,publishedAt,observedAt,documentHash,securityVersion,independenceKey,access:'READ'});
  }
 }
 result.financialSources=[...used.values()];result.financialVersion=config.version;
 return result;
}
