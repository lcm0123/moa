import {publicationAuthority} from '../server/catalyst/evidence-policy.mjs';
import {secProviderHealth} from '../server/catalyst/provider-health.mjs';
import {controlledContext,controlledDocumentScope,controlledDocumentAvailable} from './catalyst-controlled-context.mjs';
import {TavilyExtractAdapter} from '../server/catalyst/research-providers.mjs';
import {validateExtractURL} from './catalyst-controlled-api.mjs';
import {officialSecFallback} from './catalyst-sec-fallback.mjs';
import fs from 'node:fs/promises';
import securityPolicy from '../config/catalyst-security.json' with {type:'json'};
import {withSecurity} from './catalyst-security-ledger.mjs';
import {publicationTime} from './observation-reader.mjs';
import {decodeDocumentEntities,finvizPage} from './catalyst-tools.mjs';
import {request as dartRequest} from '../server/us-kr-evidence.mjs';
import {safeUrl,hash} from '../server/catalyst/core.mjs';
import {researchConfig as rc} from '../server/catalyst/research-config.mjs';
import {rows} from '../server/catalyst/store.mjs';
import {indexDocument,retrieveSections,dartDocumentFile,memoryGuard,streamResearchDocument} from './catalyst-targeted-retrieval.mjs';
import {registerOfficialDomain,registerOrganization,officialDomains,explicitOfficialLinks} from '../server/catalyst/official-domain-registry.mjs';
import {annualMetadata} from './competitor-sources.mjs';
import {sourceAuthority} from '../server/catalyst/claim-validation.mjs';
import {dartOperationalTables} from '../server/catalyst/dart-event-assertions.mjs';
import irDocuments from '../config/competitor-ir-sources.json' with {type:'json'};
import {issuerDocumentAuthority} from '../server/catalyst/authority.mjs';
import {resolveSourceAuthority} from '../server/catalyst/source-authority.mjs';
import {revenueGrid} from '../server/catalyst/company-research-profile.mjs';

// Yield existing documents before making any official/news network request.
// This preparation never resolves or adds discovery candidates.
export async function* priorResearchSources(store,base,{assets,query}){
 const selected=assets.slice(0,3),fresh=new Set();
 for(const asset of selected){
  const saved=await rows(store.db,"SELECT body,json_remove(payload,'$.tables','$.operationalTables') payload FROM catalyst_sources WHERE asset_id=? ORDER BY observed_at DESC LIMIT 3",asset.id);
  for(const row of saved){const source={...JSON.parse(row.payload),body:row.body};if(!source.body||store.sourceReady&&!store.sourceReady(source))continue;
   if(source.authority?.verified&&['business','official','regulatory'].includes(source.sourceType)&&Date.now()-Date.parse(source.observedAt)<rc.ttls.candidate)fresh.add(asset.id);
   yield {tier:'DB_CACHE',asset,source};
  }
 }
 for(const asset of selected){
  if(fresh.has(asset.id)||asset.kind==='CRYPTO'||!base.business)continue;
  try{const source=await base.business(asset);if(source?.body&&source.assetId===asset.id)yield {tier:'OFFICIAL_DOCUMENT',asset,source};}
  catch{yield {tier:'OFFICIAL_DOCUMENT',asset,status:'unavailable'};}
 }
 if(!base.news)return;
 const key='research:news:security-1.4:'+await hash(query),cached=await store.cache(key);let news=cached&&!cached.stale?cached.value:null;
 if(!news){try{news=await base.news(selected.length===1?selected[0]:null,query,{allowBroad:false});await store.putCache(key,news,rc.ttls.search);}
  catch{yield {tier:'EXISTING_NEWS',status:'unavailable'};return;}}
 for(const item of (news.items||[]).slice(0,1))yield {tier:'EXISTING_NEWS',item};
}

export async function researchBytes(url,env={}){
 const r=await streamResearchDocument(url,env);return {...r,contentType:r.pdf?'application/pdf':'text/html',bytes:await fs.readFile(r.file)};
}
export function researchHtml(html,{fragment=false}={}){
 const main=fragment?html:/<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1]||/<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1]||html;
 const body=decodeDocumentEntities(main.replace(/<(script|style|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<\/(?:p|div|li|tr|h[1-6])>/gi,'\n').replace(/<[^>]+>/g,' ')).split('\n').map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n');
 const dateOnly=/(?:"datePublished"\s*:\s*"|<meta\b[^>]*(?:property|name)=["'](?:article:published_time|datePublished|pubdate)["'][^>]*content=["'])(\d{4}-\d\d-\d\d)["']/i.exec(html)?.[1];
 const publishedAt=publicationTime(html)||dateOnly||null;
 return {body:body.slice(0,rc.maxDocumentCharacters),publishedAt,publicationPrecision:publishedAt?.includes('T')?'instant':publishedAt?'date':'unknown',truncated:body.length>rc.maxDocumentCharacters};
}
export function decodeResearchHtml(bytes,contentType=''){
 const header=bytes.subarray(0,4096).toString('latin1'),charset=/charset\s*=\s*["']?([a-z\d_-]+)/i.exec(contentType)?.[1]||/<meta[^>]+charset\s*=\s*["']?([a-z\d_-]+)/i.exec(header)?.[1]||'utf-8';
 try{return new TextDecoder(charset).decode(bytes);}catch{return new TextDecoder('utf-8').decode(bytes);}
}
export function sameOfficialHost(url,root){try{const host=new URL(url).hostname,r=new URL(root).hostname.replace(/^www\./,'');return host===r||host.endsWith('.'+r);}catch{return false;}}
export function finvizCompanyWebsite(html){
 const heading=/<h2\b[^>]*class=["'][^"']*quote-header_ticker-wrapper_company[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i.exec(html)?.[1]||'';
 const href=/<a\b[^>]*href=["'](https?:\/\/[^"']+)["']/i.exec(heading)?.[1];
 const url=href?safeUrl(decodeDocumentEntities(href).replace(/^http:/,'https:')):null;
 return url?new URL(url).origin:null;
}
export function dartPeriodicParams(asset,now=Date.now()){
 const date=time=>new Date(time).toISOString().slice(0,10).replaceAll('-','');
 return {corp_code:asset.issuerId,bgn_de:date(now-550*86400000),end_de:date(now),pblntf_ty:'A',last_reprt_at:'Y',page_count:'20',sort:'date',sort_mth:'desc'};
}
export function createResearchTools(env,store,base){
 store.securityVersion=securityPolicy.version;
 store.sourceAllowed=url=>{try{withSecurity(env,l=>l.assertAllowed(url));return true;}catch{return false;}};
 store.sourceReady=source=>source.securityVersion===securityPolicy.version&&store.sourceAllowed(source.url)&&(!controlledContext()||!!(source.documentId&&source.documentHash));
 const sections=async(asset,filing,purpose)=>{
  const url='https://dart.fss.or.kr/dsaf001/main.do?rcpNo='+filing.rcept_no,date=filing.rcept_dt.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
  const meta={assetId:asset.id,url,publishedAt:date,title:filing.report_nm,documentType:/사업|분기|반기/.test(filing.report_nm)?'PERIODIC':/계약/.test(filing.report_nm)?'CONTRACT':'CAPEX'};
  const cachedDoc=await cachedBeneficiaryDocument(store,env,{asset,filing,url});
  const file=cachedDoc?.local_path||await dartDocumentFile(env,filing.rcept_no,{issuer:filing.corp_name||asset.name,title:filing.report_nm}),doc=cachedDoc||await indexDocument(store,file,meta,env);
  let result;
  if(['BENEFICIARY_BUSINESS','BENEFICIARY_MATERIALITY'].includes(purpose)){
   const picked=await beneficiaryFilingSections(store,doc.id,purpose);
   result={sections:picked,bytesRead:picked.reduce((n,s)=>n+Buffer.byteLength(s.html),0)};
  }else result=await retrieveSections(store,doc.id,purpose);
  // Subsidiary identity is often in a separate table. Keep the original table
  // and its locator, never substitute the parent company's identity.
  const identity=/종속회사/.test(filing.report_nm)?await rows(store.db,"SELECT html,locator FROM catalyst_filing_sections WHERE document_id=? AND truncated=0 AND (html LIKE '%종속회사명%' OR html LIKE '%종속회사인%') AND LENGTH(html)<12000 LIMIT 2",doc.id):[];
  for(const s of result.sections)if(identity.length)s.html=identity.filter(x=>x.locator!==s.locator).map(x=>x.html).join('\n')+'\n'+s.html;
  return result.sections.map(s=>({...researchHtml(s.html),securityVersion:securityPolicy.version,url,title:filing.report_nm,assetId:asset.id,sourceType:'regulatory',publisher:'OpenDART',publishedAt:date,observedAt:new Date().toISOString(),originRef:filing.rcept_no,documentId:doc.id,documentHash:doc.document_hash,sectionKind:s.kind,heading:s.heading,sectionHtml:s.html,sectionTruncated:!!s.truncated,operationalTables:dartOperationalTables(s.html,{heading:s.heading}),locator:url+'#'+s.locator,retrieval:{bytesRead:result.bytesRead,documentBytes:doc.byte_size,sections:result.sections.length,indexCached:doc.cached}}));
 };
 return {
  profileSections:sections,
  promotionEnabled:true,
  // Reuse discovery metadata, never its snippets as event evidence. Bounded DB
  // scan precedes paid search and de-duplicates canonical URLs across providers.
  async cachedEventCandidates({secondary=false}={}){
   const saved=await rows(store.db,"SELECT payload FROM catalyst_cache WHERE cache_key LIKE 'research:router:%' ORDER BY created_at DESC LIMIT 40");
   return [...new Map(saved.flatMap(r=>JSON.parse(r.payload).items||[]).filter(i=>(i.purpose==='OFFICIAL_SOURCE_DISCOVERY'&&/newsroom|\/ir-news|\/investor|\/press-release/.test(i.url)||secondary&&publicationAuthority(i.url))).map(i=>[i.canonicalUrl||i.url,{...i,cacheReuse:true}])).values()];
  },
  async verifyCachedRoot(asset){
   const cached=await store.cache('research:roots:'+asset.id),v=cached?.value;
   if(!cached||cached.stale||v.assetId!==asset.id||!safeUrl(v.verificationSource))return {status:'NO_CACHED_IDENTITY_PROOF'};
   const root=v.roots[0];
   await registerOrganization(store,{organization_id:asset.id,organization_name:asset.name,canonical_domain:root,asset_id:asset.id},{method:'CORPORATE_METADATA',url:v.verificationSource,checkedAt:cached.at,identityVerified:true});
   // Only a secure redirect starting from the independently verified homepage
   // can establish a new corporate domain. A search URL is not a proof.
   try{
    const r=await controlledDocumentScope('event',asset.id,()=>streamResearchDocument(root,env));
    if(r.redirectChain.length>1){
     await registerOfficialDomain(store,asset,r.url,{type:'VERIFIED_REDIRECT',proofUrl:root,hash:r.sanitized_hash,trusted:true});
     return {status:'VERIFIED_REDIRECT',root,finalUrl:r.url,redirectChain:r.redirectChain};
    }
    return {status:'ROOT_VERIFIED',root};
   }catch(e){return {status:'ROOT_PROBE_FAILED',code:/^[A-Z_0-9]+$/.test(e.message)?e.message:'FETCH_FAILED',root};}
  },
  authority:input=>resolveSourceAuthority({...input,store}),
  stageAvailable:(stage,assetId)=>controlledDocumentAvailable(stage==='technicalGap'?'technical':stage==='discovery'?'probe':stage,assetId),
  withStage:(stage,assetId,run)=>controlledDocumentScope(stage,assetId,run),
  async extractFallback(item,reason){
   if(!['HTTP_403','unreadable_body','STATIC_PARSE_FAILED'].includes(reason))return {status:'EXTRACT_NOT_ELIGIBLE'};
   try{const key='research:extract-untrusted:10.9:'+await hash(item.url),cached=await store.cache(key);if(cached&&!cached.stale)return {status:'UNTRUSTED_EXTRACT_CACHED',count:cached.value.sections.length};
    const adapter=new TavilyExtractAdapter(env,fetch,{validateURL:url=>validateExtractURL(url,env)}),result=await adapter.extract({urls:[item.url],maxCharacters:12000});
    if(result.sections?.length)await store.putCache(key,{sections:result.sections,trust:'UNTRUSTED_SOURCE'},rc.ttls.search);
    return {status:result.sections?.length?'UNTRUSTED_EXTRACT_STORED':result.status||'EXTRACT_EMPTY',count:result.sections?.length||0};
   }catch{return {status:'EXTRACT_SECURITY_OR_PROVIDER_BLOCKED'};}
  },
  priorSources:input=>priorResearchSources(store,{...base,business:null},input),
  async businessSources(asset,purpose='PRODUCT_RELATION'){
   if(asset.kind==='US_STOCK'){
    const docs=await rows(store.db,"SELECT body,payload FROM catalyst_sources WHERE asset_id=? AND source_type IN ('business','regulatory','official') ORDER BY published_at DESC LIMIT 8",asset.id);
    const known=docs.map(row=>({...JSON.parse(row.payload),body:row.body}));
    // Existing verified SEC evidence first; do not refetch old unsafe raw cache.
    const cached=await officialSecFallback({asset,cache:known.filter(d=>/(^|\.)sec.gov$/.test(new URL(d.url).hostname)),ready:store.sourceReady,authority:s=>s.assetId===asset.id&&!!sourceAuthority(s,asset),read:async()=>({status:'read_failed'})});
    if(cached.sources.length)return cached.sources;
    try{const filing=await annualMetadata(env,asset.symbol,String(asset.issuerId).padStart(10,'0')),source=await this.read({url:filing.url,title:filing.form},{asset,roots:await this.roots(asset),purpose,filingDate:filing.sourceDate});if(source.status==='read'&&source.assetId===asset.id)return [source];}catch{}
    const roots=await this.roots(asset);
    const eligible=known.filter(s=>sourceAuthority(s,asset)&&!/(^|\.)sec.gov$/.test(new URL(s.url).hostname));
    const fallback=await officialSecFallback({asset,ready:store.sourceReady,authority:s=>s.assetId===asset.id&&!!sourceAuthority(s,asset),
     ir:eligible.filter(s=>!/10-K|20-F|40-F/.test(s.title||'')),
     annual:irDocuments.filter(d=>Number(d.cik)===Number(asset.issuerId)).map(d=>({url:d.url,title:'10-K'})),
     other:eligible.filter(s=>/10-K|20-F|40-F/.test(s.title||'')),
     read:item=>this.read(item,{asset,roots,purpose,filingDate:item.publishedAt||null})});
    const providerHealth=secProviderHealth({asset,fallback:fallback.sources});
    await store.putCache('provider-health:SEC:'+asset.id,providerHealth,900000);
    return fallback.sources.map(source=>({...source,providerHealth,evidenceCoverage:providerHealth.evidenceCoverage}));
   }
   if(asset.kind!=='KR_STOCK')return [];
   const key='research:filing-list:'+asset.id,old=await store.cache(key);let filing=old&&!old.stale?old.value:null;
   if(!filing){const d=await dartRequest({...env,DART_API_KEY:env.OPENDART_API_KEY||env.DART_API_KEY},'list.json',dartPeriodicParams(asset));filing=d.list?.find(f=>f.corp_code===asset.issuerId&&f.stock_code===asset.symbol&&/사업보고서|반기보고서|분기보고서/.test(f.report_nm));if(filing)await store.putCache(key,filing,21600000);}
   return filing?sections(asset,filing,purpose):[];
  },
  async events(asset){
   const key='research:official-events:sections-2:'+asset.id,cached=await store.cache(key);if(cached&&!cached.stale){const sources=[];for(const ref of cached.value.sources){const r=(await rows(store.db,"SELECT body,json_remove(payload,'$.tables','$.operationalTables') payload FROM catalyst_sources WHERE id=?",ref.id))[0];if(r){const s={...JSON.parse(r.payload),body:r.body};if(store.sourceReady(s))sources.push(s);}}if(sources.length)return {sources,failures:cached.value.failures};}
   const sources=[],failures=[];
   if(asset.kind==='KR_STOCK'){
    const dartEnv={...env,DART_API_KEY:env.OPENDART_API_KEY||env.DART_API_KEY},end=new Date(),start=new Date(end.getTime()-rc.eventMaxDays*86400000),date=d=>d.toISOString().slice(0,10).replaceAll('-','');
    try{
     const listing=await dartRequest(dartEnv,'list.json',{corp_code:asset.issuerId,bgn_de:date(start),end_de:date(end),page_count:'100',sort:'date',sort_mth:'desc',last_reprt_at:'Y'});
     const filings=(listing.list||[]).filter(f=>f.corp_code===asset.issuerId&&f.stock_code===asset.symbol&&/신규시설투자|유형자산.*취득|단일판매.*공급계약|투자판단.*주요경영/.test(f.report_nm)).slice(0,2);
     for(const f of filings)try{
      sources.push(...await sections(asset,f,/계약/.test(f.report_nm)?'ORDER':'CAPACITY_EXPANSION'));
     }catch{failures.push({receipt:f.rcept_no,status:'OFFICIAL_EVENT_BODY_UNAVAILABLE'});}
    }catch{failures.push({status:'OFFICIAL_EVENT_LIST_UNAVAILABLE'});}
   }else if(asset.kind==='US_STOCK'){
    const docs=await rows(store.db,'SELECT d.id,d.source_url,f.accepted_at,f.filed_date,d.form FROM sec_documents d JOIN sec_filings f ON f.accession=d.accession JOIN sec_filing_issuers i ON i.accession=d.accession WHERE CAST(i.cik AS INTEGER)=? ORDER BY f.filed_date DESC LIMIT 2',Number(asset.issuerId));
    // Existing SEC metadata discovers a URL; legacy chunks cannot be stamped as
    // security-validated content. Reuse/refetch only through the secure reader.
    for(const d of docs){const source=await this.read({url:d.source_url,title:d.form},{asset,roots:await this.roots(asset),purpose:'CAPACITY_EXPANSION',filingDate:d.accepted_at||d.filed_date});if(source.status==='read')sources.push(source);}
    if(!sources.length)failures.push({status:'SEC_EVENT_BODY_NOT_STORED'});
   }
   const saved=[];for(const s of sources)saved.push(await store.addSource(s));const value={sources:saved,failures};await store.putCache(key,{sources:saved.map(s=>({id:s.id})),failures},rc.ttls.event);return value;
  },
  async roots(asset){
   const key='research:roots:'+asset.id,cache=await store.cache(key),registered=await officialDomains(store,asset);if(cache&&!cache.stale)return {...cache.value,roots:[...new Set([...cache.value.roots,...registered.map(r=>r.domain)])]};
   let roots=[],verificationSource=null;
   try{
    if(asset.kind==='KR_STOCK'){
     // Reuse the site's structured OpenDART company cache before network calls.
     // Company/ticker equality is required; cache text is not business evidence.
     let d=null;
     try{const cached=(await rows(store.db,'SELECT payload,updated_at FROM research_cache WHERE cache_key=?','dart:company:'+asset.issuerId))[0];if(cached&&Date.now()-Date.parse(cached.updated_at)<30*86400000){const value=JSON.parse(cached.payload);if(value.corp_code===asset.issuerId&&value.stock_code===asset.symbol)d=value;}}catch{}
     d||=await dartRequest({...env,DART_API_KEY:env.OPENDART_API_KEY||env.DART_API_KEY},'company.json',{corp_code:asset.issuerId});
     if(d.stock_code===asset.symbol&&d.corp_code===asset.issuerId){const raw=d.hm_url?.trim();const url=raw?.startsWith('http:')?raw.replace(/^http:/,'https:'):raw?.startsWith('https:')?raw:raw?'https://'+raw:null;roots=[safeUrl(url)].filter(Boolean);verificationSource='https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019010';}
    }else if(asset.kind==='US_STOCK'){
     const html=await finvizPage(env,asset.symbol),root=finvizCompanyWebsite(html);
     roots=root?[root]:[];verificationSource='https://finviz.com/quote.ashx?t='+encodeURIComponent(asset.symbol);
    }else{const d=await base.cryptoMetadata(asset);roots=d?.homepages||[];verificationSource=d?.source;}
   }catch{}
   for(const url of roots)await registerOfficialDomain(store,asset,url,{type:'ISSUER_REGISTRY',proofUrl:verificationSource,trusted:true});
   roots=[...new Set([...roots,...registered.map(r=>r.domain)])];const value={roots,verificationSource,assetId:asset.id};if(roots.length)await store.putCache(key,value,rc.ttls.candidate);return value;
  },
  async read(item,{asset=null,roots=null,purpose='PRODUCT_RELATION',filingDate=null}={}){
   try{
    // Google RSS is only a URL discovery feed; reuse its original-article resolver.
    withSecurity(env,l=>l.assertAllowed(item.url));
    if(/\.pdf(?:$|\?)/i.test(item.url)&&!memoryGuard(env,{pdf:true}).allowed)throw Error('memory_deferred');
    const r=await streamResearchDocument(item.url,env),meta={assetId:asset?.id||'UNBOUND',url:r.url,pdf:r.pdf,title:item.title||'',publishedAt:filingDate,documentType:filingDate&&/10-K|10-Q|20-F|40-F/.test(item.title)?'PERIODIC':r.pdf?'PDF':'HTML'};
    const doc=await indexDocument(store,r.file,meta,env);let selected=await retrieveSections(store,doc.id,purpose,{maxBytes:60000,maxSections:8});
    // Short articles often have no filing headings. This is a bounded section
    // fallback, never an unbounded full-report parse.
    if(!selected.sections.length&&doc.byte_size<rc.maxReadBytes)selected=await retrieveSections(store,doc.id,'PRODUCT_RELATION',{maxBytes:60000,maxSections:8});
    // Corporate technical pages are not statutory filings. Their substantive
    // paragraphs often have OTHER headings; reuse bounded sanitized sections.
    if(meta.documentType==='HTML'&&(purpose==='PRODUCT_RELATION'||researchHtml(selected.sections.map(s=>s.html).join('\n')).body.length<100))selected=await retrieveSections(store,doc.id,'STATIC_ARTICLE',{maxBytes:60000,maxSections:8});
    const html=selected.sections.map(s=>s.html).join('\n'),parsed=researchHtml(html,{fragment:true});
    if(!parsed.publishedAt){const head=await rows(store.db,'SELECT html FROM catalyst_filing_sections WHERE document_id=? AND LENGTH(html)<=60000 ORDER BY ordinal LIMIT 2',doc.id);parsed.publishedAt=head.map(s=>researchHtml(s.html,{fragment:true}).publishedAt).find(Boolean)||null;}
    parsed.truncated=selected.truncated;parsed.locator=selected.sections.map(s=>s.locator).join(',');
    if(parsed.body.length<100||/^(access denied|just a moment|please enable javascript)/i.test(parsed.body))throw Error('unreadable_body');
    const direct=asset&&roots?.assetId===asset.id&&roots.roots.some(root=>sameOfficialHost(r.url,root));
    const redirected=asset&&roots?.assetId===asset.id&&r.redirectChain.length>1&&roots.roots.some(root=>sameOfficialHost(r.redirectChain[0],root));
    const secBound=asset?.kind==='US_STOCK'&&new URL(r.url).hostname==='www.sec.gov'&&new URL(r.url).pathname.startsWith('/Archives/edgar/data/'+Number(asset.issuerId)+'/');
    const registered=asset?.kind==='US_STOCK'&&irDocuments.find(d=>d.url===r.url&&Number(d.cik)===Number(asset.issuerId));let irProof=null;
    if(registered){const cover=(await rows(store.db,'SELECT html FROM catalyst_filing_sections WHERE document_id=? ORDER BY ordinal LIMIT 2',doc.id)).map(s=>researchHtml(s.html).body).join('\n');if(cover.includes(registered.name)&&cover.includes(registered.ticker)&&cover.includes(registered.coverDate)&&/FORM\s+10-K/.test(cover))irProof=issuerDocumentAuthority({identityVerified:true,documentHash:doc.document_hash,sourceUrl:r.url},asset);}
    const resolvedAuthority=await resolveSourceAuthority({url:r.url,expectedAsset:asset,store});
    const official=direct||redirected||secBound||!!irProof;
    if(redirected)await registerOfficialDomain(store,asset,r.url,{type:'VERIFIED_REDIRECT',proofUrl:r.redirectChain[0],hash:doc.document_hash,trusted:true});
    if(official)for(const link of explicitOfficialLinks(html,r.url))await registerOfficialDomain(store,asset,link.url,{type:link.type,proofUrl:r.url,hash:doc.document_hash,trusted:true});
    return {...parsed,sectionHtml:html,resolvedAuthority,sectionId:selected.sections.map(s=>s.id||s.locator).join(','),sectionTruncated:selected.sections.some(s=>s.truncated),securityVersion:securityPolicy.version,rawHash:r.content_sha256,sanitizedHash:r.sanitized_hash,publishedAt:filingDate||parsed.publishedAt,url:r.url,title:item.title||'',body:parsed.body,assetId:official?asset.id:resolvedAuthority.assetId||null,sourceType:secBound?'regulatory':official||resolvedAuthority.ownershipVerified?'official':'news',documentId:doc.id,documentHash:doc.document_hash,filingIdentity:irProof&&registered?{verified:true,cik:registered.cik,ticker:registered.ticker,documentPeriod:registered.reportDate}:null,sectionKind:selected.sections[0]?.kind,documentBasis:(official||resolvedAuthority.ownershipVerified)&&!irProof&&!filingDate&&!parsed.publishedAt?'CURRENT_OFFICIAL_DOCUMENT':null,publisher:resolvedAuthority.organizationName||new URL(r.url).hostname,observedAt:new Date().toISOString(),contentHash:await hash(parsed.body),authority:irProof|| (official?{kind:'official_domain',assetId:asset.id,verified:true,verificationSource:secBound?r.url:redirected?r.redirectChain[0]:roots.verificationSource,publisherId:asset.id,documentHash:doc.document_hash,documentUrl:r.url}:null),status:'read',retrieval:{documentBytes:doc.byte_size,bytesRead:selected.bytesRead,sections:selected.sections.length,indexCached:doc.cached,parserStats:doc.parserStats}};
   }catch(e){return {url:safeUrl(item.url),status:'read_failed',code:/^[a-zA-Z_\d]+$/.test(e.message)?e.message:'connection_failed'};}
  }
 };
}
export async function beneficiaryFilingSections(store,documentId,purpose='BENEFICIARY_BUSINESS'){
 if(purpose==='BENEFICIARY_MATERIALITY'){
  const sections=await rows(store.db,"SELECT ordinal,kind,heading,html,locator,truncated FROM catalyst_filing_sections WHERE document_id=? AND kind IN ('BUSINESS','PRODUCTS','SEGMENTS','ORDERS') AND issuer_scope='ISSUER_BUSINESS' AND truncated=0 AND LENGTH(html)<24000 ORDER BY ordinal LIMIT 120",documentId);
  const dataTable=s=>[...s.html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].some(m=>{const grid=revenueGrid(m[0]);return grid.length>=2&&grid.slice(0,2).flat().some(x=>x.length<80&&/매출|수주|revenue|sales|품\s*목|사업부문/i.test(x))&&grid.slice(1).some(r=>r.some(x=>/^[△▲−+-]?[\d,]+(?:\.\d+)?\s*(?:%|\(\s*\d+(?:\.\d+)?\s*%\s*\))?$/.test(x)));});
  return sections.filter(dataTable).map(s=>({...s,html:sections.filter(p=>p.ordinal>=s.ordinal-2&&p.ordinal<=s.ordinal+1&&p.heading===s.heading&&(p.ordinal===s.ordinal||p.html.length<1600&&(!dataTable(p)||/단위|재무제표|재무정보/.test(p.html)))).map(p=>p.html).join('\n')})).filter(s=>/매출|수주|revenue|sales/i.test(s.html+' '+s.heading)).slice(0,8);
 }

 return rows(store.db,"SELECT kind,heading,html,locator,truncated FROM catalyst_filing_sections WHERE document_id=? AND kind IN ('BUSINESS','PRODUCTS','SEGMENTS','ORDERS') AND issuer_scope='ISSUER_BUSINESS' AND truncated=0 AND LENGTH(html) BETWEEN 200 AND 22000 ORDER BY CASE WHEN instr(html,'당사')>0 THEN 0 ELSE 1 END, CASE kind WHEN 'BUSINESS' THEN 0 WHEN 'SEGMENTS' THEN 1 WHEN 'PRODUCTS' THEN 2 ELSE 3 END,ordinal LIMIT 16",documentId);
}
export async function cachedBeneficiaryDocument(store,env,{asset,filing,url}){
 // Reading an existing small section index does not require archive parsing.
 // Reuse only the unchanged file certified by the current security ledger.
 const api=new URL('https://opendart.fss.or.kr/api/document.xml');api.search=new URLSearchParams({crtfc_key:env.OPENDART_API_KEY||env.DART_API_KEY||'',rcept_no:filing.rcept_no});
 let proof=null;
 withSecurity(env,l=>{l.assertAllowed(api.href);const saved=l.get(api.href);if(saved?.security_status==='SANITIZED'){const m=JSON.parse(saved.metadata);if(m.securityVersion===securityPolicy.version&&m.safe_path&&m.content_sha256&&Date.now()-Date.parse(m.fetch_time)<securityPolicy.safeCacheHours*3600000){l.assertAllowed(api.href,m.content_sha256);proof=m;}}});
 if(!proof)return null;
 const doc=(await rows(store.db,"SELECT * FROM catalyst_filing_documents WHERE issuer_id=? AND url=? AND local_path=? AND parser_version='sections-security-1' AND last_indexed_at<>'INDEXING' LIMIT 1",asset.id,url,proof.safe_path))[0];
 if(!doc)return null;
 try{const stat=await fs.stat(doc.local_path);return stat.size===doc.byte_size&&stat.mtimeMs===doc.file_mtime_ms?{...doc,cached:true}:null;}catch{return null;}
}
