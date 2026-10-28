import {officialDomains,sameIssuerHost} from '../server/catalyst/official-domain-registry.mjs';
import {issuerKey} from '../server/catalyst/business-profile.mjs';
import {sourceAuthority} from '../server/catalyst/claim-validation.mjs';
import {safeUrl,clean} from '../server/catalyst/core.mjs';
import {isIP} from 'node:net';

// Discovery only: bodies still pass through tools.read's DNS/redirect/content
// security checks. No guessed paths, search snippets, or domain-name similarity.
function publicDocumentUrl(value){
 const url=safeUrl(value);if(!url)return null;
 const u=new URL(url);if(isIP(u.hostname)||u.hostname.includes(':')||/(^|\.)(localhost|local|internal)$/.test(u.hostname))return null;
 u.hash='';return u.href;
}
export function profileCompanyLinks(source,roots){
 const out=[],seen=new Set();
 for(const m of String(source.sectionHtml||'').slice(0,60000).matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
  const url=publicDocumentUrl(m[1].replaceAll('&amp;','&')),label=clean(m[2]);
  if(!url||url===publicDocumentUrl(source.url)||seen.has(url)||!roots.some(r=>sameIssuerHost(url,r.domain)))continue;
  const ir=/^(?:Investor Relations|Investors|IR|IR 홈페이지|투자정보|투자자 정보)$/i.test(label);
  const business=/^(?:About(?: Us| the Company)?|Company Overview|Our (?:Business|Products|Solutions)|Products|Solutions|회사소개|기업소개|사업소개|제품소개|제품|솔루션)$/i.test(label);
  if(!ir&&!business)continue;
  seen.add(url);out.push({url,title:label,profileDocumentKind:ir?'OFFICIAL_IR':'OFFICIAL_COMPANY'});
 }
 return out.slice(0,8);
}

export async function officialProfileIR(store,tools,asset,{specified=null}={}){
 let roots=await officialDomains(store,asset);const catalog=await store.runtime('profile-ir-documents:'+issuerKey(asset)),out=[],failures=[];
 const allowed=async url=>{try{return !!publicDocumentUrl(url)&&typeof store.sourceAllowed==='function'&&await store.sourceAllowed(url)===true;}catch{return false;}};
 const read=async(d,kind)=>{
  const owner=roots.find(r=>sameIssuerHost(d.url,r.domain));
  if(!owner||!await allowed(d.url)||!await allowed(owner.domain)){failures.push({url:publicDocumentUrl(d.url),code:'IR_SOURCE_SECURITY_REJECTED'});return null;}
  let s;try{s=await tools.read(d,{asset,roots:{assetId:asset.id,roots:roots.map(r=>r.domain),verificationSource:owner.proof_url},purpose:'BUSINESS_REVENUE',filingDate:d.publishedAt||null});}catch(e){s={code:/^[A-Z_0-9]+$/i.test(e.message)?e.message:'IR_READ_FAILED'};}
  const ready=s.status==='read'&&s.assetId===asset.id&&s.securityVersion==='security-1'&&s.documentId&&s.documentHash&&s.locator&&s.evidence!==false&&!['DISCOVERY_ONLY','UNTRUSTED_SOURCE'].includes(s.trust);
  if(ready&&sourceAuthority(s,asset)&&await allowed(d.url)&&await allowed(s.url)&&await allowed(owner.domain)&&(!store.sourceReady||store.sourceReady(s))){
   const value={...s,fiscalYear:d.fiscalYear||null,fiscalQuarter:d.fiscalQuarter||null,periodEnd:d.periodEnd||null,profileDocumentKind:kind};out.push(value);return value;
  }
  failures.push({url:publicDocumentUrl(d.url),code:s.code||'IR_ISSUER_OR_SECURITY_UNCONFIRMED'});return null;
 };
 const entries=(specified?[specified]:catalog?.documents||[]).filter(d=>publicDocumentUrl(d.url)&&roots.some(r=>sameIssuerHost(d.url,r.domain))).slice(0,2);
 if(entries.length){for(const d of entries)await read(d,'OFFICIAL_IR');return {sources:out,failures};}
 // An explicit document never silently changes into a different source.
 if(specified)return {sources:[],failures:[{url:publicDocumentUrl(specified.url),code:'IR_ROOT_UNCONFIRMED'}]};
 if(!roots.length){
  try{await tools.roots?.(asset);}catch(e){failures.push({code:/^[A-Z_0-9]+$/i.test(e.message)?e.message:'OFFICIAL_ROOT_UNAVAILABLE'});}
  roots=await officialDomains(store,asset);
 }
 let root;for(const candidate of roots)if(await allowed(candidate.domain)){root=candidate;break;}
 if(!root)return {sources:[],failures:[...failures,{code:'OFFICIAL_ROOT_UNCONFIRMED'}]};
 const homepage=await read({url:root.domain,title:asset.name+' 공식 홈페이지'},'OFFICIAL_COMPANY');
 if(homepage){
  // tools.read can establish an explicitly linked IR/redirect domain. Reload
  // those existing proofs; arbitrary external links cannot register themselves.
  roots=await officialDomains(store,asset);
  const linked=profileCompanyLinks(homepage,roots).find(d=>d.url!==publicDocumentUrl(root.domain));
  if(linked)await read(linked,linked.profileDocumentKind);
 }
 return {sources:out,failures};
}
