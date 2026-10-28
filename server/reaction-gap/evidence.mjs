// Read-only bridge from the existing private news/idea result and evidence ledger.
// No discovery, price lookup, source retrieval, AI, or master writes occur here.
import {CatalystStore,one,rows} from '../catalyst/store.mjs';
import {hash} from '../catalyst/core.mjs';
import {canonicalIdentity} from '../catalyst/identity.mjs';
import {normalize,safeLink,evidence,specific} from '../news-companies-model.mjs';
import {validateIdeaClaim} from '../idea-companies-model.mjs';
import {profileVersion} from '../news-inline-publication.mjs';
import {timestamp,validDate,unique,publicationTimeReasons} from './input.mjs';

export const evidenceAdapterVersion='reaction-gap-evidence-2';
const parse=value=>{try{return typeof value==='string'?JSON.parse(value):value;}catch{return null;}};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const stable=value=>JSON.stringify(value,(_key,v)=>object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const digest=value=>hash(stable(value));
const text=value=>typeof value==='string'&&value.length>0&&value.length<=300;
const sourceValue=row=>row?{...parse(row.payload),id:row.id,assetId:row.asset_id,url:row.url,body:row.body,
 sourceType:row.source_type,publishedAt:row.published_at,observedAt:row.observed_at,contentHash:row.content_hash,locator:row.locator}:null;
const revoked=s=>!!(s?.withdrawn||s?.revoked||s?.superseded||['WITHDRAWN','REVOKED','CANCELLED','REFUTED','SUPERSEDED'].includes(s?.status));

function requestCheck(request){
 if(!object(request)||!text(request.owner)||!text(request.sourceJobId)||!Number.isSafeInteger(request.sourceVersion)||request.sourceVersion<1
  ||!timestamp(request.asOf)||!timestamp(request.frozenAt)||Date.parse(request.frozenAt)>Date.parse(request.asOf)
  ||request.knowledgeCutoff!==undefined&&(!timestamp(request.knowledgeCutoff)||Date.parse(request.knowledgeCutoff)>Date.parse(request.asOf))
  ||!['RETROSPECTIVE','AS_KNOWN'].includes(request.informationMode||'RETROSPECTIVE')
  ||!['EVENT','DATE_REFERENCE','FIXED_WINDOW'].includes(request.window?.mode)
  ||request.window?.mode==='FIXED_WINDOW'&&!validDate(request.window.endDate))throw Error('INVALID_EVIDENCE_REQUEST');
}

/** Load once BEFORE market-data reads. User-provided event/candidate fields are ignored. */
export async function loadStoredEvidence(db,request,{sourceAllowed=async()=>false}={}){
 requestCheck(request);
 const {owner,sourceJobId,sourceVersion,asOf,frozenAt}=request,informationMode=request.informationMode||'RETROSPECTIVE';
 const job=await one(db,'SELECT * FROM news_company_jobs WHERE id=? AND owner=?',sourceJobId,owner);
 if(!job)throw Error('NOT_FOUND');
 if(job.version!==sourceVersion)throw Error('SOURCE_VERSION_CONFLICT');
 if(!['COMPLETE','PARTIAL'].includes(job.status)||!job.result)throw Error('SOURCE_NOT_COMPLETE');
 const result=parse(job.result),input=parse(job.input);
 if(!object(result)||!object(input))throw Error('SOURCE_SCHEMA_INVALID');
 if(['invalidated','cancelled','unavailable'].includes(result.inline?.status))throw Error('SOURCE_EVIDENCE_INVALID');
 const idea=input.inputType==='IDEA',event=result.event||null;
 if(idea&&request.window.mode!=='FIXED_WINDOW'&&!event?.evidence)throw Error('IDEA_EVENT_UNVERIFIED');
 const resultHash=await digest(result),dependencies=[],holds=[],cache=new Map(),permissions=new Map(),store=new CatalystStore(db);
 const dep=async(kind,key,value)=>{const d={kind,key,version:await digest(value)};dependencies.push(d);return d;};
 await dep('news_job',job.id,{owner:job.owner,version:job.version,status:job.status,input:job.input,result:job.result});
 async function source(id){
  if(cache.has(id))return cache.get(id);
  const stored=await one(db,'SELECT * FROM catalyst_sources WHERE id=?',id),embedded=(result.sources||[]).find(s=>s.id===id);
  // News readers retain sanitized document snapshots in the existing job even
  // when a document has no shared source row. Its source/security identity is
  // still checked; a URL-only or title-only result cannot satisfy proof().
  const value=stored?sourceValue(stored):embedded?{...embedded}:null;
  await dep('source',id,{storage:stored?'ledger':'job_snapshot',value});
  cache.set(id,value);return value;
 }
 async function proof(ref,assetId=null){
  const reasons=[];
  if(!ref?.sourceId)return {ok:false,reasons:['EVIDENCE_MISSING'],source:null,ref:null};
  const s=await source(ref.sourceId);
  if(!s)return {ok:false,reasons:['SOURCE_MISSING'],source:null,ref:null};
  if(revoked(s))reasons.push('EVIDENCE_REVOKED');
  if(!safeLink(s.url)||s.userProvided||ref.userProvided||s.securityVersion!=='security-1'||!s.documentHash)reasons.push('SOURCE_UNVERIFIED');
  if(s.contentHash&&await hash(String(s.body||''))!==s.contentHash)reasons.push('SOURCE_BODY_HASH_MISMATCH');
  try{const allowed=await sourceAllowed(s)===true;permissions.set(s.id,{id:s.id,url:s.url,documentHash:s.documentHash||null,allowed});if(!allowed)reasons.push('SOURCE_NOT_ALLOWED');}
  catch{permissions.set(s.id,{id:s.id,url:s.url,documentHash:s.documentHash||null,allowed:false});reasons.push('SOURCE_PERMISSION_CHECK_FAILED');}
  // Never accept a source revision different from the job's evidence version.
  const old=(result.sources||[]).find(x=>x.id===s.id);
  if(old?.documentHash&&old.documentHash!==s.documentHash)reasons.push('SOURCE_REVISION_CHANGED');
  let checked=null;
  try{checked=evidence(ref,[{...s,access:s.access||'READ'}],{assetId});}catch(e){reasons.push(e.message);}
  const published=s.publishedAt,observed=s.firstObservedAt||s.observedAt||s.retrievedAt;
  reasons.push(...publicationTimeReasons({publishedAt:timestamp(published)?published:null,publishedDate:validDate(published)?published:null},informationMode==='AS_KNOWN'?request.knowledgeCutoff||frozenAt:asOf));
  if(informationMode==='AS_KNOWN'&&(!timestamp(observed)||Date.parse(observed)>Date.parse(request.knowledgeCutoff||frozenAt)))reasons.push('EVIDENCE_AFTER_CUTOFF');
  return {ok:!reasons.length,reasons:unique(reasons),source:s,ref:checked};
 }
 const eventProof=event?.evidence?await proof(event.evidence):null;
 const eventId=result.context?.eventKey||result.inline?.eventAnchor||'news-job:'+job.id;
 const eventVersion=await digest({event,source:eventProof?.source?.documentHash||null,resultVersion:sourceVersion});
 const disclosed=eventProof?.source?.publishedAt;
 // An AI-extracted time does not upgrade a source's date-only publication.
 const publishedAt=timestamp(disclosed)?disclosed:null;
 const publishedDate=validDate(disclosed)?disclosed:publishedAt?.slice(0,10)||null;
 const window=request.window.mode==='FIXED_WINDOW'?{mode:'FIXED_WINDOW',endDate:request.window.endDate}:{
  mode:publishedAt&&request.window.mode==='EVENT'?'EVENT':'DATE_REFERENCE',
  event:{id:eventId,version:eventVersion,publishedAt,publishedDate,precision:publishedAt?'timestamp':'date'},
 };
 const eventHolds=window.mode==='FIXED_WINDOW'?[]:[...(eventProof?.reasons||['EVENT_EVIDENCE_MISSING']),...(!publishedDate?['EVENT_DATE_UNVERIFIED']:[]),...(event?.corrective?['EVENT_REVOKED']:[])];
 const visible=Array.isArray(result.inline?.candidates)?[...result.inline.candidates,...(result.inline.conditional||[])]:[...(result.candidates||[]),...(result.pending||[])];
 if(visible.length>100)throw Error('CANDIDATE_LIMIT');
 const uniqueCandidates=[...new Map(visible.filter(c=>text(c.asset?.id)).map(c=>[c.asset.id,c])).values()];
 const candidates=[];
 for(const c of uniqueCandidates){
  const asset=await store.asset(c.asset.id),reasons=[...eventHolds];
  await dep('asset',c.asset.id,asset);
  await dep('profile',c.asset.id,await profileVersion(db,c.asset.id));
  if(!asset||asset.kind!=='KR_STOCK'||asset.identityStatus!=='verified'||!canonicalIdentity(asset).complete||asset.active!==true)reasons.push('IDENTITY_UNVERIFIED');
  const original=(result.rawCandidates||[]).find(x=>x.asset?.id===c.asset.id)||c;
  const links=original.links||c.links||[],paths=[];
  // Revalidate every preserved path; failure of the first path cannot erase a
  // later independently supported product path for this same issuer.
  for(const l of links.length?links:[{product:c.product,sourceTerm:c.business,evidence:c.businessEvidence,claim:c.claims?.[0]}]){
   if(!specific(l.product)||!specific(l.sourceTerm)){paths.push({ok:false,reasons:['PRODUCT_UNVERIFIED']});continue;}
   const p=await proof(l.evidence,c.asset.id);
   let claim=l.claim,observation=null;
   const claimId=claim?.claimId||claim?.id;
   if(claimId){
    const row=await one(db,'SELECT * FROM catalyst_claims WHERE id=?',claimId);
    await dep('claim',claimId,row);
    if(row){claim={...parse(row.payload),id:row.id,subject:row.subject_id,status:row.status,quote:row.quote,sourceIds:parse(row.source_ids)};
     const found=await rows(db,"SELECT * FROM company_metadata_facts WHERE json_extract(payload,'$.claimId')=? AND source_id=? ORDER BY id LIMIT 2",claimId,p.source?.id||'');
     if(found.length===1){observation={...parse(found[0].payload),verificationStatus:found[0].verification_status,lifecycleStatus:found[0].lifecycle_status};await dep('observation',found[0].id,found[0]);}}
    else p.reasons.push('CLAIM_MISSING');
   }
   // News links already contain an exact quote but may not have a claim row.
   // Use the existing deterministic business validator on that quote with an
   // UNVERIFIED provisional claim, never an invented VERIFIED ledger entry.
   const check=p.ok&&asset?validateIdeaClaim({asset,source:p.source,claim:claimId?claim:{id:'stored-news-link:'+p.source.id,subject:asset.id,status:'UNVERIFIED',quote:p.ref.quote,sourceIds:[p.source.id],documentHash:p.source.documentHash},observation,
    product:{term:l.sourceTerm},input:{asOf,historical:informationMode==='AS_KNOWN',markets:['KR']},now:Date.parse(asOf)}):null;
   const pathReasons=[...p.reasons,...(check?.status==='SUPPORTED'&&['PRODUCT_SALES','SUPPLY','SERVICE_OPERATION'].includes(check.kind)?[]:[check?.reason||'BUSINESS_UNVERIFIED'])];
   if(original.counterEvidence?.some(r=>['REFUTES','CONFLICT'].includes(r.effect)&&(!r.product||r.product===l.product)))pathReasons.push('CONTRARY_EVIDENCE');
   paths.push({ok:!pathReasons.length,link:l,proof:p,check,reasons:unique(pathReasons)});
  }
  const selected=paths.find(p=>p.ok)||paths[0];
  if(!selected?.ok)reasons.push(...(selected?.reasons||['BUSINESS_UNVERIFIED']));
  const s=selected?.proof?.source,l=selected?.link;
  let supply=null;
  const supplyRef=original.projectSupply||c.supplyEvidence;
  if(supplyRef&&event?.actor&&event?.project){
   const p=await proof(supplyRef,c.asset.id),q=p.ref?.quote||'';
   if(p.ok&&[event.actor,event.project,asset?.name,l?.sourceTerm].every(v=>v&&normalize(q).includes(normalize(v)))&&/납품.{0,12}(?:완료|했습니다|하였)|delivered|completed delivery/i.test(q)&&!/계획|예정|미확인|will|expect|may|not confirmed/i.test(q))supply=p;
  }
  const sourceIds=[...new Set([s?.id,supply?.source?.id].filter(Boolean))];
  const relationship={eventId,eventVersion,product:l?.product||'UNKNOWN',role:l?.relationship==='INDIRECT'?'INDIRECT_PRODUCT_SELLER':l?'DIRECT_PRODUCT_SELLER':'UNKNOWN',
   stage:supply?'CONFIRMED_DELIVERY':'PRODUCT_SELLER',verified:!reasons.length,subjectIssuerId:asset?.issuerId||null,sourceIds,
   revoked:reasons.includes('EVIDENCE_REVOKED')||reasons.includes('EVENT_REVOKED'),publishedAt:timestamp(s?.publishedAt)?s.publishedAt:null,publishedDate:validDate(s?.publishedAt)?s.publishedAt:null,
   firstObservedAt:timestamp(s?.firstObservedAt||s?.observedAt||s?.retrievedAt)?s.firstObservedAt||s.observedAt||s.retrievedAt:null,
   provenance:selected?.ok&&selected.proof?.ref?{sourceId:s.id,sourceUrl:s.url,sourceTitle:typeof s.title==='string'?s.title.slice(0,200):null,documentHash:s.documentHash,quote:selected.proof.ref.quote,locator:selected.proof.ref.locator,originalPublishedAt:s.publishedAt||null}:null,
   projectDeliveryVerified:!!supply,reasonCodes:unique(reasons),paths:paths.map(p=>({product:p.link?.product||null,verified:p.ok,reasonCodes:p.reasons}))};
  const candidate={id:c.asset.id,name:asset?.name||c.asset.name||null,ticker:asset?.symbol||null,symbol:asset?.symbol||null,issuerId:asset?.issuerId||null,securityId:asset?.isin||asset?.securityId||null,
   market:asset?.market||null,listingMarket:asset?.exchange||null,securityType:asset?.securityType||'UNKNOWN',identityVerified:!!asset&&asset.identityStatus==='verified'&&canonicalIdentity(asset).complete&&asset.active===true,
   validFrom:validDate(asset?.validFrom||asset?.listedAt)?asset.validFrom||asset.listedAt:null,validTo:validDate(asset?.validTo)?asset.validTo:null,
   benchmarkId:['KOSPI','KOSDAQ'].includes(asset?.exchange)?asset.exchange:null,relationship};
  candidates.push(candidate);if(reasons.length)holds.push({assetId:candidate.id,reasonCodes:unique(reasons)});
 }
 const orderedAssetIds=candidates.map(c=>c.id),knowledgeCutoff=request.knowledgeCutoff||frozenAt;
 if(!timestamp(knowledgeCutoff)||Date.parse(knowledgeCutoff)>Date.parse(asOf))throw Error('INVALID_EVIDENCE_REQUEST');
 const version=await digest({adapterVersion:evidenceAdapterVersion,sourceVersion,resultHash,window,orderedAssetIds,dependencies,informationMode,knowledgeCutoff});
 const contextLabel=idea&&typeof input.text==='string'?input.text:typeof eventProof?.source?.title==='string'?eventProof.source.title:typeof input.title==='string'?input.title:null;
 return {adapterVersion:evidenceAdapterVersion,source:{jobId:job.id,owner:job.owner,version:job.version,inputType:idea?'IDEA':'NEWS',resultHash},
  displayContext:{sourceType:idea?'IDEA':'NEWS',label:contextLabel?.trim().slice(0,300)||null},
  request:{owner,sourceJobId,sourceVersion,asOf,frozenAt,informationMode,window:request.window,knowledgeCutoff},window,
  cohort:{id:'news-job:'+job.id,version,selectionPolicyVersion:evidenceAdapterVersion,selectedBeforePrices:true,frozenAt,knowledgeCutoff,orderedAssetIds},
  candidates,dependencies:[...new Map(dependencies.map(d=>[d.kind+':'+d.key,d])).values()],holds,securitySources:[...permissions.values()],
  event:{id:eventId,version:eventVersion,verified:!eventHolds.length,reasonCodes:unique(eventHolds),source: eventProof?.ok&&eventProof.ref?{...eventProof.ref,publishedAt:disclosed||null}:null},
  performanceClaim:'RETROSPECTIVE_COMPARISON_NOT_RECOMMENDATION'};
}

/** GET-time invalidation only: read existing rows and the existing permission checker. */
export async function validateStoredEvidence(db,frozen,options={}){
 if(!frozen?.request||!Array.isArray(frozen.dependencies))return {valid:false,reasonCodes:['EVIDENCE_MANIFEST_INVALID']};
 try{
  // Check frozen security identities before reading the mutable job. A source
  // job correction/deletion must not hide a simultaneous permission withdrawal.
  if(options.requireSourcePermission)for(const source of frozen.securitySources||[]){
   try{if(await options.sourceAllowed?.(source)!==true)return {valid:false,reasonCodes:['SOURCE_NOT_ALLOWED']};}
   catch{return {valid:false,reasonCodes:['SOURCE_PERMISSION_CHECK_FAILED']};}
  }
  const current=await loadStoredEvidence(db,frozen.request,options);
  const checked=compareFrozen(frozen,current);
  // Read access is fail closed even for a result that was held for a different
  // reason when created. A held relationship is not permission to disclose it.
  if(options.requireSourcePermission){
   const permissionSources=[...new Map([...(frozen.securitySources||[]),...current.securitySources].map(source=>[source.id,source])).values()];
   for(const source of permissionSources){
    try{if(!source.allowed||await options.sourceAllowed?.(source)!==true)return {valid:false,reasonCodes:unique([...checked.reasonCodes,'SOURCE_NOT_ALLOWED'])};}
    catch{return {valid:false,reasonCodes:unique([...checked.reasonCodes,'SOURCE_PERMISSION_CHECK_FAILED'])};}
   }
  }
  return checked;
 }catch(e){return {valid:false,reasonCodes:[e.message]};}
}

function compareFrozen(frozen,current){
 const before=new Map(frozen.dependencies.map(d=>[d.kind+':'+d.key,d.version]));
 const changed=current.dependencies.filter(d=>before.get(d.kind+':'+d.key)!==d.version).map(d=>d.kind.toUpperCase()+'_CHANGED');
 if(current.dependencies.length!==before.size)changed.push('DEPENDENCY_SET_CHANGED');
 if(current.cohort.version!==frozen.cohort?.version)changed.push('EVIDENCE_VERSION_CHANGED');
 // Permission can change without altering the document row. Previously valid
 // paths must not survive a security/rights revocation in a separate ledger.
 for(const c of current.candidates){const old=frozen.candidates?.find(x=>x.id===c.id);if(old?.relationship?.verified&&!c.relationship.verified)changed.push(...c.relationship.reasonCodes);}
 if(frozen.event?.verified&&!current.event.verified)changed.push(...current.event.reasonCodes);
 for(const source of frozen.securitySources||[]){if(source.allowed&&!current.securitySources.some(s=>s.id===source.id&&s.allowed))changed.push('SOURCE_NOT_ALLOWED');}
 return {valid:!changed.length,reasonCodes:unique(changed)};
}

/**
 * Capture the existing DB reads used for verification and return a publication
 * predicate for the caller's atomic db.batch. Values stay bound parameters.
 * A changed row OR insertion of a formerly missing source/claim blocks publish.
 * This does not pretend a separate security DB is in the same transaction: its
 * read-only sourceAllowed policy is checked immediately before this fence.
 */
export async function evidenceReadFence(db,frozen,options={}){
 if(!frozen?.request||!Array.isArray(frozen.dependencies))throw Error('EVIDENCE_MANIFEST_INVALID');
 const captures=[],seen=new Set();let bytes=0;
 const traced={prepare(sql){
  if(!/^SELECT\b/i.test(sql.trim()))throw Error('EVIDENCE_FENCE_WRITE_REJECTED');
  return {bind(...args){return {async all(){
   const result=await db.prepare(sql).bind(...args).all(),key=stable([sql,args]);
   if(!seen.has(key)){
    const records=result.results||[],columns=records.length?Object.keys(records[0]):[],values=records.map(r=>columns.map(c=>r[c]));
    const expected=JSON.stringify(values);bytes+=expected.length;
    if(bytes>8_000_000||captures.length>=512)throw Error('EVIDENCE_FENCE_LIMIT');
    captures.push({sql,args,columns,expected});seen.add(key);
   }
   return result;
  }};}};
 }};
 const current=await loadStoredEvidence(traced,frozen.request,options),checked=compareFrozen(frozen,current);
 if(!checked.valid)throw Error('EVIDENCE_CHANGED:'+checked.reasonCodes.join(','));
 const predicates=[],args=[];
 for(const c of captures){
  if(!c.columns.length){predicates.push(`NOT EXISTS(${c.sql})`);args.push(...c.args);continue;}
  const names=c.columns.map(name=>'rg_evidence_row."'+name.replaceAll('"','""')+'"').join(',');
  predicates.push(`(SELECT json_group_array(json_array(${names})) FROM (${c.sql}) AS rg_evidence_row)=?`);
  args.push(...c.args,c.expected);
 }
 return {sql:predicates.length?predicates.map(p=>'('+p+')').join(' AND '):'0',args,
  readCount:captures.length,externalSecurityAtomic:false};
}
