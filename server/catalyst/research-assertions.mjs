import {bridgeAssertions} from './technical-bridge.mjs';
import {norm} from './core.mjs';
// Closed extractive grammar. Targets proposed by the planner never enter this
// function, so a hypothesis cannot turn into evidence by keyword co-occurrence.
export function researchAssertions(body){
 const out=[];
 const add=(quote,subject,predicate,object,kind,extra={})=>{
  if(subject.length>120||object.length<3||object.length>450)return;
  if(kind==='technical'&&/^(?:they|we|what|which|how|why|where|when|because|depending|then)\b/i.test(subject))return;
  if(kind==='technical'&&/\b(?:manufactures?|produces?|sells?|provides?|develops?)\b/i.test(subject))return;
  if(kind==='technical'&&(/\b(?:through|via|will|would|may|could|should|expects?|plans?)\b/i.test(subject)||/^(?:as|to|for)\b/i.test(subject)||/[,;]|\b(?:or|and|increasing|including)$/i.test(object.slice(-12))))return;
  if(kind==='technical'&&(/\b(?:in|to|will|would|may|can|could|should|is|are|the|a|an|of)$/i.test(subject)||/^(?:of|since|ensure|allow|enable)\b/i.test(object)||/^(?:this|it|these|those)\b/i.test(subject)||/\b(?:javascript|cookies?|browser)\b/i.test(object)))return;
  out.push({ref:String(out.length),quote,subject:norm(subject).toLowerCase(),predicate,object:norm(object).replace(/[.!]$/,'').toLowerCase(),kind,...extra});
 };
 for(const quote of String(body||'').split(/\n|(?<=[.!?。])\s+(?=[A-Z가-힣])/).map(norm).filter(x=>x.length>=24&&x.length<=1200).slice(0,1400)){
  if(/\b(?:not|rumou?r|might|could|expected|expects|potential|customer(?:s)? (?:produce|manufacture))\b|아니|않|루머|미확인|수혜 기대|추정|고객사가/.test(quote))continue;
  let m;
  // A disclosed production/use clause, not two nearby product keywords.
  if((m=/^(.{3,100}?)(?:은|는) 당사의 (?:기존 )?주력 사업으로 (.{3,100}?)에 사용되는 (.{3,120}?)(?:을|를) 중심으로 다양한 장비를 개발 및 생산하고 있으며, .+ 공급하고 있습니다\.$/.exec(quote))&&!/계획|추진/.test(quote))add(quote,m[3],'USED_IN',m[2],'technical');
  if((m=/^(.{0,90}?(?:AOI|inspection system|inspection equipment|optical inspection)) (?:systems? )?(?:designed )?for (.{3,180})[.!]?$/i.exec(quote)))add(quote,m[1],'INSPECTS',m[2],'technical');
  else if((m=/^(.{0,90}?(?:processing equipment|drill bits?|plating equipment|wet process equipment)) (?:designed )?for (.{3,180})[.!]?$/i.exec(quote)))add(quote,m[1],'PROCESSES',m[2],'technical');
  else if((m=/^(.{0,90}?(?:materials?|resins?|chemicals?)) for (.{3,180})[.!]?$/i.exec(quote)))add(quote,m[1],'MATERIAL_FOR',m[2],'technical');
  else if((m=/^(.{3,150}?) (?:is designed to inspect|inspects?) (.{3,180})[.!]?$/i.exec(quote)))add(quote,m[1],'INSPECTS',m[2],'technical');
  else if((m=/^(.{3,120}?)용 (.{3,100}?(?:검사장비|광학검사|습식공정 장비|도금장비))[.!]?$/.exec(quote)))add(quote,m[2],/검사/.test(m[2])?'INSPECTS':'PROCESSES',m[1],'technical');
  if((m=/^(.{2,100}?) (?:is|are) (?:widely |primarily )?(?:used|utilized|required) (?:in|for|to) (.{3,450})[.!]?$/.exec(quote)))add(quote,m[1],'USED_IN',m[2],'technical');
  else if((m=/^(.{2,120}?) (requires?|uses?) (.{3,400})[.!]?$/.exec(quote)))add(quote,m[1],m[2].startsWith('use')?'USES':'REQUIRES',m[3],'technical');
  else if((m=/^(.{2,100}?)(?:은|는|이|가) (.{3,400}?)(?:에|에서) (?:사용|적용)됩니다[.!]?$/.exec(quote)))add(quote,m[1],'USED_IN',m[2],'technical');
  if((m=/^(.{2,100}?) (?:designs?, (?:develops?, )?(?:and )?manufactures?|manufactures?|produces?|sells?|provides?|develops?) (.{3,450})[.!]?$/.exec(quote)))add(quote,m[1],'REPORTS_PRODUCTS',m[2],'business');
  else if((m=/^(당사|우리 회사)(?:는|가) (.{3,400}?)(?:을|를) (?:생산|제조|판매|제공|개발)(?:하고 있습니다|합니다)[.!]?$/.exec(quote)))add(quote,m[1],'REPORTS_PRODUCTS',m[2],'business');
  // Announcement of a plan is an announcement fact, not completion of the plan.
  if((m=/^(.{2,100}?) (?:today )?(?:announced|has announced) (.{3,450})[.!]?$/.exec(quote)))add(quote,m[1],'ANNOUNCED',m[2],'event',{eventState:'ANNOUNCED'});
  else if((m=/^(.{2,100}?) (?:has )?(approved|ordered|installed) (.{3,450})[.!]?$/.exec(quote)))add(quote,m[1],m[2].toUpperCase(),m[3],'event',{eventState:m[2].toUpperCase()});
  else if((m=/^(.{2,100}?) (?:has )?completed (.{3,450})[.!]?$/.exec(quote)))add(quote,m[1],'COMPLETED',m[2],'event',{eventState:'COMPLETED'});
  else if((m=/^(.{2,100}?) plans (?:to )?(.{3,450})[.!]?$/.exec(quote)))add(quote,m[1],'PLANNED',m[2],'event',{eventState:'PLANNED'});
  else if((m=/^(.{2,100}?) is (?:now )?ramping (.{3,450})[.!]?$/.exec(quote)))add(quote,m[1],'RAMPING',m[2],'event',{eventState:'RAMPING'});
  else if((m=/^(.{2,100}?) (?:is|are) (?:now )?in production (.{3,400})[.!]?$/.exec(quote)))add(quote,m[1],'IN_PRODUCTION',m[2],'event',{eventState:'IN_PRODUCTION'});
  else if((m=/^(.{2,100}?) (?:has )?(?:started|begun) (construction|ramping|production) (.{3,400})[.!]?$/.exec(quote)))add(quote,m[1],'STARTED',m[3],'event',{eventState:({construction:'UNDER_CONSTRUCTION',ramping:'RAMPING',production:'IN_PRODUCTION'})[m[2]]});
  else if((m=/^(.{2,100}?)(?:은|는|이|가) (.{3,400}?) 발표했다[.!]?$/.exec(quote)))add(quote,m[1],'ANNOUNCED',m[2],'event',{eventState:'ANNOUNCED'});
  else if((m=/^(.{2,100}?)(?:은|는|이|가) (.{3,400}?) (?:공시했다|밝혔다)[.!]?$/.exec(quote)))add(quote,m[1],'ANNOUNCED',m[2],'event',{eventState:'ANNOUNCED'});
 }
 for(const a of bridgeAssertions(body))if(!out.some(x=>x.quote===a.quote&&x.predicate===a.predicate))out.push({...a,ref:String(out.length)});
 return out;
}
