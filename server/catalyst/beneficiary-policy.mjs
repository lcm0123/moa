import policy from '../../config/catalyst-beneficiary.json' with {type:'json'};
import {fixedExposureScore,economicAssessment} from './economic-exposure.mjs';
import {norm} from './core.mjs';
import {scopeTerms} from './document-scope.mjs';
import {verifiedListedAsset} from './business-exposure.mjs';
import {researchConcepts} from '../../dist/js/catalyst-question-scope.js';
export {policy as beneficiaryPolicy};
export const knownFact=f=>!!f&&['VERIFIED','SUPPORTED','INFERRED'].includes(f.status)&&f.sourceIds?.length>0&&f.quote&&f.validationVersion===policy.version;
const lower=x=>norm(x||'').toLowerCase();
export function expansionScope(condition){
 return condition?.targetScope==='SUBSTRATE'?{targets:['PCB','PACKAGE_SUBSTRATE'],basis:'USER_BROAD_INDUSTRY_ASSUMPTION',factualClaim:false}:{targets:[condition?.targetScope],basis:'USER_SUPPLIED_CONDITION',factualClaim:false};
}
export function productExposure(fact,condition){
 const ownClause=String(fact.quote||'').split(/[,;。]|\s+(?:and|및)\s+/i).find(x=>lower(x).includes(lower(fact.product)))||fact.product||'';
 const text=fact.applicationQuote||ownClause,ids=scopeTerms(text).map(t=>t.id),target=condition?.targetScope;
 const substrateTarget=['SUBSTRATE','PACKAGE_SUBSTRATE','FC_BGA','ABF_SUBSTRATE','BT_SUBSTRATE','PCB'].includes(target);
 if(!substrateTarget){
  const targets=condition?.kind==='ECONOMIC'?condition.topics.map(t=>t.id):[target];
  const matched=targets.filter(id=>ids.includes(id));
  const economic=condition?.kind==='ECONOMIC';
  // A sector mention is not rate/FX/cost exposure. The same product excerpt
  // must state the economic driver and a concrete operating/financial channel.
  // Tuple slots are [id, label, aliases, kind, exposure pattern].
  const macroChannel=!economic||matched.some(id=>{const c=researchConcepts.find(([key])=>key===id);return c?.[3]==='ECONOMIC'&&c[4]?.test(text);});
  const direct=condition?.targetProduct&&(matched.length||lower(text).includes(lower(condition.targetProduct)))&&macroChannel;
  return direct?{level:'DIRECT',application:'TARGET_DIRECT',scope:matched.length?matched:[target]}:{level:'WEAK',application:'UNKNOWN',scope:ids};
 }
 if(/\bTGV\b|through glass via|(?:glass|유리).{0,15}(?:기판|substrate)/i.test(ownClause))return {level:'ADJACENT',application:'GLASS_SUBSTRATE_CONDITIONAL',scope:ids};
 if(/package.{0,30}(?:singulat|cut|saw)|패키지의.{0,25}절단|기판.{0,25}개별\s*칩.{0,25}절단|VISION PLACEMENT|(?:TC|Die|FC)\s*(?:BONDER|본더)/i.test(fact.quote+' '+fact.product)&&!/substrate fabrication|기판 제조 공정/.test(text))return {level:'ADJACENT',application:'SEMICONDUCTOR_PACKAGING_ADJACENT',scope:ids};
 const packageDirect=ids.some(x=>['PACKAGE_SUBSTRATE','FC_BGA','ABF_SUBSTRATE','BT_SUBSTRATE'].includes(x))||/integrated circuit substrate|IC\s*Package\s*기판|반도체\s*기판/i.test(text);
 if(packageDirect)return {level:'DIRECT',application:/\bic substrate/i.test(text)?'IC_SUBSTRATE_DIRECT':'PACKAGE_SUBSTRATE_DIRECT',scope:ids};
 if(ids.includes('PCB'))return {level:target==='PCB'||target==='SUBSTRATE'?'DIRECT':'ADJACENT',application:'PCB_DIRECT',scope:ids};
 if(ids.includes('SUBSTRATE'))return {level:'ADJACENT',application:'SUBSTRATE_UNSPECIFIED',scope:ids};
 if(target&&!['SUBSTRATE','PACKAGE_SUBSTRATE','FC_BGA','ABF_SUBSTRATE','BT_SUBSTRATE','PCB'].includes(target)&&lower(text).includes(lower(condition.targetProduct)))return {level:'DIRECT',application:'TARGET_DIRECT',scope:[target]};
 if(/semiconductor|반도체/i.test(text))return {level:['EQUIPMENT','MATERIAL'].includes(fact.category)?'ADJACENT':'THEMATIC',application:'SEMICONDUCTOR_ADJACENT',scope:ids};
 if(/electronics|electronic|전자/i.test(text))return {level:'THEMATIC',application:'GENERAL_ELECTRONICS',scope:ids};
 return {level:'WEAK',application:'UNKNOWN',scope:ids};
}
export function expansionSensitivity(fact,condition){
 if(!knownFact(fact))return {type:'UNKNOWN',level:'UNKNOWN',basis:[]};
 if(condition&&(condition.kind==='ECONOMIC'||condition.direction==='DECREASE'||condition.direction==='MIXED'||condition.type==='USER_RESEARCH_TOPIC'))return {type:'SCENARIO_EXPOSURE',level:'UNKNOWN',basis:[fact.id],status:'RESEARCH_INFERENCE'};
 const t=fact.quote+' '+(fact.applicationQuote||'');
 if(/replacement|replace(?:s|ment)?|교체주기|교체용/i.test(t))return {type:'REPLACEMENT_EQUIPMENT',level:'LOW',basis:[fact.id],status:'RESEARCH_INFERENCE'};
 if(fact.category==='MATERIAL'&&/consum|chemical|resin|film|foil|잉크|소모|화학|필름|동박|수지|약품/i.test(t))return {type:'VOLUME_LINKED_CONSUMABLE',level:'HIGH',volumeLeverage:true,basis:[fact.id],status:'RESEARCH_INFERENCE'};
 if(fact.category==='EQUIPMENT')return {type:'CAPACITY_LINKED_EQUIPMENT',level:/production|manufactur|공정|생산|기판|PCB|substrate/i.test(t)?'HIGH':'MEDIUM',basis:[fact.id],status:'RESEARCH_INFERENCE'};
 if(fact.category==='COMPONENT')return {type:'INDIRECT_COMPONENT',level:'LOW',basis:[fact.id],status:'RESEARCH_INFERENCE'};
 if(fact.category==='SERVICE')return {type:'INDIRECT_SERVICE',level:'LOW',basis:[fact.id],status:'RESEARCH_INFERENCE'};
 return {type:'UNKNOWN',level:'UNKNOWN',basis:[]};
}
export function exposureScore(dimensions){
 return fixedExposureScore(dimensions);
}
export function beneficiaryAssessment({asset,facts,condition,universe=[],now=Date.now()}){
 const business=facts.filter(f=>knownFact(f)&&f.type==='business'&&f.businessEvidence===true&&!/^(?:반도체|디스플레이|전자|semiconductors?|electronics|displays?)$/i.test(f.product?.trim()||'')&&['EQUIPMENT','MATERIAL','COMPONENT','SERVICE','PRODUCT'].includes(f.category)&&!targetOutput(f,condition));
 const concrete=x=>!!x.fact.applicationQuote&&!['UNKNOWN','SEMICONDUCTOR_ADJACENT','GENERAL_ELECTRONICS'].includes(x.exposure.application);
 const generic=f=>/^(?:설비|제품|장비|소재|equipment|products?|materials?)$/i.test(f.product.trim());
 const ordered=business.map(f=>({fact:f,exposure:productExposure(f,condition)})).sort((a,b)=>Number(concrete(b))-Number(concrete(a))||Number(generic(a.fact))-Number(generic(b.fact))||policy.directness[b.exposure.level]-policy.directness[a.exposure.level]);
 const best=ordered[0],reasons=[];if(!verifiedListedAsset(asset,now))reasons.push('CANONICAL_LISTING_UNVERIFIED');if(!best||['WEAK','THEMATIC'].includes(best.exposure.level))reasons.push('RELATED_BUSINESS_EVIDENCE_MISSING');
 const exposure=best?.exposure||{level:'WEAK',application:'UNKNOWN'},sensitivity=expansionSensitivity(best?.fact,condition);
 const revenue=facts.filter(f=>knownFact(f)&&f.type==='revenue_share'&&f.relatedToBusiness&&f.status!=='INFERRED').sort((a,b)=>(a.status==='VERIFIED'?-1:1)-(b.status==='VERIFIED'?-1:1))[0];
 const share=revenue?.share,quant=Number.isFinite(share)&&share>=0&&share<=1;
 const revenueLevel=quant?(share>=policy.revenueBands.high?'HIGH':share>=policy.revenueBands.medium?'MEDIUM':'LOW'):revenue?.qualitativeLevel||'UNKNOWN';
 const customers=facts.filter(f=>knownFact(f)&&f.type==='customer'&&f.transactionExplicit&&f.relatedToBusiness&&f.product===best?.fact.product&&f.status!=='INFERRED');
 const overlap=customers.filter(f=>universe.some(u=>[u.name,u.asset?.name,u.asset?.symbol].filter(Boolean).some(n=>lower(f.customerName)===lower(n))));
 const momentum=facts.filter(f=>knownFact(f)&&['order','capex','event'].includes(f.type)&&f.relatedToBusiness&&f.product===best?.fact.product&&f.status!=='INFERRED'&&now-Date.parse(f.asOf)>=0&&now-Date.parse(f.asOf)<180*86400000);
 const quality=best?.fact.status==='VERIFIED'?1:best?.fact.status==='SUPPORTED'?.65:best?.fact.status==='INFERRED'?.35:null;
 const score=exposureScore({directness:best?policy.directness[exposure.level]:null,revenue:policy.levels[revenueLevel]??null,sensitivity:policy.levels[sensitivity.level]??null,customer:overlap.length?1:customers.length?.6:null,momentum:momentum.length?1:null,evidence:quality});
 const technical=facts.some(f=>knownFact(f)&&f.type==='technical');
 const filing=facts.some(f=>knownFact(f)&&f.filingSource);
 const confidence=best&&exposure.level==='DIRECT'&&filing&&technical&&quant?'HIGH':best&&['DIRECT','ADJACENT'].includes(exposure.level)&&quality>=.65?'MEDIUM':'LOW';
 const passed=!reasons.length,finalEligible=passed&&['DIRECT','ADJACENT'].includes(exposure.level)&&!['SEMICONDUCTOR_ADJACENT','GENERAL_ELECTRONICS'].includes(exposure.application)&&best.fact.applicationQuote&&score.coverage>=policy.minimumFinalCoverage;
 const why=beneficiaryThesis(best?.fact,sensitivity,condition);
 return {passed,reasons,finalEligible:!!finalEligible,exposureLevel:exposure.level,productTargetExposure:exposure.application,product:best?.fact.product||null,category:best?.fact.category||null,businessClaimId:best?.fact.id||null,applicationClaimId:best?.fact.applicationQuote?best.fact.id:null,revenueExposure:quant?{share,period:revenue.period,sourceIds:revenue.sourceIds,claimId:revenue.id}:revenueLevel,sensitivity,customerExposure:customers.length?customers:'UNKNOWN',customerMatch:overlap.length?'CUSTOMER_MATCH':'UNKNOWN',recentMomentum:momentum.length?momentum:'UNKNOWN',actualCatalyst:momentum.length?'YES':'UNKNOWN',exposureScore:score,confidence,benefitThesis:{text:why,status:'RESEARCH_INFERENCE',basis:[best?.fact.id].filter(Boolean),factualClaim:false},...economicAssessment({facts:facts.filter(knownFact),business:ordered,exposure,sensitivity,customers,overlap,momentum,passed}),missing:['revenue','customer','momentum'].filter(k=>({revenue:revenueLevel==='UNKNOWN',customer:!customers.length,momentum:!momentum.length})[k])};
}
export function targetOutput(fact,condition){
 if(condition?.upstreamOnly===false)return false;
 if(fact.category==='EQUIPMENT')return false;
 // A substrate maker's output is not an input consumed in substrate production.
 // This is a product identity check, not a list of companies or beneficiaries.
 const product=norm(fact.product),matches=scopeTerms(product);
 if(condition?.upstreamOnly&&matches.some(m=>m.id===condition.targetScope&&m.terms.some(t=>lower(t)===lower(product))))return true;
 const targetIdentity=(matches.length>0||/\b(?:fpcb|hdi|printed circuit boards?|WBCSP|WB.?CSP|FC.?CSP|FC.?BGA|MCP|SiP)\b/i.test(product))&&expansionScope(condition).targets.some(t=>['PCB','PACKAGE_SUBSTRATE','SUBSTRATE','FC_BGA'].includes(t))||lower(product)===lower(condition?.targetProduct);
 return targetIdentity&&!/material|chemical|film|foil|resin|laminate|ink|drill|소재|재료|약품|수지|필름|동박|잉크|드릴|부품/i.test(product);
}
export function beneficiaryThesis(fact,sensitivity,condition){
 if(!fact)return '관련 사업 근거를 확인하지 못했습니다.';
 if(sensitivity?.type==='SCENARIO_EXPOSURE')return `${fact.product} 사업의 관련 노출을 확인했습니다. ${condition?.topics?.length>1?'질문의 각 변화가 이 사업에 함께 적용되는지와 ':''}유불리·영향 규모는 추가 확인이 필요합니다.`;
 return `${fact.product} 사업이 확인됐습니다. ${sensitivity?.type==='VOLUME_LINKED_CONSUMABLE'?'생산량이 늘면 반복 소비 수요가 증가할 수 있습니다.':sensitivity?.type==='CAPACITY_LINKED_EQUIPMENT'?'투자 확대 시 장비 설치 수요와 연결될 수 있습니다.':'질문의 변화가 이 사업의 매출로 연결되는지는 추가 확인이 필요합니다.'}`;
}
