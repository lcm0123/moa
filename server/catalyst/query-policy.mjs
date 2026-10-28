import {norm} from './core.mjs';
import {scopeTerms,scopeLabel} from './document-scope.mjs';
import {questionMode,researchConcepts} from '../../dist/js/catalyst-question-scope.js';
export const intentPolicyVersion='intent-gates-2';
export function queryIntent(query){
 return questionMode(norm(query));
}
export function researchQuestion(query){
 const q=norm(query),intent=queryIntent(q);
 if(!['CONDITIONAL_ANALYSIS','BENEFICIARY_DISCOVERY'].includes(intent))return null;
 const terms=scopeTerms(q),economic=terms.filter(t=>researchConcepts.some(([id,,,kind])=>id===t.id&&kind==='ECONOMIC'));
 const position=t=>Math.min(...t.terms.map(word=>q.toLowerCase().indexOf(word.toLowerCase())));
 const primary=economic[0]||terms.slice().sort((a,b)=>position(a)-position(b))[0];
 const target=primary?scopeLabel(primary.id):norm(q.replace(/^(?:만약\s*|if\s+|assuming\s+)/i,'').split(/(?:투자|수요|생산|시장|가격|공급)?\s*(?:증설|증가|감소|확대|늘어나|커지|성장|관련|수혜|beneficiar|related|increases?|decreases?|grows?)/i)[0]).replace(/(?:들이|가|이|은|는)\s*$/,'').slice(0,120);
 if(!target||target.length<2||/^(?:어떤|어느|기업|회사|종목|주식|수혜주|뭐|무엇|which|what)$/i.test(target))return null;
 const decrease=/감소|축소|둔화|하락|인하|내려|내리|낮아|떨어|약세|decreas|declin|fall|lower|weaken/i.test(q);
 const increase=/증가|확대|상승|인상|늘어|오르|올라|높아|회복|강세|강화|커지|increas|grow|rise|higher|expand|recover/i.test(q);
 const capacity=/증설|capacity expansion|expand.{0,30}(?:capacity|plant)|build.{0,20}factor/i.test(q);
 return {intent,targetProduct:target,targetScope:primary?.id||target.toLowerCase(),topics:terms.map(t=>({id:t.id,label:scopeLabel(t.id)})),kind:economic.length?'ECONOMIC':'INDUSTRY',direction:decrease&&increase?'MIXED':decrease?'DECREASE':increase||capacity?'INCREASE':'UNSPECIFIED',action:capacity?'CAPACITY_EXPANSION':economic.length?'ECONOMIC_CHANGE':decrease?'DEMAND_DECREASE':increase?'DEMAND_INCREASE':'TOPIC_RESEARCH',upstreamOnly:capacity||/장비|소재|부품|공급사|equipment|material|supplier|component/i.test(q)};
}
export function userCondition(query){
 const q=norm(query);if(queryIntent(q)!=='CONDITIONAL_ANALYSIS')return null;
 const parsed=researchQuestion(q);if(!parsed)return null;
 const action=parsed.action;
 const target=parsed.targetProduct;
 if(!target||!/[\p{L}\p{N}]{2}/u.test(target))return null;
 return {...parsed,type:'USER_SUPPLIED_CONDITION',condition:parsed.targetScope+'_'+action,conditionText:q,rawQuestion:q,action,targetProduct:target,verificationRequired:false,factualClaim:false,version:intentPolicyVersion};
}
export function beneficiaryQuestion(query){
 const condition=userCondition(query);if(condition)return condition;
 const parsed=researchQuestion(query);if(parsed?.intent!=='BENEFICIARY_DISCOVERY')return null;
 const q=norm(query);return {...parsed,type:'USER_RESEARCH_TOPIC',condition:parsed.targetScope+'_RESEARCH',conditionText:q,rawQuestion:q,verificationRequired:false,factualClaim:false,version:intentPolicyVersion};
}
export function validBeneficiaryQuestion(value){
 if(!value||value.factualClaim!==false||value.verificationRequired!==false)return false;
 return JSON.stringify(value)===JSON.stringify(beneficiaryQuestion(value.rawQuestion));
}
export function validUserCondition(value){
 if(!value||value.type!=='USER_SUPPLIED_CONDITION'||value.verificationRequired!==false||value.factualClaim!==false)return false;
 const parsed=userCondition(value.rawQuestion);return !!parsed&&JSON.stringify(value)===JSON.stringify(parsed);
}
export function intentGate({query,condition,eventVerified=false,newsVerified=false,marketVerified=false}){
 const intent=queryIntent(query),reasons=[];
 if(intent==='CONDITIONAL_ANALYSIS'){if(!validUserCondition(condition))reasons.push('EXPLICIT_CONDITION_REQUIRED');}
 else if(!eventVerified)reasons.push('ACTUAL_EVENT_REQUIRED');
 if(intent==='MOVE_ANALYSIS'){if(!newsVerified)reasons.push('NEWS_EVIDENCE_REQUIRED');if(!marketVerified)reasons.push('MARKET_EVIDENCE_REQUIRED');}
 return {intent,passed:!reasons.length,reasons,eventRequired:intent!=='CONDITIONAL_ANALYSIS'};
}
export function marketEvidenceReady(value){
 return !!value&&!value.stale&&Number.isFinite(value.price)&&value.price>0&&!!value.source&&Number.isFinite(Date.parse(value.endAt))&&Object.values(value.windows||{}).some(w=>Number.isFinite(w.return)&&w.dataQuality?.return==='VERIFIED');
}
