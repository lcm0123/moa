import {saveIdentity} from './identity.mjs';
import {safeUrl,norm} from './core.mjs';
const pending=new WeakMap();
const nameKey=s=>norm(s).toLowerCase().replace(/\s+-\s+.*$/,'').replace(/\b(incorporated|inc|corporation|corp|ltd|limited|company|co)\b/g,'').replace(/[^a-z0-9]/g,'');
export async function enrichStockIdentity(env,store,asset){
 if(asset?.kind!=='US_STOCK'||!env.CATALYST_TOOLS?.stockIdentity)return asset;
 if(asset.exchange&&asset.identitySource?.startsWith('https://www.nasdaqtrader.com/')&&Date.now()-Date.parse(asset.identityCheckedAt)<86400000)return asset;
 let active=pending.get(store.db);if(!active){active=new Map();pending.set(store.db,active);}if(active.has(asset.id))return active.get(asset.id);
 const work=(async()=>{
  const cached=await store.fact(asset.id,'listing_identity');if(cached&&!cached.stale)return cached.asset||asset;
  let match=null;try{match=await env.CATALYST_TOOLS.stockIdentity(asset);}catch{}
  // Prevent re-used or mismatched ticker metadata from filling an old issuer.
  const ok=match?.symbol===asset.symbol&&nameKey(match.name)===nameKey(asset.name)&&!!nameKey(asset.name)&&['NASDAQ','NYSE','NYSE AMERICAN','NYSE ARCA','CBOE BZX','IEX'].includes(match.exchange)&&safeUrl(match.source)&&new URL(match.source).hostname==='www.nasdaqtrader.com';
  let next=asset;
  if(ok){next={...asset,exchange:match.exchange,identitySource:match.source,identityCheckedAt:match.observedAt};await store.db.prepare('UPDATE catalyst_assets SET exchange=?,payload=?,updated_at=? WHERE id=?').bind(next.exchange,JSON.stringify(next),new Date().toISOString(),asset.id).run();next=await saveIdentity(store,next);}
  await store.putFact(asset.id,'listing_identity',{asset:next,status:ok?'matched':'unresolved'},[],ok?86400000:900000);return next;
 })();active.set(asset.id,work);try{return await work;}finally{active.delete(asset.id);}
}
