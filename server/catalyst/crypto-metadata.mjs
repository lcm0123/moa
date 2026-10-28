import {hash,config,safeUrl} from './core.mjs';
import {rows,one} from './store.mjs';
import {cryptoDetails} from './evidence.mjs';
import {validateClaim} from './claims.mjs';
import {proposition,sourceAuthority} from './claim-validation.mjs';
import {CatalystGraph} from './graph.mjs';
import {supersedingEvent} from './graph-policy.mjs';

export const valueCaptureTypes=['FEE_SHARE','BUYBACK','BURN','STAKING','COLLATERAL','REQUIRED_USE','GOVERNANCE_ONLY','NONE','UNKNOWN'];
export const cryptoSourcePriority=['official_protocol','official_foundation','governance','official_documentation','verified_contract','exchange','onchain','market','news','social'];
export function deploymentStandard(chain,address,native=false){
 if(native)return 'NATIVE';
 // Chain + address format do not prove the contract's token standard.
 if(chain==='solana'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address||''))return 'SPL_UNVERIFIED';
 if(/^0x[\da-f]{40}$/i.test(address||'')&&chain==='binance-smart-chain')return 'BEP20_UNVERIFIED';
 if(/^0x[\da-f]{40}$/i.test(address||'')&&['ethereum','arbitrum-one','optimistic-ethereum','base','polygon-pos'].includes(chain))return 'ERC20_UNVERIFIED';
 return 'UNKNOWN';
}
export async function cryptoMetadata(store,assetId){
 let token=await one(store.db,'SELECT * FROM catalyst_tokens WHERE asset_id=?',assetId);
 if(!token){const asset=await store.asset(assetId);if(asset?.kind==='CRYPTO'&&asset.geckoId)token=await one(store.db,"SELECT * FROM catalyst_tokens WHERE json_extract(provider_ids,'$.coingecko')=? AND symbol=?",asset.geckoId,asset.symbol);}
 if(!token)return {asset_id:assetId,status:'not_collected'};
 const relations=await rows(store.db,'SELECT * FROM catalyst_token_protocols WHERE token_id=?',token.token_id);
 return {asset_id:assetId,token,deployments:await rows(store.db,'SELECT * FROM catalyst_deployments WHERE token_id=?',token.token_id),exchange_pairs:await rows(store.db,'SELECT * FROM catalyst_exchange_pairs WHERE token_id=?',token.token_id),protocols:await rows(store.db,'SELECT p.* FROM catalyst_protocols p JOIN catalyst_token_protocols t ON t.protocol_id=p.protocol_id WHERE t.token_id=?',token.token_id),relationships:relations.map(r=>({...r,payload:JSON.parse(r.payload)})),token_value_capture:(await rows(store.db,'SELECT * FROM catalyst_token_value_capture WHERE token_id=?',token.token_id)).map(r=>({...r,payload:JSON.parse(r.payload)})),observations:(await rows(store.db,'SELECT * FROM catalyst_crypto_observations WHERE entity_id=? OR entity_id IN (SELECT protocol_id FROM catalyst_token_protocols WHERE token_id=?)',token.token_id,token.token_id)).map(r=>({...r,payload:JSON.parse(r.payload)}))};
}
export async function saveCryptoMetadata(store,asset,m,{documents=[],now=Date.now(),namespace='production'}={}){
 if(asset.kind!=='CRYPTO'||m.geckoId!==asset.geckoId)throw Error('crypto_identity_mismatch');
 const prior=await one(store.db,"SELECT * FROM catalyst_tokens WHERE json_extract(provider_ids,'$.coingecko')=? AND symbol=?",asset.geckoId,asset.symbol),root=await store.asset('CRYPTO:'+asset.geckoId),rootId=root?.kind==='CRYPTO'&&root.symbol===asset.symbol?root.id:asset.id;
 const token_id=prior?.token_id||'TOKEN:'+await hash(rootId),at=new Date(now).toISOString(),native=!!config.nativeChains[asset.geckoId]&&asset.canonicalIdentifier?.startsWith('native:');
 await store.db.prepare('INSERT INTO catalyst_tokens VALUES(?,?,?,?,?,?,?) ON CONFLICT(token_id) DO UPDATE SET provider_ids=excluded.provider_ids,last_verified_at=excluded.last_verified_at').bind(token_id,prior?.asset_id||rootId,asset.symbol,asset.name,native?1:0,JSON.stringify({coingecko:m.geckoId}),at).run();
 const platforms=native?[{chain:config.nativeChains[asset.geckoId].chain,contractAddress:null}]:(m.platforms||[]);
 for(const p of platforms){
  const chain='BLOCKCHAIN:'+p.chain,standard=deploymentStandard(p.chain,p.contractAddress,native),id='DEPLOYMENT:'+await hash(token_id+'|'+chain+'|'+(p.contractAddress||'native'));
  await store.db.batch([store.db.prepare('INSERT INTO catalyst_blockchains VALUES(?,?,?,?) ON CONFLICT(chain_id) DO UPDATE SET last_verified_at=excluded.last_verified_at').bind(chain,p.chain,m.source,at),store.db.prepare('INSERT INTO catalyst_deployments VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(deployment_id) DO UPDATE SET verification_status=excluded.verification_status,last_verified_at=excluded.last_verified_at').bind(id,token_id,chain,p.contractAddress||null,standard,native?'VERIFIED':'PARTIAL',m.source,at)]);
 }
 if(asset.instrument&&asset.mappingEvidence)await store.db.prepare('INSERT OR REPLACE INTO catalyst_exchange_pairs VALUES(?,?,?,?,?,?,?)').bind('PAIR:binance:'+asset.instrument,token_id,'Binance',asset.symbol,'USDT','spot',asset.identitySource||m.source).run();
 const n=v=>Number.isFinite(v)&&v>=0?v:null;
 const tokenomics={circulating_supply:n(m.tokenomics?.circulatingSupply),max_supply:n(m.tokenomics?.maxSupply),total_supply:n(m.tokenomics?.totalSupply),FDV:n(m.tokenomics?.fdv),unlock:null,emission:null,inflation:null,treasury:null,holder_concentration:null};
 await store.db.prepare('INSERT OR REPLACE INTO catalyst_crypto_observations VALUES(?,?,?,?,?)').bind(token_id,'tokenomics',m.asOf||at,m.source,JSON.stringify({values:tokenomics,quality:'PARTIAL',provider:'CoinGecko',observedAt:at,missing:'락업·발행 일정·집중도 공급원 미연결'})).run();
 let governanceFound=false;
 for(const doc of documents.slice(0,2)){
  if(doc.assetId!==asset.id||!sourceAuthority(doc,asset))continue;
  const source=await store.addSource(doc);
  for(const quote of String(source.body).split(/\n|(?<=[.!?])\s+/).slice(0,350)){
   const p=proposition(quote);if(!p||p.subject!==asset.symbol.toLowerCase())continue;
   if(supersedingEvent({quote})==='GOVERNANCE_EXECUTED'){
    const c=await validateClaim({id:'execution:'+quote,type:'tokenomics',subject_id:asset.id,predicate:p.predicate,value:quote,quote,source_id:source.id,freshness_policy_id:'CRYPTO_TOKENOMICS'},[source],[asset],'metadata:'+source.id,now);await store.saveClaim(c,'metadata:'+source.id);await new CatalystGraph(store.db,{namespace}).applyLifecycleClaim(c,{now});continue;
   }
   if(p.predicate==='BURN'){
    const c=await validateClaim({id:'burn:'+quote,type:'value_capture',subject_id:asset.id,predicate:'BURN',value:quote,quote,source_id:source.id,freshness_policy_id:'CRYPTO_TOKENOMICS'},[source],[asset],'metadata:'+source.id,now);await store.saveClaim(c,'metadata:'+source.id);
    if(c.status==='VERIFIED')await store.db.batch([store.db.prepare('INSERT OR REPLACE INTO catalyst_token_value_capture VALUES(?,?,?,?,?)').bind(token_id,'BURN','VERIFIED',JSON.stringify([c.id]),JSON.stringify({source_url:source.url,quote:c.quote,other_capture:'UNKNOWN',last_verified_at:at})),store.db.prepare("UPDATE catalyst_token_protocols SET payload=json_set(payload,'$.burn',json('true'),'$.burn_claim_id',?) WHERE token_id=?").bind(c.id,token_id),store.db.prepare("DELETE FROM catalyst_token_value_capture WHERE token_id=? AND capture_type='GOVERNANCE_ONLY'").bind(token_id)]);
    continue;
   }
   if(p.predicate!=='GOVERNANCE_OF')continue;
   const c=await validateClaim({id:'governance:'+quote,type:'tokenomics',subject_id:asset.id,predicate:p.predicate,value:quote,quote,source_id:source.id,freshness_policy_id:'CRYPTO_TOKENOMICS'},[source],[asset],'metadata:'+source.id,now);await store.saveClaim(c,'metadata:'+source.id);
   if(c.status!=='VERIFIED')continue;
   const host=new URL(source.url).hostname,protocol_id='PROTOCOL:'+await hash(p.object+'|'+host),claim_ids=JSON.stringify([c.id]);governanceFound=true;
   const relationship={utility:null,governance:true,staking:null,fee_capture:null,buyback:null,burn:null,collateral_use:null,required_demand:null,quote:c.quote,source_url:source.url,last_verified_at:at};
   await store.db.batch([store.db.prepare('INSERT OR REPLACE INTO catalyst_protocols VALUES(?,?,?,?,?,?,?,?)').bind(protocol_id,p.object,null,host,'[]','VERIFIED',at,JSON.stringify({claim_ids:[c.id],chainsVerification:'token deployment only; protocol deployment unverified'})),store.db.prepare('INSERT OR REPLACE INTO catalyst_token_protocols VALUES(?,?,?,?,?)').bind(token_id,protocol_id,'VERIFIED',claim_ids,JSON.stringify(relationship)),store.db.prepare('INSERT OR REPLACE INTO catalyst_token_value_capture VALUES(?,?,?,?,?)').bind(token_id,'GOVERNANCE_ONLY','VERIFIED',claim_ids,JSON.stringify({source_url:source.url,quote:c.quote,other_capture:'UNKNOWN',meaning:'확인된 관계는 거버넌스 · 다른 가치 귀속이 없다는 뜻 아님'})),store.db.prepare('INSERT OR REPLACE INTO catalyst_crypto_observations VALUES(?,?,?,?,?)').bind(protocol_id,'fundamentals',at,source.url,JSON.stringify({TVL:null,volume:null,revenue:null,fees:null,users:null,stablecoin_supply:null,quality:'UNAVAILABLE',reason:'프로토콜 단위 전문 공급원 미연결'}))]);
   const graph=new CatalystGraph(store.db,{namespace}),from=await graph.node({kind:'TOKEN',label:asset.symbol,assetId:asset.id}),to=await graph.node({kind:'PROTOCOL',label:p.object});
   const edge={source_node_id:from,target_node_id:to,relation_type:'GOVERNANCE_OF',status:'VERIFIED',freshness_policy_id:'CRYPTO_TOKENOMICS'};await graph.propose(edge,{claimIds:[c.id]});await graph.publish(edge,[c.id],{now});
  }
 }
 if(governanceFound)await store.db.prepare("DELETE FROM catalyst_token_value_capture WHERE token_id=? AND capture_type='UNKNOWN'").bind(token_id).run();
 if(await one(store.db,"SELECT token_id FROM catalyst_token_value_capture WHERE token_id=? AND capture_type='BURN' AND verification_status='VERIFIED'",token_id))await store.db.prepare("DELETE FROM catalyst_token_value_capture WHERE token_id=? AND capture_type='GOVERNANCE_ONLY'").bind(token_id).run();
 if(!governanceFound)await store.db.prepare('INSERT OR REPLACE INTO catalyst_token_value_capture VALUES(?,?,?,?,?)').bind(token_id,'UNKNOWN','UNVERIFIED','[]',JSON.stringify({reason:'공식 문서에서 가치 귀속 관계 미확인'})).run();
 return {...await cryptoMetadata(store,asset.id),requires_deployment_choice:!native&&platforms.length>1,identity_status:platforms.length?native?'verified':'provider_matched':'unresolved'};
}
export async function collectCryptoMetadata(env,store,asset,{now=Date.now(),namespace='production',force=false}={}){
 const old=await store.fact(asset.id,'crypto_metadata');if(old&&!old.stale&&!force)return cryptoMetadata(store,asset.id);
 const started=performance.now(),{asset:enriched,metadata:m}=await cryptoDetails(env,store,asset,{force});if(!m)throw Error('crypto_provider_unavailable');
 const docs=[];
 if(env.CATALYST_TOOLS?.cryptoDocuments){for(const doc of await env.CATALYST_TOOLS.cryptoDocuments(enriched,m)){if(safeUrl(doc.url))docs.push(doc);}}
 const remoteMs=performance.now()-started,result=await saveCryptoMetadata(store,enriched,m,{documents:docs,now:Math.max(now,Date.now()),namespace});
 await store.putFact(asset.id,'crypto_metadata',{collected_at:new Date(now).toISOString(),remoteMs},[],config.ttl.entity);return {...result,remoteMs};
}
