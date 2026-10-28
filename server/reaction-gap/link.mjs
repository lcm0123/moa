// Read-only source→stored result discovery. No queue kick, cache write or price read.
import {one} from '../catalyst/store.mjs';
import {loadStoredEvidence,validateStoredEvidence} from './evidence.mjs';
import {timestamp} from './input.mjs';
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const kstDay=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date(value));

export async function gapSourceLink(db,owner,sourceJobId,sourceVersion,{sourceAllowed=async()=>false,runtimeReady=false,now=Date.now()}={}){
 if(typeof sourceJobId!=='string'||!sourceJobId||sourceJobId.length>100||!Number.isSafeInteger(sourceVersion)||sourceVersion<1)throw Error('INVALID_SOURCE_REFERENCE');
 const job=await one(db,'SELECT * FROM news_company_jobs WHERE id=? AND owner=?',sourceJobId,owner);
 if(!job)throw Error('NOT_FOUND');if(job.version!==sourceVersion)throw Error('SOURCE_VERSION_CONFLICT');
 const source={id:job.id,version:job.version,status:job.status};
 const stopped=reason=>({source,linked:null,creation:{allowed:false,reasonCodes:[reason],request:null}});
 if(!['COMPLETE','PARTIAL'].includes(job.status)||!job.result)return stopped('SOURCE_NOT_COMPLETE');
 const result=parse(job.result),input=parse(job.input);if(!result||!input)return stopped('SOURCE_SCHEMA_INVALID');
 const asOf=[result.asOf,input.asOf,job.updated_at].find(timestamp);
 if(!asOf||Date.parse(asOf)>now)return stopped('SOURCE_TIME_UNVERIFIED');
 const options={sourceAllowed};
 const makeRequest=window=>({sourceJobId,sourceVersion,asOf,informationMode:'RETROSPECTIVE',window});
 const freeze=request=>loadStoredEvidence(db,{...request,owner,frozenAt:asOf},options);
 let request=makeRequest({mode:'FIXED_WINDOW',endDate:kstDay(asOf)}),frozen;
 if(result.event?.evidence){
  const eventRequest=makeRequest({mode:'EVENT'}),eventFrozen=await freeze(eventRequest);
  if(eventFrozen.event.verified){request=makeRequest({mode:eventFrozen.window.mode});frozen=eventFrozen;}
 }
 frozen||=await freeze(request);
 const permission=await validateStoredEvidence(db,frozen,{sourceAllowed,requireSourcePermission:true});
 if(permission.reasonCodes.some(reason=>['SOURCE_NOT_ALLOWED','SOURCE_PERMISSION_CHECK_FAILED','EVIDENCE_REVOKED','EVENT_REVOKED'].includes(reason)))throw Error('SOURCE_ACCESS_DENIED');
 if(!permission.valid)return stopped('SOURCE_EVIDENCE_INVALID');
 const linked=await one(db,`SELECT id,version,state,latest_version FROM reaction_gap_jobs WHERE owner=?
  AND json_extract(request,'$.sourceJobId')=? AND json_extract(request,'$.sourceVersion')=? AND json_extract(request,'$.asOf')=?
  AND json_extract(request,'$.window.mode')=? AND COALESCE(json_extract(request,'$.window.endDate'),'')=? ORDER BY updated_at DESC,id DESC LIMIT 1`,owner,sourceJobId,sourceVersion,asOf,request.window.mode,request.window.endDate||'');
 const reasonCodes=linked?['STORED_RESULT_AVAILABLE']:!frozen.candidates.length?['NO_COMPARABLE_CANDIDATES']:!runtimeReady?['WORKER_REQUIRED']:[];
 return {source,linked:linked?{id:linked.id,version:linked.version,state:linked.state,latestVersion:linked.latest_version}:null,
  creation:{allowed:!reasonCodes.length,reasonCodes,request}};
}
