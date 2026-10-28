import {one,rows} from './store.mjs';
import {config,norm} from './core.mjs';
import {entityPhrases,isGeneric,canonicalIdentity,syncIdentityIndex} from './identity.mjs';
const locks=new WeakMap();
export function stockIdentity(market,ticker,issuer){if(market==='KR'&&/^[0-9A-Z]{6}$/.test(ticker)&&/^\d{8}$/.test(issuer))return 'KR:'+issuer+':'+ticker;if(market==='US'&&/^[A-Z0-9.^/-]{1,24}$/.test(ticker)&&/^\d{1,10}$/.test(String(issuer)))return 'US:'+String(Number(issuer))+':'+ticker;return null;}
export function cryptoIdentity(meta,coin){
 const native=config.nativeChains[meta.geckoId];
 if(native&&coin.symbol===native.symbol)return {identityStatus:'verified',chain:native.chain,contractAddress:null,canonicalIdentifier:'native:'+native.chain+':'+native.symbol,identitySource:native.source};
 return {identityStatus:'provisional',chain:null,contractAddress:null,canonicalIdentifier:null,identitySource:meta.geckoId?'https://www.coingecko.com/en/coins/'+meta.geckoId:null};
}
export async function syncAssets(store,{force=false}={}){
 if(locks.has(store.db))return locks.get(store.db);
 const job=(async()=>{
  const checkpoint=await store.runtime('assets');if(!force&&checkpoint?.version===3&&Date.now()-checkpoint.at<config.ttl.entity)return checkpoint;
  const now=new Date().toISOString(),assets=[];
  const corp=await one(store.db,"SELECT payload FROM research_cache WHERE cache_key='dart:companies'");
  const listing=await one(store.db,"SELECT payload,base_date FROM fsc_daily_snapshots WHERE operation='stocks' ORDER BY base_date DESC LIMIT 1"),listed=new Map((listing?JSON.parse(listing.payload):[]).map(s=>[s.ticker,s]));
  for(const c of corp?JSON.parse(corp.payload).items||[]:[]){const id=stockIdentity('KR',c.ticker,c.corpCode),current=listed.get(c.ticker);if(id)assets.push({id,kind:'KR_STOCK',market:'KR',symbol:c.ticker,name:current?.name||c.name,exchange:current?.exchange||null,isin:current?.isin||null,active:listing?!!current:null,listingAsOf:listing?.base_date||null,issuerId:c.corpCode,identityStatus:'verified',legacyKey:'KR:'+c.ticker,identitySource:'https://opendart.fss.or.kr/'});}
  for(const c of await rows(store.db,'SELECT ticker,name,cik FROM competitor_universe')){const id=stockIdentity('US',c.ticker,String(c.cik));if(id)assets.push({id,kind:'US_STOCK',market:'US',symbol:c.ticker,name:c.name,issuerId:String(Number(c.cik)),identityStatus:'verified',legacyKey:'US:'+c.ticker,identitySource:'https://www.sec.gov/files/company_tickers.json'});}
  const snapshot=await one(store.db,"SELECT payload FROM cmc_cache WHERE cache_key='binance:spot:snapshot'"),metadata=await one(store.db,"SELECT payload FROM cmc_cache WHERE cache_key='binance:gecko:metadata'");
  const coins=snapshot?JSON.parse(snapshot.payload).items||[]:[],meta=new Map((metadata?JSON.parse(metadata.payload).items||[]:[]).map(c=>[c.id,c]));
  for(const c of coins){const m=meta.get(c.id)||{};assets.push({id:'CRYPTO:'+(m.geckoId||c.id),kind:'CRYPTO',symbol:c.symbol,name:m.name||c.name,geckoId:m.geckoId||null,instrumentId:c.id,instrument:c.ticker,categories:m.categories||[],legacyKey:c.id,...cryptoIdentity(m,c)});}
  for(let i=0;i<assets.length;i+=200){const batch=[];for(const a of assets.slice(i,i+200)){
   batch.push(store.db.prepare("INSERT INTO catalyst_assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,symbol=excluded.symbol,exchange=COALESCE(excluded.exchange,exchange),payload=CASE WHEN excluded.kind='US_STOCK' AND excluded.exchange IS NULL AND catalyst_assets.exchange IS NOT NULL THEN json_patch(excluded.payload,json_object('exchange',catalyst_assets.exchange,'identitySource',json_extract(catalyst_assets.payload,'$.identitySource'),'identityCheckedAt',json_extract(catalyst_assets.payload,'$.identityCheckedAt'))) WHEN excluded.kind<>'CRYPTO' THEN excluded.payload ELSE catalyst_assets.payload END,updated_at=excluded.updated_at").bind(a.id,a.kind,a.symbol,a.name,a.exchange||null,a.issuerId||null,a.chain||null,a.contractAddress||null,null,a.identityStatus,JSON.stringify(a),now));
   batch.push(store.db.prepare('INSERT OR IGNORE INTO catalyst_identifiers(namespace,value,asset_id,source_url) VALUES(?,?,?,?)').bind('legacy',a.legacyKey,a.id,a.identitySource||null));
   if(a.canonicalIdentifier)batch.push(store.db.prepare('INSERT OR IGNORE INTO catalyst_identifiers(namespace,value,asset_id,source_url) VALUES(?,?,?,?)').bind('canonical',a.canonicalIdentifier,a.id,a.identitySource));
  }await store.db.batch(batch);}
  await syncIdentityIndex(store,(await rows(store.db,'SELECT * FROM catalyst_assets')).map(readAsset));
  const result={version:3,at:Date.now(),counts:Object.fromEntries(['KR_STOCK','US_STOCK','CRYPTO'].map(k=>[k,assets.filter(a=>a.kind===k).length]))};await store.runtime('assets',result);return result;
 })();locks.set(store.db,job);try{return await job;}finally{locks.delete(store.db);}
}
function readAsset(r){const a={...JSON.parse(r.payload),id:r.id,kind:r.kind,symbol:r.symbol,name:r.name,exchange:r.exchange||null,issuerId:r.issuer_id||null,chain:r.chain||null,contractAddress:r.contract_address||null,identityStatus:r.identity_status};return {...a,canonicalIdentity:canonicalIdentity(a)};}
async function exactMatches(store,q,kind){
 const phrases=entityPhrases(q);if(!phrases.length)return [];
 const slots=phrases.map(()=>'?').join(','),allowed=kind?(Array.isArray(kind)?kind:[kind]):null;
 // Query exact identities BEFORE any fuzzy LIMIT. Same-symbol instruments stay separate.
 const found=await rows(store.db,`SELECT a.*,MIN(CASE WHEN i.alias_type='exact' THEN 0 WHEN lower(a.symbol) IN (${slots}) THEN 1 WHEN lower(a.name) IN (${slots}) THEN 2 ELSE 3 END) match_rank
 FROM catalyst_assets a LEFT JOIN catalyst_aliases i ON i.asset_id=a.id AND i.alias IN (${slots})
 WHERE (lower(a.symbol) IN (${slots}) OR lower(a.name) IN (${slots}) OR i.alias IS NOT NULL)
 ${allowed?'AND a.kind IN ('+allowed.map(()=>'?').join(',')+')':''} GROUP BY a.id ORDER BY match_rank,a.id`,...phrases,...phrases,...phrases,...phrases,...phrases,...(allowed||[]));
 return found.map(r=>({...readAsset(r),matchRank:r.match_rank,matchType:['exact_alias','exact_ticker','exact_name','canonical_alias'][r.match_rank]})).filter(a=>a.active!==false);
}
export async function searchAssets(store,q,kind=null){
 await syncAssets(store);const query=norm(q);if(!query||isGeneric(query))return [];
 const exact=await exactMatches(store,query,kind);if(exact.length)return exact;
 // Fuzzy is for an explicit short asset lookup only; never decides an identity.
 if(query.length<3||query.length>60||/[?？]|왜|수혜|증설|상승|기업|업체|어떤|같은|Catalyst/i.test(query)||query.split(/\s+/).length>3)return [];
 const allowed=kind?(Array.isArray(kind)?kind:[kind]):null;
 const found=await rows(store.db,'SELECT * FROM catalyst_assets WHERE instr(lower(name),?)>0'+(allowed?' AND kind IN ('+allowed.map(()=>'?').join(',')+')':'')+' ORDER BY length(name),id LIMIT 30',query.toLowerCase(),...(allowed||[]));
 return found.map(r=>({...readAsset(r),matchType:'fuzzy'})).filter(a=>a.active!==false).slice(0,15);
}
export async function resolveAsset(store,q,id,kind){
 if(id){let a=await store.asset(id);if(!a){const ids=await rows(store.db,'SELECT asset_id FROM catalyst_identifiers WHERE namespace=? AND value=?','legacy',id);if(ids.length===1)a=await store.asset(ids[0].asset_id);}return {asset:a,choices:[],invalidSelection:!a};}
 const found=await searchAssets(store,q,kind),exact=found.filter(a=>a.matchType!=='fuzzy');
 // A symbol collision is not resolved by popularity, alias rank or query order.
 return {asset:exact.length===1?exact[0]:null,choices:exact.length>1?exact:exact.length?[]:found};
}
