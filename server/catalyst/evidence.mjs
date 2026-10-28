import {one,rows} from './store.mjs';
import {config,terms,safeUrl,hash} from './core.mjs';
import {searchAssets} from './assets.mjs';
import {saveIdentity} from './identity.mjs';
import {deduplicateSources} from './claims.mjs';
import {optionalWebSearch} from './web-search.mjs';
import {verifyStructuredSource} from './structured-evidence.mjs';
import {issuerDocumentAuthority} from './authority.mjs';

// Candidate discovery is deliberately separate from verification. Legacy product
// classifications are never themselves evidence or an automatic relationship.
export async function profileCandidates(store,query,kind=null){
 const ts=terms(query).filter(t=>t.length>2),found=[];
 if(ts.length){const indexed=await rows(store.db,'SELECT asset_id,COUNT(DISTINCT term) relevance FROM catalyst_business_index WHERE term IN ('+ts.map(()=>'?').join(',')+') GROUP BY asset_id ORDER BY relevance DESC LIMIT 10',...ts);for(const r of indexed){const asset=await store.asset(r.asset_id);if(asset&&asset.active!==false&&(!kind||kind.includes(asset.kind)))found.push({asset,relevance:r.relevance});}}
 const profiles=await rows(store.db,'SELECT payload,market,ticker FROM competitor_profiles ORDER BY source_date DESC,checked_at DESC LIMIT 500');
 const seen=new Set();for(const r of profiles){const key=r.market+':'+r.ticker;if(seen.has(key))continue;seen.add(key);const p=JSON.parse(r.payload);const text=JSON.stringify(p.products||[]).toLowerCase(),relevance=ts.filter(t=>text.includes(t)).length;if(!relevance)continue;
  const a=await one(store.db,"SELECT asset_id FROM catalyst_identifiers WHERE namespace='legacy' AND value=?",key);if(!a)continue;const asset=await store.asset(a.asset_id);if(!asset||asset.active===false||kind&&!kind.includes(asset.kind))continue;found.push({asset,relevance});
 }return [...new Map(found.sort((a,b)=>b.relevance-a.relevance).map(x=>[x.asset.id,x.asset])).values()].slice(0,config.stockCandidates);
}
export async function indexBusiness(store,source){
 if(source.sourceType!=='business'||!source.assetId)return;
 const stop=new Set(['with','this','that','from','have','their','which','other','these','company','business','products','through','during','these','were','been','including','있는','하고','당사는','회사의','사업의']);
 const ts=[...new Set(source.body.toLowerCase().match(/[\p{L}][\p{L}\p{N}-]{2,35}/gu)||[])].filter(t=>!stop.has(t)).slice(0,180);
 for(let i=0;i<ts.length;i+=60)await store.db.batch(ts.slice(i,i+60).map(t=>store.db.prepare('INSERT OR IGNORE INTO catalyst_business_index VALUES(?,?,?)').bind(source.assetId,t,source.id)));
}
export async function cachedProfile(store,asset){
 const p=await one(store.db,'SELECT payload FROM competitor_profiles WHERE market=? AND ticker=? ORDER BY source_date DESC,checked_at DESC LIMIT 1',asset.market,asset.symbol);if(!p)return null;
 const value=JSON.parse(p.payload),blocks=(value.products||[]).flatMap(p=>Object.values(p.evidence||{}).flat()).filter(b=>b?.text),unique=[...new Map(blocks.map(b=>[b.text,b])).values()];
 if(!value.identityVerified||!value.documentHash||!safeUrl(value.sourceUrl)||!unique.length)return null;
 return {assetId:asset.id,sourceType:'business',publisher:value.source||'기업 공시',title:value.source||'사업 보고서',url:value.sourceUrl,publishedAt:value.sourceDate,observedAt:value.checkedAt,body:unique.map(b=>b.text).join('\n'),tables:value.tables,locator:unique.map(b=>b.locator).join(' / ').slice(0,700),originRef:value.receipt,authority:issuerDocumentAuthority(value,asset)};
}
export async function sourceRevision(store,asset){
 const sec=await one(store.db,"SELECT MAX(f.updated_at) stamp FROM sec_filings f JOIN sec_filing_issuers i ON i.accession=f.accession WHERE CAST(i.cik AS INTEGER)=?",Number(asset?.issuerId)||0);
 const dart=asset?.market==='KR'?await one(store.db,'SELECT MAX(last_seen_at) stamp FROM dart_filings WHERE ticker=?',asset.symbol).catch(()=>null):null;
 return [sec?.stamp,dart?.stamp].filter(Boolean).join('|');
}
export function selectExcerpt(body,query,max=config.maxSourceCharacters){
 const ts=terms(query),text=String(body),segments=text.split(/\n|(?<=[.!?。])\s+/).filter(s=>s.length>20),ranked=segments.map((s,i)=>({s,i,n:ts.filter(t=>s.toLowerCase().includes(t)).length})).sort((a,b)=>b.n-a.n||a.i-b.i);
 let length=0;return ranked.filter(x=>{if(length+x.s.length>max)return false;length+=x.s.length;return true;}).sort((a,b)=>a.i-b.i).map(x=>x.s).join('\n').slice(0,max)||text.slice(0,max);
}
export async function cryptoDetails(env,store,asset,{force=false}={}){
 const cached=await store.fact(asset.id,'crypto');if(cached&&!cached.stale&&!force)return {asset,metadata:cached};
 const m=await env.CATALYST_TOOLS?.cryptoMetadata(asset);if(!m)return {asset,metadata:null};
 let next={...asset,protocolId:m.protocolId,homepages:m.homepages};
 const native=asset.canonicalIdentifier?.startsWith('native:');
 if(m.platforms.length===1&&!native){const p=m.platforms[0];next={...next,...p,identityStatus:'verified',canonicalIdentifier:'token:'+p.chain+':'+p.contractAddress,identitySource:m.source};}
 // Multiple deployment contracts require a user's explicit chain, never an arbitrary first one.
 if(m.platforms.length>1&&asset.identityStatus!=='verified'){
  const deployments=[];for(const p of m.platforms.slice(0,20)){const value={...asset,...p,id:'CRYPTO:'+p.chain+':'+p.contractAddress,identityStatus:'verified',canonicalIdentifier:'token:'+p.chain+':'+p.contractAddress,identitySource:m.source,protocolId:m.protocolId,name:asset.name+' · '+p.chain};
   await store.db.prepare('INSERT OR IGNORE INTO catalyst_assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(value.id,'CRYPTO',asset.symbol,value.name,null,null,p.chain,p.contractAddress,m.protocolId,'verified',JSON.stringify(value),new Date().toISOString()).run();await saveIdentity(store,value);deployments.push(value.id);
  }next={...next,identityStatus:'ambiguous',platforms:m.platforms,deployments};
 }
 await store.db.prepare('UPDATE catalyst_assets SET chain=?,contract_address=?,protocol_id=?,identity_status=?,payload=?,updated_at=? WHERE id=?').bind(next.chain||null,next.contractAddress||null,next.protocolId,next.identityStatus,JSON.stringify(next),new Date().toISOString(),next.id).run();
 if(next.canonicalIdentifier)await store.db.prepare('INSERT OR IGNORE INTO catalyst_identifiers(namespace,value,asset_id,source_url) VALUES(?,?,?,?)').bind('canonical',next.canonicalIdentifier,next.id,next.identitySource||null).run();
 next=await saveIdentity(store,next);
 await store.putFact(asset.id,'crypto',m,[],config.ttl.entity);return {asset:next,metadata:m};
}
export async function gatherEvidence(env,store,run,assets,checkpoint=()=>{}){
 const tool=env.CATALYST_TOOLS,sourceList=[],failures=[],diag={searchResults:0,readDocuments:0,businessDocuments:0,newsDocuments:0,businessAttempts:0,searchProvider:null};
 const add=async(s)=>{if(s?.body&&safeUrl(s.url)){const saved=await store.addSource({...s,excerpt:selectExcerpt(s.body,run.query)});sourceList.push(saved);await indexBusiness(store,saved);
  const structured=await verifyStructuredSource(store,saved,assets.find(a=>a.id===saved.assetId));diag.structuredClaims=(diag.structuredClaims||0)+structured.length;diag.structuredVerified=(diag.structuredVerified||0)+structured.filter(c=>c.status==='VERIFIED').length;
  diag.readDocuments++;return saved;}return null;};
 // Read existing original SEC text; metadata-only titles are not facts.
 if(run.asset?.kind==='US_STOCK'){
  const documents=await rows(store.db,'SELECT d.id,d.source_url,f.accepted_at,f.filed_date,d.form FROM sec_documents d JOIN sec_filings f ON f.accession=d.accession JOIN sec_filing_issuers i ON i.accession=d.accession WHERE CAST(i.cik AS INTEGER)=? ORDER BY f.filed_date DESC LIMIT 2',Number(run.asset.issuerId));
  for(const d of documents){const chunks=await rows(store.db,'SELECT english,anchor FROM sec_chunks WHERE document_id=? ORDER BY ordinal LIMIT 40',d.id);await add({assetId:run.asset.id,url:d.source_url,body:chunks.map(c=>c.english).join('\n'),publishedAt:d.accepted_at||d.filed_date,sourceType:'regulatory',publisher:'SEC EDGAR',title:d.form,locator:chunks[0]?.anchor||'본문',originRef:d.id});}
 }
 for(const asset of assets.slice(0,10)){
  checkpoint();if(asset.kind==='CRYPTO')continue;
  const old=await store.fact(asset.id,'business');let source=old&&!old.stale?old.source:null;
  source||=await cachedProfile(store,asset);
  if((!source||Date.now()-Date.parse(source.publishedAt)>config.businessFreshDays*86400000)&&tool&&diag.businessAttempts<3){diag.businessAttempts++;try{source=await tool.business(asset);}catch{failures.push({asset:asset.symbol,stage:'business',code:'business_unavailable'});}}
  if(source){const saved=await add(source);diag.businessDocuments++;await store.putFact(asset.id,'business',{source:saved},[source.url],config.ttl.business);}
 }
 let items=(run.sourceUrls||[]).map(url=>({url,title:'직접 지정한 근거'}));
 if(tool){try{checkpoint();const news=await tool.news(run.asset,run.query);diag.searchProvider=news.provider;diag.searchResults=news.items.length;items.push(...news.items);}catch{failures.push({stage:'search',code:'search_failed'});}}
 const homepages=[...new Set([...(run.cryptoMetadata?.homepages||[]),...(run.asset?.kind==='CRYPTO'&&config.nativeChains[run.asset.geckoId]?.source?[config.nativeChains[run.asset.geckoId].source]:[])])];if(run.asset?.kind==='CRYPTO')items.unshift(...homepages.slice(0,1).map(url=>({url,title:run.asset.name+' 공식 문서'})));
 items=[...new Map(items.filter(x=>safeUrl(x.url)).map(x=>[x.url,x])).values()].slice(0,6);
 for(let i=0;i<items.length&&sourceList.length<config.maxSources;i+=2){checkpoint();const read=await Promise.all(items.slice(i,i+2).map(async item=>{try{return await tool?.read(item);}catch{return {status:'read_failed'};}}));
  for(let j=0;j<read.length;j++){const r=read[j],item=items[i+j];if(r?.status!=='read'){failures.push({url:item.url,stage:'read',code:r?.code||'body_unavailable'});continue;}
   const knownOfficial=homepages.some(h=>new URL(h).hostname===new URL(r.url).hostname),businessOwner=sourceList.find(s=>s.assetId&&s.sourceType==='business'&&new URL(s.url).hostname===new URL(r.url).hostname&&!/q4cdn|cloudfront|amazonaws/.test(new URL(r.url).hostname)),government=/^(?:www\.)?(?:sec\.gov|federalreserve\.gov|fss\.or\.kr|dart\.fss\.or\.kr)$/.test(new URL(r.url).hostname);
   await add({...r,assetId:knownOfficial?run.asset.id:businessOwner?.assetId||null,sourceType:government?'regulatory':knownOfficial||businessOwner?'official':'news',authority:knownOfficial?{verified:true,kind:'official_domain',assetId:run.asset.id,verificationSource:run.asset.identitySource}:businessOwner?.authority||null,locator:'원문 본문'});diag.newsDocuments++;
  }
 }
 if(tool&&!sourceList.some(s=>s.sourceType!=='business'&&s.publishedAt&&Date.now()-Date.parse(s.publishedAt)<config.eventFreshDays*86400000)&&run.classification.freshnessRequired&&!run.classification.scenario&&env.ENABLE_OPENAI_WEB_SEARCH==='true'){
  checkpoint();run.webSearchUsed=true;
  try{const extra=await optionalWebSearch(env,store,run);diag.searchResults+=extra.items.length;diag.searchProvider+=' + OpenAI Web Search (관리자 허용)';
   for(const item of extra.items){checkpoint();const r=await tool.read(item);if(r?.status!=='read'){failures.push({url:item.url,stage:'read',code:'body_unavailable'});continue;}
    const official=homepages.some(h=>new URL(h).hostname===new URL(r.url).hostname);
    await add({...r,assetId:official?run.asset.id:null,sourceType:official?'official':'news',authority:official?{verified:true,kind:'official_domain',assetId:run.asset.id,verificationSource:run.asset.identitySource}:null,locator:'추가 검색의 원문 본문'});diag.newsDocuments++;
   }
  }catch(e){failures.push({stage:'search',code:e.code||'search_failed'});}
 }
 const sources=deduplicateSources(sourceList);if(run.intent==='MOVE_ANALYSIS')sources.sort((a,b)=>Number(b.sourceType!=='business')-Number(a.sourceType!=='business')||String(b.publishedAt||'').localeCompare(String(a.publishedAt||'')));
 return {sources:sources.slice(0,config.maxSources),diagnostics:diag,failures};
}
export async function discoverAssets(env,store,run){
 const choices=await profileCandidates(store,run.query,run.classification.assetKinds),direct=await searchAssets(store,run.query);
 const selected=[...new Map([...(run.asset?[run.asset]:[]),...choices,...direct].map(a=>[a.id,a])).values()];
 return selected.filter(a=>a.id===run.asset?.id||run.classification.assetKinds.includes(a.kind)).slice(0,run.asset?.kind==='CRYPTO'?config.cryptoCandidates:config.stockCandidates);
}
export async function expandFromEvidence(env,store,run,sources,existing,checkpoint){
 // Discover names in already read documents. A mention is a search candidate only.
 const text=sources.filter(s=>s.sourceType!=='business').map(s=>s.body).join('\n').slice(0,50000).toLowerCase();if(!text)return {assets:existing,sources:[],attempted:0};
 const matches=await rows(store.db,"SELECT id,payload FROM catalyst_assets WHERE length(name)>=4 AND instr(?,lower(name))>0 AND COALESCE(json_extract(payload,'$.active'),1)<>0 LIMIT 30",text);
 const newAssets=matches.map(r=>({...JSON.parse(r.payload),id:r.id})).filter(a=>!existing.some(x=>x.id===a.id)&&run.classification.assetKinds.includes(a.kind)).slice(0,3),additional=[];
 for(const a of newAssets){checkpoint();if(a.kind==='CRYPTO')continue;try{const s=await env.CATALYST_TOOLS.business(a);if(s?.body){const saved=await store.addSource({...s,excerpt:selectExcerpt(s.body,run.query)});additional.push(saved);await indexBusiness(store,saved);await store.putFact(a.id,'business',{source:saved},[saved.id],config.ttl.business);}}catch{}}
 return {assets:[...existing,...newAssets].slice(0,run.asset?.kind==='CRYPTO'?config.cryptoCandidates:config.stockCandidates),sources:additional,attempted:newAssets.length};
}
export async function contextFingerprint(store,run,assets){return hash([config.version,config.promptVersion,config.stockScoreVersion,config.cryptoScoreVersion,run.query,run.asset?.id,run.deep,run.sourceUrls?.join('|'),...await Promise.all(assets.map(a=>sourceRevision(store,a)))].join('|'));}
