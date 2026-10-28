import {canonicalCondition} from './graph-policy.mjs';
import {norm,safeUrl} from './core.mjs';
import {compareTypedValues,parsePeriod,parseScope,validationVersion} from './typed-values.mjs';
import {koreanProposition,exposure} from './normalization.mjs';
import {validateTableEvidence} from './table-evidence.mjs';
import {hostedAuthority} from './authority.mjs';
import {businessAssertions} from './business-assertions.mjs';
import {researchAssertions} from './research-assertions.mjs';
import {dartEventAssertions} from './dart-event-assertions.mjs';
import {promotionAssertions} from './promotion-assertions.mjs';
import {resolveDocumentScope} from './document-scope.mjs';
export {validationVersion};
export const validationStages=['SUBJECT_MATCH','PREDICATE_MATCH','OBJECT_MATCH','NUMERIC_MATCH','UNIT_MATCH','PERIOD_MATCH','SCOPE_MATCH','SEMANTIC_SUPPORT','SOURCE_AUTHORITY'];
const normalized=s=>norm(s).toLowerCase().replace(/[.!?。]+$/,'');
// Deliberately narrow extraction, not an open-ended semantic model. Unsupported
// constructions/translations are retained but cannot become VERIFIED.
export function proposition(text){
 const burn=/^(?:Since [A-Za-z]+ \d{4}, protocol fees collected across .+?'s products|Protocol fees) are used to burn ([A-Z0-9]+)(?:, reducing its total supply over time)?\.$/.exec(norm(text));
 if(burn)return {subject:normalized(burn[1]),predicate:'BURN',object:'protocol fees'};
 const conditional=/^IF (.{1,180}?) THEN (.+)$/i.exec(norm(text));
 if(conditional){const p=proposition(conditional[2]);return p?{...p,condition:canonicalCondition({scenario:normalized(conditional[1])}),raw_condition_text:conditional[1]}:null;}
 const governance=/^([A-Z0-9]+) is (?:the |a |first and foremost a )?governance token(?: of| for|, governing) (?:the )?([A-Za-z][A-Za-z -]{1,60}?)(?: protocol)?(?:[.,]|$)/.exec(norm(text));
 if(governance)return {subject:normalized(governance[1]),predicate:'GOVERNANCE_OF',object:normalized(governance[2])};
 const product=/^Our (?:principal |primary |major )?products include (.+)[.!?]?$/.exec(norm(text));
 if(product)return {subject:'our company',predicate:'REPORTS_PRODUCTS',object:normalized(product[1])};
 const ko=koreanProposition(text);if(ko)return ko;
 const t=norm(text).replace(/[.!?。]+$/,'');
 const relation=/^(.+?)\s+(is used in|depends on|runs on|is part of|benefits from|is hurt by|competes with|is a substitute for|correlates with|causes)\s+(.+)$/i.exec(t);
 if(relation)return {subject:normalized(relation[1]),predicate:({'is used in':'USED_IN','depends on':'DEPENDS_ON','runs on':'RUNS_ON','is part of':'PART_OF','benefits from':'BENEFITS_FROM','is hurt by':'HURT_BY','competes with':'COMPETES_WITH','is a substitute for':'SUBSTITUTE_FOR','correlates with':'CORRELATED_WITH',causes:'CAUSES'})[relation[2].toLowerCase()],object:normalized(relation[3])};
 const m=/^(.+?)\s+(executed|ended|terminated|repealed|amended|manufactures?|manufactured|produces?|produced|sells?|sold|provides?|provided|develops?|developed|delivers?|delivered|announced?|announces|increases?|increased|decreases?|decreased|receives?|received|requires?|required|uses?|used|supplies|supply|supplied|completed|plans?|planned|was|were|is|are)\b\s*(.*)$/i.exec(t);
 if(!m)return null;
 return {subject:normalized(m[1]),predicate:m[2].toLowerCase(),object:normalized(m[3])};
}
export function sourceAuthority(source,asset){
 if(!safeUrl(source?.url))return false;
 const resolved=source.resolvedAuthority;
 if(resolved?.status==='AUTHORITY_VERIFIED'&&resolved.ownershipVerified&&resolved.organizationId&&safeUrl(resolved.verificationSource)&&Date.parse(resolved.validTo)>Date.now()&&source.documentId&&source.documentHash&&source.securityVersion&&(!asset||resolved.assetId===asset.id))return true;
 const host=new URL(source.url).hostname;
 const regulator=/(^|\.)(sec\.gov|federalreserve\.gov|dart\.fss\.or\.kr|opendart\.fss\.or\.kr)$/.test(host);
 if(regulator&&['regulatory','business','official'].includes(source.sourceType))return true;
 const proof=source.authority;
 if(['business','official','regulatory'].includes(source.sourceType)&&hostedAuthority(source,asset))return true;
 const hosted=/(^|\.)(q4cdn\.com|cloudfront\.net|amazonaws\.com|akamaized\.net)$/.test(host);
 if(hosted&&!(proof?.publisherId&&proof.documentHash&&proof.documentUrl===source.url&&safeUrl(proof.verificationSource)&&new URL(proof.verificationSource).hostname!==host))return false;
 return ['business','official','regulatory'].includes(source.sourceType)&&proof?.verified===true&&['issuer_document','official_domain'].includes(proof.kind)&&
  !!proof.assetId&&proof.assetId===source.assetId&&(!asset||asset.id===proof.assetId)&&!!safeUrl(proof.verificationSource);
}
export function validateProposition(proposal,quote,source,asset){
 if(proposal.promotion_ref!==undefined){
  const a=promotionAssertions(source?.body).find(x=>x.ref===proposal.promotion_ref),scope=resolveDocumentScope({document:{body:quote},targetProduct:proposal.target_product});
  const ok=!!a&&a.quote===quote&&proposal.value===quote&&proposal.predicate===a.predicate&&proposal.type==='transmission'&&!!source?.sectionId&&!!source?.locator&&!source.sectionTruncated;
  const checks=Object.fromEntries(validationStages.map(k=>[k,{status:ok?'PASS':'FAIL',reason:'문장·관계 강도·원문 위치 재추출 대조'}]));
  checks.SCOPE_MATCH={status:scope.status==='EXACT'?'PASS':'FAIL',reason:scope.rejectReason||'명시적 적용 범위 일치'};
  checks.SOURCE_AUTHORITY={status:sourceAuthority(source,asset)?'PASS':source?.resolvedAuthority?.authorityVerified?'UNKNOWN':'FAIL',reason:'공식 소유권 또는 별도 출처 등급 확인'};
  return {checks,typedValue:compareTypedValues(quote,proposal.value).values,period:parsePeriod(quote),scope:parseScope(quote),proposition:a,exposureType:'UNKNOWN'};
 }
 if(proposal.dart_event_ref!==undefined){
  const a=dartEventAssertions(source?.sectionHtml,{title:source?.title,issuer:asset?.id}).find(x=>x.ref===proposal.dart_event_ref);
  const ok=!!a&&!!asset&&source.assetId===asset.id&&a.eventState!=='UNKNOWN'&&proposal.type==='event'&&a.quote===quote&&proposal.value===quote&&proposal.predicate===a.predicate&&JSON.stringify(proposal.dart_event_value)===JSON.stringify(a)&&!source.sectionTruncated;
  const checks=Object.fromEntries(validationStages.map(k=>[k,{status:ok?'PASS':'FAIL',reason:'원문 표 행·라벨·값·통화·날짜·사건 상태 재추출 대조'}]));
  checks.SOURCE_AUTHORITY={status:sourceAuthority(source,asset)?'PASS':'UNKNOWN',reason:'공시 발행인과 DART 원문 확인'};
  return {checks,typedValue:[],period:{start:a?.start_date||null,end:a?.end_date||null},scope:{eventState:a?.eventState,eventEntity:a?.event_entity},proposition:a,exposureType:'UNKNOWN'};
 }
 if(proposal.research_ref!==undefined){
  const a=researchAssertions(source?.body).find(x=>x.ref===proposal.research_ref),typed=compareTypedValues(quote,proposal.value);
  const ok=!!a&&a.quote===quote&&proposal.value===quote&&proposal.predicate===a.predicate&&({event:'event',business:'business',technical:'transmission'})[a.kind]===proposal.type;
  const checks=Object.fromEntries(validationStages.map(k=>[k,{status:ok?'PASS':'FAIL',reason:'제한된 원문 문법으로 같은 주어·서술어·목적어 재검증'}]));
  if(a?.kind==='business'&&asset){
   const names=[asset.name,asset.name?.replace(/\b(inc|corp|corporation|ltd|co)\b\.?/gi,'').trim(),asset.symbol,'we','our company','당사','우리 회사'].filter(Boolean).map(x=>normalized(x));
   if(!names.includes(a.subject))checks.SUBJECT_MATCH={status:'FAIL',reason:'발행인 자신의 사업 주어가 아님'};
  }
  checks.SOURCE_AUTHORITY={status:sourceAuthority(source,asset)?'PASS':'UNKNOWN',reason:'발행인과 공식 도메인 확인'};
  return {checks,typedValue:typed.values,period:parsePeriod(quote),scope:{...parseScope(quote),...(a?.eventState?{eventState:a.eventState}:{})},proposition:a,exposureType:a?.kind==='business'?'QUALITATIVE':'UNKNOWN'};
 }
 if(proposal.business_ref!==undefined){
  const a=businessAssertions(source?.body).find(a=>a.ref===proposal.business_ref),typed=compareTypedValues(quote,proposal.value),ok=!!a&&a.quote===quote&&proposal.value===quote&&proposal.predicate===a.predicate&&source.assetId===asset?.id;
  const checks=Object.fromEntries(validationStages.map(k=>[k,{status:ok?'PASS':'FAIL',reason:'원문에서 명시적으로 연결된 사업·제품 문법을 다시 추출하여 대조'}]));
  if(a?.explicitSubject){const legal=s=>normalized(s||'').replace(/\b(?:corp|corporation|inc|ltd|limited|co)\b\.?/g,'').trim();if(legal(a.subject)!==legal(asset?.name))checks.SUBJECT_MATCH={status:'FAIL',reason:'명시된 제품 포트폴리오 주체와 발행 기업 불일치'};}
  checks.SOURCE_AUTHORITY={status:sourceAuthority(source,asset)?'PASS':'UNKNOWN',reason:'공시 발행인 확인'};
  return {checks,typedValue:typed.values,period:parsePeriod(quote),scope:{...parseScope(quote),...(a?.eventState?{eventState:a.eventState}:{})},proposition:a,exposureType:a?.exposureType||'QUALITATIVE'};
 }
 if(proposal.table_ref){const result=validateTableEvidence(proposal,source);return {...result,checks:{...result.checks,SOURCE_AUTHORITY:{status:sourceAuthority(source,asset)?'PASS':'UNKNOWN',reason:'공식 표의 발행인 확인'}},proposition:result.cell?{subject:result.cell.subject,predicate:'REPORTED_VALUE',object:result.cell.row_header}:null};}
 const value=norm(proposal.value),p=proposition(value),e=proposition(quote),typed=compareTypedValues(quote,value),checks={};
 const record=(key,result,reason)=>{checks[key]={status:result===true?'PASS':result===false?'FAIL':'UNKNOWN',reason};};
 record('SUBJECT_MATCH',p&&e?p.subject===e.subject:null,'주어를 원문과 대조');
 const topic=normalized(proposal.predicate);
 record('PREDICATE_MATCH',p&&e?p.predicate===e.predicate&&!!topic&&(normalized(quote).includes(topic)||topic===e.predicate.toLowerCase()):null,'동작·서술어 및 제안된 항목을 원문과 대조');
 record('OBJECT_MATCH',p&&e?p.object===e.object&&p.recipient===e.recipient&&exposure(value)===exposure(quote):null,'목적어·고객·제품/사업부 범위를 원문과 대조');
 record('NUMERIC_MATCH',typed.numeric,'정확한 십진값·부호·배수 대조');
 record('UNIT_MATCH',typed.units,'통화·단위 대조');
 record('PERIOD_MATCH',typed.period&&(!proposal.period||JSON.stringify(proposal.period)===JSON.stringify(parsePeriod(quote))),'대상 연도·주기·분기 대조');
 record('SCOPE_MATCH',typed.scope&&(!proposal.scope||JSON.stringify(proposal.scope)===JSON.stringify(parseScope(quote))),'연결·별도 / 계획·완료 범위 대조');
 // Exact statements are the only mechanically provable path for now. Even
 // plausible paraphrases need a future verifier; no keyword-based promotion.
 const koreanEquivalent=p?.language==='ko'&&e?.language==='ko'&&JSON.stringify(p)===JSON.stringify(e);
 record('SEMANTIC_SUPPORT',(normalized(value)===normalized(quote)||koreanEquivalent)&&!!p&&!!e?true:normalized(value)!==normalized(quote)?false:null,'동일 명제 또는 허용된 한국어 동사 활용 정규화');
 record('SOURCE_AUTHORITY',sourceAuthority(source,asset)?true:null,'공식 도메인 또는 식별 검증된 공시 출처');
 return {checks,typedValue:typed.values,period:parsePeriod(value),scope:parseScope(value),proposition:p,exposureType:exposure(value)};
}
