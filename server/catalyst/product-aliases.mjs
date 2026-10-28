import {norm} from './core.mjs';
import {sourceAuthority} from './claim-validation.mjs';
import {rows} from './store.mjs';
export async function discoverProductAliases(store,source){
 const trusted=sourceAuthority(source,null)&&['official','business','regulatory'].includes(source.sourceType),out=[];
 const save=async(concept,alias,quote)=>{if(concept===alias)return;
  await store.db.prepare("INSERT INTO catalyst_product_aliases VALUES(?,?,?,?,?,?) ON CONFLICT(concept,alias) DO UPDATE SET status=CASE WHEN excluded.status='VERIFIED' THEN excluded.status ELSE catalyst_product_aliases.status END,source_id=CASE WHEN excluded.status='VERIFIED' THEN excluded.source_id ELSE catalyst_product_aliases.source_id END,quote=CASE WHEN excluded.status='VERIFIED' THEN excluded.quote ELSE catalyst_product_aliases.quote END,checked_at=excluded.checked_at").bind(concept,alias,trusted?'VERIFIED':'PENDING',source.id,quote,new Date().toISOString()).run();out.push({concept,alias,status:trusted?'VERIFIED':'PENDING'});
 };
 // Explicit expansion(acronym), never AI synonym proposals or word proximity.
 for(const m of String(source.body||'').matchAll(/([A-Za-z][A-Za-z -]{5,65})\s*\(([A-Z][A-Z0-9-]{1,9})\)/g)){
  const words=m[1].trim().split(/\s+/),abbr=m[2].replaceAll('-',''),tail=words.slice(-abbr.length);
  if(tail.map(w=>w[0]).join('').toUpperCase()!==abbr)continue;
  const concept=norm(tail.join(' ')).toLowerCase(),alias=m[2].toLowerCase(),quote=m[0];
  await save(concept,alias,quote);
 }
 // Explicit adjacent bilingual terms only. Sentences, figures and market-share
 // parentheses are not terminology evidence.
 for(const m of String(source.body||'').matchAll(/(?:^|[\n:;·]|[가-힣]는\s)([가-힣][가-힣 -]{1,24})\s*\(([A-Za-z][A-Za-z -]{1,55})\)/g)){
  if(/(?:당사|업체|회사|사업|다음|대한|위한|하는)/.test(m[1]))continue;
  await save(norm(m[2]).toLowerCase(),norm(m[1]).toLowerCase(),m[0].trim());
 }return out;
}
export async function verifiedProductAliases(store){return rows(store.db,"SELECT concept,alias,source_id,quote FROM catalyst_product_aliases WHERE status='VERIFIED'");}
export function productText(text,aliases=[]){
 let s=norm(text).toLowerCase().replace(/\b(substrates|systems|materials|bits)\b/g,x=>x.slice(0,-1));
 for(const a of aliases){const escaped=a.alias.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');s=s.replace(new RegExp('(^|[^a-z0-9])'+escaped+'(?=$|[^a-z0-9])','gi'),(_,p)=>p+a.concept);}
 return s;
}
