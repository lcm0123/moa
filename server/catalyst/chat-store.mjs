import {hash,norm} from './core.mjs';
import {one,rows} from './store.mjs';
import {chatPolicy as p} from './chat-contract.mjs';
import {withRequestedTable,withMissingCompanyData} from './chat-format.mjs';
import {chatQuota} from './chat-limits.mjs';
export async function ownedChat(store,id,reader){return one(store.db,'SELECT j.*,d.reader_hash,d.conversation_id,d.parent_job_id,d.context FROM catalyst_research_jobs j JOIN catalyst_dialogue d ON d.job_id=j.id WHERE j.id=? AND d.reader_hash=?',id,reader);}
export async function enqueueChat(store,input){
 const query=norm(input.query),market=input.market||'ALL';
 if(!query||query.length>p.maxQuestionCharacters||!['ALL','KR','US','CRYPTO'].includes(market)||!/^[a-f0-9]{64}$/.test(input.readerHash||''))throw Error('CHAT_INPUT_INVALID');
 let parent=null,history=[];
 if(input.parentId){parent=await ownedChat(store,input.parentId,input.readerHash);if(!parent||!['complete','limited'].includes(parent.status))throw Error('CHAT_PARENT_UNAVAILABLE');
  const n=await one(store.db,'SELECT COUNT(*) n FROM catalyst_dialogue WHERE conversation_id=? AND reader_hash=?',parent.conversation_id,input.readerHash);if(n.n>=p.maxTurns)throw Error('CHAT_TURN_LIMIT');
  // Only this branch's ancestors, never another user's conversation or a sibling's constraints.
  let at=parent;for(let i=0;at&&i<p.contextTurns;i++){
   const result=JSON.parse(at.result||'{}');history.unshift({query:at.query,market:at.market_filter,result,at:at.updated_at});
   at=at.parent_job_id?await ownedChat(store,at.parent_job_id,input.readerHash):null;
  }
 }
 const version=await one(store.db,'SELECT MAX(at) at FROM (SELECT MAX(updated_at) at FROM research_cache UNION ALL SELECT MAX(retrieved_at) FROM fred_macro_cache UNION ALL SELECT MAX(observed_at) FROM catalyst_sources UNION ALL SELECT MAX(received_at) FROM cmc_cache UNION ALL SELECT MAX(last_verified_at) FROM company_metadata_facts UNION ALL SELECT MAX(verified_at) FROM catalyst_facts)'),reports=await one(store.db,'SELECT (SELECT MAX(updated_at) FROM telegram_reports) updated,(SELECT MAX(updated_at) FROM telegram_report_categories) categorized'),key='chat:'+await hash(JSON.stringify([p.version,p.contextVersion,input.thesisContext?.cacheKey||null,input.readerHash,query,market,input.parentId||null,parent?.updated_at,version?.at,reports,Math.floor(Date.now()/p.answerCacheMs)]));
 const cached=await one(store.db,"SELECT j.* FROM catalyst_research_jobs j JOIN catalyst_dialogue d ON d.job_id=j.id WHERE research_key=? AND d.reader_hash=? AND status IN ('queued','running','complete','limited')",key,input.readerHash);if(cached)return {...cached,shared:true};
 const id=crypto.randomUUID(),now=new Date().toISOString();
 const quota=await chatQuota(store,input.readerHash);if(!quota.remaining)throw Object.assign(Error('CHAT_RATE_LIMIT'),{quota});
 const context={history,assets:[],version:p.version,...(input.thesisContext?{thesis:input.thesisContext}:{})};
 // Same queue/schema as existing one-shot jobs. No second research database.
 await store.db.batch([
 store.db.prepare("INSERT INTO catalyst_research_jobs VALUES(?,?,?,?,?,'queued','chat',NULL,NULL,NULL,?,?,0,0,?)").bind(id,key,query,market,'normal',now,now,p.version),
 store.db.prepare('INSERT INTO catalyst_dialogue VALUES(?,?,?,?,?,?)').bind(id,input.readerHash,parent?.conversation_id||id,parent?.id||null,JSON.stringify(context),now)
 ]);return {id,status:'queued',conversation_id:parent?.conversation_id||id};
}
export async function publicChat(store,id,reader,{sourceAllowed=()=>false}={}){
 const j=await ownedChat(store,id,reader);if(!j)return null;const r=JSON.parse(j.result||'null');
 if(r){let allowed=[];for(const s of r.sources||[])if((!s.url||await sourceAllowed(s))&&(!s.sourceUrls||(await Promise.all(s.sourceUrls.map(url=>sourceAllowed({url})))).every(Boolean)))allowed.push(s);
  let previous;do{previous=allowed.length;const ids=new Set(allowed.map(s=>s.id));allowed=allowed.filter(s=>!s.inputRefs||s.inputRefs.every(id=>ids.has(id)));}while(allowed.length!==previous);
  const ids=new Set(allowed.map(s=>s.id));
  r.coverage=(r.coverage||[]).map(c=>{const refs=(c.refs||[]).filter(id=>ids.has(id));return {...c,refs,status:c.refs?.length&&!refs.length?'unavailable':c.status};});
  r.blocks=(r.blocks||[]).map(b=>b.refs.some(id=>!ids.has(id))?{kind:'unknown',text:'사용한 자료의 접근 상태가 바뀌어 이 부분은 다시 확인해야 합니다.',refs:[]}:b);r.sources=allowed;
  if(['complete','limited'].includes(j.status))r.blocks=withRequestedTable(r,j.query,(r.contextEvidence||[]).filter(s=>ids.has(s.id)),r.assets,j.market_filter,{companyContext:r.coverage?.some(c=>c.dataset==='business')}).blocks;
  r.blocks=withMissingCompanyData(r,r.coverage).blocks;
 }
 // Internal evidence content stays in the owner-bound context, never in a shared delivery endpoint.
 if(r){delete r.contextEvidence;delete r.thesisReview;}
 const context=JSON.parse(j.context||'{}'),thesisId=context.thesis?.thesisId||context.thesis?.id;
 return {id:j.id,conversationId:j.conversation_id,parentId:j.parent_job_id,...(/^[a-f0-9-]{36}$/i.test(thesisId||'')?{thesisId}:{}),query:j.query,market:j.market_filter,status:j.status,stage:j.stage,updatedAt:j.updated_at,errorCode:j.error_code,result:r};
}
export async function chatHistory(store,reader){return rows(store.db,'SELECT j.id,j.query,j.status,j.updated_at,d.conversation_id FROM catalyst_dialogue d JOIN catalyst_research_jobs j ON j.id=d.job_id WHERE d.reader_hash=? ORDER BY d.created_at DESC LIMIT 12',reader);}
