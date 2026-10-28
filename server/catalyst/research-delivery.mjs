import {storedProfileObservations} from './business-profile.mjs';
import {businessProfileForResearch} from './company-research-profile.mjs';
// Read-only projection of existing evidence. No search, model or document reader.
import {one,rows} from './store.mjs';
import {hash,norm,safeUrl,classifyQuery} from './core.mjs';
import {beneficiaryAssessment,beneficiaryPolicy as policy,knownFact,beneficiaryThesis} from './beneficiary-policy.mjs';
import {normalizedResearchQuestion} from './research-config.mjs';
import security from '../../config/catalyst-security.json' with {type:'json'};
import {businessSourceMatchesAsset,literalProductMatch} from './beneficiary-extraction.mjs';
import {queryIntent} from './query-policy.mjs';

export const deliveryVersion='delivery-question-scope-2';
const resultFields=['scope','version','condition','expansionScope','expansionUniverse','failures','counts','eventAnchor','anchor'];
const jobColumns="id,query,market_filter,status,updated_at,version,error_code,lease_until,CASE WHEN result IS NULL THEN NULL ELSE json_object("+resultFields.map(k=>`'${k}',json_extract(result,'$.${k}')`).join(',')+") END result";
const factFields=['id','subject','type','product','category','quote','applicationQuote','businessEvidence','status','sourceIds','validationVersion','relatedToBusiness','revenueLevel','share','shareRange','period','unit','targetRevenue','totalRevenue','denominator','tableEvidence','coreExplicit','asOf','transactionExplicit','customerName','filingSource','targetPeriod','totalPeriod','targetScope','totalScope','targetCurrency','totalCurrency','targetUnit','totalUnit'];
async function storedCandidates(store,id){
 // Let SQLite project away duplicated profiles, score breakdowns and typed
 // numeric token arrays before they enter the small web process's JS heap.
 const values=await rows(store.db,`SELECT json_extract(c.value,'$.asset') asset,json_extract(c.value,'$.deep') deep,
 (SELECT json_group_array(json_object(${factFields.map(k=>`'${k}',json_extract(f.value,'$.${k}')`).join(',')})) FROM json_each(c.value,'$.facts') f) facts
 FROM catalyst_research_jobs j,json_each(json_array(json_extract(j.result,'$.coreBeneficiaries'),json_extract(j.result,'$.secondaryBeneficiaries'),json_extract(j.result,'$.watchlist'),json_extract(j.result,'$.lowerPriority'))) g,json_each(g.value) c
 WHERE j.id=? AND json_extract(c.value,'$.asset.id') IS NOT NULL ORDER BY g.key,c.key`,id);
 return values.map(c=>({asset:JSON.parse(c.asset),facts:JSON.parse(c.facts||'[]').map(f=>{for(const k of ['businessEvidence','relatedToBusiness','coreExplicit','transactionExplicit','filingSource'])if(f[k]===1||f[k]===0)f[k]=!!f[k];return f;}),deep:c.deep?JSON.parse(c.deep):null}));
}
const pct=n=>(n*100).toLocaleString('ko-KR',{maximumFractionDigits:2})+'%';
const groupLabels={core:'핵심 수혜 후보',related:'관련 사업 보유 기업',unknown:'비중 추가 확인'};
export function publicSourceUrl(value){
 const safe=safeUrl(value);if(!safe)return null;const u=new URL(safe),host=u.hostname;
 if([...u.searchParams.keys()].some(k=>/key|token|secret|auth|signature|password/i.test(k)))return null;
 if(!host.includes('.')||/^[\d.]+$|:|\.local$|\.internal$|localhost/i.test(host))return null;
 return safe;
}
export function revenueBasisValid(f,{allowSegment=false}={}){
 if(f.type!=='revenue_share')return true;
 const t=f.tableEvidence;
 // One source table must establish denominator, period and accounting scope.
 return !!(t&&f.period&&f.unit&&(['CONSOLIDATED','SEPARATE'].includes(t.scope)||t.scope==='UNSPECIFIED'&&t.validation==='revenue-table-2')&&t.period===f.period&&t.unit===f.unit&&(f.denominator==='COMPANY_TOTAL_REVENUE'||allowSegment&&f.denominator==='SEGMENT_REVENUE'&&t.denominatorKind==='SEGMENT_REVENUE'&&t.denominatorLabel)&&f.totalRevenue>0&&f.targetRevenue>=0&&t.totalRevenue===f.totalRevenue&&t.value===f.targetRevenue&&(t.validation==='revenue-table-2'?Math.abs(f.share-t.reportedPercent/100)<0.000001&&Math.abs(f.targetRevenue/f.totalRevenue-f.share)<=.0051:Math.abs(f.targetRevenue/f.totalRevenue-f.share)<0.000001)&&f.share<=1&&(!f.targetPeriod||f.targetPeriod===f.period)&&(!f.totalPeriod||f.totalPeriod===f.period)&&(!f.targetScope||f.targetScope===t.scope)&&(!f.totalScope||f.totalScope===t.scope)&&(!f.targetCurrency||f.targetCurrency===f.totalCurrency)&&(!f.targetUnit||f.targetUnit===f.totalUnit));
}
function shareLabel(m){
 const f=m.source,scope=f?.tableEvidence?.scope==='CONSOLIDATED'?'연결':f?.tableEvidence?.scope==='SEPARATE'?'별도':'';
 const basis=[f?.period,scope&&scope+' 기준'].filter(Boolean).join(' · ');
 if(m.share!==null){
  const t=f?.tableEvidence;
  if(t?.validation==='revenue-table-2')return `${t.label} ${Number(t.reportedPercent).toLocaleString('ko-KR',{maximumFractionDigits:2})}% · ${t.denominatorKind==='SEGMENT_REVENUE'?t.denominatorLabel+' 내':'공시 매출표 전체 대비'}${m.revenueLevel===2?'; 제품별 단독 비중 미공개':''} · ${f.period} · ${scope||'연결·별도 미기재'}`;
  return `${m.revenueLevel===2?'관련 사업부 기준':'관련 제품 매출'} ${pct(m.share)}${m.revenueLevel===2?'; 해당 제품 개별 비중 미공개':''}${basis?' · '+basis:''}`;
 }
 if(m.coreExplicit)return '주력사업으로 확인 · 정확한 매출 비중 미공개';
 const b=m.broaderSegments?.[0];
 return b?`관련 사업부 기준 ${pct(b.share)}; 해당 제품 개별 비중 미공개`:'관련 제품 확인 · 회사 전체 매출 비중 미확인';
}
export function deepStatus(deep,failures=[]){
 if(!deep?.attempted)return '미실시';
 if(deep.newEvidenceIds?.length)return '추가 근거 확보';
 if(failures.some(f=>/BUDGET|LIMIT/.test(f.code||'')))return '예산 한도 도달';
 if(failures.some(f=>/BLOCK|ACCESS|403|DENIED/.test(f.code||'')))return '출처 접근 제한';
 if(!Array.isArray(deep.newEvidenceIds)&&deep.found?.length)return '조사 기록 있음 · 추가 확보 여부 미기록';
 return '조사했으나 추가 근거 미확보';
}
export function deliveryCandidate(candidate,condition,universe=[],sources=[],{asOf=Date.now()}={}){
 const facts=candidate.facts.filter(f=>knownFact(f)&&f.subject===candidate.asset.id&&revenueBasisValid(f)&&(f.type!=='business'||literalProductMatch(f.quote,f.product)));
 const a=beneficiaryAssessment({asset:candidate.asset,facts,condition,universe,now:asOf}),m=a.economicMateriality;
 const business=facts.find(f=>f.id===a.businessClaimId);
 const displayRevenue=candidate.facts.filter(f=>f.type==='revenue_share'&&knownFact(f)&&f.subject===candidate.asset.id&&revenueBasisValid(f,{allowSegment:true}));
 const revenueBreakdown=[...new Map(displayRevenue.map(f=>[f.tableEvidence?.locator||f.id,{label:shareLabel({source:f,share:f.share,revenueLevel:f.revenueLevel}),sourceIds:f.sourceIds,quote:f.quote}])).values()];
 const shareBasis=m.share!==null?shareLabel(m):revenueBreakdown.length?revenueBreakdown.map(x=>x.label).join(' / ')+(displayRevenue.every(f=>f.denominator==='SEGMENT_REVENUE')?' · 회사 전체 비중 미확인':' · 질문 대상 제품의 단독 비중 미확인'):shareLabel(m);
 const applied=a.exposureLevel==='DIRECT'&&a.exposureCoverage.application!=='UNKNOWN';
 const concrete=!['UNKNOWN','SEMICONDUCTOR_ADJACENT','GENERAL_ELECTRONICS'].includes(a.productTargetExposure);
 const important=m.share!==null?m.share>=policy.coreMinimumShare:m.coreExplicit;
 const group=!a.passed||!concrete?'excluded':!applied?'related':m.materialityGate&&important&&a.sensitivity.type!=='SCENARIO_EXPOSURE'?'core':m.share!==null||a.sensitivity.type==='SCENARIO_EXPOSURE'?'related':'unknown';
 const importance=m.share!==null?(m.share>=policy.coreMinimumShare?'높은 사업 비중':'확인된 일부 사업'):m.coreExplicit?'주력사업':'중요도 미확인';
 const conditionText=a.productTargetExposure==='GLASS_SUBSTRATE_CONDITIONAL'?'유리기판 전환과 채택이 전제입니다. 일반 PCB·패키지기판 증설과 구분됩니다.':a.productTargetExposure==='SEMICONDUCTOR_PACKAGING_ADJACENT'?'후공정 절단·배치 공정으로, 기판 제조 증설과 구분됩니다.':a.productTargetExposure==='PCB_DIRECT'&&condition.targetScope!=='SUBSTRATE'&&condition.targetScope!=='PCB'?'일반 PCB 적용 근거이며 패키지기판 적용은 별도 확인이 필요합니다.':!applied?'질문 대상 사업·경제 변화에 적용되는 조건을 추가 확인해야 합니다.':null;
 const reason=group==='related'?(conditionText||'관련 제품은 확인했지만 확인된 회사 전체 매출 비중은 일부입니다.'):group==='unknown'?'제품 적용은 확인했지만 회사 전체에서의 사업 중요도는 미확인입니다.':group==='core'?'제품 적용과 회사 전체에서의 사업 중요도가 함께 확인됐습니다.':'질문에 맞는 구체적인 제품·서비스와 적용 근거가 부족합니다.';
 const demand=beneficiaryThesis(business,a.sensitivity,condition);
 const missing=[...(conditionText?[conditionText]:[]),...(!m.materialityGate?['질문 대상 제품의 매출 비중 또는 주력사업 근거']:[]),...(a.customerExposure==='UNKNOWN'?['실제 고객 발주 및 공급 관계']:[]),...(a.recentMomentum==='UNKNOWN'?['관련 신규 수주 규모와 수익성']:[])];
 const relevant=[...facts.filter(f=>f.id===a.businessClaimId||f.id===m.source?.id||f.product===a.product),...displayRevenue];
 const sourceIds=new Set(relevant.flatMap(f=>f.sourceIds));
 const ownSources=sources.filter(s=>s.sourceIds.some(id=>sourceIds.has(id))).map(s=>({...s,quotes:[...new Set(relevant.filter(f=>f.sourceIds.some(id=>s.sourceIds.includes(id))).map(f=>f.quote))].slice(0,6)}));
 const href=['KR','US'].includes(candidate.asset.market)?`/stock/${candidate.asset.market}/${encodeURIComponent(candidate.asset.symbol)}?tab=company`:null;
 return {asset:{id:candidate.asset.id,name:candidate.asset.name,market:candidate.asset.market,symbol:candidate.asset.symbol,href},group,groupLabel:groupLabels[group]||'제외·참고',category:{EQUIPMENT:'장비',MATERIAL:'소재',COMPONENT:'부품',SERVICE:'서비스',PRODUCT:'제품'}[a.category]||'기타',product:[...new Set([a.product,m.source?.product].filter(Boolean))].join(' · ')||'확인 필요',importance,share:m.share,shareScope:m.revenueLevel,shareBasis,revenueBreakdown:revenueBreakdown.map(x=>({label:x.label})),sensitivity:(applied?'':'적용 조건부 · ')+({HIGH:'높음',MEDIUM:'중간',LOW:'낮음'}[a.sensitivity.level]||'미확인'),sensitivityBasis:'수요 연결에 대한 분석이며 실제 수주·실적 보장은 아닙니다.',reason,explanation:demand,missing,primaryMissing:missing[0]||'후속 고객 발주 및 수익성',condition:conditionText,evidenceLevel:business?.status==='VERIFIED'?'원문 확인':business?.status==='SUPPORTED'?'복수 근거 지원':'부족',details:{businessProfile:(candidate.businessProfile?.observations||[]).filter(o=>o.metric!=='NON_DISCLOSURE').slice(0,8).map(o=>({id:o.id,label:o.label,amountExact:o.amountExact,unit:o.unit,percent:o.percent,period:o.period.label,sourceUrl:o.sourceUrl})),business:business?.quote||null,materiality:m.source?.quote||null,inference:demand,additionalResearch:deepStatus(candidate.deep,candidate.deliveryFailures),sources:ownSources},sort:{importance:m.share!==null?(m.share>=policy.coreMinimumShare?2:1):m.coreExplicit?2:1,share:m.share,scope:m.revenueLevel,directness:policy.applicationValues[a.productTargetExposure]||0,sensitivity:policy.levels[a.sensitivity.level]||0,evidence:a.evidenceConfidence,momentum:a.recentMomentum==='UNKNOWN'?0:1},internalScore:a.economicExposure};
}
export function compareDelivered(a,b){
 const x=a.sort,y=b.sort;
 return y.importance-x.importance||(x.scope===y.scope&&x.scope===1&&x.share!==null&&y.share!==null?y.share-x.share:0)||y.directness-x.directness||y.sensitivity-x.sensitivity||y.evidence-x.evidence||y.momentum-x.momentum||a.asset.name.localeCompare(b.asset.name);
}
async function sourceProjection(store,candidates,allowed){
 const all=new Map(),ids=[...new Set(candidates.flatMap(c=>c.facts.flatMap(f=>f.sourceIds||[])))];
 for(const id of ids){
  const row=await one(store.db,"SELECT id,asset_id,url,title,publisher,published_at,observed_at,body,json_extract(payload,'$.documentId') documentId,json_extract(payload,'$.documentHash') documentHash,json_extract(payload,'$.securityVersion') securityVersion FROM catalyst_sources WHERE id=?",id);
  if(!row||row.securityVersion!==security.version||!publicSourceUrl(row.url)||!await allowed(row))continue;
  all.set(id,row);
 }
 const docs=new Map();
 for(const s of all.values()){
  // Sections of one receipt/document are one source, irrespective of claim count.
  const u=new URL(s.url);u.hash='';const key=s.documentId||u.href;
  if(!docs.has(key))docs.set(key,{sourceIds:[],title:s.title||'원문 자료',publisher:s.publisher||u.hostname,publishedAt:s.published_at,observedAt:s.observed_at,url:u.href});
  docs.get(key).sourceIds.push(s.id);
 }
 return {all,docs:[...docs.values()]};
}
export async function researchDelivery(store,{id=null,query=null,market='ALL',sourceAllowed=()=>false,now=Date.now()}={}){
 let job;
 if(id)job=await one(store.db,`SELECT ${jobColumns} FROM catalyst_research_jobs WHERE id=? AND id NOT IN (SELECT job_id FROM catalyst_dialogue)`,id);
 else{
  const recent=await rows(store.db,"SELECT id,query,market_filter,status,updated_at FROM catalyst_research_jobs WHERE result IS NOT NULL AND id NOT IN (SELECT job_id FROM catalyst_dialogue) ORDER BY updated_at DESC LIMIT 50");
  const hit=recent.find(j=>(market==='ALL'||j.market_filter===market)&&(query?normalizedResearchQuestion(j.query)===normalizedResearchQuestion(query):true));
  if(hit)job=await one(store.db,`SELECT ${jobColumns} FROM catalyst_research_jobs WHERE id=?`,hit.id);
 }
 if(!job)return null;
 const r=job.result?JSON.parse(job.result):null;
 const base={analysisId:job.id,query:job.query,intent:classifyQuery(job.query).intent,asOf:job.updated_at,materialityPolicyVersion:policy.economicVersion,status:job.status,market:job.market_filter};
 // A failed engine also saves an empty result envelope. It is not evidence
 // that there are no relevant companies, and must never reach candidate UI.
 if(job.status==='failed'){
  const network=/STRUCTURED_API_(?:CONNECTION_FAILED|NETWORK_DENIED)/.test(job.error_code||'');
  return {...base,pending:false,failed:true,retryable:true,message:network?'분석 API에 연결하지 못해 기업 조사를 시작하지 못했습니다.':'분석을 완료하지 못했습니다.',failure:{code:job.error_code||'RESEARCH_FAILED'},guidance:job.error_code==='STRUCTURED_API_NETWORK_DENIED'?'서버 실행 환경에서 외부 연결이 차단됐습니다. 연결을 복구한 뒤 새 분석을 요청해 주세요.':network?'관련 기업이 없다는 뜻이 아닙니다. 연결 상태를 확인한 뒤 새 분석을 요청해 주세요.':'관련 기업 유무를 판단할 수 없습니다. 관리자가 오류 기록을 확인한 뒤 다시 요청할 수 있습니다.'};
 }
 if(job.status==='cancelled')return {...base,pending:false,message:'분석이 취소됐습니다.'};
 if(!r&&job.status==='running'&&job.lease_until<now)return {...base,pending:false,message:'분석 작업이 중단됐습니다. 관리자가 같은 질문을 명시적으로 요청하면 예산 범위 안에서 재개할 수 있습니다.'};
 if(!r)return {...base,pending:['queued','running'].includes(job.status),message:job.status==='cancelled'?'분석이 취소됐습니다.':job.status==='failed'?'분석을 완료하지 못했습니다. 저장된 다른 결과를 확인하거나 다시 시도해 주세요.':'분석 중입니다. 완료 후 저장된 결과를 표시합니다.'};
 if(r.scope!=='BENEFICIARY_DISCOVERY'||job.market_filter==='CRYPTO')return {...base,supported:false,message:job.market_filter==='CRYPTO'?'가상화폐는 Protocol / Token Value Capture 분석을 사용합니다. 주식 사업 비중과 함께 순위를 매기지 않습니다.':['BENEFICIARY_DISCOVERY','CONDITIONAL_ANALYSIS'].includes(queryIntent(job.query))?'이전 해석 방식으로 저장된 기록입니다. 같은 질문으로 새 분석을 요청하면 확장된 사업 탐색을 사용합니다.':'이 기록은 사건·가격 원인 조사입니다. 확인되지 않은 사건을 수혜 후보로 바꾸지 않습니다.',eventStatus:r.eventAnchor?.status||r.anchor?.status||'UNVERIFIED',groups:{core:[],related:[],unknown:[]},limitations:['기존 자산별 분석 기록은 종전 링크에서 확인할 수 있습니다.']};
 const byAsset=new Map();
 for(const c of await storedCandidates(store,job.id))if(c.asset&&c.facts&&!byAsset.has(c.asset.id))byAsset.set(c.asset.id,c);
 const candidates=[...byAsset.values()];
 const {all,docs}=await sourceProjection(store,candidates,sourceAllowed);
 for(const c of candidates)c.facts=c.facts.filter(f=>f.subject===c.asset.id&&knownFact(f)).map(f=>({...f,sourceIds:f.sourceIds.filter(id=>{const s=all.get(id);return s&&s.asset_id===c.asset.id&&businessSourceMatchesAsset(s,c.asset)&&norm(s.body).includes(norm(f.quote));})})).filter(f=>f.sourceIds.length);
 // Read the same persisted observation used on the stock page. Keep the
 // question-specific product mapping separate from the observation's own label.
 for(const c of candidates){
  c.businessProfile=await businessProfileForResearch(store,c.asset,{sourceAllowed});
  const shared=new Map((await storedProfileObservations(store,c.asset)).map(r=>[r.id,r]));
  c.facts=c.facts.filter(f=>{const id=f.tableEvidence?.businessProfileId;if(!id)return true;const r=shared.get(id);if(!r||!f.sourceIds.includes(r.sourceId)||r.documentHash!==all.get(r.sourceId)?.documentHash||r.percent===null)return false;f.share=r.percent/100;f.targetRevenue=r.amount;f.totalRevenue=r.totalRevenue;Object.assign(f.tableEvidence,{reportedPercent:r.percent,value:r.amount,totalRevenue:r.totalRevenue});return true;});
 }
 const dataVersion=await hash(JSON.stringify([job.updated_at,r.version,[...all.values()].map(s=>[s.id,s.documentHash]),candidates.map(c=>[c.facts.map(f=>[f.id,f.share,f.tableEvidence?.businessProfileId]),c.businessProfile.observations.map(o=>[o.id,o.amountExact,o.percent,o.documentHash])])]));
 const cacheKey='research:delivery:'+await hash(JSON.stringify([deliveryVersion,normalizedResearchQuestion(job.query),job.market_filter,r.condition,r.expansionScope,dataVersion,policy.economicVersion]));
 const cached=await store.cache(cacheKey);if(cached&&!cached.stale)return {...cached.value,freshness:{...cached.value.freshness,cacheHit:true,stale:now-Date.parse(job.updated_at)>86400000}};
 const projected=candidates.map(c=>deliveryCandidate({...c,deliveryFailures:(r.failures||[]).filter(f=>f.assetId===c.asset.id)},r.condition,r.expansionUniverse,docs,{asOf:Date.parse(job.updated_at)})).sort(compareDelivered);
 const groups=Object.fromEntries(['core','related','unknown'].map(group=>[group,projected.filter(c=>c.group===group).map(({sort,internalScore,...card})=>card)]));
 const output={...base,supported:true,pending:false,dataVersion,scope:{condition:r.condition.text||job.query,targets:r.expansionScope?.targets||[],hypothetical:r.condition.type!=='USER_RESEARCH_TOPIC'},groups,summary:groups.core.length?`사업 중요도와 적용 관계를 확인한 핵심 후보 ${groups.core.length}개입니다. 관련 사업 보유 ${groups.related.length}개와 비중 추가 확인 ${groups.unknown.length}개를 별도로 정리했습니다.`:'현재 자료에서 사업 중요도까지 확인한 핵심 후보는 없습니다.',sources:[...new Map(Object.values(groups).flatMap(cs=>cs.flatMap(c=>c.details.sources)).map(({sourceIds,quotes,...s})=>[s.url,s])).values()],limitations:[r.condition.type==='USER_RESEARCH_TOPIC'?'질문 주제에 연결된 사업을 조사한 결과이며 실제 사건 발생을 뜻하지 않습니다.':'사용자가 제시한 변화를 가정한 분석이며 실제 발생을 뜻하지 않습니다.','수요 연결은 분석·추론입니다. 실제 발주·수익성과 주가 영향은 확인되지 않았습니다.','제품별 비중과 넓은 사업부 비중은 같은 정밀도의 수치로 비교하지 않습니다.','상장 식별과 사업 정보는 저장된 분석 기준 시점의 자료입니다. 현재 상장 상태를 다시 조회하지 않습니다.','일본 상장 매핑은 연결되지 않았으며 한국·미국 주식만 표시합니다.'],freshness:{kind:'STORED',cacheHit:false,stale:now-Date.parse(job.updated_at)>86400000,sourceVersion:r.version,reranked:r.version!==policy.economicVersion},coverage:{investigated:candidates.length,originalQualified:r.counts?.initial||0,materialityInvestigated:r.counts?.materialityInvestigated||0,excluded:projected.filter(c=>c.group==='excluded').length}};
 await store.putCache(cacheKey,output,3600000);return output;
}
