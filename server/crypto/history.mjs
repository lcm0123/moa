// Observed in Finviz's official crypto chart on 2026-09-27. This is its public
// chart JSON route, not the authenticated Crypto Performance CSV contract.
// Never send FINVIZ_AUTH to this host. dateTo is the chart's older-bars cursor.
const ENDPOINT='https://api.finviz.com/api/quote';
const DAY=86400000;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export function parseCryptoHistory(data,ticker){
 if(!data||data.ticker!==ticker||data.name!==ticker.slice(0,-3)+'/USD'||data.timeframe!=='d')throw new Error('Finviz 코인 일봉 식별자 확인 필요');
 const keys=['date','open','high','low','close','volume'];
 if(keys.some(k=>!Array.isArray(data[k])||data[k].length!==data.date.length))throw new Error('Finviz 코인 일봉 배열 형식 오류');
 const bars=[],seen=new Set();
 for(let i=0;i<data.date.length;i++){
  const [time,open,high,low,close,volume]=keys.map(k=>data[k][i]);
  if(!Number.isSafeInteger(time)||time<0||time>Date.now()/1000+2*86400||[open,high,low,close].some(n=>!finite(n)||n<=0)||low>Math.min(open,close)||high<Math.max(open,close)||low>high||volume!==null&&(!finite(volume)||volume<0))throw new Error('Finviz 코인 일봉 값 확인 필요');
  const date=new Date(time*1000).toISOString().slice(0,10);
  if(seen.has(date))throw new Error('Finviz 코인 일봉 날짜 중복');seen.add(date);
  // Daily provider timestamps are session labels (13:00 UTC was observed), not
  // candle close/execution times. Preserve the raw value; render a date-only axis.
  bars.push({date,time,open,high,low,close,volume});
 }
 bars.sort((a,b)=>a.time-b.time);
 return {bars,lastTime:finite(data.lastTime)?new Date(data.lastTime*1000).toISOString():null,lastDate:Number.isInteger(data.lastDate)?String(data.lastDate).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'):null};
}
export function mergeCryptoBars(oldBars,newBars){return [...new Map([...oldBars,...newBars].map(b=>[b.date,b])).values()].sort((a,b)=>a.time-b.time);}
export class CryptoHistory {
 constructor(env,store,{fetcher=fetch,spacing=900}={}){this.env=env;this.store=store;this.fetcher=fetcher;this.spacing=spacing;this.queue=Promise.resolve();this.pending=new Map();this.lastRequest=0;this.ttl=Math.max(3600000,(Number(env.CRYPTO_HISTORY_HOURS)||6)*3600000);}
 async request(ticker,dateTo){
  const task=async()=>{
   const diag=(await this.store.diagnostics()).find(d=>d.endpoint==='finviz_crypto_history');
   if(diag?.retry_after>Date.now())throw new Error('Finviz 과거 가격 연결 대기');
   await new Promise(resolve=>setTimeout(resolve,Math.max(0,this.spacing-(Date.now()-this.lastRequest))));this.lastRequest=Date.now();
   const url=new URL(ENDPOINT);Object.entries({ticker,instrument:'crypto',timeframe:'d',aftermarket:'0',premarket:'0',patterns:'false',events:'false',chartEventsVersion:'2',...(dateTo!==undefined?{dateTo}:{})}).forEach(([k,v])=>url.searchParams.set(k,v));
   let response;
   try{response=await this.fetcher(url,{headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw new Error('Finviz 과거 가격 연결 실패');}
   if(!response.ok){
    if([401,403,429].includes(response.status))await this.store.diagnostic('finviz_crypto_history',response.status,'error','Finviz 과거 가격 HTTP '+response.status,Date.now()+(response.status===429?3600000:DAY));
    throw new Error('Finviz 과거 가격 HTTP '+response.status);
   }
   if(!/application\/json/i.test(response.headers.get('content-type')||''))throw new Error('Finviz 과거 가격 응답 형식 오류');
   const reader=response.body.getReader(),decoder=new TextDecoder();let text='',size=0;
   while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>4000000){await reader.cancel();throw new Error('Finviz 과거 가격 응답 크기 초과');}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();
   let data;try{data=JSON.parse(text);}catch{throw new Error('Finviz 과거 가격 JSON 오류');}
   return parseCryptoHistory(data,ticker);
  };
  const promise=this.queue.then(task,task);this.queue=promise.catch(()=>{});return promise;
 }
 async get(coin){
  const ticker=coin.symbol+'USD',key='finviz:crypto:daily:'+coin.id;
  const old=await this.store.read(key);if(old&&old.expires>Date.now())return {...old.data,stale:!!old.data.error};
  if(this.pending.has(key))return this.pending.get(key);
  const job=(async()=>{
   let current=old?.data;
   try{
    const latest=await this.request(ticker);if(!latest.bars.length)throw new Error('제공되는 코인 일봉이 없습니다.');
    let bars=mergeCryptoBars(current?.bars||[],latest.bars),before=latest.bars[0].time,pages=1,complete=false;
    const previousEnd=old?.data.complete?old.data.bars.at(-1)?.time:null;
    current={bars,ticker,source:'Finviz 코인 일봉 · 공식 차트 데이터',currency:'USD',receivedAt:new Date().toISOString(),lastTime:latest.lastTime,lastDate:latest.lastDate,complete:false};
    while(pages<16){
     if(previousEnd!=null&&before<=previousEnd){complete=true;break;}
     const older=await this.request(ticker,before);pages++;
     const extra=older.bars.filter(b=>b.time<before);
     if(!extra.length){complete=true;break;}
     // The latest response wins for overlapping dates; do not overwrite today's
     // still-changing candle with an older page's copy.
     bars=mergeCryptoBars(extra,bars);before=extra[0].time;current.bars=bars;
    }
    current={...current,bars,complete,pages,error:complete?null:'이전 일봉 추가 수집 필요'};
    await this.store.write(key,current,complete?this.ttl:3600000);
    return {...current,stale:false};
   }catch(error){
    const message=String(error.message).startsWith('Finviz')||String(error.message).startsWith('제공되는')?error.message:'Finviz 과거 가격 조회 실패';
    if(current?.bars?.length){current={...current,error:message};await this.store.write(key,current,300000);return {...current,stale:true};}
    // Cache negative results as well: hovering/reloading must not retry a
    // missing instrument or unavailable endpoint for every visitor.
    const empty={bars:[],ticker,source:'Finviz 코인 일봉 · 공식 차트 데이터',currency:'USD',complete:false,receivedAt:null,error:message};
    await this.store.write(key,empty,300000);return {...empty,stale:true};
   }finally{this.pending.delete(key);}
  })();this.pending.set(key,job);return job;
 }
}
