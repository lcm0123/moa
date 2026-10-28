import {managerProviderQuery} from '../manager-search.mjs';
import {finvizStocks} from './finviz-stocks.mjs';
import {finvizCsv,parseCsv,csvNumber,requireFinviz,FinvizError,digest} from './finviz-client.mjs';
import {parseCover,parseInformationTable,resolveFilings,enrichPositions,comparePositions,sectorAllocation} from '../manager-model.mjs';
import {secFetch} from '../sec-client.mjs';
const cache=new Map();
const validCik=cik=>/^\d{1,10}$/.test(String(cik));
const cikKey=cik=>String(Number(cik));
function safeSlug(slug){if(!/^[a-z0-9-]{1,180}$/.test(slug||''))throw new Error('Invalid manager slug');return slug;}
async function readResponse(response,max){if(!response.ok)throw new Error('Provider HTTP '+response.status);if(Number(response.headers.get('content-length')||0)>max){await response.body?.cancel();throw new Error('Response too large');}const reader=response.body.getReader(),decoder=new TextDecoder();let text='',size=0;while(true){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;if(size>max){await reader.cancel();throw new Error('Response too large');}text+=decoder.decode(p.value,{stream:true});}return text+decoder.decode();}
async function publicData(url,env,format='json',ttl=900000){
 const parsed=new URL(url);if(!['finviz.com','data.sec.gov','www.sec.gov'].includes(parsed.hostname)||parsed.protocol!=='https:')throw new Error('Invalid provider');
 const existing=cache.get(url);if(existing&&existing.until>Date.now())return existing.promise;
 const run=async()=>{const accept=format==='json'?'application/json':format==='html'?'text/html':'application/xml';const response=parsed.hostname.endsWith('sec.gov')?await secFetch(env,url,accept):await fetch(url,{headers:{Accept:accept,'User-Agent':env.SEC_USER_AGENT||'MoaMarket Local Research'},redirect:'error',signal:AbortSignal.timeout(20000)});const text=await readResponse(response,format==='xml'?32000000:16000000);return format==='json'?JSON.parse(text):text;};
 const promise=run();
 cache.set(url,{until:Date.now()+ttl,promise});
 const release=()=>{if(cache.get(url)?.promise===promise)cache.delete(url);};
 // Persist parsed snapshots, not tens of megabytes of raw XML per large filer.
 promise.then(()=>{if(format==='xml')release();},release);
 if(cache.size>250)cache.delete(cache.keys().next().value);return promise;
}
export function parseManagerExport(text){
 return parseCsv(text,['Ticker','Name','Type','Sector','Shares Held','Market Value']).map(r=>{
  const kind=String(r.Type).toLowerCase(),shares=csvNumber(r['Shares Held']),valueUsd=csvNumber(r['Market Value']);if(!['share','put','call'].includes(kind)||shares===null||valueUsd===null||shares<0||valueUsd<0)throw new Error('Invalid holdings CSV');
  return {ticker:/^[A-Z0-9.^-]{1,20}$/.test(r.Ticker)?r.Ticker:null,name:r.Name,kind,shares,valueUsd,sector:r.Sector.trim()||null,industry:r.Industry?.trim()||null};
 });
}
async function saveManager(env,m){if(!env.DB)return;await env.DB.prepare('INSERT INTO manager_directory(cik,name,people,slug,period,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(cik) DO UPDATE SET name=excluded.name,people=excluded.people,slug=COALESCE(excluded.slug,manager_directory.slug),period=excluded.period,updated_at=excluded.updated_at').bind(m.cik,m.name,JSON.stringify(m.people),m.slug,m.period,new Date().toISOString()).run();}
export async function searchManagers(env,q='',page=1){
 requireFinviz(env,'display','MANAGERS');
 const query=managerProviderQuery(q);
 const result=await publicData('https://finviz.com/api/managers/list?'+new URLSearchParams({page:String(page),search:query}),env);
 if(!Array.isArray(result.items)||!Number.isInteger(result.totalPages))throw new Error('Manager list schema');
 const grouped=new Map();for(const entry of result.items){const f=entry.filer;if(!validCik(f?.filerCik)||!f.filerName)continue;const cik=cikKey(f.filerCik),existing=grouped.get(cik),people=[f.portfolioManager,f.otherManagerName].filter(Boolean);if(existing){existing.people=[...new Set([...existing.people,...people])];continue;}
  grouped.set(cik,{cik,name:f.filerName,people,slug:f.investorType==='manager_13f'&&entry.slug?safeSlug(entry.slug):null,period:f.reportDate,totalValue:entry.latestSummaries?.[0]?.totalSumOfUsdValue??null,holdingCount:entry.latestSummaries?.[0]?.totalCountOfInvestments??null});
 }
 const items=[...grouped.values()];for(const m of items)await saveManager(env,m);
 return {status:items.length?'ready':'empty',items,page,nextPage:page<result.totalPages?page+1:null,source:'Finviz Manager',receivedAt:new Date().toISOString()};
}
function filingRows(data){return (data?.form||[]).map((form,i)=>({form,period:data.reportDate[i],filedAt:data.filingDate[i],accession:data.accessionNumber[i],document:data.primaryDocument[i]})).filter(r=>['13F-HR','13F-HR/A'].includes(r.form)&&/^\d{4}-\d\d-\d\d$/.test(r.period)&&/^\d{10}-\d\d-\d{6}$/.test(r.accession));}
async function secHistory(cik,env){const data=await publicData(`https://data.sec.gov/submissions/CIK${cik.padStart(10,'0')}.json`,env);if(!validCik(data.cik)||cikKey(data.cik)!==cik)throw new Error('SEC filer identity mismatch');let filings=filingRows(data.filings?.recent);for(const file of (data.filings?.files||[]).slice(0,3)){if(new Set(filings.map(f=>f.period)).size>=5)break;if(!/^CIK\d{10}-submissions-\d+\.json$/.test(file.name))continue;filings.push(...filingRows(await publicData('https://data.sec.gov/submissions/'+file.name,env)));}return {name:data.name,filings};}
async function readSecFiling(cik,filing,env){
 const base=`https://www.sec.gov/Archives/edgar/data/${cik}/${filing.accession.replaceAll('-','')}/`;
 const listing=await publicData(base+'index.json',env),documents=listing.directory?.item?.map(x=>x.name).filter(n=>/^[\w.-]+\.xml$/i.test(n))||[];
 const primary=filing.document.split('/').at(-1);if(!documents.includes(primary))throw new Error('SEC primary document missing');
 const coverXml=await publicData(base+primary,env,'xml');
 const cover=parseCover(coverXml,{...filing,cik});let rows=[];
 for(const file of documents.filter(n=>n!==primary)){const xml=await publicData(base+file,env,'xml');if(/<(?:[\w-]+:)?informationTable[\s>]/i.test(xml))rows.push(...parseInformationTable(xml,cover.multiplier));}
 return {...cover,rows,url:base+filing.accession+'-index.html'};
}
async function snapshot(cik,period,filings,slug,env,saved){
 const filingKey=await digest(JSON.stringify(filings.filter(f=>f.period===period).sort((a,b)=>a.accession.localeCompare(b.accession))));
 if(saved?.schemaVersion===2&&saved.filingKey===filingKey&&saved.enrichment==='ready')return {...saved,checkedAt:new Date().toISOString()};
 const chain=[];for(const filing of filings.filter(f=>f.period===period).sort((a,b)=>a.filedAt.localeCompare(b.filedAt)||a.accession.localeCompare(b.accession)))chain.push(await readSecFiling(cik,filing,env));
 const resolved=resolveFilings(chain);let enrichment='ready',exportRows=[];
 try{const csv=await finvizCsv(env,'/export/managers/'+safeSlug(slug)+'/holdings',{reportEndDate:period},900000);exportRows=parseManagerExport(csv.text);}catch{enrichment='unavailable';}
 const items=enrichPositions(resolved.items,exportRows),revision=await digest(JSON.stringify({filings:resolved.filings,items}));
 return {...resolved,schemaVersion:2,checkedAt:new Date().toISOString(),filingKey,period,items,revision,enrichment,mappedCount:items.filter(r=>r.ticker).length,receivedAt:new Date().toISOString(),source:'SEC 13F · Finviz 종목 연결'};
}
export async function persistSnapshot(env,cik,s){
 if(!env.DB)return;
 const existing=await env.DB.prepare('SELECT payload FROM manager_snapshots WHERE cik=? AND period=?').bind(cik,s.period).all();
 if(existing.results[0]&&JSON.parse(existing.results[0].payload).revision===s.revision&&JSON.parse(existing.results[0].payload).schemaVersion===s.schemaVersion){await env.DB.prepare('UPDATE manager_snapshots SET payload=?,updated_at=? WHERE cik=? AND period=?').bind(JSON.stringify(s),s.checkedAt,cik,s.period).run();return;}
 const insert=env.DB.prepare('INSERT OR REPLACE INTO manager_positions(cik,period,revision,security_id,ticker,kind,shares,value_usd) VALUES(?,?,?,?,?,?,?,?)');
 const write=async statements=>{if(env.DB.batch)await env.DB.batch(statements);else for(const statement of statements)await statement.run();};
 // New revision rows are invisible to readers until the final snapshot pointer is committed.
 for(let i=0;i<s.items.length;i+=250)await write(s.items.slice(i,i+250).map(r=>insert.bind(cik,s.period,s.revision,r.id,r.ticker,r.kind,r.shares,r.valueUsd)));
 await write([
  env.DB.prepare('INSERT INTO manager_snapshots(cik,period,payload,updated_at) VALUES(?,?,?,?) ON CONFLICT(cik,period) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').bind(cik,s.period,JSON.stringify(s),s.receivedAt),
  env.DB.prepare('DELETE FROM manager_positions WHERE cik=? AND period=? AND revision<>?').bind(cik,s.period,s.revision)
 ]);
}
const pending=new Map();
function detailResult(manager,history,policy,warning=null){
 const latest=history[0],comparison=comparePositions(latest,history[1]);
 return {status:'ready',manager,period:latest.period,filedAt:latest.filedAt,totalValue:latest.totalValue,holdingCount:latest.items.length,entryCount:latest.entryCount,filings:latest.filings,amended:latest.amended,confidential:latest.confidential,receivedAt:latest.receivedAt,source:latest.source,warning,policy,...comparison,
  history:policy.chart?['share','put','call','principal'].map(kind=>({kind,quarters:history.map(s=>sectorAllocation(s,kind)).reverse()})):[],mappedCount:latest.mappedCount,loadedQuarters:history.length};
}
export async function managerPeriodDetail(env,cik,period){
 const policy=requireFinviz(env,'display','MANAGERS');
 if(!env.DB)throw new FinvizError('공시 저장소 연결 필요');
 const rows=(await env.DB.prepare('SELECT payload FROM manager_snapshots WHERE cik=? AND period<=? ORDER BY period DESC LIMIT 4').bind(cikKey(cik),period).all()).results;
 const m=(await env.DB.prepare('SELECT * FROM manager_directory WHERE cik=?').bind(cikKey(cik)).all()).results[0];
 const history=rows.map(r=>JSON.parse(r.payload));
 if(!m||history[0]?.period!==period)return {status:'empty',items:[],message:'선택한 분기의 저장된 공시가 없습니다.'};
 return detailResult({...m,people:JSON.parse(m.people)},history,policy);
}
export async function managerDetail(env,input,{quarters=4}={}){
 const policy=requireFinviz(env,'display','MANAGERS');if(!validCik(input)||![1,4].includes(quarters))throw new Error('Invalid manager query');const cik=cikKey(input);
 const key=(await digest(env.FINVIZ_API_KEY))+':'+cik+':'+quarters;
 if(pending.has(key))return pending.get(key);
 const promise=(async()=>{
  const cached=env.DB?await env.DB.prepare('SELECT payload,updated_at FROM manager_snapshots WHERE cik=? ORDER BY period DESC LIMIT 4').bind(cik).all():{results:[]};
  const directory=env.DB?await env.DB.prepare('SELECT * FROM manager_directory WHERE cik=?').bind(cik).all():{results:[]};
  const saved=cached.results.map(r=>JSON.parse(r.payload)),m=directory.results[0];
  const savedManager=m?{cik,name:m.name,people:JSON.parse(m.people),slug:m.slug,period:saved[0]?.period}:null;
  if(savedManager&&saved.length>=quarters&&saved.slice(0,quarters).every(s=>s.schemaVersion===2&&Date.now()-Date.parse(s.checkedAt)<900000)){
   return detailResult(savedManager,saved.slice(0,quarters),policy);
  }
  let manager,history,warning=null;
  try{
   const [details,sec]=await Promise.all([publicData('https://finviz.com/api/managers/'+cik,env),secHistory(cik,env)]);
   const f=details.filer;if(cikKey(f?.filerCik)!==cik||!f.slug)throw new Error('Manager identity mismatch');
   manager={cik,name:sec.name||f.filerName,people:[f.portfolioManager].filter(Boolean),slug:safeSlug(f.slug),period:null};
   if(!manager.people.length&&m)manager.people=JSON.parse(m.people);
   const periods=[...new Set(sec.filings.map(f=>f.period))].sort().reverse().slice(0,quarters);if(!periods.length)return {status:'empty',manager,items:[],message:'공개된 13F 보유 공시가 없습니다.'};
   history=[];for(const period of periods){try{const s=await snapshot(cik,period,sec.filings,manager.slug,env,saved.find(s=>s.period===period));history.push(s);await persistSnapshot(env,cik,s);}catch{if(!history.length)throw new Error('Latest filing incomplete');warning='일부 이전 분기의 공시를 불러오지 못했습니다.';}}
   manager.period=history[0].period;await saveManager(env,manager);
  }catch{
   if(!saved.length||!savedManager)throw new FinvizError('운용사 공시를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.');
   manager=savedManager;history=saved.slice(0,quarters);warning='갱신 실패 · 마지막으로 확인한 공시입니다.';
  }
  return detailResult(manager,history,policy,warning);
 })();pending.set(key,promise);try{return await promise;}finally{pending.delete(key);}
}
export async function savedStockManagers(env,ticker){
 if(!env.DB)return {items:[],indexedManagers:0};
 const result=await env.DB.prepare(`SELECT p.cik,d.name,s.period,p.shares,p.value_usd,p.kind,s.updated_at,json_extract(s.payload,'$.filedAt') AS filedAt
 FROM manager_positions p JOIN manager_snapshots s ON s.cik=p.cik AND s.period=p.period AND p.revision=json_extract(s.payload,'$.revision')
 JOIN manager_directory d ON d.cik=p.cik WHERE p.ticker=? AND p.kind='share' AND p.shares>0 AND s.period=(SELECT MAX(n.period) FROM manager_snapshots n WHERE n.cik=p.cik)
 ORDER BY p.value_usd DESC LIMIT 100`).bind(ticker).all();
 const count=await env.DB.prepare('SELECT COUNT(DISTINCT cik) AS total FROM manager_snapshots').bind().all();
 return {items:result.results,indexedManagers:count.results[0].total};
}
export function parseStockOwners(html){
 const match=html.match(/<script\b(?=[^>]*\bid="institutional-ownership-init-data-0")[^>]*>([\s\S]*?)<\/script>/i);
 if(!match)throw new Error('Ownership response missing');
 const data=JSON.parse(match[1]);if(!Array.isArray(data.managersOwnership))throw new Error('Ownership schema changed');
 const found=new Map();for(const row of data.managersOwnership){
  if(!validCik(row.investorId)||!row.name||!Number.isFinite(row.percOwnership)||row.percOwnership<0)throw new Error('Invalid manager ownership');
  const cik=cikKey(row.investorId);if(!found.has(cik))found.set(cik,{cik,name:row.name,ownershipPct:row.percOwnership,kind:'share',period:null,shares:null,value_usd:null});
 }
 return [...found.values()];
}
export function verifiedStockHolding(detail,ticker){
 if(detail.status!=='ready'||detail.warning||!detail.period||!detail.filedAt)return null;
 const positions=(detail.items||[]).filter(r=>r.ticker===ticker&&r.kind==='share'&&r.unit==='SH'&&r.mappingStatus==='matched_filing_totals'&&r.shares>0&&!/NOTE|BOND|DEB|WARRANT|\bWTS\b|PFD|PREF|CONVERT|SDBCV/i.test(r.titleOfClass||''));
 if(!positions.length)return null;
 return {cik:detail.manager.cik,name:detail.manager.name,period:detail.period,filedAt:detail.filedAt,shares:positions.reduce((sum,r)=>sum+r.shares,0),value_usd:positions.reduce((sum,r)=>sum+r.valueUsd,0),kind:'share',ownershipPct:null,verified:true,securityIds:positions.map(r=>r.id)};
}
const ownerChecks=new Map();
export async function stockManagers(env,ticker){
 requireFinviz(env,'display','MANAGERS');if(!/^[A-Z0-9.^-]{1,20}$/.test(ticker))throw new Error('Invalid ticker');
 const key=(await digest(env.FINVIZ_API_KEY))+':'+ticker;let job=ownerChecks.get(key);
 if(!job||job.expires<Date.now()){
  job={expires:Date.now()+900000,items:[],processed:0,total:0,excluded:0,failed:0,pending:null};
  job.initializing=(async()=>{const html=await publicData('https://finviz.com/stock?'+new URLSearchParams({t:ticker}),env,'html');job.candidates=parseStockOwners(html).slice(0,10);job.total=job.candidates.length;})();
  ownerChecks.set(key,job);if(ownerChecks.size>40)ownerChecks.delete(ownerChecks.keys().next().value);
 }
 try{await job.initializing;}catch{ownerChecks.delete(key);throw new FinvizError('보유 운용사 후보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');}
 // Verify a bounded batch per request. The client can show verified results while
 // subsequent batches are checked, instead of rendering unverified candidates.
 if(!job.pending&&job.processed<job.total){
  job.pending=(async()=>{
   const candidates=job.candidates.slice(job.processed,job.processed+2);
   const results=await Promise.allSettled(candidates.map(async candidate=>verifiedStockHolding(await managerDetail(env,candidate.cik,{quarters:1}),ticker)));
   for(const result of results){if(result.status==='fulfilled'&&result.value)job.items.push(result.value);else if(result.status==='rejected')job.failed++;else job.excluded++;}
   job.processed+=candidates.length;
  })();
 }
 if(job.pending){const step=job.pending;try{await step;}finally{if(job.pending===step)job.pending=null;}}
 const done=job.processed===job.total;
 return {status:done?(job.items.length?'ready':job.failed?'incomplete':'empty'):'checking',ticker,items:[...job.items].sort((a,b)=>b.value_usd-a.value_usd),
  source:'SEC 13F · Finviz 종목 연결',coverage:'최신 공시에서 주식 보유 확인 · 후보 최대 10개',receivedAt:new Date().toISOString(),limited:true,
  verification:{done,checked:job.processed,total:job.total,excluded:job.excluded,failed:job.failed},
  message:done?(job.failed?'일부 공시를 확인하지 못했습니다. 확인된 주식 보유만 표시합니다.':job.items.length?'':'해당 종목의 주식 보유가 확인된 운용사가 없습니다.'):'최신 공시의 주식 보유를 대조하고 있습니다.'};
}

export async function searchManagerStocks(env,q){
 requireFinviz(env,'display','MANAGERS');
 const aliases={'엔비디아':'NVDA','애플':'AAPL','마이크로소프트':'MSFT','테슬라':'TSLA','아마존':'AMZN','메타':'META','알파벳':'GOOGL','구글':'GOOGL','인텔':'INTC','브로드컴':'AVGO','팔란티어':'PLTR','버크셔':'BRK-B'};
 const query=aliases[q.replaceAll(' ','')]||q;
 const result=await finvizStocks(env,{q:query});
 return {status:result.status,message:result.message,items:result.items.slice(0,12).map(({id,ticker,name,market})=>({id,ticker,name,market}))};
}
