import {safeUrl,clean,norm} from './core.mjs';
import {rows} from './store.mjs';
const hosted=host=>/(^|\.)(q4cdn\.com|cloudfront\.net|amazonaws\.com|akamaized\.net)$/.test(host);
export function sameIssuerHost(url,root){try{const host=new URL(url).hostname,r=new URL(root).hostname.replace(/^www\./,'');return host===r||host.endsWith('.'+r);}catch{return false;}}
export function explicitOfficialLinks(html,base){
 const out=[];
 for(const m of String(html).matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
  const label=norm(clean(m[2]));if(!/^(?:Investor Relations|Official (?:Web)?site|Corporate (?:Web)?site|Company Website|공식 홈페이지|회사 홈페이지|IR 홈페이지)$/i.test(label))continue;
  try{const url=safeUrl(new URL(m[1],base).href);if(url)out.push({url,type:'OFFICIAL_IR_LINK'});}catch{}
 }
 for(const tag of String(html).matchAll(/<link\b[^>]*>/gi))if(/rel=["']canonical["']/i.test(tag[0])){const href=/href=["']([^"']+)/i.exec(tag[0])?.[1];try{const url=safeUrl(new URL(href,base).href);if(url)out.push({url,type:'CANONICAL_LINK'});}catch{}}
 return out;
}
export async function registerOfficialDomain(store,asset,url,{type,proofUrl,hash=null,trusted=false}={}){
 const valid=safeUrl(url),proof=safeUrl(proofUrl);if(!trusted||!valid||!proof||!['ISSUER_REGISTRY','VERIFIED_REDIRECT','OFFICIAL_IR_LINK','CANONICAL_LINK','FILING_HOMEPAGE'].includes(type))return false;
 const domain=new URL(valid).origin;if(hosted(new URL(domain).hostname))return false; // CDN authority stays document-scoped.
 await store.db.prepare('INSERT INTO catalyst_official_domain_registry VALUES(?,?,?,?,?,?) ON CONFLICT(asset_id,domain) DO UPDATE SET proof_type=excluded.proof_type,proof_url=excluded.proof_url,document_hash=excluded.document_hash,verified_at=excluded.verified_at').bind(asset.id,domain,type,proof,hash,new Date().toISOString()).run();return true;
}
export async function officialDomains(store,asset){return rows(store.db,'SELECT domain,proof_url,proof_type FROM catalyst_official_domain_registry WHERE asset_id=?',asset.id);}

// Server-only ingestion of verified identity records. Search results cannot call
// this API and are not accepted as ownership proof. Alternate domains need an
// explicit link in an already verified corporate document, never name similarity.
export async function registerOrganization(store,record,proof){
 const methods=['ISSUER_REGISTRY','FILING_HOMEPAGE','OFFICIAL_IR_LINK','VERIFIED_REDIRECT','CORPORATE_METADATA'];
 if(!proof?.identityVerified||!methods.includes(proof.method)||!safeUrl(proof.url)||!safeUrl(record.canonical_domain)||!record.organization_id||!record.organization_name)throw Error('INSUFFICIENT_OWNERSHIP_EVIDENCE');
 const at=Date.parse(proof.checkedAt),now=Date.now();if(!Number.isFinite(at)||at>now||now-at>180*86400000)throw Error('REGISTRY_PROOF_EXPIRED');
 const domains=['alternate_domains','ir_domains','product_domains','documentation_domains'];
 for(const key of domains)for(const d of record[key]||[])if(!safeUrl(d)||!proof.linkedDomains?.includes(d))throw Error('ALTERNATE_DOMAIN_PROOF_REQUIRED');
 const value={...record,canonical_domain:new URL(record.canonical_domain).origin,verification_method:proof.method,verified_at:new Date(at).toISOString(),last_checked_at:new Date(now).toISOString(),valid_from:new Date(at).toISOString(),valid_to:new Date(at+180*86400000).toISOString()};
 await store.db.prepare(`INSERT INTO catalyst_source_organizations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(organization_id) DO UPDATE SET organization_name=excluded.organization_name,canonical_domain=excluded.canonical_domain,alternate_domains=excluded.alternate_domains,ir_domains=excluded.ir_domains,product_domains=excluded.product_domains,documentation_domains=excluded.documentation_domains,verification_method=excluded.verification_method,verified_at=excluded.verified_at,last_checked_at=excluded.last_checked_at,valid_from=excluded.valid_from,valid_to=excluded.valid_to,proof=excluded.proof,asset_id=excluded.asset_id`).bind(value.organization_id,value.organization_name,value.canonical_domain,...domains.map(k=>JSON.stringify(record[k]||[])),proof.method,value.verified_at,value.last_checked_at,value.valid_from,value.valid_to,JSON.stringify(proof),record.asset_id||null).run();return value;
}
