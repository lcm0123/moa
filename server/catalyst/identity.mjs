import settings from '../../config/catalyst-entities.json' with {type:'json'};
import {norm} from './core.mjs';
export const identityVersion=settings.version;
const generic=new Set(settings.genericTerms.map(x=>norm(x).toLowerCase()));
const particles=/(?:에게서|에서는|으로는|으로|에서|에게|처럼|과는|와는|보다|까지|부터|이랑|랑|은|는|이|가|을|를|의|와|과|도|에)$/u;
export function entityPhrases(query){
 const words=norm(query).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}.^/-]*/gu)||[],out=new Set();
 for(let start=0;start<words.length;start++)for(let size=1;size<=6&&start+size<=words.length;size++){
  const phrase=words.slice(start,start+size).join(' '),base=phrase.replace(particles,'');
  for(const value of [phrase,base])if(value.length>=2&&!generic.has(value))out.add(value);
 }
 return [...out];
}
export const isGeneric=query=>generic.has(norm(query).toLowerCase().replace(particles,''));
export function canonicalIdentity(a){
 let key=null,missing=[];
 if(a.kind==='KR_STOCK'){
  if(!/^[0-9A-Z]{6}$/.test(a.symbol)||!/^\d{8}$/.test(a.issuerId||''))missing.push('ticker/corp_code');
  if(a.market!=='KR')missing.push('market');
  if(!missing.length)key=['KR',a.market,a.symbol,a.issuerId].join(':');
 }else if(a.kind==='US_STOCK'){
  if(!/^[A-Z0-9.^/-]{1,24}$/.test(a.symbol)||!/^\d{1,10}$/.test(a.issuerId||''))missing.push('ticker/CIK');
  if(!a.exchange)missing.push('exchange');
  if(!missing.length)key=['US',a.exchange.toUpperCase(),a.symbol,Number(a.issuerId)].join(':');
 }else{
  if(!a.chain)missing.push('chain');
  const native=a.canonicalIdentifier?.startsWith('native:');
  if(!native&&!a.contractAddress)missing.push('contract/address');
  if(!missing.length)key=['CRYPTO',a.symbol,a.chain,native?'native':a.contractAddress].join(':');
 }
 return {key,complete:!!key,missing,version:identityVersion};
}
function identityStatement(store,a){
 const identity=canonicalIdentity(a);
 return store.db.prepare(`INSERT INTO catalyst_asset_identity VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
 ON CONFLICT(asset_id) DO UPDATE SET canonical_key=excluded.canonical_key,market=excluded.market,symbol=excluded.symbol,exchange=excluded.exchange,issuer_id=excluded.issuer_id,chain=excluded.chain,contract_address=excluded.contract_address,completeness=excluded.completeness,source_url=excluded.source_url,version=excluded.version,updated_at=excluded.updated_at`)
 .bind(a.id,identity.key,a.market||null,a.symbol,a.exchange||null,a.issuerId||null,a.chain||null,a.contractAddress||null,identity.complete?'complete':'incomplete',a.identitySource||null,identityVersion,new Date().toISOString());
}
export async function saveIdentity(store,a){await identityStatement(store,a).run();return {...a,canonicalIdentity:canonicalIdentity(a)};}
export async function syncIdentityIndex(store,assets){
 // Only already mapped entities receive curated aliases. No name-based issuer guesses.
 const known=new Map(assets.map(a=>[a.id,a]));
 for(let i=0;i<assets.length;i+=200)await store.db.batch(assets.slice(i,i+200).map(a=>identityStatement(store,a))); 
 for(const entry of settings.aliases){const a=known.get(entry.assetId);if(!a)continue;
  for(const alias of entry.values)await store.db.prepare('INSERT OR IGNORE INTO catalyst_aliases VALUES(?,?,?,?,?)').bind(norm(alias).toLowerCase(),a.id,'canonical',a.identitySource||null,identityVersion).run();
 }
}
