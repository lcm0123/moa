import {extractBeneficiaryFacts} from './beneficiary-extraction.mjs';
import {issuerKey} from './business-profile.mjs';
import {hash} from './core.mjs';

// Optional document-level help using the existing model, exact-quote validator,
// token reservations and account budget. Numeric tables stay server-validated.
export async function assistBusinessProfile(env,store,asset,source,{job,remaining=0,extractor=extractBeneficiaryFacts}={}){
 if(remaining<1)return {calls:0,state:'AI_BUDGET_DISABLED'};
 if(source.rights?.aiProcessing!==true)return {calls:0,state:'AI_RIGHTS_UNCONFIRMED'};
 if(!source.documentHash||!source.documentId||!await env.CATALYST_SOURCE_ALLOWED?.(source))return {calls:0,state:'SOURCE_UNAVAILABLE'};
 const key='profile-ai:'+await hash([issuerKey(asset),source.documentHash,'profile-ai-1'].join('|'));
 if(await store.runtime(key))return {calls:0,state:'DOCUMENT_ALREADY_ATTEMPTED'};
 // Reserve once before dispatch. Failed output is not silently retried per cell.
 await store.runtime(key,{state:'RESERVED',at:new Date().toISOString()});
 try{
  const result=await extractor(env,store,{...job,mode:'normal',query:'Extract this issuer’s actual business and disclosed revenue evidence only.'},source,asset,{allowAI:true});
  let claims=0;for(const fact of result.facts.filter(f=>f.type==='business')){await store.saveClaim(fact,'business-profile:'+issuerKey(asset));claims++;}
  const out={calls:1,state:claims?'PARTIAL':'EXTRACTION_UNRESOLVED',claims,rejected:result.rejected};await store.runtime(key,out);return out;
 }catch(e){const out={calls:1,state:/budget/i.test(e.code||e.message)?'BUDGET_WAIT':'EXTRACTION_UNRESOLVED'};await store.runtime(key,out);return out;}
}
