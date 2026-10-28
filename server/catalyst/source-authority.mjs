import {publicationAuthority} from './evidence-policy.mjs';
import {hash,safeUrl} from './core.mjs';
import {rows} from './store.mjs';
import {sameIssuerHost,registerOrganization} from './official-domain-registry.mjs';
export const authorityTypes=['OFFICIAL_COMPANY','OFFICIAL_IR','OFFICIAL_PRODUCT','OFFICIAL_TECHNICAL','OFFICIAL_INDUSTRY_BODY','OFFICIAL_STANDARD_BODY','ACADEMIC','PROFESSIONAL_TECH_MEDIA','PATENT_PRIMARY','PATENT_MIRROR','NEWS','BLOG','SEO_CONTENT','UNKNOWN'];
export const authorityRejectReasons=['UNKNOWN_OWNER','DOMAIN_MISMATCH','ORGANIZATION_MISMATCH','NOT_OFFICIAL','MIRROR_SOURCE','PATENT_MIRROR','SEO_CONTENT','NEWS_ONLY','INSUFFICIENT_OWNERSHIP_EVIDENCE'];
const names=s=>String(s||'').toLowerCase().replace(/\b(?:corporation|corp|inc|ltd|limited|co)\b|[^\p{L}\p{N}]/gu,'');
export async function resolveSourceAuthority({url,expectedOrganization,expectedProduct,expectedAsset,sourceMetadata={},store,now=Date.now()}){
 const valid=safeUrl(url),domain=valid?new URL(valid).origin:null;
 let out={status:'AUTHORITY_UNKNOWN',organizationId:null,organizationName:null,canonicalDomain:null,authorityType:'UNKNOWN',ownershipVerified:false,verificationMethod:null,verifiedAt:null,sourceScope:expectedProduct||'UNKNOWN',rejectReason:'UNKNOWN_OWNER'};
 if(!valid)return {...out,status:'AUTHORITY_REJECTED',rejectReason:'DOMAIN_MISMATCH'};
 // Only existing, server-established identity proofs may bootstrap an organization.
 if(store){
  const legacy=await rows(store.db,'SELECT r.*,a.name FROM catalyst_official_domain_registry r JOIN catalyst_assets a ON a.id=r.asset_id WHERE r.verified_at>=?',new Date(now-180*86400000).toISOString());
  for(const r of legacy.filter(r=>sameIssuerHost(valid,r.domain))){
   if(!r.asset_id||!r.name)continue;
   if(['ISSUER_REGISTRY','FILING_HOMEPAGE','OFFICIAL_IR_LINK','VERIFIED_REDIRECT'].includes(r.proof_type))await registerOrganization(store,{organization_id:r.asset_id,organization_name:r.name,canonical_domain:r.domain,asset_id:r.asset_id},{method:r.proof_type,url:r.proof_url,hash:r.document_hash,checkedAt:r.verified_at,identityVerified:true});
   else {const cached=await store.cache('research:roots:'+r.asset_id),value=cached?.value,root=value?.roots?.find(d=>sameIssuerHost(valid,d));
    if(cached&&!cached.stale&&root&&value.assetId===r.asset_id&&safeUrl(value.verificationSource))await registerOrganization(store,{organization_id:r.asset_id,organization_name:r.name,canonical_domain:root,asset_id:r.asset_id},{method:'CORPORATE_METADATA',url:value.verificationSource,checkedAt:cached.at,identityVerified:true});
   }
  }
 }
 const organizations=store?await rows(store.db,'SELECT * FROM catalyst_source_organizations'):[];
 const owners=organizations.filter(o=>[o.canonical_domain,...['alternate_domains','ir_domains','product_domains','documentation_domains'].flatMap(k=>JSON.parse(o[k]))].some(d=>sameIssuerHost(valid,d)));
 const owner=owners.find(o=>Date.parse(o.valid_from)<=now&&Date.parse(o.valid_to)>now);
 const host=new URL(valid).hostname;
 if(/(^|\.)(patents\.google\.com|freepatentsonline\.com)$/.test(host))out={...out,status:'AUTHORITY_REJECTED',authorityType:'PATENT_MIRROR',rejectReason:'PATENT_MIRROR'};
 else if(owner){
  if(expectedAsset&&owner.asset_id!==expectedAsset.id||expectedOrganization&&![owner.organization_id,owner.organization_name].some(x=>names(x)===names(expectedOrganization)))out={...out,status:'AUTHORITY_REJECTED',rejectReason:'ORGANIZATION_MISMATCH'};
  else {const p=new URL(valid).pathname,type=/\/investor|\/ir(?:\/|$)/i.test(p)?'OFFICIAL_IR':/product|solution/i.test(p)?'OFFICIAL_PRODUCT':/techn|document|application/i.test(p)?'OFFICIAL_TECHNICAL':'OFFICIAL_COMPANY';out={...out,status:'AUTHORITY_VERIFIED',organizationId:owner.organization_id,organizationName:owner.organization_name,canonicalDomain:owner.canonical_domain,authorityType:type,ownershipVerified:true,verificationMethod:owner.verification_method,verifiedAt:owner.verified_at,validTo:owner.valid_to,verificationSource:JSON.parse(owner.proof).url,assetId:owner.asset_id,rejectReason:null};}
 }else if(owners.length)out={...out,status:'AUTHORITY_REJECTED',rejectReason:'INSUFFICIENT_OWNERSHIP_EVIDENCE'};
 else if(sourceMetadata.ownershipProbeCompleted)out={...out,status:'AUTHORITY_REJECTED',rejectReason:'INSUFFICIENT_OWNERSHIP_EVIDENCE'};
 if(out.ownershipVerified)Object.assign(out,{authorityVerified:true,sourceTier:1});
 else if(out.rejectReason!=='PATENT_MIRROR'){const publication=publicationAuthority(valid);if(publication)out={...out,...publication};}
 // Discovery hints, including provider/title/type, are intentionally ignored.
 if(store)await store.db.prepare('INSERT OR REPLACE INTO catalyst_source_authority VALUES(?,?,?,?,?,?,?)').bind(await hash(valid),domain,out.organizationId,out.status,out.rejectReason,new Date(now).toISOString(),JSON.stringify(out)).run();
 return out;
}
