import {concreteTarget} from './research-config.mjs';
// Hypothesis-driven discovery only. No company dictionary, factual promotion,
// or extra requests: these queries replace the broad thematic slots.
export function precisionQueries(plan){
 const products=plan.productTargets.filter(concreteTarget),equipment=plan.equipmentTargets.filter(concreteTarget),materials=plan.materialTargets.filter(concreteTarget);
 if(!products.length||(!equipment.length&&!materials.length))return {discovery:plan.candidateDiscoveryQueries,technical:plan.technicalQueries};
 // Search-only translation is not a VERIFIED alias or a product relationship.
 const queryTerm=t=>t.replace(/검사장비/g,'inspection equipment').replace(/드릴링/g,'drilling').replace(/도금/g,'plating').replace(/라미네이션/g,'lamination').replace(/장비/g,'equipment');
 const chosen=equipment.slice().sort((a,b)=>Number(/[A-Z]/.test(b))-Number(/[A-Z]/.test(a))).slice(0,3);
 const make=(term,i,role)=>[products[i%products.length],queryTerm(term),role].filter(Boolean).join(' ').slice(0,180);
 const discovery=[...chosen.map((x,i)=>make(x,i,'manufacturer')),...materials.slice(0,2).map((x,i)=>make(x,i+chosen.length,'supplier'))];
 const technical=chosen.map((x,i)=>make(x,i,'official application'));
 return {discovery,technical:technical.length?technical:plan.technicalQueries};
}
