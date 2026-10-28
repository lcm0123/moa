export const changeLabels={new:'신규',increased:'보유 수량 증가',reduced:'보유 수량 감소',unchanged:'유지',disposed:'청산',unknown:'비교 불가'};
export const eventLabels={earnings:'실적',calendar:'일정',report:'리포트',manager:'운용사',price:'주가'};
export function priceEvents(stock,feed){
 if(!feed.policy?.chart)return [];const bars=[...(stock.history||[])].filter(b=>/^\d{4}-\d\d-\d\d$/.test(b.date)&&Number.isFinite(b.value)).sort((a,b)=>a.date.localeCompare(b.date)),events=[];
 for(let i=1;i<bars.length;i++){const p=bars[i-1],b=bars[i];if(p.value<=0)continue;const pct=(b.value/p.value-1)*100;if(Math.abs(pct)<5)continue;events.push({id:'price:'+stock.market+':'+stock.ticker+':'+b.date,key:stock.market+':'+stock.ticker,kind:'price',title:'일봉 종가 '+(pct>0?'+':'')+pct.toFixed(2)+'%',date:b.date,originalDate:b.date,timeZone:stock.market==='US'?'미국 거래일':'한국 거래일',precision:'date',updatedAt:stock.historyReceivedAt,source:stock.historySource||feed.source,chartDate:b.date,dataDate:b.date,close:b.value,previousClose:p.value,referenceDate:p.date,changePct:pct,detail:'직전 거래일 종가 대비 · 수정주가 여부 미확인'});}
 const cutoff=new Date(Date.now()-190*86400000).toISOString().slice(0,10);return events.filter(e=>e.date>=cutoff);
}
export function selectEvents(items,{kind='all',stock='all',since=null}={}){return items.filter(e=>(kind==='all'||kind==='earnings'&&['earnings','calendar'].includes(e.kind)||kind===e.kind)&&(stock==='all'||e.key===stock)&&(!since||e.date>=since)).sort((a,b)=>b.date.localeCompare(a.date)||(b.publishedAt||b.at||'').localeCompare(a.publishedAt||a.at||'')||a.id.localeCompare(b.id));}
export function sortedReports(items,sort='latest'){
 return [...items].sort((a,b)=>{if(sort==='target'){const currency=(a.target?.currency||'~').localeCompare(b.target?.currency||'~');if(currency)return currency;const delta=(b.target?.value??-Infinity)-(a.target?.value??-Infinity);if(Number.isFinite(delta)&&delta)return delta;if(!!a.target!==!!b.target)return a.target?-1:1;}if(sort==='up'){const diff=Number(b.revision==='up')-Number(a.revision==='up');if(diff)return diff;}return (b.date||b.postedAt).localeCompare(a.date||a.postedAt);});
}
export function sectorMovers(stocks){const seen=new Set();return stocks.filter(s=>{const key=s.market+':'+s.id;if(seen.has(key))return false;seen.add(key);return true;}).sort((a,b)=>(b.changePct??-Infinity)-(a.changePct??-Infinity));}

// Factual disclosure summary: no inference from valuation changes or amendment status.
export function holdingEventSummary(e){
 if(e.kind!=='manager')return '';
 const ticker=String(e.key||'').split(':')[1]||'해당 종목',parts=[];
 const quarters={'03-31':1,'06-30':2,'09-30':3,'12-31':4},q=quarters[e.period?.slice(5)];
 if(e.period)parts.push(q?e.period.slice(0,4)+'년 '+q+'분기':e.period+' 기준');
 if(e.changeType==='disposed')parts.push(ticker+' 전량 처분');
 else parts.push(ticker+' '+(Number.isFinite(e.shares)&&e.shares>=0?e.shares.toLocaleString('ko-KR')+'주 보유':'보유 수량 확인 불가'));
 if(['increased','reduced'].includes(e.changeType)&&Number.isFinite(e.shareChangePct))parts.push('전 분기 대비 수량 '+(e.shareChangePct>0?'+':'')+e.shareChangePct.toLocaleString('ko-KR',{maximumFractionDigits:2})+'%');
 else if(e.changeType==='new')parts.push('신규 편입');
 else if(e.changeType==='unchanged')parts.push('보유 수량 유지');
 else if(e.changeType==='unknown'||!e.changeType)parts.push('전 분기 비교 불가');
 if(e.changeType!=='disposed'&&Number.isFinite(e.weight)&&e.weight>=0)parts.push('공시 비중 '+(e.weight>0&&e.weight<0.01?'<0.01':e.weight.toFixed(2))+'%');
 return parts.join(' · ');
}

export function sectorEventDate(event){return event.marketDate||event.originalDate||event.date;}
export function sectorDate(feed,market){const direct=feed?.baseDate||feed?.dataDate;if(direct)return {date:direct,confirmed:true};if(feed?.asOf&&feed.asOfKind!=='received')return {date:/^\d{4}-\d{2}-\d{2}$/.test(feed.asOf)?feed.asOf:new Intl.DateTimeFormat('en-CA',{timeZone:market==='US'?'America/New_York':'Asia/Seoul'}).format(new Date(feed.asOf)),confirmed:true};return {date:new Intl.DateTimeFormat('en-CA',{timeZone:market==='US'?'America/New_York':'Asia/Seoul'}).format(new Date()),confirmed:false};}
export function sectorContributions(stocks){const valid=stocks.length&&stocks.every(s=>Number.isFinite(s.previousMarketCap)&&s.previousMarketCap>0&&Number.isFinite(s.changePct)&&s.quoteAvailable!==false&&s.returnBaseDate&&s.capBaseDate===s.returnBaseDate);if(!valid||new Set(stocks.map(s=>s.returnBaseDate)).size!==1||new Set(stocks.map(s=>s.currency)).size!==1)return null;const total=stocks.reduce((n,s)=>n+s.previousMarketCap,0);return new Map(stocks.map(s=>[s.market+':'+s.id,s.previousMarketCap/total*s.changePct]));}
