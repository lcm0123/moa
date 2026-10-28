import {one} from './catalyst/store.mjs';
import {hash} from './catalyst/core.mjs';
import {createNewsJob} from './news-companies-store.mjs';
import {validateInput,safeLink,policy} from './news-companies-model.mjs';
import {articleRelationOwner,newsLivePolicy} from './news-live-policy.mjs';

// Public feed jobs share one persistent bounded queue and the existing worker/lease.
// Never reuse a reader's private URL/text analysis as public feed content.
export {articleRelationOwner};
const messages={QUEUED:'사업 연결 확인 대기',RUNNING:'기사 본문·기업 사업 근거 확인 중',LIMITED:'자동 분석 한도 도달 · 저장된 결과만 표시',CONFIGURATION_REQUIRED:'사업 연결 분석 설정 필요',ARTICLE_ACCESS_DENIED:'기사 본문 접근 제한 · 사업 연결 미확인',ARTICLE_READ_FAILED:'기사 본문 수집 실패 · 사업 연결 미확인',SOURCE_BLOCKED:'근거 자료 재확인 필요',FAILED:'사업 연결 분석 실패',NO_CONNECTION:'확인된 사업 연결 없음',SEARCH_FAILED:'기업 검색 실패 · 연결 미확인',INSUFFICIENT_DATA:'기업 사업 근거 부족',UNASSESSED:'사업 연결 미분석'};
Object.assign(messages,{EVENT_EVIDENCE_REJECTED:'기사의 사건·인용 근거 검증 보류',UNSUPPORTED_QUOTE:'기사 인용문 대조 실패 · 본문 판정 보류',UNSUPPORTED_PROPOSITION:'기사에 없는 연결 주장 제외',WORKER_INTERRUPTED:'이전 본문 분석 중단',AI_RATE_LIMIT:'AI 요청 제한 · 본문 분석 대기',AI_TIMEOUT:'AI 응답 지연 · 본문 분석 미완료',TIMEOUT:'본문 분석 시간 초과'});
const state=(status,extra={})=>({status,message:status==='QUEUE_FULL'?'분석 대기열이 가득 찼습니다 · 다음 갱신 때 재확인':messages[status]||messages.FAILED,candidates:[],...extra});
const inputFor=a=>validateInput({url:a.url,title:a.title,conditions:{includeIndirect:true}});
export function relationIds(ids){if(!Array.isArray(ids)||!ids.length||ids.length>6||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^feed-[a-f0-9]{64}$/.test(id)))throw Error('INVALID_RELATION_REQUEST');return ids;}

// A deliberately narrow public projection: no full documents, private inputs,
// raw model output or source from a different issuer can reach the news list.
export async function projectArticleRelation(row,allowed){
 if(!row)return state('UNASSESSED');
 if(['QUEUED','RUNNING'].includes(row.status))return state(row.status,{phase:row.phase});
 if(!['COMPLETE','PARTIAL'].includes(row.status))return state(messages[row.error]?row.error:'FAILED',{code:row.error||row.status});
 const r=JSON.parse(row.result||'null');if(!r?.event)return state('FAILED');
 const proof=async(ref,assetId=null)=>{
  const s=r.sources?.find(s=>s.id===ref?.sourceId);
  if(!s||s.userProvided||ref.userProvided||s.access!=='READ'||assetId&&s.assetId!==assetId||!safeLink(s.url)||!s.body?.includes(ref.quote)||!await allowed(s))return null;
  return {url:s.url,quote:ref.quote,publisher:s.publisher||null,title:s.title,locator:ref.locator,publishedAt:s.publishedAt||null};
 };
 const eventProof=await proof(r.event.evidence);if(!eventProof)return state('SOURCE_BLOCKED');
 const candidates=[];let blocked=0;
 for(const c of r.candidates||[]){
  if(c.counterEvidence?.some(x=>['REFUTES','CONFLICT'].includes(x.effect)))continue;
  for(const l of c.links||[]){
   const d=r.event.demands.find(d=>d.product===l.product),business=await proof(l.evidence,c.asset.id),event=d&&await proof(d.evidence);
   if(!business||!event){blocked++;continue;}
   candidates.push({asset:c.asset,product:l.product,business:l.sourceTerm,relationship:l.relationship,reason:l.reason,nature:'CONDITIONAL',mentionedInArticle:c.mentionedInArticle??null,eventEvidence:event,businessEvidence:business,conditions:d.conditions||[],weakening:d.weakening||[],confirmedSupply:!!c.projectSupply&&!!await proof(c.projectSupply),asOf:r.asOf});break;
  }
 }
 // Non-mentioned businesses first. No price, text similarity or invented
 // revenue weighting is involved in this presentation order.
 candidates.sort((a,b)=>Number(a.mentionedInArticle===true)-Number(b.mentionedInArticle===true));
 const retrievalGap=(r.limitations||[]).some(s=>/본문 확보 실패|ISSUER_EVIDENCE_MISMATCH|공식 발행인 도메인 미확인/.test(s));
 const status=candidates.length?'READY':blocked?'SOURCE_BLOCKED':r.outcome==='SEARCH_FAILED'?'SEARCH_FAILED':!r.event.demands.length?'NO_CONNECTION':retrievalGap||r.outcome==='INSUFFICIENT_DATA'?'INSUFFICIENT_DATA':'NO_CONNECTION';
 return state(status,{message:status==='READY'?'공시·기업 자료로 연결한 국내 종목':messages[status],candidates:candidates.slice(0,3),asOf:r.asOf,stale:Date.now()-Date.parse(row.updated_at)>policy.staleMs,scope:'국내 상장기업 · 제품 사업 근거에 따른 조건부 연결',eventEvidence:eventProof,diagnostics:{documents:r.diagnostics?.documents,dbMatches:r.diagnostics?.dbMatches,validated:r.diagnostics?.validated}});
}

export function createArticleRelations({db,resolve,allowed,start,ready=()=>true,env={},match=null}){
 async function existing(a){
  let row=await one(db,'SELECT * FROM news_company_jobs WHERE owner=? AND request_key=?',articleRelationOwner,await hash(JSON.stringify(inputFor(a))));
  if(row?.status==='RUNNING'&&Date.now()-Date.parse(row.updated_at)>policy.timeoutMs+60000){
   await db.prepare("UPDATE news_company_jobs SET status='FAILED',phase='FAILED',error='WORKER_INTERRUPTED' WHERE id=? AND status='RUNNING' AND updated_at=?").bind(row.id,row.updated_at).run();
   row=await one(db,'SELECT * FROM news_company_jobs WHERE id=?',row.id);
  }
  return row;
 }
 async function projected(a,row){
  const verified=await projectArticleRelation(row,allowed);
  if(verified.status==='READY'||!match)return {...verified,autoEligible:!row};
  const local=await match(a);
  const verification=row?{status:verified.status,message:verified.message,code:verified.code||null}:null;
  // A failed enrichment must not erase available, independently proven business
  // exposure. Neither local matches nor a feed excerpt become verified impact.
  return {...local,autoEligible:!row&&local.autoEligible,verification};
 }
 async function decorate(items){return Promise.all(items.map(async a=>{
  try{return {...a,relation:await projected(a,await existing(a))};}
  catch{return {...a,relation:state('FAILED',{status:'RETRY',message:'사업 자료 조회 지연 · 자동 재확인',autoEligible:false})};}
 }));}
 async function request(ids){
  relationIds(ids);
  const items=[];
  for(const id of ids){try{
   const a=await resolve(id);if(!a){items.push({id,relation:state('FAILED',{status:'SOURCE_UNAVAILABLE',message:'기사 저장 기간 만료 또는 접근 제한 · 목록 새로고침 필요',autoEligible:false})});continue;}
   let row=await existing(a),relation=await projected(a,row);
   if(match&&!row&&!relation.autoEligible){items.push({id,relation});continue;}
   if(!row){
    if(!ready())relation=match?{...relation,autoEligible:false,verification:state('CONFIGURATION_REQUIRED')}:state('CONFIGURATION_REQUIRED');
    else try{row=(await createNewsJob(db,articleRelationOwner,inputFor(a),{maxPending:newsLivePolicy(env).maxPending})).row;}catch(e){if(e.message!=='QUEUE_FULL')throw e;relation=match?{...relation,verification:state('QUEUE_FULL')}:state('QUEUE_FULL');}
   }
   if(row?.status==='QUEUED'&&ready())await start(row).catch(()=>{});
   items.push({id:a.id,relation:row?await projected(a,await existing(a)):relation});
  }catch{items.push({id,relation:state('FAILED',{status:'RETRY',message:'사업 자료 조회 지연 · 자동 재확인',autoEligible:false})});}
  }
  return {items,scope:'저장 제품·사업 연결 → 필요한 기사만 본문 추가 확인',limitPerHour:null,maxPending:newsLivePolicy(env).maxPending};
 }
 return {decorate,request};
}
