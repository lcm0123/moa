import {CryptoStore} from './store.mjs';
import {CryptoHistory} from './history.mjs';
import {parsePerformance,matchIdentity,DAY,customReturns,PERIODS} from './model.mjs';
import {categoryInfo,categoryLabels,primaryCategory} from './categories.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class CryptoService {
 constructor(env,{fetcher=fetch}={}){this.env=env;this.fetcher=fetcher;this.store=new CryptoStore(env.DB);this.history=new CryptoHistory(env,this.store,{fetcher});this.interval=Math.max(60000,(Number(env.CRYPTO_REFRESH_SECONDS)||300)*1000);this.metadataInterval=Math.max(3600000,(Number(env.CRYPTO_METADATA_HOURS)||24)*3600000);this.pending=new Map();this.metadataJob=null;this.progress=null;this.cmcQueue=Promise.resolve();this.lastCmc=0;}
 safe(message){let text=String(message||'연결 오류');for(const k of [this.env.FINVIZ_AUTH,this.env.CMC_API_KEY])if(k)text=text.replaceAll(k,'[redacted]');return text.replace(/https?:\/\/\S+/g,'[url]').slice(0,240);}
 async shared(key,ttl,loader){
  const old=await this.store.read(key);if(old&&old.expires>Date.now())return {...old,stale:false};if(this.pending.has(key))return this.pending.get(key);
  const task=(async()=>{try{const value=await loader();return {...await this.store.write(key,value,ttl),stale:false};}catch(error){const message=this.safe(error.message);if(old)return {...old,stale:true,error:message};throw new Error(message);}finally{this.pending.delete(key);}})();this.pending.set(key,task);return task;
 }
 async prices(){
  const result=await this.shared('finviz:crypto:performance',this.interval,async()=>{
   const diag=(await this.store.diagnostics()).find(d=>d.endpoint==='finviz_crypto');if(diag?.retry_after>Date.now())throw new Error(diag.message);
   if(!this.env.FINVIZ_AUTH?.trim())throw new Error('FINVIZ_AUTH 설정 필요');
   const url=new URL(this.env.FINVIZ_CRYPTO_EXPORT_URL||'https://elite.finviz.com/export/crypto/performance');
   // Server-configured path is replaceable; authentication never leaves the Finviz host.
   if(url.origin!=='https://elite.finviz.com'||!url.pathname.startsWith('/export/')||url.username||url.password||url.search||url.hash)throw new Error('Finviz Export URL 설정을 확인해 주세요.');
   url.searchParams.set('auth',this.env.FINVIZ_AUTH.trim());let response;
   try{
    response=await this.fetcher(url,{headers:{Accept:'text/csv'},redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('Finviz Crypto HTTP '+response.status);
    if(!/csv|octet-stream|text\/plain/i.test(response.headers.get('content-type')||''))throw new Error('Finviz CSV 대신 로그인 또는 다른 형식의 응답을 받았습니다.');
    if(Number(response.headers.get('content-length'))>2000000)throw new Error('Finviz Crypto 응답 크기 초과');
    const text=await response.text();if(text.length>2000000)throw new Error('Finviz Crypto 응답 크기 초과');
    const receivedAt=new Date().toISOString(),items=parsePerformance(text,receivedAt);if(!items.length)throw new Error('Finviz Crypto CSV에 코인이 없습니다.');
    await this.store.diagnostic('finviz_crypto',response.status,0,'CSV 정상');return {items,receivedAt,columns:text.split(/\r?\n/)[0].split(','),rawCsv:text};
   }catch(error){const message=this.safe(error.message);await this.store.diagnostic('finviz_crypto',response?.status||503,'error',message,Date.now()+(response?.status===429?3600000:60000));throw new Error(message);}
  });
  // On restart, preserve a valid cached snapshot using its original receipt time.
  const {items,receivedAt}=result.data;
  if(this.lastObservation!==receivedAt){const bucket=new Date(Math.floor(Date.parse(receivedAt)/300000)*300000).toISOString(),kstDay=new Date(Date.parse(receivedAt)+9*3600000).toISOString().slice(0,10);await this.env.DB.batch(items.map(c=>this.env.DB.prepare('INSERT INTO crypto_observations(instrument_id,bucket,kst_day,price,received_at,currency) VALUES(?,?,?,?,?,?) ON CONFLICT(instrument_id,bucket) DO NOTHING').bind(c.id,bucket,kstDay,c.price,receivedAt,'USD')));this.lastObservation=receivedAt;}
  return result;
 }
 async cmc(path,params={},ttl=this.metadataInterval){
  const key=path+'?'+new URLSearchParams(params);
  return this.shared(key,ttl,async()=>{
   const job=async()=>{
    if(!this.env.CMC_API_KEY)throw new Error('CMC_API_KEY 설정 필요 · 분야 미분류');
    const diag=(await this.store.diagnostics()).find(d=>d.endpoint===path||d.endpoint==='cmc_global');if(diag?.retry_after>Date.now())throw new Error(diag.message);
    const days=await this.store.usage(),day=new Date().toISOString().slice(0,10),used=days.find(d=>d.day===day)?.rest_credits||0;
    if(used>=(Number(this.env.CMC_DAILY_CREDITS)||400))throw new Error('CMC 일일 호출 예산 보호 · 마지막 분야 정보 유지');
    await pause(Math.max(0,1300-(Date.now()-this.lastCmc)));this.lastCmc=Date.now();let response,body;
    try{response=await this.fetcher('https://pro-api.coinmarketcap.com'+key,{headers:{'X-CMC_PRO_API_KEY':this.env.CMC_API_KEY,Accept:'application/json'},signal:AbortSignal.timeout(20000)});body=await response.json();}catch{throw new Error('CMC 분야 연결 오류');}
    await this.store.usage(Number(body.status?.credit_count)||0,0,1);const code=Number(body.status?.error_code||0);
    if(!response.ok||code){const msg=this.safe(body.status?.error_message||'CMC HTTP '+response.status);await this.store.diagnostic([1001,1007,1010].includes(code)||response.status===429?'cmc_global':path,response.status,code,msg,Date.now()+(response.status===429?3600000:6*3600000));throw new Error(msg);}
    await this.store.diagnostic(path,response.status,0,'분야 데이터 정상');return body;
   };const result=this.cmcQueue.then(job,job);this.cmcQueue=result.catch(()=>{});return result;
  });
 }
 async refreshMetadata(items){
  if(this.metadataJob)return this.metadataJob;
  this.metadataJob=(async()=>{try{
   this.progress='코인 식별자 확인 중';
   const identity=await this.cmc('/v1/cryptocurrency/map',{symbol:[...new Set(items.map(c=>c.symbol))].join(',')});if(identity.stale)throw new Error(identity.error);
   const matched=items.map(c=>({...c,...matchIdentity(c,identity.data.data||[])}));const wantedIds=new Set(matched.filter(c=>c.cmcId).map(c=>c.cmcId));
   await this.env.DB.batch(matched.map(c=>this.env.DB.prepare('INSERT INTO crypto_identity_map VALUES(?,?,?,?,?,?,?) ON CONFLICT(instrument_id) DO UPDATE SET finviz_name=excluded.finviz_name,cmc_id=excluded.cmc_id,status=excluded.status,checked_at=excluded.checked_at,evidence=excluded.evidence').bind(c.id,c.ticker,c.name,c.cmcId,c.status,new Date().toISOString(),c.evidence)));
   const all=await this.cmc('/v1/cryptocurrency/categories');if(all.stale)throw new Error(all.error);
   let names=Object.keys(categoryLabels);try{if(this.env.CRYPTO_CATEGORY_NAMES)names=JSON.parse(this.env.CRYPTO_CATEGORY_NAMES);}catch{throw new Error('CRYPTO_CATEGORY_NAMES JSON 설정 오류');}
   const selected=(all.data.data||[]).filter(c=>names.includes(c.name)).map(categoryInfo),membership=new Map(),caps=new Map(),complete=[];
   for(let ci=0;ci<selected.length;ci++){
    const category=selected[ci];this.progress=`분야 연결 ${ci+1}/${selected.length} · ${category.label}`;let total=category.numTokens||0,seen=new Set();
    for(let start=1;start<=Math.max(total,1);start+=1000){
     const r=await this.cmc('/v1/cryptocurrency/category',{id:category.id,start,limit:1000,convert:'USD'});if(r.stale)throw new Error(r.error);const data=r.data.data,rows=data?.coins;if(!Array.isArray(rows))throw new Error('CMC Category 응답 형식 오류');total=data.num_tokens||total;
     for(const row of rows){seen.add(row.id);if(!wantedIds.has(row.id))continue;const set=membership.get(row.id)||[];if(!set.some(c=>c.id===category.id))set.push(category);membership.set(row.id,set);const q=Array.isArray(row.quote)?row.quote.find(q=>q.symbol==='USD'):row.quote?.USD;if(q?.market_cap>0){const current=caps.get(row.id),at=q.last_updated||row.last_updated;if(!current||Date.parse(at)>Date.parse(current.at))caps.set(row.id,{value:q.market_cap,at,receivedAt:r.receivedAt});}}
     if(rows.length<1000)break;if(start>=30000)throw new Error('CMC 분야 구성 페이지 범위 확인 필요');
    }
    complete.push({...category,loadedMembers:seen.size,membershipComplete:seen.size>=total});
   }
   const result={items:matched.map(c=>{const categories=membership.get(c.cmcId)||[],cap=caps.get(c.cmcId);return {id:c.id,finvizName:c.name,cmcId:c.cmcId,mappingStatus:c.status,mappingReason:c.evidence,categories,primary:primaryCategory(categories),marketCap:cap?.value??null,capAsOf:cap?.at??null,capReceivedAt:cap?.receivedAt??null};}),categories:complete,receivedAt:new Date().toISOString(),source:'CoinMarketCap Categories / Category',scope:'설정된 CMC 분야만 비교 · 현재 구성 기준'};
   await this.store.write('crypto:metadata',result,this.metadataInterval);await this.store.diagnostic('crypto_metadata',200,0,'연결 완료');this.progress=null;return result;
  }catch(e){this.progress=null;await this.store.diagnostic('crypto_metadata',503,'error',this.safe(e.message),Date.now()+300000);return null;}finally{this.metadataJob=null;}})();return this.metadataJob;
 }
 async snapshot(query=new URLSearchParams()){
  let prices;try{prices=await this.prices();}catch(e){return {status:'error',items:[],categories:[],message:this.safe(e.message),source:'Finviz Elite Crypto Performance',mode:'periodic',intervalSeconds:this.interval/1000};}
  const meta=await this.store.read('crypto:metadata'),diag=(await this.store.diagnostics()).find(d=>d.endpoint==='crypto_metadata');
  if((!meta||meta.expires<Date.now())&&(!diag||diag.retry_after<Date.now()))void this.refreshMetadata(prices.data.items);
  const map=new Map((meta?.data.items||[]).map(c=>[c.id,c]));let items=prices.data.items.map(c=>{const saved=map.get(c.id),linked=saved&&(!saved.finvizName||saved.finvizName===c.name)?saved:null;return {...c,...linked,capStale:!meta||meta.expires<Date.now()||!linked?.capAsOf||Date.now()-Date.parse(linked.capAsOf)>2*DAY,primary:linked?.primary||primaryCategory([])};});
  const bounds=(await this.env.DB.prepare('SELECT MIN(kst_day) AS first,MAX(kst_day) AS last,MIN(received_at) AS firstAt,MAX(received_at) AS lastAt FROM crypto_observations').all()).results[0];
  if(query.get('period')==='custom'){
   const start=query.get('start'),end=query.get('end');if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||start>=end||start<bounds.first||end>bounds.last)throw new Error('저장된 범위 안의 서로 다른 시작일·종료일을 선택해 주세요.');
   const records=(await this.env.DB.prepare('SELECT * FROM crypto_observations WHERE kst_day IN (?,?) ORDER BY received_at').bind(start,end).all()).results;items=customReturns(items,records,start,end);
  }
  return {status:'ready',items,categories:meta?.data.categories||[],periods:PERIODS.map(([id,label])=>({id,label})),receivedAt:prices.data.receivedAt,source:'Finviz Elite Crypto Performance',mode:'periodic',stale:prices.stale||Date.now()-Date.parse(prices.data.receivedAt)>this.interval*2,message:prices.error||null,columns:prices.data.columns,metadata:{receivedAt:meta?.receivedAt||null,stale:meta?meta.expires<Date.now():true,progress:this.progress,error:diag?.code==='error'?diag.message:null,scope:meta?.data.scope||'분야 연결 중'},history:{...bounds,basis:'KST 해당일 최초 저장 가격 · 과거 시계열 미연결'},intervalSeconds:this.interval/1000};
 }
 async chart(id,days=0){
  if(!/^finviz:@?[A-Z0-9._-]{1,30}$/.test(id))throw new Error('코인 식별자를 확인해 주세요.');
  days=[0,1,7,30,90,180,365,1095].includes(days)?days:0;
  const prices=await this.prices(),coin=prices.data.items.find(c=>c.id===id);
  if(!coin)throw new Error('Finviz 제공 목록에 없는 코인입니다.');
  const history=await this.history.get(coin);
  if(history.bars.length){
   const last=history.bars.at(-1),from=days?last.time-(days-1)*86400:-Infinity,bars=history.bars.filter(b=>b.time>=from);
   return {points:bars.map(b=>({...b,at:new Date(b.time*1000).toISOString(),price:b.close})),source:history.source,currency:'USD',kind:'line',interval:'daily',asOfKind:'provider_daily',receivedAt:history.receivedAt,dataAsOf:last.date,providerLastTime:history.lastTime,firstAt:history.bars[0].date,lastAt:last.date,totalBars:history.bars.length,complete:history.complete,stale:history.stale,available:{first:history.bars[0].date,last:last.date},message:[history.error,history.complete?'공급처가 반환한 전체 일봉':'과거 일봉 일부 수집',`${history.bars.length.toLocaleString('ko-KR')}개`,history.lastDate===last.date?'마지막 일봉은 진행 중일 수 있습니다':null].filter(Boolean).join(' · ')};
  }
  // Preserve genuine collected observations as an explicitly identified fallback.
  const after=days?new Date(Date.now()-days*DAY).toISOString():'0000',group=days===0||days>7?'kst_day':days>1?'substr(received_at,1,13)':"substr(received_at,1,16)";
  const result=(await this.env.DB.prepare('SELECT price,received_at FROM crypto_observations WHERE instrument_id=? AND received_at>=? AND received_at IN (SELECT MIN(received_at) FROM crypto_observations WHERE instrument_id=? AND received_at>=? GROUP BY '+group+') ORDER BY received_at').bind(id,after,id,after).all()).results;
  return {points:result.map(r=>({at:r.received_at,price:r.price})),source:'Finviz Elite · 서버 수신 후 저장 가격',currency:'USD',kind:'line',interval:'observations',asOfKind:'received',receivedAt:result.at(-1)?.received_at||null,firstAt:result[0]?.received_at||null,complete:false,stale:true,message:history.error+' · 과거 일봉 연결 실패, 수집 이후 가격만 표시'};
 }
 start(){if(!this.env.FINVIZ_AUTH)return;const tick=()=>this.snapshot().catch(()=>{});void tick();const timer=setInterval(tick,this.interval);timer.unref?.();return ()=>clearInterval(timer);}
}
