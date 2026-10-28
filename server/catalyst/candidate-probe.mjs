import {corroborated} from './evidence-policy.mjs';
import {canonicalIdentity} from './identity.mjs';
import {concreteTarget,topicMatch} from './research-config.mjs';
import {productText} from './product-aliases.mjs';

// Discovery eligibility only. Passing this probe is never a technical verdict.
export function candidateProbe(asset,claims,plan){
 const canonical=asset.identityStatus==='verified'&&canonicalIdentity(asset).complete;
 const targets=[...(plan.entities||[]),...(plan.premiseTargets||[]),...plan.productTargets,...plan.equipmentTargets,...plan.materialTargets,...plan.processTargets,...plan.protocolTargets].filter(concreteTarget);
 const official=claims.filter(c=>['VERIFIED','SUPPORTED'].includes(c.status)&&c.subject===asset.id&&['business','protocol_metric','tokenomics'].includes(c.type)&&(['official','business','regulatory'].includes(c.sourceType)||corroborated(c)));
 const matching=official.filter(c=>targets.some(t=>topicMatch(productText((c.object||'')+' '+(c.quote||''),plan.productAliases),productText(t,plan.productAliases))));
 return {status:canonical&&matching.length?'PROBE_QUALIFIED':'SEARCH_MENTION_ONLY',canonical,claimIds:matching.map(c=>c.id),reason:!canonical?'CANONICAL_IDENTITY_UNVERIFIED':!matching.length?'OFFICIAL_TARGET_PRODUCT_NOT_FOUND':null};
}

// Candidate evidence is loaded, persisted, then released before the next ID.
export async function sequentialCandidates(items,{load,process,persist,released}){
 for(const item of items){let candidate=await load(item);try{await process(candidate);await persist(candidate);}finally{candidate=null;await released?.(item);}}
}
