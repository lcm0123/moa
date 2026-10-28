import {persistProfileObservations,storedProfileObservations,readBusinessProfile} from './business-profile.mjs';
import {validationStages} from './claim-validation.mjs';
import {parseTypedValues} from './typed-values.mjs';
import {norm,clean,hash} from './core.mjs';
import {validateBeneficiaryExtraction,actualBusinessStatement,literalProductMatch} from './beneficiary-extraction.mjs';
import {beneficiaryPolicy as policy,productExposure} from './beneficiary-policy.mjs';
import {cachedSource} from './research-evidence.mjs';

// Expand bounded merged headers before reading revenue columns. Never infer
// a period, currency, product allocation, or company denominator from AI.
export function revenueGrid(html){
 const grid=[],spans=[];
 for(const r of [...String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].slice(0,100)){
  const row=[];let col=0;
  const fill=()=>{while(spans[col]?.left>0){row[col]=spans[col].value;spans[col].left--;col++;}};fill();
  for(const c of r[1].matchAll(/<(td|th|te)\b([^>]*)>([\s\S]*?)<\/\1>/gi)){
   fill();const text=norm(clean(c[3])),width=Math.min(20,Number(/colspan=["']?(\d+)/i.exec(c[2])?.[1])||1),height=Math.min(100,Number(/rowspan=["']?(\d+)/i.exec(c[2])?.[1])||1);
   for(let i=0;i<width;i++){row[col]=text;if(height>1)spans[col]={value:text,left:height-1};col++;}
  }fill();grid.push(row);
 }return grid;
}
const num=x=>/^[\d,]+(?:\.\d+)?%?$/.test(x||'')?Number(x.replaceAll(',','').replace('%','')):null;
const compact=x=>norm(x).toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const contains=(a,b)=>compact(b).length>=2&&compact(a).includes(compact(b));
export function deterministicProposal(source,{products=[]}={}){
 const business=[],details=[],sentences=String(source.body||'').split(/(?<=[.!?。])\s+|\n/).map(norm).filter(t=>t.length>=16&&t.length<=1150);
 for(const quote of sentences){
  if(!actualBusinessStatement(quote))continue;
  // Vocabulary comes from this question's plan/current verified products, not
  // a beneficiary/company dictionary. Literal names only, never translated.
  for(const p of products){const product=typeof p==='string'?p:p.product||p.term;if(!literalProductMatch(quote,product))continue;
   const start=quote.toLowerCase().indexOf(product.toLowerCase());
   business.push({product:quote.slice(start,start+product.length),category:p.category||'EQUIPMENT',quote,applicationQuote:quote});
  }
 }
 return {business:[...new Map(business.map(b=>[b.product,b])).values()].slice(0,8),details};
}
export async function materialityFacts(source,asset,business,condition,{historical=false}={}){
 const pre=await validateBeneficiaryExtraction({},source,asset,historical&&Date.parse(source.publishedAt||source.observedAt)<=Date.now()?{now:Date.parse(source.publishedAt||source.observedAt)}:{});if(pre.rejected.length)return {facts:[],observations:[],rejected:pre.rejected};
 // Financial tables from news/co-mentions cannot inherit issuer scope.
 if(source.assetId!==asset.id)return {facts:[],observations:[],rejected:['ISSUER_SCOPE_REQUIRED']};
 const eligible=business.filter(f=>f.type==='business'&&f.businessEvidence&&productExposure(f,condition).level==='DIRECT');
 const status=source.sourceType==='regulatory'||source.sourceType==='official'?'VERIFIED':'SUPPORTED';
 const checks=Object.fromEntries(validationStages.map(k=>[k,{status:'PASS',reason:'Source-bound deterministic table/prose validation; product, issuer, period, unit and denominator checked'}]));
 const facts=[],observations=[],body=norm(source.body),newFact=async(type,quote,extra)=>({id:await hash([policy.economicVersion,source.id,asset.id,type,quote,JSON.stringify(extra)].join('|')),type,quote,subject:asset.id,predicate:'SOURCE_REPORTED_'+type.toUpperCase(),value:quote,object:extra.product||quote,status,confidence:status==='VERIFIED'?'HIGH':'MEDIUM',typedValue:parseTypedValues(quote),validationChecks:checks,sourceEvidence:[{sourceId:source.id,quote,locator:source.locator,independenceKey:source.independenceKey||source.id,status,version:policy.version,checks}],validationVersion:policy.version,economicVersion:policy.economicVersion,sourceIds:[source.id],sourceUrl:source.url,asOf:source.publishedAt||source.observedAt,locator:source.locator,filingSource:source.sourceType==='regulatory',relatedToBusiness:true,...extra});
 for(const f of eligible){
  const sentences=body.split(/(?<=[.!?。])\s+/);
  const core=sentences.find(t=>t.length<=1000&&contains(t,f.product)&&/(?:당사|회사|our|we\b).{0,100}(?:주력\s*(?:사업|제품|장비)|주요\s*제품|주된\s*사업|main business|principal products?|core business)/i.test(t)&&!/예정|계획|목표|potential/i.test(t));
  if(core)facts.push(await newFact('business_core',core,{product:f.product,coreExplicit:true}));
  for(const sentence of sentences){
   if(sentence.length>1100||!contains(sentence,f.product)||!/of (?:our |total |net |consolidated )*(?:revenue|sales)|전체\s*매출|총\s*매출|연결\s*매출/i.test(sentence)||/예상|전망|목표|forecast|expected|수출|내수|고객|export|domestic|customer/i.test(sentence))continue;
   const range=/(\d+(?:\.\d+)?)\s*(?:~|–|to)\s*(\d+(?:\.\d+)?)\s*%/.exec(sentence),values=[...sentence.matchAll(/(\d+(?:\.\d+)?)\s*%/g)];
   const period=/(20\d{2})(?:년)?\s*(?:H[12]|Q[1-4]|반기|분기|상반기|하반기)?/i.exec(sentence)?.[0];if(!period)continue;
   if(range&&+range[1]<=+range[2]&&+range[2]<=100)facts.push(await newFact('revenue_share',sentence,{product:f.product,revenueLevel:1,shareRange:[+range[1]/100,+range[2]/100],period,denominator:'COMPANY_TOTAL_REVENUE',rangeBasis:'SOURCE_EXPLICIT_RANGE'}));
   else if(values.length===1&&+values[0][1]<=100)facts.push(await newFact('revenue_share',sentence,{product:f.product,revenueLevel:1,share:+values[0][1]/100,period,denominator:'COMPANY_TOTAL_REVENUE'}));
  }
 }
 for(const [ti,table]of [...String(source.sectionHtml||'').matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].slice(0,12).entries()){
  const tableText=norm(clean(table[0]));if(!body.includes(tableText)){observations.push({status:'UNKNOWN',reason:'TABLE_BODY_MISMATCH'});continue;}
  const grid=revenueGrid(table[0]);if(!grid.length)continue;
  const headerRows=grid.slice(0,2),header=headerRows.flat().join(' ');
  const combinedCol=headerRows[0].findIndex(x=>/매출.*(?:비율|비중)/.test(x));
  const percentRow=headerRows.find(r=>r.some(x=>/^(?:매출)?(?:비중|비율)(?:\s*\(%\))?$|^%$/i.test(x)));
  const combined=combinedCol>=0&&/매출액.*\(/.test(headerRows[0][combinedCol]);
  const percentCol=combined?combinedCol:percentRow?.findIndex(x=>/^(?:매출)?(?:비중|비율)(?:\s*\(%\))?$|^%$/i.test(x));
  const valueCol=combined?percentCol:percentCol-1;
  const parsed=row=>{if(combined){const m=/^([\d,]+(?:\.\d+)?)\s*\(\s*([\d.]+)%\s*\)$/.exec(row[valueCol]||'');return m?{value:num(m[1]),pct:+m[2],precision:(m[2].split('.')[1]||'').length}:{};}return {value:num(row[valueCol]),pct:num(row[percentCol]),precision:(String(row[percentCol]||'').replace('%','').split('.')[1]||'').length};};
  const titleDate=/(20\d{2})\.(\d{2})/.exec(source.title||'');
  const reportPeriod=titleDate&&/사업보고서|반기보고서|분기보고서/.test(source.title)?`${titleDate[1]}년 ${titleDate[2]==='06'?'반기':titleDate[2]==='12'?'연간':titleDate[2]+'월 누적'}`:null;
  const period=headerRows[0][valueCol]?.match(/20\d{2}/)?headerRows[0][valueCol]:reportPeriod;
  const unit=/단위\s*[:：]\s*(백만원|천원|억원|원|million USD|USD)/i.exec(body)?.[1];
  const totals=grid.filter(r=>r.slice(0,valueCol).some(x=>/^(?:합계|총합계|총계|계|총매출액|total)$/i.test(x.replace(/\s/g,'')))&&Math.abs((parsed(r).pct??0)-100)<.01);
  const total=totals.length===1?totals[0]:null,denominator=total&&parsed(total).value;
  if(!/매출|sales|revenue/i.test(header+' '+source.heading)||!period||!unit||!denominator||!total||valueCol<1){observations.push({table:ti+1,status:'UNKNOWN',reason:'COMPANY_DENOMINATOR_PERIOD_OR_UNIT_UNCONFIRMED',heading:source.heading});continue;}
  const axisText=source.heading+' '+header;
  const axis=/지역별|국가별|geograph/i.test(axisText)?'GEOGRAPHY':/수출|내수|export|domestic/i.test(header)?'DOMESTIC_EXPORT':/고객별|고객집중|customer concentration/i.test(axisText)?'CUSTOMER':/최종시장|end.market/i.test(axisText)?'END_MARKET':null;
  const productCol=headerRows[0].findIndex(x=>/품\s*목|생산\s*제품|^제품$/.test(x));
  const segmentCol=headerRows[0].findIndex(x=>/사업부문/.test(x));
  const sectionScope=/\[([^\]]*사업부[분문][^\]]*)\]/.exec(source.body||'')?.[1];
  const denominatorKind=sectionScope?'SEGMENT_REVENUE':'COMPANY_TOTAL_REVENUE';
  let scope=/연결/.test(body)&&!/별도/.test(body)?'CONSOLIDATED':/별도/.test(body)&&!/연결/.test(body)?'SEPARATE':'UNSPECIFIED';
  const fromConsolidated=/(20\d{2})년부터는?\s*연결재무제표/.exec(body);
  if(fromConsolidated&&Number(/20\d{2}/.exec(period)?.[0])>=+fromConsolidated[1])scope='CONSOLIDATED';
  for(const [ri,row]of grid.entries()){
   if(row===total||ri<1)continue;const {value,pct,precision}=parsed(row);
   if(value===null||value===undefined||pct===null||pct===undefined||pct>100||value<0||Math.abs(value/denominator*100-pct)>Math.max(.01,.5*10**(-precision)+100/denominator))continue;
   const label=productCol>=0?row[productCol]:[...new Set(row.slice(0,valueCol))].join(' ');
   if(/(?:소계|합계|\s계)$|판매업|제조\s*및\s*판매/.test(label))continue;
   const description=productCol>=0?row.slice(productCol+1,valueCol).join(' '):label;
   const matches=eligible.filter(f=>contains(label,f.product)||/[,、]| 등/.test(description)&&contains(description,f.product));
   const grouped=/[,、]| 등|사업부|segment|공정장비|부문|및/i.test(label)||matches.some(f=>!contains(label,f.product));
   const displayLabel=grouped&&segmentCol>=0&&/생산\s*제품/.test(headerRows[0][productCol]||'')?row[segmentCol]:label;
   const quote=tableText;
   const observation={dimension:axis||(grouped&&segmentCol>=0&&/생산\s*제품/.test(headerRows[0][productCol]||'')?'BUSINESS_SEGMENT':'PRODUCT'),parent:segmentCol>=0?row[segmentCol]:null,rowQuote:norm(clean([...table[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)][ri]?.[1]||'')),tableKey:source.id+':table'+(ti+1),label:displayLabel,productLabel:label,value,totalRevenue:denominator,reportedPercent:pct,period,unit,scope,denominatorKind,denominatorLabel:sectionScope||'공시 매출표 합계',validation:'revenue-table-2',locator:source.locator+':table'+(ti+1)+':row'+(ri+1),sourceId:source.id,sourceUrl:source.url};observations.push(observation);
   if(/OLED|디스플레이|이차전지|배터리|battery|display|general electronics/i.test(label)){observations.at(-1).reason='BROADER_MIXED_SEGMENT_NOT_TARGET_SHARE';continue;}
   if(axis)continue;
   for(const match of matches)facts.push(await newFact('revenue_share',quote,{product:match.product,revenueLevel:grouped?2:1,share:pct/100,calculatedShare:value/denominator,period,unit,targetRevenue:value,totalRevenue:denominator,denominator:denominatorKind,reportedPercent:pct,tableEvidence:observation}));
  }
 }
 return {facts,observations,rejected:[]};
}
export async function companyProfile(store,asset,source,business,condition){
 if(store.sourceReady&&!store.sourceReady(source))return {facts:[],observations:[],rejected:['SOURCE_NOT_READY'],cacheHit:false};
 const key='beneficiary:profile:parser7:'+policy.economicVersion+':'+await hash(JSON.stringify([asset.id,source.id,source.documentHash,condition.targetScope,business.map(f=>[f.id,f.product])]));
 const cached=await store.cache(key);
 if(cached&&!cached.stale&&(!store.sourceReady||store.sourceReady(source)))return {...cached.value,cacheHit:true};
 const out=await materialityFacts(source,asset,business,condition);
 await persistProfileObservations(store,asset,source,out.observations.filter(o=>o.validation==='revenue-table-2'));
 const shared=await storedProfileObservations(store,asset,source.id);
 for(const f of out.facts.filter(f=>f.type==='revenue_share'&&f.tableEvidence)){const record=shared.find(r=>r.locator===f.tableEvidence.locator);if(record&&record.percent===f.tableEvidence.reportedPercent){f.businessProfileId=record.id;f.tableEvidence.businessProfileId=record.id;}}
 const value={assetId:asset.id,sourceId:source.id,documentHash:source.documentHash,version:policy.economicVersion,business:business.filter(f=>f.type==='business').map(f=>f.id),products:business.filter(f=>f.type==='business').map(f=>f.product),revenue:out.observations,customers:business.filter(f=>f.type==='customer'),orders:business.filter(f=>f.type==='order'),capacity:business.filter(f=>f.type==='capex'),...out,checkedAt:new Date().toISOString()};
 await store.putCache(key,value,policy.profileTtlMs);return {...value,cacheHit:false};
}
export async function cachedProfileFacts(store,asset,condition,business){
 const result=[];for(const f of business){for(const id of f.sourceIds||[]){const s=await cachedSource(store,id);if(!s)continue;const p=await companyProfile(store,asset,s,business,condition);result.push(...p.facts);}}
 return [...new Map(result.map(f=>[f.id,f])).values()];
}
// Same observation IDs and calculations as the stock detail. No network/model work.
export async function businessProfileForResearch(store,asset,{sourceAllowed=async source=>Boolean(await store.sourceAllowed?.(source.url))}={}){
 const profile=await readBusinessProfile(store,asset,{sourceAllowed});
 return {issuer:profile.issuer,descriptions:profile.descriptions,observations:Object.values(profile.groups).flatMap(g=>g.datasets.filter(d=>!d.historical).flatMap(d=>d.items)),companyRevenue:profile.companyRevenue,calculations:profile.calculations,updatedAt:profile.updatedAt};
}
