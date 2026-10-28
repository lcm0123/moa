import {materialityFacts,revenueGrid} from './company-research-profile.mjs';
import {persistProfileObservations,profileRequestKey,businessProfileVersion,comparableShare,profilePeriod,issuerKey,projectBusinessProfile,businessDescriptionContentAllowed} from './business-profile.mjs';
import {inlineRevenueObservations} from './profile-xbrl.mjs';
import {periodTableObservations} from './profile-period-tables.mjs';
import {operatingRevenueTableObservations} from './profile-operating-tables.mjs';
import {adjustedRevenueTableObservations} from './profile-adjusted-tables.mjs';
import {englishSegmentObservations,reportedQuarterSegmentObservations} from './profile-ir-tables.mjs';
import {rows,one} from './store.mjs';
import {norm,clean,hash} from './core.mjs';
import {validateBeneficiaryExtraction,actualBusinessStatement} from './beneficiary-extraction.mjs';
import {sourceAuthority,validationStages} from './claim-validation.mjs';
import {assistBusinessProfile} from './profile-ai-assist.mjs';
export const profileExtractionVersion='profile-db-extract-13';
// These are exact issuer sentences, not summaries or inferred business links.
// Keep named introductions bounded to an issuer's own product/service action.
export function profileBusinessDescriptions(source,asset){
 if(source.assetId!==asset.id||source.securityVersion!=='security-1'||!source.documentId||!source.documentHash||!source.locator||source.evidence===false||['DISCOVERY_ONLY','UNTRUSTED_SOURCE'].includes(source.trust)||!sourceAuthority(source,asset))return [];
 const name=String(asset.name||'').trim().replace(/[,\s]+(?:incorporated|corporation|company|inc\.?|corp\.?|ltd\.?|co\.?)\s*$/i,'').trim();
 const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const issuer=name.length>=3?new RegExp('^(?:The\\s+)?'+escaped+'(?=$|[\\s,(])','i'):null;
 const sentences=[],body=String(source.body||'');let start=0;
 for(const match of body.matchAll(/\n+|(?<=[.!?。])\s+/g)){
  if(!match[0].includes('\n')&&/\b(?:Inc|Corp|Ltd|Co|U|S)\.$/i.test(body.slice(start,match.index)))continue;
  sentences.push(body.slice(start,match.index).trim());start=match.index+match[0].length;
 }
 sentences.push(body.slice(start).trim());
 return [...new Set(sentences)].filter(quote=>{
  if(quote.length<40||quote.length>700)return false;
  if(!businessDescriptionContentAllowed(quote))return false;
  if(/^(당사는|당사의|we |our )/i.test(quote))return actualBusinessStatement(quote);
  const match=issuer?.exec(quote);if(!match)return false;
  let rest=quote.slice(match[0].length).trim().replace(/^,?\s*(?:Inc\.?|Corp\.?|Ltd\.?)\s*/i,'').trim();
  const listing=/^\((?:NASDAQ|NYSE|AMEX)\s*:\s*([A-Z0-9.\-]+)\)\s*/i.exec(rest);
  if(listing){if(listing[1].toUpperCase()!==String(asset.symbol||'').toUpperCase())return false;rest=rest.slice(listing[0].length);}
  if(/^(?:partners?|suppliers?|customers?|competitors?|clients?)\b/i.test(rest))return false;
  const direct=/^(?:is\s+(?:a|an|the)\s+|manufactures?\b|produces?\b|supplies\b|sells?\b|provides?\b|offers?\b)/i.test(rest)&&actualBusinessStatement(quote);
  const platform=/^[\w™®\s-]{0,100}\b(?:platform|software|service|solution|product)s?\s+(?:protects?|connects?|secures?|filters?|provides?|offers?)\b/i.test(rest);
  return direct||platform;
 }).slice(0,2);
}
export function disclosedExportObservations(source){
 const output=[];
 for(const [i,quote] of String(source.body||'').split(/(?<=[.!?。])\s+|\n/).entries()){
  if(quote.length>1000||/예상|전망|목표|forecast|expected/i.test(quote))continue;
  const period=/(20\d{2})년\s*(반기|연간|상반기)/.exec(quote)?.[0];
  const m=/(?:전체|총)\s*매출\s*([\d,]+(?:\.\d+)?)\s*(억원|백만원|천원|원)\s*중\s*수출(?:이|액은?|은)?\s*([\d,]+(?:\.\d+)?)\s*\2.{0,30}?(\d+(?:\.\d+)?)\s*%/.exec(quote);
  if(!period||!m)continue;
  const total=Number(m[1].replaceAll(',','')),value=Number(m[3].replaceAll(',','')),percent=+m[4];
  if(!total||value>total||Math.abs(value/total*100-percent)>.51)continue;
  output.push({dimension:'DOMESTIC_EXPORT',metric:'EXPORT_REVENUE_SHARE',label:'수출',parent:null,value,reportedPercent:percent,totalRevenue:total,period,unit:m[2],scope:/연결/.test(quote)?'CONSOLIDATED':/별도/.test(quote)?'SEPARATE':'UNSPECIFIED',denominatorKind:'COMPANY_TOTAL_REVENUE',denominatorLabel:'문장에 공시된 전체 매출',basis:'DISCLOSED',rowQuote:quote,locator:source.locator+':export:'+i,tableKey:source.id+':export:'+i});
 }
 return output;
}
// Bounded table reader for an explicitly named geography/export/segment axis.
// Amount-only rows stay amount-only unless both scopes permit a safe calculation.
export function dimensionalRevenueObservations(source,asset){
 const output=[];
 for(const [ti,match] of [...String(source.sectionHtml||'').matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].slice(0,12).entries()){
  if(!norm(source.body).includes(norm(clean(match[0]))))continue;
  const grid=revenueGrid(match[0]),heading=source.heading||'',head=grid[0]?.join(' ')||'';
  if(!/매출|revenue|net sales/i.test(heading+' '+head))continue;
  const dimension=/지역|국가|geograph|country|countries/i.test(heading+' '+head)?'GEOGRAPHY':/수출|내수|export|domestic/i.test(head)?'DOMESTIC_EXPORT':/segment|사업부문별/i.test(heading+' '+head)?'BUSINESS_SEGMENT':null;
  if(!dimension)continue;
  const col=grid[0].findIndex(x=>/20\d{2}/.test(x));if(col<1)continue;
  const period=grid[0][col],unit=/단위\s*[:：]\s*(백만원|천원|억원|원)|\b(in (?:millions|thousands)(?: of (?:U\.S\. )?dollars)?)\b/i.exec(source.body)?.[0];if(!unit)continue;
  const money=/million/i.test(unit)?'USD million':/thousand/i.test(unit)?'USD thousand':unit.replace(/^단위\s*[:：]\s*/,'');
  const number=x=>/^\$?\s*[\d,]+(?:\.\d+)?$/.test(x||'')?Number(x.replace(/[$,\s]/g,'')):null;
  const totalRows=grid.filter(r=>/^(합\s*계|총\s*계|total(?: net)? (?:revenues?|sales)|total)$/i.test(r[0]||'')),total=totalRows.length===1?number(totalRows[0][col]):null;
  const scope=/consolidated|연결재무/.test(source.body)?'CONSOLIDATED':/별도재무/.test(source.body)?'SEPARATE':'UNSPECIFIED';
  const p=profilePeriod(period,source.title),basis=/customer.{0,30}(location|located)|고객.{0,15}소재지/i.test(source.body)?'CUSTOMER_LOCATION':/ship.to|배송지/i.test(source.body)?'SHIP_TO_LOCATION':/billing|청구지/i.test(source.body)?'BILLING_LOCATION':/operating location|영업소재지/i.test(source.body)?'OPERATING_LOCATION':'UNKNOWN';
  for(let ri=1;ri<grid.length;ri++){const row=grid[ri],value=number(row[col]);if(value===null||row===totalRows[0]||!row[0]||/subtotal|소계|내부|elimination/i.test(row[0]))continue;
   const common={issuer:issuerKey(asset),periodStart:p.start,periodEnd:p.end,periodType:p.type,scope,currency:money.startsWith('USD')?'USD':'KRW',unit:money,revenueDefinition:'EXTERNAL_CUSTOMER'};
   // Only explicit external-customer basis authorizes deriving a ratio.
   const explicit=/external (?:customer|revenue)|외부\s*(?:고객|매출)/i.test(source.body),percent=explicit?comparableShare({...common,amount:value},{...common,amount:total}):null;
   const rowQuote=norm(clean([...match[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)][ri]?.[1]||''));
   output.push({dimension,metric:dimension==='GEOGRAPHY'?/foreign customer|해외 고객/i.test(row[0])?'FOREIGN_CUSTOMER_REVENUE_SHARE':'GEOGRAPHIC_REVENUE_SHARE':dimension==='DOMESTIC_EXPORT'?/수출|export/i.test(row[0])?'EXPORT_REVENUE_SHARE':'DOMESTIC_REVENUE_SHARE':'REVENUE_COMPOSITION',label:row[0],value,reportedPercent:null,calculatedShare:percent,shareOrigin:percent===null?null:'DERIVED',totalRevenue:total,period,unit:money,scope,basis:'DISCLOSED',geographyBasis:basis,denominatorKind:total?'COMPANY_TOTAL_REVENUE':'UNKNOWN',denominatorLabel:explicit?'외부 고객 매출':'매출 정의 확인 필요',revenueDefinition:explicit?'EXTERNAL_CUSTOMER':'UNKNOWN',rowQuote,locator:source.locator+':dimension:'+ti+':'+ri,tableKey:source.id+':dimension:'+ti});
  }
 }return output;
}
export function nonDisclosureObservations(source){
 const output=[];
 for(const [i,quote]of String(source.body||'').split(/\n|(?<=[.!?。])\s+/).entries()){
  if(quote.length>600||!/공개하지 않|공시하지 않|별도로.*공시하지|not (?:separately )?disclos/i.test(quote))continue;
  const dimension=/수출|export/i.test(quote)?'DOMESTIC_EXPORT':/지역별|국가별|geograph/i.test(quote)?'GEOGRAPHY':/제품별|사업부별|segment|product/i.test(quote)?'PRODUCT':null;
  if(dimension)output.push({dimension,metric:'NON_DISCLOSURE',label:'해당 비중 미공개',value:null,reportedPercent:null,totalRevenue:null,period:source.title||'기간 미확인',unit:null,scope:'UNSPECIFIED',rowQuote:quote,locator:source.locator+':not-disclosed:'+i,tableKey:source.id+':not-disclosed:'+i});
 }return output;
}
export async function ingestProfileSource(store,asset,source){
 const at=Date.parse(source.publishedAt||source.observedAt);
 const pre=await validateBeneficiaryExtraction({},source,asset,Number.isFinite(at)&&at<=Date.now()?{now:at}:{});
 if(pre.rejected.length)return [];
 for(const quote of profileBusinessDescriptions(source,asset)){
  const id=await hash('profile-description:'+source.id+':'+quote),checks=Object.fromEntries(validationStages.map(k=>[k,{status:'PASS',reason:'Exact issuer business statement; no numeric inference'}]));
  await store.saveClaim({id,type:'business',subject:asset.id,predicate:'DESCRIBES_BUSINESS',object:asset.name,value:quote,quote,status:'VERIFIED',confidence:'HIGH',sourceIds:[source.id],asOf:source.publishedAt,validationVersion:businessProfileVersion,validationChecks:checks,securityVersion:'security-1',sourceEvidence:[{sourceId:source.id,quote,locator:source.locator,independenceKey:source.id,status:'VERIFIED',version:businessProfileVersion,checks}]},'business-profile:'+issuerKey(asset));
 }
 const raw=await materialityFacts(source,asset,[],{}, {historical:true});
 const adjusted=adjustedRevenueTableObservations(source),operating=operatingRevenueTableObservations(source);
 const current=raw.observations.filter(o=>o.validation==='revenue-table-2'&&!adjusted.some(a=>a.legacyTableKey===o.tableKey)&&!operating.some(c=>c.label===o.label&&c.dimension===o.dimension&&profilePeriod(o.period,source.title).end===c.explicitPeriod.end&&o.tableKey===source.id+':table'+(Number(/:operating:(\d+):/.exec(c.tableKey)?.[1])+1)));
 const history=periodTableObservations(source).filter(o=>!current.some(c=>c.label===o.label&&c.dimension===o.dimension&&profilePeriod(c.period,source.title).end===o.explicitPeriod.end)&&!operating.some(c=>c.dimension===o.dimension&&c.explicitPeriod.end===o.explicitPeriod.end));
 const observations=[...adjusted,...current,...operating,...history,...disclosedExportObservations(source),...dimensionalRevenueObservations(source,asset),...inlineRevenueObservations(source,asset),...englishSegmentObservations(source),...reportedQuarterSegmentObservations(source),...nonDisclosureObservations(source)];
 // Replace this exact issuer/source's parser projection, preserving its old
 // payloads before any same-locator upsert. Other filings/corrections remain.
 // A previous operating or dimensional row must not survive merely because
 // the new parser correctly rejects its period or no longer emits the row.
 const oldRows=await rows(store.db,"SELECT id,payload FROM company_metadata_facts WHERE company_id=? AND source_id=? AND category LIKE 'profile:%' AND lifecycle_status='ACTIVE'",asset.id,source.id);
 if(oldRows.length){
  const historyKey='profile-parser-history:'+source.id+':'+profileExtractionVersion;
  if(!await store.runtime(historyKey))await store.runtime(historyKey,{at:new Date().toISOString(),version:profileExtractionVersion,rows:oldRows});
  await store.db.batch([
   store.db.prepare("UPDATE catalyst_claims SET status='UNVERIFIED' WHERE id IN (SELECT mc.claim_id FROM company_metadata_claims mc JOIN company_metadata_facts f ON f.id=mc.fact_id WHERE f.company_id=? AND f.source_id=? AND f.category LIKE 'profile:%')").bind(asset.id,source.id),
   store.db.prepare("UPDATE catalyst_claim_ledger SET verification_status='UNVERIFIED' WHERE claim_id IN (SELECT mc.claim_id FROM company_metadata_claims mc JOIN company_metadata_facts f ON f.id=mc.fact_id WHERE f.company_id=? AND f.source_id=? AND f.category LIKE 'profile:%')").bind(asset.id,source.id),
   store.db.prepare("UPDATE company_metadata_facts SET verification_status='UNVERIFIED',lifecycle_status='SUPERSEDED' WHERE company_id=? AND source_id=? AND category LIKE 'profile:%'").bind(asset.id,source.id)
  ]);
 }
 return persistProfileObservations(store,asset,source,observations);
}
export async function collectBusinessProfile(env,store,asset,{fetchSources=null,cacheOnly=false,forceFetch=false,aiLimit=0,job=null}={}){
 const start=performance.now(),key=profileRequestKey(asset),prior=await store.runtime(key),counts={sources:0,records:0,cacheHits:0,aiCalls:0,searchCalls:0};
 await store.runtime(key,{...prior,status:'RUNNING',requestedAt:new Date().toISOString()});
 try{
  const ids=await rows(store.db,`SELECT s.id FROM catalyst_sources s JOIN catalyst_assets a ON a.id=s.asset_id WHERE a.kind=? AND a.issuer_id=? AND s.source_type IN ('business','regulatory','official') ORDER BY s.published_at DESC LIMIT 40`,asset.kind,asset.issuerId);
  const seen=new Set();
  const ingest=async source=>{if(!source||seen.has(source.id)||!await env.CATALYST_SOURCE_ALLOWED?.(source))return;seen.add(source.id);const owner=await store.asset(source.assetId);if(!owner||issuerKey(owner)!==issuerKey(asset))return;
   const checkpoint=await one(store.db,'SELECT records FROM business_profile_documents WHERE issuer=? AND source_id=? AND document_hash=? AND version=?',issuerKey(asset),source.id,source.documentHash||'',profileExtractionVersion);
   counts.sources++;if(checkpoint){counts.records+=checkpoint.records;counts.cacheHits++;return;}
   const records=await ingestProfileSource(store,owner,source);counts.records+=records.length;
   if(!cacheOnly&&job&&!records.length&&counts.aiCalls<aiLimit){const assisted=await assistBusinessProfile(env,store,owner,source,{job,remaining:aiLimit-counts.aiCalls});counts.aiCalls+=assisted.calls;counts.aiState=assisted.state;}
   await store.db.prepare('INSERT OR REPLACE INTO business_profile_documents VALUES(?,?,?,?,?,?,?)').bind(issuerKey(asset),source.id,source.documentHash||'',profileExtractionVersion,records.length?'PARTIAL':'EXTRACTION_UNRESOLVED',records.length,new Date().toISOString()).run();
  };
  for(const row of ids){const saved=await one(store.db,"SELECT body,json_remove(payload,'$.tables','$.operationalTables') payload FROM catalyst_sources WHERE id=?",row.id);await ingest({...JSON.parse(saved.payload),body:saved.body,id:row.id});}
  // A requested company with existing usable sections is parsed locally first.
  // Missing axes alone do not cause repeated paid search or model calls.
  if(!cacheOnly&&(forceFetch||!counts.records)&&fetchSources){for(const source of (await fetchSources(asset)).slice(0,12)){const saved=await store.addSource(source);await ingest(saved);}}
  if(!counts.sources&&!cacheOnly)throw Error('PROFILE_SOURCE_UNAVAILABLE');
  await store.runtime(key,{status:counts.sources?'PARTIAL':'NOT_COLLECTED',requestedAt:(await store.runtime(key)).requestedAt,completedAt:new Date().toISOString(),counts,elapsedMs:Math.round(performance.now()-start),version:businessProfileVersion});
  await projectBusinessProfile(store,asset,env.CATALYST_SOURCE_ALLOWED);
  return counts;
 }catch(e){
  const code=/^[A-Z_0-9]+$/.test(e.message)?e.message:'PROFILE_SOURCE_UNAVAILABLE';
  await store.runtime(key,{...prior,status:'FETCH_FAILED',requestedAt:new Date().toISOString(),completedAt:new Date().toISOString(),error:code,counts});throw Error(code);
 }
}
