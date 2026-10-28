import {calculateReactionGap} from './index.mjs';
import {loadStoredEvidence,validateStoredEvidence,evidenceReadFence} from './evidence.mjs';
import {preserveExactHistory,loadGapData,discloseGap,validateDataReads} from './data.mjs';
import {createGapJob,refreshGapJob,readGapJob,readGapVersion,gapHistory,publishGap,withdrawGapPublication,failGap,gate,settings,digest} from './store.mjs';
import {timestamp,validDate} from './input.mjs';
import {gapPresentation} from './presentation.mjs';

export function gapRequest(body,{now=Date.now()}={}){
 if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(k=>!['sourceJobId','sourceVersion','asOf','informationMode','window'].includes(k)))throw Error('INVALID_REQUEST');
 if(typeof body.sourceJobId!=='string'||body.sourceJobId.length>100||!Number.isSafeInteger(body.sourceVersion)||body.sourceVersion<1||!timestamp(body.asOf)||Date.parse(body.asOf)>now)throw Error('INVALID_REQUEST');
 if(!['EVENT','DATE_REFERENCE','FIXED_WINDOW'].includes(body.window?.mode)||Object.keys(body.window).some(k=>!['mode','endDate'].includes(k))||body.window.mode==='FIXED_WINDOW'&&!validDate(body.window.endDate))throw Error('INVALID_WINDOW');
 if(body.informationMode!==undefined&&body.informationMode!=='RETROSPECTIVE')throw Error('RETROSPECTIVE_ONLY');
 // This adapter freezes today's stored evidence. It makes no historical
 // recommendation-performance claim. asOf is the logical observation cutoff.
 return {sourceJobId:body.sourceJobId,sourceVersion:body.sourceVersion,asOf:body.asOf,informationMode:'RETROSPECTIVE',window:{mode:body.window.mode,...body.window.mode==='FIXED_WINDOW'?{endDate:body.window.endDate}:{}}};
}
async function freeze(db,owner,body,options){
 const request=gapRequest(body,options),frozen=await loadStoredEvidence(db,{...request,owner,frozenAt:request.asOf},options);
 if(frozen.candidates.length>settings.maxCandidates)throw Error('CANDIDATE_LIMIT');
 return {request,frozen};
}
export async function enqueueGap(db,owner,body,options={}){
 if(!(await gate(db)).enabled)throw Error('FEATURE_DISABLED');
 const {request,frozen}=await freeze(db,owner,body,options);return createGapJob(db,owner,request,frozen,options);
}
export async function refreshGap(db,owner,id,expectedVersion,body,options={}){
 if(!await readGapJob(db,id,owner))throw Error('NOT_FOUND');
 const {request,frozen}=await freeze(db,owner,body,options);return refreshGapJob(db,owner,id,expectedVersion,request,frozen,options);
}

/** A command worker owns the lease. No external retrieval or AI is called. */
export async function executeGapJob(db,job,{now=Date.now(),sourceAllowed=async()=>false,clock=Date.now,requireSharedLease=false}={}){
 try{
  const frozen=JSON.parse(job.frozen),request=JSON.parse(job.request);
  const validation=await validateStoredEvidence(db,frozen,{sourceAllowed});if(!validation.valid)throw Error('EVIDENCE_CHANGED');
  await preserveExactHistory(db,frozen,{asOf:request.asOf});
  const bundle=await loadGapData(db,frozen,request);
  const result=discloseGap(calculateReactionGap(bundle.input),bundle.manifest);
  const evidenceFence=await evidenceReadFence(db,frozen,{sourceAllowed});
  // Clock is injectable. Production uses a fresh time at publication, so a
  // slow operation cannot publish with its old lease-start timestamp.
  const publicationNow=Math.max(now,clock());
  const sharedFence={sql:"EXISTS(SELECT 1 FROM catalyst_runtime WHERE key='research-worker-lease' AND json_extract(value,'$.token')=? AND json_extract(value,'$.gapJob')=? AND json_extract(value,'$.jobVersion')=? AND json_extract(value,'$.until')>=?)",args:[job.lease_token,job.id,job.version,publicationNow]};
  const previousVersion=(await readGapJob(db,job.id,job.owner))?.latest_version??null;
  if(!(await validateStoredEvidence(db,frozen,{sourceAllowed})).valid)throw Error('EVIDENCE_CHANGED');
  const published=await publishGap(db,job,{...bundle,result,fences:[bundle.fence,evidenceFence,...requireSharedLease?[sharedFence]:[]]},{now:publicationNow});
  // The permission ledger uses a different SQLite file. These checks do not
  // claim a cross-database atomic commit. GET/history independently recheck
  // current permission, including the interval before this withdrawal.
  if(published&&!(await validateStoredEvidence(db,frozen,{sourceAllowed})).valid){
   await withdrawGapPublication(db,job,bundle.input.snapshotId,previousVersion,{now:Math.max(publicationNow,clock())});
   return false;
  }
  if(!published)await failGap(db,job,'PUBLICATION_FENCE_REJECTED',{now:publicationNow});
  return published;
 }catch(e){await failGap(db,job,e.message,{now});throw e;}
}

export async function getGap(db,owner,id,{version=null,sourceAllowed=async()=>false}={}){
 const job=await readGapJob(db,id,owner);if(!job)throw Error('NOT_FOUND');
 if(!(await gate(db)).enabled)throw Error('FEATURE_DISABLED');
 const base={id:job.id,version:job.version,latestVersion:job.latest_version,state:job.state,workState:job.state,errorCode:job.error_code,createdAt:job.created_at,updatedAt:job.updated_at,responseVersion:'reaction-gap-response-2'};
 const saved=await readGapVersion(db,owner,id,version);
 if(!saved)return {...base,result:null,reasonCodes:[version!==null?'VERSION_NOT_FOUND':'RESULT_NOT_READY']};
 const manifest=JSON.parse(saved.manifest),input=JSON.parse(saved.input),result=JSON.parse(saved.result);
 const valid=await validateStoredEvidence(db,manifest.frozen,{sourceAllowed,requireSourcePermission:true});
 if(valid.reasonCodes.some(reason=>['SOURCE_NOT_ALLOWED','SOURCE_PERMISSION_CHECK_FAILED','EVIDENCE_REVOKED','EVENT_REVOKED'].includes(reason)))throw Error('SOURCE_ACCESS_DENIED');
 const reasons=[...saved.valid?[]:[saved.invalid_reason||'INVALIDATED'],...valid.reasonCodes];
 if(await digest(manifest)!==saved.snapshot_id||input.snapshotId!==saved.snapshot_id)reasons.push('SNAPSHOT_MISMATCH');
 if(!await validateDataReads(db,manifest.reads))reasons.push('MARKET_OR_CONTRACT_CHANGED');
 if(reasons.length)return {...base,resultVersion:saved.version,snapshotId:saved.snapshot_id,result:null,state:'INVALIDATED',reasonCodes:[...new Set(reasons)]};
 return {...base,resultVersion:saved.version,snapshotId:saved.snapshot_id,result,presentation:gapPresentation(input,manifest,result),reasonCodes:[],storedAt:saved.created_at,
  sources:manifest.raw.map(r=>({assetId:r.assetId,date:r.date,revision:r.revision,rawHash:r.rawHash,responseHash:r.exact?.source?.responseHash,locator:r.exact?.source?.locator,reasonCodes:r.issues||[]})),
  providerStates:manifest.providerStates,
  contractVersions:Object.fromEntries(Object.entries(manifest.contracts).map(([k,v])=>[k,{version:v.row?.version||null,verified:v.verified&&!v.actualDataVerificationRejected,...v.actualDataVerificationRejected?{purposeRejected:true}:{}}])),calendarVersion:manifest.calendar?.version||null};
}

/** Stored history is private and subject to the same current source gate as GET. */
export async function getGapHistory(db,owner,id,options={}){
 const history=await gapHistory(db,owner,id),items=[];
 for(const saved of history){
  const current=await getGap(db,owner,id,{...options,version:saved.version});
  items.push({version:saved.version,snapshotId:saved.snapshot_id,storedAt:saved.created_at,validation:current.result?'CURRENTLY_VALID':'INVALIDATED',invalidReason:current.result?null:current.reasonCodes.join(',')});
 }
 return {items};
}
