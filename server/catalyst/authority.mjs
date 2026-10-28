import {hash,safeUrl} from './core.mjs';
import irSources from '../../config/competitor-ir-sources.json' with {type:'json'};
export function issuerDocumentAuthority(profile,asset){
 const hosted=irSources.find(x=>x.url===profile.sourceUrl&&Number(x.cik)===Number(asset.issuerId));
 return {verified:profile.identityVerified===true&&!!profile.documentHash,kind:'issuer_document',assetId:asset.id,publisherId:asset.issuerId||asset.protocolId,documentUrl:profile.sourceUrl,documentHash:profile.documentHash,verificationSource:hosted?.page||profile.sourceUrl};
}
// Registry is server configuration, never model output. Its entries require an
// issuer/protocol identifier and a reviewed ownership reference.
export function registeredPublisher(assetId,url,registry=[]){
 if(!safeUrl(url))return null;const host=new URL(url).hostname;
 return registry.find(r=>r.assetId===assetId&&r.domains?.includes(host)&&safeUrl(r.ownershipSource))||null;
}
export async function documentOwnership(source,asset,registry,ownerDocument){
 const publisher=registeredPublisher(asset.id,ownerDocument?.url,registry);
 if(!publisher||!safeUrl(source.url)||ownerDocument.assetId!==asset.id)return null;
 // Hosted PDFs/CDNs are trusted only when an issuer-owned page links the exact
// document and the retrieved document carries the checked issuer identifier.
 const links=[...String(ownerDocument.html||'').matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)].map(m=>{try{return new URL(m[1].replaceAll('&amp;','&'),ownerDocument.url).href;}catch{return null;}});
 if(!links.includes(source.url)||source.identityVerified!==true||source.issuerId!==asset.issuerId)return null;
 return {verified:true,kind:'hosted_document',assetId:asset.id,publisherId:publisher.publisherId,verificationSource:ownerDocument.url,ownershipSource:publisher.ownershipSource,documentUrl:source.url,documentHash:await hash(source.body),ownerPageHash:await hash(ownerDocument.html)};
}
export function hostedAuthority(source,asset){
 const p=source?.authority;
 return p?.kind==='hosted_document'&&p.verified===true&&!!p.publisherId&&p.assetId===source.assetId&&(!asset||asset.id===p.assetId)&&p.documentUrl===source.url&&p.documentHash===source.contentHash&&!!p.ownerPageHash&&!!safeUrl(p.verificationSource)&&!!safeUrl(p.ownershipSource);
}
