import {validationVersion} from './claim-validation.mjs';
import {CatalystStore,one} from './store.mjs';
import {resolveAsset,syncAssets} from './assets.mjs';
import {config,classifyQuery,norm,safeUrl,hash,CatalystError,messages} from './core.mjs';
import {marketContext} from './market.mjs';
import {cryptoDetails,gatherEvidence,discoverAssets,contextFingerprint,expandFromEvidence} from './evidence.mjs';
import {callAnalyzer,budgetStatus} from './ai.mjs';
import {enrichStockIdentity} from './identity-enrichment.mjs';
import {CatalystGraph} from './graph.mjs';
import {validateClaim,reconcileClaims,qualityGate,scoreCandidate,causalityStatus} from './claims.mjs';

export function validateRequest(body){
 const query=norm(body?.query);if(query.length<3||query.length>500)throw new CatalystError('invalid_query','질문을 3~500자로 입력해 주세요.');
 if(body.assetId!==undefined&&(typeof body.assetId!=='string'||body.assetId.length>180))throw new CatalystError('invalid_query','자산 선택을 확인해 주세요.');
 const sourceUrls=Array.isArray(body.sourceUrls)?body.sourceUrls:[];if(sourceUrls.length>3||sourceUrls.some(s=>typeof s!=='string'||s.length>1200||!safeUrl(s)))throw new CatalystError('invalid_query','HTTPS 원문 주소를 최대 3개까지 입력할 수 있습니다.');
 return {query,assetId:body.assetId||null,sourceUrls,deep:body.deep===true};
}
export async function enqueue(env,reader,body){
 const store=new CatalystStore(env.DB),input=validateRequest(body);await syncAssets(store);
 const classification=classifyQuery(input.query),resolved=await resolveAsset(store,input.query,input.assetId,classification.resolutionKinds);
 if(!resolved.asset&&(resolved.invalidSelection||resolved.choices.length>0||classification.intent==='MOVE_ANALYSIS'))return {state:'selection_required',code:resolved.choices.length?'identity_ambiguous':'identity_missing',message:messages[resolved.choices.length?'identity_ambiguous':'identity_missing'],choices:resolved.choices};
 const cacheKey=await hash([reader,input.query,input.assetId,input.deep,...input.sourceUrls].join('|'));
 const active=await one(env.DB,"SELECT payload FROM catalyst_runs WHERE reader_hash=? AND cache_key=? AND state IN ('queued','running')",reader,cacheKey);if(active)return JSON.parse(active.payload);
 const counts=await one(env.DB,"SELECT SUM(CASE WHEN state IN ('queued','running') THEN 1 ELSE 0 END) active,SUM(CASE WHEN reader_hash=? AND created_at>? THEN 1 ELSE 0 END) mine FROM catalyst_runs",reader,new Date(Date.now()-3600000).toISOString());
 if(counts.active>=config.maxQueue||counts.mine>=config.requestsPerHour)throw new CatalystError('rate_limit',messages.rate_limit);
 const createdAt=new Date().toISOString(),run={id:crypto.randomUUID(),...input,asset:resolved.asset,classification,intent:classification.intent,state:'queued',stage:'queued',createdAt,updatedAt:createdAt,diagnostics:{},version:config.version,promptVersion:config.promptVersion,model:env.CATALYST_AI_MODEL||config.model};
 await env.DB.prepare('INSERT INTO catalyst_runs VALUES(?,?,?,?,?,?,?,?,?,?,?,0)').bind(run.id,reader,input.query,resolved.asset?.id||null,run.intent,run.state,run.stage,JSON.stringify(run),cacheKey,createdAt,createdAt).run();
 env.CATALYST_WAKE?.();return run;
}
export function publicRun(run){
 if(!run)return null;const {sourceUrls,assetId,...out}=run;
 const legacy=run.claims?.some(c=>c.validationVersion!==validationVersion);
 return {...out,...(legacy?{code:'revalidation_required',message:'검증 기준이 변경되었습니다. 이전 분석의 근거를 다시 검증해 주세요.',causality:{status:'no_evidence',claimIds:[],confidence:'LOW'}}:{}),requiresRevalidation:!!legacy,claims:run.claims?.map(c=>c.validationVersion===validationVersion?c:{...c,status:'UNVERIFIED',confidence:'LOW',reasons:[...(c.reasons||[]),'검증 기준 갱신 · 재검증 필요']}),asset:run.asset?publicAsset(run.asset):null,choices:run.choices?.map(publicAsset),candidates:run.candidates?.map(c=>({...c,...(legacy?{gate:{passed:false,missing:['검증 기준 갱신 · 재검증 필요'],claimIds:[]},score:{...c.score,score:null,confidence:'LOW'},direction:'unclear',explanation:'검증 기준 갱신 · 재검증 필요'}:{}),asset:publicAsset(c.asset)})),sources:run.sources?.map(({body,text,excerpt,...s})=>s)};
}
export function publicAsset(a){return {id:a.id,kind:a.kind,symbol:a.symbol,name:a.name,identityStatus:a.identityStatus,canonicalIdentity:a.canonicalIdentity||null,exchange:a.exchange||null,issuerId:a.issuerId||null,chain:a.chain||null,contractAddress:a.contractAddress||null,identitySource:a.identitySource||null,href:a.kind==='CRYPTO'?'/crypto?coin='+encodeURIComponent(a.instrumentId):'/stock/'+a.market+'/'+encodeURIComponent(a.symbol)+'?tab=company'};}
export async function persistGraph(store,run,candidates){
 const graph=new CatalystGraph(store.db);
 for(const c of candidates)for(const p of c.path||[]){
  // Model-supplied labels/kinds are proposals. They cannot create production facts.
  const from=await graph.node({kind:'CATALYST',label:p.from}),to=await graph.node({kind:p.to===c.asset.name?'ASSET':'PRODUCT',label:p.to,assetId:p.to===c.asset.name?c.asset.id:null});
  const claim=run.claims.find(x=>x.localId===p.claim_id);
  await graph.propose({source_node_id:from,target_node_id:to,relation_type:p.relation},{claimIds:claim?[claim.id]:[],runId:run.id});
 }
}
export async function processRun(env,store,run,dependencies={}){
 const started=Date.now(),checkpoint=()=>{if(Date.now()-started>config.runTimeoutMs)throw new CatalystError('timeout',messages.timeout);};
 let fallback=null;
 const stage=async name=>{checkpoint();run.stage=name;await store.saveRun(run);};
 const deps={market:marketContext,evidence:gatherEvidence,analyze:callAnalyzer,...dependencies};
 try{
  await stage('identity');
  if(run.asset?.kind==='US_STOCK')run.asset=await enrichStockIdentity(env,store,run.asset);
  if(run.asset?.kind==='CRYPTO'){try{const d=await cryptoDetails(env,store,run.asset);run.asset=d.asset;run.cryptoMetadata=d.metadata;}catch{run.dataGaps=['코인 계약·토큰 구조 정보 갱신 실패'];}}
  if(run.asset?.identityStatus==='ambiguous'){run.state='selection_required';run.code='identity_ambiguous';run.message='여러 체인의 계약 주소가 연결되어 있습니다. 분석할 체인을 선택해 주세요.';run.platforms=run.asset.platforms;run.choices=(await Promise.all((run.asset.deployments||[]).map(id=>store.asset(id)))).filter(Boolean);return;}
  let assets=await discoverAssets(env,store,run);if(run.asset)assets=assets.map(a=>a.id===run.asset.id?run.asset:a);
  const fingerprint=await contextFingerprint(store,run,assets),cacheKey='result:'+await hash(fingerprint+'|'+run.model),cached=await store.cache(cacheKey);
  if(cached?.stale&&cached.value?.state==='complete')fallback=cached;
  if(cached&&!cached.stale){const identity={id:run.id,createdAt:run.createdAt,query:run.query};Object.assign(run,cached.value,identity,{cached:true,cacheAsOf:cached.at});return;}
  await stage('market');
  if(run.asset){try{run.market=await deps.market(env,store,run.asset,{strict:run.intent==='MOVE_ANALYSIS'});}catch(e){if(run.intent==='MOVE_ANALYSIS')throw e;run.dataGaps=[...(run.dataGaps||[]),'시세 비교 데이터 미확보'];}}
  await stage('evidence');const collected=await deps.evidence(env,store,run,assets,checkpoint);run.diagnostics={...collected.diagnostics,assets:assets.length,market:run.market?1:0};run.sources=collected.sources;run.failures=collected.failures;
  if(env.CATALYST_TOOLS&&assets.length<config.stockCandidates){const expanded=await expandFromEvidence(env,store,run,run.sources,assets,checkpoint);assets=expanded.assets;run.sources.push(...expanded.sources);run.diagnostics.expansionAttempts=expanded.attempted;run.diagnostics.assets=assets.length;}
  if(!run.sources.length){run.state='no_result';run.code=run.diagnostics.searchResults?'body_unavailable':run.failures.some(f=>f.stage==='search')?'search_failed':'no_evidence';run.message=messages[run.code]||'검색에 실패했습니다. 근거 주소를 지정하거나 다시 시도해 주세요.';return;}
  await stage('analyzing');
  const context={query:run.query,intent:run.intent,conditional_scenario:run.classification.scenario,analysis_at:new Date().toISOString(),market:run.market||null,assets:assets.map(a=>({id:a.id,name:a.name,symbol:a.symbol,kind:a.kind,identity_status:a.identityStatus})),sources:run.sources};
  let answer;
  try{answer=await deps.analyze(env,store,run,context,{deep:run.deep});}catch(e){if(e.code!=='structured_failed'||run.webSearchUsed)throw e;const budget=await budgetStatus(store.db,env);if(budget.softReached)throw e;checkpoint();answer=await deps.analyze(env,store,run,context,{deep:false,repair:true});run.repaired=true;}
  await stage('validating');
  // Validate against exactly the excerpts the model received, not unseen parts.
  run.sources=await store.saveSourceLineage(run.sources);
  const sources=run.sources.filter(s=>answer.context.sources.some(x=>x.id===s.id)).map(s=>({...s,body:answer.context.sources.find(x=>x.id===s.id).excerpt}));
  run.claims=reconcileClaims(await Promise.all(answer.value.claims.map(p=>validateClaim(p,sources,assets,run.id))));
  if(answer.value.conflict)for(const c of run.claims){if(['VERIFIED','SUPPORTED'].includes(c.status)){c.status='CONFLICTED';c.confidence='LOW';c.reasons.push('자료 충돌 경고 · 독립 검토 필요');}}
  for(const c of run.claims)await store.saveClaim(c,run.id);
  run.causality=causalityStatus(run.claims,run.intent==='MOVE_ANALYSIS'?run.market:null,run.classification.scenario);
  run.catalystType=answer.value.catalyst_type;run.candidates=[];
  for(const candidate of answer.value.candidates){let asset=assets.find(a=>a.id===candidate.asset_id);if(!asset||run.candidates.some(c=>c.asset.id===asset.id))continue;
   asset=await enrichStockIdentity(env,store,asset);
   if(asset.kind==='CRYPTO'&&asset.id!==run.asset?.id){try{asset=(await cryptoDetails(env,store,asset)).asset;}catch{/* Incomplete identity remains ineligible. */}}
   const gate=qualityGate(candidate,run.claims,asset,{scenario:run.classification.scenario,causality:run.intent==='MOVE_ANALYSIS'?run.causality:null}),score=scoreCandidate(candidate,run.claims,asset,gate);
   run.candidates.push({asset,product:candidate.product,relationship:candidate.relationship,direction:gate.passed?candidate.direction:'unclear',path:candidate.path,gate,score,claimIds:gate.claimIds,
    explanation:gate.passed?candidate.product+'의 사건·전달경로·사업 근거를 확인했습니다.':gate.missing.join(' · ')});
  }
  run.candidates.sort((a,b)=>Number(b.gate.passed)-Number(a.gate.passed)||(b.score.score??-1)-(a.score.score??-1));
  run.diagnostics={...run.diagnostics,claims:run.claims.length,validatedClaims:run.claims.filter(c=>['VERIFIED','SUPPORTED'].includes(c.status)).length,candidates:run.candidates.length,passed:run.candidates.filter(c=>c.gate.passed).length};
  run.state='complete';run.code=run.classification.scenario?'scenario':run.intent==='MOVE_ANALYSIS'&&run.causality.status!=='reported_catalyst'?'cause_unclear':run.diagnostics.passed?'ready':'no_candidates';
  run.message=run.code==='ready'?'사건과 사업 노출을 연결하는 근거를 확인했습니다.':run.code==='scenario'?'조건부 시나리오입니다. 실제 발생한 사건이나 가격 상승 원인으로 판정하지 않습니다.':messages[run.code];
  run.dataGaps=[...(run.dataGaps||[]),...(run.market?.limitations||[]),'원문에서 확인한 인용을 제공합니다. 자료만으로 인과관계나 미래 수익을 확정하지 않습니다.'];
  if(run.asset?.kind==='CRYPTO')run.dataGaps.push('토큰 언락·보유 집중도·파생상품·수수료 수익 분배는 연결된 공식 근거가 없으면 미확인입니다.');
  if(run.asset&&run.asset.kind!=='CRYPTO'){const flow=await one(store.db,'SELECT payload,updated_at FROM earnings_flow_targets WHERE security_key=?',run.asset.market+':'+run.asset.symbol);if(flow?.payload)run.earnings={available:true,asOf:flow.updated_at,href:'/stock/'+run.asset.market+'/'+run.asset.symbol+'?tab=financial#earnings-inflection',note:'기존 실적 흐름 · 이번 촉매 분석과 별도'};}
  await persistGraph(store,run,run.candidates);
  run.completedAt=new Date().toISOString();await store.putCache(cacheKey,{...run,sources:run.sources.map(({body,text,excerpt,...s})=>s)},run.asset?.kind==='CRYPTO'?config.ttl.cryptoMove:config.ttl.stockMove);
 }catch(e){const failure=e instanceof CatalystError?e.code:'processing_failed';
  if(fallback){const identity={id:run.id,createdAt:run.createdAt,query:run.query};Object.assign(run,fallback.value,identity,{state:'complete',code:'stale_result',cached:true,stale:true,cacheAsOf:fallback.at,refreshFailure:failure,message:'갱신에 실패해 이전 분석을 표시합니다. 현재 상황으로 해석하지 마세요.'});if(run.market)run.market={...run.market,stale:true};}
  else{run.state='failed';run.code=failure;run.message=messages[run.code]||'분석 자료 처리에 실패했습니다. 다시 시도해 주세요.';}
 }
 finally{run.elapsedMs=Date.now()-started;run.completedAt||=new Date().toISOString();run.sources=run.sources?.map(({body,text,excerpt,...s})=>s);await store.saveRun(run);}
}
