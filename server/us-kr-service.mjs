import {industryScreen} from './us-kr-screen.mjs';
import {sectorProvider} from './providers/sectors.mjs';
import {requireFinviz} from './providers/finviz-client.mjs';
import {fscPolicy} from './providers/data-go-kr-model.mjs';
import {historyPolicy} from './sector-history.mjs';
import {collectCompanyEvidence} from './us-kr-evidence.mjs';
import {sessionPair,industryAnalysis,nextDayReactions,rules,version,calendar} from './us-kr-model.mjs';
const parse=s=>{try{return JSON.parse(s);}catch{return null;}};
const rows=async(env,sql,...args)=>(await env.DB.prepare(sql).bind(...args).all()).results;
async function runtime(env,key,value){await env.DB.prepare('INSERT INTO us_kr_runtime(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,JSON.stringify(value)).run();}
export function relatedPolicy(env){try{requireFinviz(env,'display');return historyPolicy(env).display&&fscPolicy(env,'stocks').display;}catch{return false;}}
export async function syncUsKr(env,{now=Date.now(),batchSize=3,loadScreen=industryScreen,loadSector=sectorProvider,collect=collectCompanyEvidence}={}){
 if(!env.DB||!relatedPolicy(env)||!historyPolicy(env).store)return {status:'restricted',message:'기존 시세·가공 데이터 저장/표시 설정 확인 필요'};
 const pair=sessionPair(now);if(!pair)return {status:'incomplete',message:'거래일 달력 갱신 필요'};
 await env.DB.prepare("INSERT INTO us_kr_runtime(key,value) VALUES('lease','0') ON CONFLICT(key) DO NOTHING").run();
 const lease=await env.DB.prepare("UPDATE us_kr_runtime SET value=? WHERE key='lease' AND CAST(value AS INTEGER)<?").bind(String(now+20*60000),now).run();if(!lease.meta.changes)return {status:'busy'};
 let error=null;const collected=[];
 try{
  const id=pair.us.date+':'+version;
  if(pair.canCollect&&!(await rows(env,'SELECT id FROM us_kr_industry_snapshots WHERE id=?',id)).length){
   const screen=await loadScreen(env),snapshot=industryAnalysis(screen,pair);
   await env.DB.prepare('INSERT INTO us_kr_industry_snapshots(id,session_date,close_at,observed_at,classification_at,version,payload) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,snapshot.sessionDate,snapshot.closeAt,snapshot.observedAt,snapshot.classificationAt,version,JSON.stringify(snapshot)).run();
  }
  // Two existing index universes, not a new securities directory. DART's exact
  // ordinary ticker mapping subsequently rejects preferred/product identities.
  const stocks=new Map();for(const index of ['KOSPI200','KOSDAQ150']){const feed=await loadSector(env,'KR',index);if(feed.status!=='ready')throw Error('국내 구성종목·시세 연결 필요');for(const group of feed.items)for(const stock of group.stocks||[]){if(stock.type!=='stock')continue;stocks.set(stock.id,{...stock,ticker:stock.id,exchange:index==='KOSPI200'?'KOSPI':'KOSDAQ',sector:group.name,quoteSource:feed.source,syncedAt:feed.syncedAt,baseDate:feed.baseDate||stock.asOf,stale:!!feed.stale});}}
  const jobs=await rows(env,'SELECT * FROM us_kr_business_jobs'),byTicker=new Map(jobs.map(j=>[j.ticker,j]));
  const versionChecked=new Set((await rows(env,'SELECT DISTINCT ticker FROM us_kr_evidence WHERE version=?',version)).map(r=>r.ticker));for(const j of jobs)if(j.latest_receipt&&!versionChecked.has(j.ticker))j.next_check=0;
  const due=[...stocks.values()].filter(s=>(byTicker.get(s.ticker)?.next_check||0)<=now).sort((a,b)=>b.marketCap-a.marketCap).slice(0,Math.max(0,Math.min(10,batchSize)));
  for(const s of due){try{collected.push(await collect(env,s));}catch{await env.DB.prepare('INSERT INTO us_kr_business_jobs(ticker,corp_code,name,next_check,checked_at,error) VALUES(?,?,?, ?,?,?) ON CONFLICT(ticker) DO UPDATE SET next_check=excluded.next_check,error=excluded.error').bind(s.ticker,'',s.name,now+86400000,new Date(now).toISOString(),'공시 수집 또는 검증 실패 · 이전 근거 유지').run();collected.push({ticker:s.ticker,error:true});}globalThis.gc?.();}
  const snapshots=(await rows(env,'SELECT payload FROM us_kr_industry_snapshots ORDER BY session_date DESC,observed_at DESC,version DESC LIMIT 750')).map(r=>parse(r.payload)).filter(Boolean),latest=snapshots[0];
  if(!latest)throw Error('정규장 마감 후 수집된 산업 자료가 없습니다');
  const evidence=(await rows(env,'SELECT payload FROM us_kr_evidence ORDER BY checked_at DESC')).map(r=>parse(r.payload)).filter(Boolean);
  const newest=new Map();for(const e of evidence)if(!newest.has(e.ticker)||e.receipt>newest.get(e.ticker))newest.set(e.ticker,e.receipt);
  const current=evidence.filter(e=>e.receipt===newest.get(e.ticker)&&e.version===version),candidates=[];
  const indexRows=await rows(env,'SELECT id,payload FROM fsc_index_history WHERE id IN (?,?)','KOSPI','KOSDAQ'),indices=new Map(indexRows.map(r=>[r.id,parse(r.payload)||[]]));
  const updatedJobs=new Map((await rows(env,'SELECT ticker,error,checked_at FROM us_kr_business_jobs')).map(j=>[j.ticker,j]));
  for(const e of current){
   const stock=stocks.get(e.ticker);if(!stock||e.isin!==stock.isin)continue;
   const job=updatedJobs.get(e.ticker),evidenceStale=!!job?.error||Date.parse(job?.checked_at||e.checkedAt)<now-9*86400000;
   const stockHistory=e.status==='verified'?(await rows(env,"SELECT payload FROM fsc_stock_history WHERE stock_id=? AND isin=? AND operation='stocks'",e.ticker,e.isin)).flatMap(r=>parse(r.payload)||[]):[];
   const reactions=nextDayReactions(snapshots,evidence.filter(x=>x.ticker===e.ticker),stockHistory,indices.get(stock.exchange)||[],stock.exchange,e.topic,now);
   candidates.push({...e,evidenceStale,status:evidenceStale?'pending':e.status,reason:evidenceStale?'사업 근거 최신 확인 지연 · 관찰 후보에서 제외':e.reason,reactions,quote:{price:stock.price,changePct:stock.changePct,currency:'KRW',baseDate:stock.baseDate,syncedAt:stock.syncedAt,source:stock.quoteSource,mode:'previous_close',stale:stock.stale},stockUrl:'/stock/KR/'+e.ticker+'?tab=company'});
  }
  const payload={status:'ready',snapshot:latest,candidates,updatedAt:new Date().toISOString(),targetCount:stocks.size,checkedCount:[...stocks.keys()].filter(t=>updatedJobs.has(t)).length,pendingCount:current.filter(e=>e.status!=='verified').length,calendarThrough:calendar.through,minimumSamples:rules.minBacktestSamples,
   limitations:['미국 산업 분석은 현재 관측 S&P 500·나스닥100·다우30 합집합입니다.','사업 제품과 매출 비중을 같은 공시 표에서 확인한 연결만 후보로 표시합니다. 복합 사업은 확인 중으로 분리합니다.','고객사·경쟁사 관계는 명시적 공시 근거가 없으면 생성하지 않습니다. 공급 관계는 특정 미국 회사와의 계약 확인을 뜻하지 않습니다.','현재 분류를 과거에 소급한 섹터 복원 자료는 백테스트에서 제외합니다. 과거 성과는 미래 상승 확률이 아닙니다.','국내 시세는 공급된 전일 기준 값이며 장중 시세가 아닙니다.'],collection:collected};
  await env.DB.prepare("INSERT INTO us_kr_cache(id,payload,updated_at) VALUES('latest',?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").bind(JSON.stringify(payload),payload.updatedAt).run();
  await runtime(env,'lastRun',{at:new Date().toISOString(),status:'ready',session:latest.sessionDate});return {status:'ready',session:latest.sessionDate,industries:latest.industries.length,candidates:candidates.filter(c=>c.status==='verified').length,collected};
 }catch(e){error=e.message==='정규장 마감 후 수집된 산업 자료가 없습니다'?e.message:'수집·검증 실패 · 마지막 저장 결과 표시';await runtime(env,'lastRun',{at:new Date().toISOString(),status:'error',message:error});return {status:'error',message:error};}
 finally{await runtime(env,'lease',0);}
}
export async function readUsKr(env,now=Date.now()){
 if(!relatedPolicy(env))return {status:'restricted',message:'기존 Finviz·국내 시세·가공 데이터 표시 설정 확인 필요',candidates:[]};
 if(!env.DB)return {status:'empty',message:'저장소 연결 필요',candidates:[]};
 const saved=parse((await rows(env,"SELECT payload FROM us_kr_cache WHERE id='latest'"))[0]?.payload),lastRun=parse((await rows(env,"SELECT value FROM us_kr_runtime WHERE key='lastRun'"))[0]?.value),pair=sessionPair(now);
 if(!saved)return {status:lastRun?.status==='error'?'error':'empty',message:lastRun?.message||'미국장 마감 후 산업·사업 근거를 수집하고 있습니다.',candidates:[],lastRun};
 const stale=!pair||pair.us.date!==saved.snapshot.sessionDate||lastRun?.status==='error'||now-Date.parse(saved.updatedAt)>2*86400000;
 return {...saved,stale,lastRun,message:stale?'갱신 지연 · 아래에 표시된 저장 당시 미국장·국내 거래일 기준입니다.':null};
}
