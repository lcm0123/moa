import {corroborated,pathQuality} from './evidence-policy.mjs';
import {productText} from './product-aliases.mjs';
export const scopePredicates=['IS_A','SUBTYPE_OF','BROADER_THAN','NARROWER_THAN'];
export const processPredicates=['USES','REQUIRES','USES_PROCESS','REQUIRES_PROCESS','USES_EQUIPMENT','REQUIRES_EQUIPMENT','USES_MATERIAL','CONSUMES_MATERIAL','USED_IN','DESIGNED_FOR','REQUIRED_FOR','INSPECTS','PROCESSES','MATERIAL_FOR'];
const good=c=>['VERIFIED','SUPPORTED'].includes(c.status)&&c.validity?.state!=='STALE'&&(!c.validity?.validUntil||Date.parse(c.validity.validUntil)>Date.now());
export const conceptKey=(s,aliases=[])=>productText(s||'',aliases).replace(/[.!]$/,'').replace(/\s+/g,' ').trim();
export function bridgeAssertions(text){
 const out=[];
 for(const quote of String(text||'').split(/\n|(?<=[.!?])\s+/).map(x=>x.trim())){
  if(quote.length<24||quote.length>800||/\b(?:not|may|might|could|would|expected|potential)\b|아니|않|추정|계획/.test(quote))continue;
  let m,predicate;
  if((m=/^(.{3,110}?) is classified as (?:a |an )?(.{3,110})[.!]$/i.exec(quote)))predicate='IS_A';
  else if((m=/^(.{3,110}?) (?:is|are) (?:a |an )?(?:type|subtype|category) of (.{3,110})[.!]$/i.exec(quote)))predicate='SUBTYPE_OF';
  else if((m=/^(.{3,110}?) is (broader|narrower) than (.{3,110})[.!]$/i.exec(quote))){predicate=m[2].toLowerCase()==='broader'?'BROADER_THAN':'NARROWER_THAN';m=[m[0],m[1],m[3]];}
  else if((m=/^(.{3,110}?) (requires|uses) (?:the )?(.{3,110}?) process[.!]$/i.exec(quote))){predicate=m[2].toLowerCase()==='requires'?'REQUIRES_PROCESS':'USES_PROCESS';m=[m[0],m[1],m[3]];}
  else if((m=/^(.{3,110}?)(?:은|는) (.{3,110}?)의 (?:한 종류|하위 범주)입니다[.!]$/.exec(quote)))predicate='SUBTYPE_OF';
  else if((m=/^(.{3,110}?)(?:은|는) (.{3,110}?) 공정을 (필요로 합니다|사용합니다)[.!]$/.exec(quote)))predicate=m[3]==='사용합니다'?'USES_PROCESS':'REQUIRES_PROCESS';
  if(m&&!/^(?:this|it|these|those)\b/i.test(m[1]))out.push({quote,subject:conceptKey(m[1]),predicate,object:conceptKey(m[2]),kind:'technical',relationClass:scopePredicates.includes(predicate)?'SCOPE':'PROCESS'});
 }return out;
}
// Only climb from a specific event target to a documented broader category.
// Never narrow a company's generic equipment into a more specific application.
export function technicalPaths(products,claims,event,plan,{maxDepth=3}={}){
 maxDepth=Math.min(3,Math.max(1,maxDepth));
 const aliases=plan.productAliases||[],key=s=>conceptKey(s,aliases),edges=[],scope=[];
 for(const c of claims.filter(good)){
  if(c.sourceType==='news'&&!corroborated(c)||c.validationChecks?.SOURCE_AUTHORITY?.status==='FAIL')continue;
  const p=c.normalizedProposition;if(!p||!p.subject||!p.object)continue;
  if(scopePredicates.includes(p.predicate))scope.push({from:key(p.predicate==='BROADER_THAN'?p.object:p.subject),to:key(p.predicate==='BROADER_THAN'?p.subject:p.object),claim:c});
  else if(processPredicates.includes(p.predicate)){const forward=['USES','REQUIRES','USES_PROCESS','REQUIRES_PROCESS','USES_EQUIPMENT','REQUIRES_EQUIPMENT','USES_MATERIAL','CONSUMES_MATERIAL'].includes(p.predicate);edges.push({target:key(forward?p.subject:p.object),product:key(forward?p.object:p.subject),claim:c});}
 }
 const anchors=event.targetProduct?[event.targetProduct]:event.status!=='ACTUAL_EVENT_VERIFIED'&&event.mode==='CONDITIONAL'?(plan.explicitConditionTargets??plan.premiseTargets??plan.productTargets??[]):event.claims.map(c=>c.normalizedProposition?.production_target||c.normalizedProposition?.object||c.quote);
 const directAnchor=(anchor,target)=>{const a=key(anchor);if(a===target)return true;const escaped=target.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp('(?:^|\\s)'+escaped+'(?:\\s+(?:공장\\s+)?(?:증설|expansion|capacity expansion))?[.!]?$','i').test(a);};
 const paths=[],seen=new Set();
 const visit=(target,chain,root)=>{
  if(chain.length>=maxDepth||paths.length>=30)return;
  for(const edge of edges.filter(e=>e.target===target)){
   if(chain.some(c=>c.id===edge.claim.id))continue;
   const next=[...chain,edge.claim];
   for(const own of products.filter(good))if(own.type==='business'&&key(own.object)===edge.product){
    const ids=next.map(c=>c.id),signature=own.id+'|'+ids.join('|');if(seen.has(signature))continue;seen.add(signature);
    paths.push({pathQuality:pathQuality([own.status,...next.map(c=>c.status),...event.claims.map(c=>c.status)]),product:edge.product,eventTarget:root,companySpecific:next.some(c=>c.applicationAssetId&&c.applicationAssetId===own.subject),relation:edge.claim.normalizedProposition.predicate,technicalClaimId:edge.claim.id,technicalClaimIds:ids.filter(id=>!scope.some(s=>s.claim.id===id)),scopeClaimIds:ids.filter(id=>scope.some(s=>s.claim.id===id)),allBridgeClaimIds:ids,businessClaimId:own.id,eventClaimIds:event.claims.map(c=>c.id),conditional:event.mode==='CONDITIONAL',condition:event.mode==='CONDITIONAL'?'해당 증설 조건이 성립할 경우':null});
   }
   visit(edge.product,next,root);
  }
  // A taxonomy proves membership, not applicability of every broader process.
  // Scoped promotion requires an explicit technical assertion for that target.
  if(!event.targetScope)for(const edge of scope.filter(e=>e.from===target))if(!chain.some(c=>c.id===edge.claim.id))visit(edge.to,[...chain,edge.claim],root);
 };
 for(const target of new Set([...edges.map(e=>e.target),...scope.map(e=>e.from)]))if(anchors.some(a=>directAnchor(a,target)))visit(target,[],target);
 return paths.sort((a,b)=>Number(!!b.companySpecific)-Number(!!a.companySpecific)||a.allBridgeClaimIds.length-b.allBridgeClaimIds.length);
}
export function technicalGapQueries(event,plan){
 const target=event.claims?.find(c=>c.normalizedProposition?.production_target)?.normalizedProposition.production_target?.replace(/\s*(?:공장\s*)?증설.*$/,'').trim()||plan.premiseTargets?.[0]||plan.productTargets?.[0];
 if(!target||plan.intent==='MOVE_ANALYSIS'||plan.marketTargets?.length===1&&plan.marketTargets[0]==='CRYPTO')return [];
 const processes=/substrate|pcb|기판/i.test(target)?['wet process','etching','plating','drilling','AOI inspection']:[...new Set(plan.processTargets||[])].slice(0,5);
 const queries=processes.map(p=>({query:`${/패키지기판|package substrate/i.test(target)?'(\"패키지기판\" OR \"package substrate\")':`"${target}"`} ${p} technical process`,purpose:'TECHNICAL_GAP',target,process:p}));
 if(/패키지기판|package substrate/i.test(target))queries.push(...processes.map(p=>({query:`package substrate manufacturing ${p} official technical documentation`,purpose:'TECHNICAL_GAP_EN',target,process:p})));
 return queries;
}

// Retrieval order only: a URL pattern cannot establish publisher authority.
export function technicalSourcePriority(item,roots=[]){
 try{const u=new URL(item.url),host=u.hostname;
  if(roots.some(root=>{const h=new URL(root).hostname.replace(/^www\./,'');return host===h||host.endsWith('.'+h);}))return 0;
  if(/(?:\.edu|\.ac\.[a-z]+|\.go\.[a-z]+)$/.test(host)||host==='patents.google.com')return 1;
  if(/product|technical|process|technology/i.test(u.pathname))return 2;
  return 3;
 }catch{return 4;}
}
