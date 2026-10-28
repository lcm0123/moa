import {rows} from './catalyst/store.mjs';
import {entityPhrases,isGeneric} from './catalyst/identity.mjs';

const key=s=>String(s||'').normalize('NFKC').replace(/[’']/g,'').replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim().toLowerCase();
const legal=s=>key(s).replace(/(?:\s+(?:incorporated|corporation|corp|inc|limited|ltd|co|plc|aktiengesellschaft))+$/g,'').trim();
const valid=a=>a.identity_status==='verified'&&a.active!==0&&a.active!==false&&(a.kind==='KR_STOCK'?/^\d{6}$/.test(a.symbol)&&/^\d{8}$/.test(a.issuer_id||''):a.kind==='US_STOCK'&&/^[A-Z0-9.^/-]{1,24}$/.test(a.symbol)&&/^\d{1,10}$/.test(a.issuer_id||''));

// Reuse the saved issuer master and its curated aliases. No sector matches,
// fuzzy prefixes, AI-generated company names, or bare acronym/ticker matches.
export function createNewsMentionMatcher(db,{now=Date.now}={}){
 let cached=null,pending=null;
 async function index(){
  if(cached&&now()<cached.until)return cached;
  if(pending)return pending;
  pending=(async()=>{
   const assets=await rows(db,"SELECT id,name,symbol,kind,issuer_id,identity_status,json_extract(payload,'$.active') active FROM catalyst_assets WHERE kind IN ('KR_STOCK','US_STOCK')"),names=new Map(),symbols=new Map(),byId=new Map();
   const add=(map,k,a)=>{if(!k)return;const set=map.get(k)||new Map();set.set(a.id,a);map.set(k,set);};
   for(const a of assets.filter(valid)){byId.set(a.id,a);for(const n of new Set([key(a.name),legal(a.name)]))if(n.length>=3&&!isGeneric(n))add(names,n,a);add(symbols,a.symbol,a);}
   for(const alias of await rows(db,"SELECT alias,asset_id FROM catalyst_aliases WHERE alias_type IN ('canonical','exact')")){const a=byId.get(alias.asset_id),n=key(alias.alias);if(a&&n.length>=3&&!isGeneric(n)&&n!==key(a.symbol))add(names,n,a);}
   cached={names,symbols,until:now()+300000};return cached;
  })();try{return await pending;}finally{pending=null;}
 }
 return async function mentions(article){
  const {names,symbols}=await index(),found=new Map();
  const add=(set,mention,basis)=>{if(set?.size!==1)return;const a=[...set.values()][0];if(!found.has(a.id))found.set(a.id,{assetId:a.id,market:a.kind==='KR_STOCK'?'KR':'US',ticker:a.symbol,name:a.name,mention,basis,relationship:'MENTIONED'});};
  for(const [basis,text]of [['TITLE',article.title],['FEED_EXCERPT',article.feedExcerpt]]){
   if(!text)continue;
   const phrases=[key(text),...entityPhrases(key(String(text).slice(0,600)))];
   for(const phrase of phrases)add(names.get(phrase),phrase,basis);
   // Require explicit security syntax; AI, ON, IT, META etc. in prose aren't tickers.
   for(const m of String(text).matchAll(/\b(?:NASDAQ|NYSE|AMEX|ticker)\s*[:：]\s*([A-Z0-9.-]{1,12})\b|\$([A-Z][A-Z0-9.-]{0,11})\b/g))add(symbols.get(m[1]||m[2]),m[0],basis);
   for(const m of String(text).matchAll(/(?:종목코드\s*[:：]?\s*|\()(\d{6})(?:\)|\b)/g))add(symbols.get(m[1]),m[0],basis);
  }
  return [...found.values()].slice(0,3);
 };
}
