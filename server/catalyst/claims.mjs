import {corroborateClaims,evidencePolicyVersion} from './evidence-policy.mjs';
import {hash,norm,instant,config,safeUrl} from './core.mjs';
import {compareTypedValues} from './typed-values.mjs';
import {validateProposition,validationVersion,proposition} from './claim-validation.mjs';
import {groupSources,copiedSource,sourceGroup} from './source-lineage.mjs';
import {freshnessPolicy} from './graph-policy.mjs';
import {canonicalIdentity} from './identity.mjs';
export const claimTypes=['event','business','transmission','value_capture','customer','revenue_share','protocol_metric','tokenomics','attribution'];
const supported=new Set(['VERIFIED','SUPPORTED']);
const tentative=/\b(may|might|could|will|expect(?:s|ed)?|rumou?r|speculat|unconfirmed|planned|proposed)\b|루머|미확인|예정|계획|검토|가능성|기대|예상|전망/i;
const broad=/^(AI|인공지능|반도체|semiconductors?|technology|기술|금융|코인|crypto|DeFi|산업|energy)$/i;
export const concrete=s=>norm(s).length>=3&&!broad.test(norm(s));
export function quoteMatches(body,quote){return norm(quote).length>=(proposition(quote)?.language==='ko'?12:24)&&norm(quote).length<=1200&&norm(body).includes(norm(quote));}
export function numbersPreserved(value,quote){const c=compareTypedValues(quote,value);return c.numeric&&c.units&&c.period&&c.scope;}
export function entityMention(asset,text){const t=norm(text).toLowerCase();return [asset?.symbol,asset?.name,asset?.name?.replace(/\b(inc|corp|corporation|ltd|co)\b\.?/gi,'').trim()].filter(x=>x?.length>=2).some(x=>new RegExp('(?:^|[^a-z0-9])'+x.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:$|[^a-z0-9])','i').test(t));}
async function validateSingleClaim(proposal,sources,assets,runId,now=Date.now()){
 const s=sources.find(x=>x.id===proposal.source_id),a=assets.find(x=>x.id===proposal.subject_id),quote=norm(proposal.quote),type=proposal.type,reasons=[];
 const validation=validateProposition(proposal,quote,s,a);
 let status='SUPPORTED';
 const secondary=s?.resolvedAuthority?.authorityVerified===true&&[2,3].includes(s.resolvedAuthority.sourceTier)&&s.documentId&&s.documentHash&&s.securityVersion&&s.locator;
 if(s?.evidence===false||['DISCOVERY_ONLY','UNTRUSTED_SOURCE'].includes(s?.trust))reasons.push('검색 요약 또는 외부 추출본만으로 사실을 확정하지 않음');
 const table=proposal.table_ref?validation.cell:null;
 if(!claimTypes.includes(type)||!s||!safeUrl(s?.url)||(!table&&proposal.dart_event_ref===undefined&&(!quoteMatches(s?.body,quote)||!numbersPreserved(proposal.value,quote))))reasons.push('원문·인용·숫자 검증 실패');
 if(!a&&proposal.subject_id!=='EVENT')reasons.push('대상 식별 실패');
 if(a&&s?.assetId!==a.id&&!entityMention(a,quote))reasons.push('해당 기업·토큰에 대한 문장인지 확인 필요');
 if(s?.publishedAt&&Date.parse(s.publishedAt)>now)reasons.push('미래 자료');
 const specific=proposal.freshness_policy_id||(['REQUIRES','USED_IN','DEPENDS_ON','PART_OF'].includes(validation.proposition?.predicate?.toUpperCase())?freshnessPolicy({relation_type:validation.proposition.predicate.toUpperCase()}).policy_id:null);
 const maxDays=specific?freshnessPolicy({policy_id:specific}).max_age/86400000:type==='business'||type==='customer'||type==='revenue_share'?config.businessFreshDays:config.eventFreshDays;
 const scopedResearchDocument=(proposal.research_ref!==undefined||proposal.promotion_ref!==undefined||proposal.business_ref!==undefined)&&['business','transmission'].includes(type)&&validation.checks.SOURCE_AUTHORITY.status==='PASS'&&s?.documentBasis==='CURRENT_OFFICIAL_DOCUMENT';
 const currentDocumentation=(['value_capture','tokenomics'].includes(type)||scopedResearchDocument)&&s?.sourceType==='official'&&!s.publishedAt;
 const basis=currentDocumentation?s.observedAt:s?.publishedAt;
 if(!basis||!Number.isFinite(Date.parse(basis))||now-Date.parse(basis)>maxDays*86400000||Date.parse(basis)>now)reasons.push('발행 시점 확인 또는 최신 근거 필요');
 if(['business','customer','revenue_share','value_capture','protocol_metric','tokenomics'].includes(type)&&!['regulatory','official','business'].includes(s?.sourceType)&&!(secondary&&type==='business'))reasons.push('해당 사실의 공식 근거 필요');
 if(type==='business'&&!table&&proposal.business_ref===undefined&&!/(manufactur|produc|sell|provid|develop|deliver|사업|생산|제조|판매|제공|개발)/i.test(quote))reasons.push('사업 수행 표현 미확인');
 if(['business','customer','value_capture','transmission'].includes(type)&&/(does not|do not|not currently|no longer|not implemented|subsidiar|our customers (?:manufacture|produce|sell|develop)|고객사[가는의]|자회사|영위하지|생산하지|제공하지|시행되지|부인)/i.test(quote))reasons.push('부정·제3자·미시행 문장 확인 필요');
 if(['protocol_metric','value_capture','tokenomics'].includes(type)&&a?.kind!=='CRYPTO')reasons.push('주식과 프로토콜·토큰 사실 유형 불일치');
 if(type==='customer'&&(!/(contract|agreement|customer|supplier|계약|고객|공급|납품|매출처)/i.test(quote)||['COOPERATES_WITH','CAN_SUPPLY','NEGOTIATES_CUSTOMER','PURSUES_SUPPLY_CHAIN','EXPECTED_BENEFIT','TARGETED_PRODUCT'].includes(validation.proposition?.predicate)))reasons.push('고객·공급 계약 표현 미확인');
 if(type==='revenue_share'&&!table&&(!/%/.test(quote)||!/(?:%\s+of\s+(?:(?:our|total|net|consolidated)\s+)*(?:revenue|sales)|(?:매출|매출액).{0,50}비중|비중.{0,50}(?:매출|매출액))/i.test(quote)))reasons.push('매출 비중 미확인');
 if(type==='value_capture'&&!/(fee.{0,30}(holder|stak)|buyback|burn|revenue.shar|token.{0,30}(required|demand)|수수료.{0,20}(분배|보유)|소각|바이백|수익.?배분)/i.test(quote))reasons.push('토큰 가치 귀속 구조 미확인');
 if(type==='transmission'&&(!concrete(proposal.predicate)||!/(classified as|type of|subtype of|category of|broader than|narrower than|하위 범주|한 종류|demand|requir|used|suppl|driv|increase|decrease|inspect|process|material.{0,40}for|equipment.{0,40}for|system.{0,40}for|수요|필요|사용|공급|증가|감소|검사|가공|공정)/i.test(quote)))reasons.push('구체적인 전달경로 미확인');
 if(type==='attribution'&&!/(shares?|stock|token|price|주가|가격).{0,100}(rose|rall|jump|fell|slid|gain|상승|하락|급등)|(?:rose|rall|jump|fell|상승|하락).{0,100}(?:because|after|on news|due to|따라|영향|소식)/i.test(quote))reasons.push('가격 움직임에 대한 출처의 설명 미확인');
 if(a&&!table&&proposal.business_ref===undefined&&proposal.dart_event_ref===undefined&&!entityMention(a,quote)&&!((/^(?:we|our company)\b|^(?:당사|우리 회사)(?:는|가|은)|^Our (?:principal |primary |major )?products (?:include|are) /i.test(quote))&&s?.assetId===a.id&&validation.checks.SOURCE_AUTHORITY.status==='PASS'))validation.checks.SUBJECT_MATCH={status:'FAIL',reason:'명시된 대상 또는 검증된 발행인 주어가 아님'};
 for(const [key,check] of Object.entries(validation.checks))if(check.status==='FAIL')reasons.push(key+': '+check.reason);
 if(reasons.length)status='UNVERIFIED';else if(/rumou?r|unconfirmed|루머|미확인/i.test(quote))status='RUMOR';else if(tentative.test(quote))status='INFERRED';
 else status=Object.values(validation.checks).every(c=>c.status==='PASS')&&type!=='attribution'?'VERIFIED':'INFERRED';
 // Verifies that an issuer announced a plan, never that the plan was executed.
 if(proposal.research_ref!==undefined&&type==='event'&&validation.proposition?.eventState==='ANNOUNCED'&&!reasons.length&&!/rumou?r|unconfirmed|루머|미확인/i.test(quote)&&Object.values(validation.checks).every(c=>c.status==='PASS'))status='VERIFIED';
 if(proposal.dart_event_ref!==undefined&&!reasons.length&&Object.values(validation.checks).every(c=>c.status==='PASS'))status='VERIFIED';
 if(secondary&&status!=='RUMOR')status='UNVERIFIED';
 if(s?.resolvedAuthority?.sourceTier===4)status=s.resolvedAuthority.authorityType==='COMMUNITY'?'RUMOR':'UNVERIFIED';
 const id=await hash([validationVersion,runId,proposal.id,type,proposal.subject_id,norm(proposal.predicate),norm(proposal.value),JSON.stringify(proposal.period||{}),JSON.stringify(proposal.scope||{}),JSON.stringify(proposal.table_value||{}),s?.id,quote].join('|'));
 return {evidenceLevel:status,sourceCount:s?1:0,officialSourceCount:status==='VERIFIED'?1:0,...(secondary?{evidencePolicy:evidencePolicyVersion,policySources:[{id:s.id,url:s.url,sourceTier:s.resolvedAuthority.sourceTier,authorityVerified:true,secureBody:true,trust:s.trust||null,body:s.body.slice(0,12000),contentHash:s.contentHash,publicationFamily:s.resolvedAuthority.publicationFamily,originalSourceUrl:s.originalSourceUrl||s.origin_url||null,quoted_source:s.quoted_source||null,independenceKey:s.independenceKey,lineageVersion:s.lineageVersion}]}:{}),validationVersion,validationChecks:validation.checks,typedValue:validation.typedValue,period:validation.period,scope:validation.scope,exposureType:validation.exposureType||'UNKNOWN',tableEvidence:table,normalizedProposition:validation.proposition,object:validation.proposition?.object||norm(proposal.value),structuredPredicate:validation.proposition?.predicate||null,effectiveAt:s?.effectiveAt||null,id,localId:proposal.id,type,subject:proposal.subject_id,predicate:norm(proposal.predicate),value:table?`${table.row_header} · ${table.column_header} · ${table.cell_value} ${table.unit}`:norm(proposal.value),status,confidence:status==='VERIFIED'?'HIGH':'LOW',asOf:basis||null,asOfKind:currentDocumentation?'observed':'published',sourceIds:s?[s.id]:[],quote:table?`${table.row_header} | ${table.column_header} | ${table.cell_value} ${table.unit}`:quote,reasons,sourceType:s?.sourceType||null,independenceKey:s?.independenceKey||sourceGroup(s||{}),sourceUrl:s?.url||null,locator:table?.source_location||s?.locator||null};
}
export async function validateClaim(proposal,sources,assets,runId,now=Date.now()){
 const grouped=groupSources(sources),refs=proposal.evidence?.length?proposal.evidence:[{source_id:proposal.source_id,quote:proposal.quote}];
 const results=await Promise.all(refs.slice(0,10).map(ref=>validateSingleClaim({...proposal,...ref},grouped,assets,runId,now)));
 const best=results.find(c=>c.status==='VERIFIED')||results.find(c=>!c.reasons.length)||results[0];
 const evidence=results.map(c=>({sourceId:c.sourceIds[0]||null,quote:c.quote,locator:c.locator,independenceKey:c.independenceKey,status:c.status,checks:c.validationChecks,reasons:c.reasons,version:validationVersion}));
 // Each reference is validated separately before policy corroboration. A bad
 // reference cannot borrow the best reference's PASS checks.
 corroborateClaims(results);
 const accepted=results.find(c=>c.status==='VERIFIED')||results.find(c=>c.status==='SUPPORTED'&&c.corroboration?.passed)||best;
 return {...accepted,sourceIds:[...new Set(evidence.map(e=>e.sourceId).filter(Boolean))],sourceEvidence:evidence,independentSourceCount:accepted.corroboration?.passed?accepted.independentSourceCount:independentEvidence(evidence).size};
}
const validEvidence=e=>e.sourceId&&!e.reasons.length&&Object.entries(e.checks).every(([key,v])=>key==='SOURCE_AUTHORITY'||v.status==='PASS');
function independentEvidence(evidence){
 const eligible=evidence.filter(validEvidence),groups=new Set();
 for(let i=0;i<eligible.length;i++){
  const e=eligible[i];
  // Identical long quotes shared across publishers may be syndicated releases.
  const copy=eligible.slice(0,i).find(x=>norm(x.quote)===norm(e.quote)&&norm(e.quote).length>=80);
  groups.add(copy?copy.independenceKey:e.independenceKey);
 }
 return groups;
}
export function reconcileClaims(claims){
 const initiallySupported=new Set(claims.filter(c=>supported.has(c.status)).map(c=>c.id));
 for(const c of claims){
  const peers=claims.filter(x=>x.subject===c.subject&&x.type===c.type&&norm(x.predicate).toLowerCase()===norm(c.predicate).toLowerCase()&&JSON.stringify(x.period)===JSON.stringify(c.period)&&JSON.stringify(x.scope)===JSON.stringify(c.scope));
  if(peers.some(x=>x!==c&&initiallySupported.has(x.id)&&initiallySupported.has(c.id)&&x.value!==c.value&&/\d/.test(x.value+c.value))){c.status='CONFLICTED';c.confidence='LOW';c.reasons.push('같은 항목의 수치 충돌 · 범위·기준일 확인 필요');continue;}
  const same=peers.filter(x=>norm(x.value)===norm(c.value));
  c.sourceEvidence=[...new Map(same.flatMap(x=>x.sourceEvidence||[]).map(e=>[e.sourceId,e])).values()];
  c.sourceIds=c.sourceEvidence.map(e=>e.sourceId).filter(Boolean);c.independentSourceCount=independentEvidence(c.sourceEvidence).size;
  if(c.status==='INFERRED'&&!tentative.test(c.quote)&&!c.reasons.length&&c.independentSourceCount>=2){c.status='SUPPORTED';c.confidence='MEDIUM';}
 }return corroborateClaims(claims);
}
export function deduplicateSources(sources){
 const grouped=groupSources(sources),out=[];for(const s of grouped){const original=sources.find(x=>x.id===s.id);if(original)original.independenceKey=s.independenceKey;if(!out.some(x=>copiedSource(x,s)))out.push(s);}return out;
}
export function causalityStatus(claims,market,scenario=false){
 const relevant=c=>!market?.assetId||c.subject===market.assetId||c.subject==='EVENT';
 const event=claims.filter(c=>c.type==='event'&&supported.has(c.status)&&relevant(c));if(!event.length)return {status:scenario?'scenario':'no_evidence',claimIds:[],confidence:'LOW'};
 if(!market)return {status:'event_supported',claimIds:event.map(c=>c.id),confidence:'MEDIUM'};
 const attribution=claims.filter(c=>c.type==='attribution'&&supported.has(c.status)&&relevant(c)&&instant(c.asOf)&&Date.parse(c.asOf)<=Date.parse(market.endAt)&&Date.parse(c.asOf)>=Date.parse(market.startAt));
 // Reporting about an already completed move is contextual, not proof of a primary cause.
 const aligned=event.filter(c=>instant(c.asOf)&&Date.parse(c.asOf)<=Date.parse(market.endAt)&&Date.parse(c.asOf)>=Date.parse(market.startAt));
 return {status:attribution.length&&aligned.length?'reported_catalyst':'unclear',claimIds:[...aligned,...attribution].map(c=>c.id),confidence:attribution.length&&aligned.length?'MEDIUM':'LOW'};
}
export function qualityGate(candidate,claims,asset,{scenario=false,causality=null}={}){
 const cs=(candidate.claim_ids||[]).map(id=>claims.find(c=>c.localId===id||c.id===id)).filter(Boolean),good=cs.filter(c=>supported.has(c.status)),missing=[];
 if(asset?.identityStatus!=='verified')missing.push('자산 식별');
 const identity=asset?canonicalIdentity(asset):null;
 if(!identity?.complete)missing.push('자산 식별 세부 정보: '+(identity?.missing||['asset']).join(', '));
 if(asset?.active===false)missing.push('현재 상장 상태');
 if(!good.some(c=>c.type==='event'))missing.push('사건 근거');
 const paths=candidate.path||[];
 if(!paths.length||paths.length>config.maxPathDepth||paths.some(p=>p.relation==='CORRELATED_WITH'||!good.some(c=>c.localId===p.claim_id&&c.type==='transmission')))missing.push('전달경로 근거');
 if(paths.some((p,i)=>i>0&&norm(paths[i-1].to)!==norm(p.from)))missing.push('끊어진 전달경로');
 for(const p of paths){const q=good.find(c=>c.localId===p.claim_id)?.quote||'';
  if(['INCREASES','BENEFITS_FROM'].includes(p.relation)&&!/(increas|growth|grow|benefit|boost|증가|성장|확대|수혜)/i.test(q))missing.push('증가 방향의 원문 근거');
  if(['DECREASES','HURT_BY'].includes(p.relation)&&!/(decreas|declin|reduc|hurt|감소|축소|악화|위축)/i.test(q))missing.push('감소 방향의 원문 근거');
 }
 if(!good.some(c=>c.type==='transmission'&&norm(c.quote).toLowerCase().includes(norm(candidate.product).toLowerCase())))missing.push('제품 단위 전달 근거');
 if(paths.length&&!good.some(c=>c.type==='event'&&(norm(c.quote).toLowerCase().includes(norm(paths[0].from).toLowerCase())||norm(c.quote).toLowerCase().includes(norm(candidate.product).toLowerCase()))))missing.push('사건과 경로의 연결');
 const own=good.filter(c=>c.subject===asset?.id);
 if(!own.some(c=>c.type==='business'||c.type==='protocol_metric'))missing.push('실제 사업·프로토콜 노출');
 if(!own.some(c=>['business','protocol_metric'].includes(c.type)&&norm(c.quote).toLowerCase().includes(norm(candidate.product).toLowerCase())))missing.push('해당 제품의 실제 사업 근거');
 if(asset?.kind==='CRYPTO'&&!own.some(c=>c.type==='value_capture'))missing.push('토큰 가치 귀속');
 if(!concrete(candidate.product))missing.push('구체적 제품·서비스');
 if(candidate.relationship==='SAME_NARRATIVE'||candidate.relationship==='SAME_ECOSYSTEM'||candidate.relationship==='TOKENOMICS_SIMILAR')missing.push('동일 촉매의 직접 전달경로');
 if(scenario)missing.push('실제 사건이 아닌 조건부 시나리오');
 if(causality&&causality.status!=='reported_catalyst')missing.push('가격 움직임의 촉매 확인');
 return {passed:missing.length===0,missing:[...new Set(missing)],claimIds:good.map(c=>c.id)};
}
export function scoreCandidate(candidate,claims,asset,gate){
 const weights=asset.kind==='CRYPTO'?config.cryptoWeights:config.stockWeights,verified=claims.filter(c=>gate.claimIds.includes(c.id)),values={directness:(candidate.path?.length||9)<=1?1:(candidate.path?.length||9)<=2?.7:.4,timing:verified.every(c=>c.asOf&&Date.now()-Date.parse(c.asOf)<30*86400000)?1:null};
 // Only measured exposure values may enter exposure weights. Missing values stay null.
 if(verified.some(c=>c.type==='protocol_metric'&&c.subject===asset.id))values.protocolExposure=1;
 if(verified.some(c=>c.type==='customer'&&c.subject===asset.id))values.customerMarket=1;
 const exposure=verified.filter(c=>c.type==='revenue_share'&&c.exposureType==='PRODUCT_REVENUE'&&c.subject===asset.id&&norm(c.quote).toLowerCase().includes(norm(candidate.product).toLowerCase())&&/(revenue|sales|매출)/i.test(c.quote)).map(c=>{
  const percentages=c.quote.match(/(?:\d+(?:\.\d+)?)\s*%/g)||[];
  return percentages.length===1?Number(percentages[0].replace('%','').trim()):null;
 }).filter(n=>n!==null&&n>=0&&n<=100);
 if(exposure.length&&new Set(exposure).size===1)values.revenueExposure=exposure[0]/100;
 if(verified.some(c=>c.type==='transmission'))values.demandSensitivity=1;
 if(verified.some(c=>c.type==='value_capture'))values.valueCapture=1;
 const covered=Object.entries(weights).reduce((s,[k,w])=>s+(values[k]!==null&&values[k]!==undefined?w:0),0)/100;
 const lowerBound=Object.entries(weights).reduce((s,[k,w])=>s+(values[k]??0)*w,0),enough=covered>=config.minimumScoreCoverage;
 return {score:gate.passed&&enough?Math.round(lowerBound):null,band:!gate.passed?'근거 확인 필요':!enough?'노출 자료 부족':lowerBound>=70?'영향 경로 뚜렷':lowerBound>=40?'일부 영향 경로 확인':'제한적 영향 경로',coverage:Math.round(covered*100),components:Object.entries(weights).map(([key,weight])=>({key,weight,value:values[key]??null})),version:asset.kind==='CRYPTO'?config.cryptoScoreVersion:config.stockScoreVersion,confidence:gate.passed?'MEDIUM':'LOW'};
}
