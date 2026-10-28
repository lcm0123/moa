import {escapeHtml as esc} from './components.js';
import {safeLink,updated} from './research-view.js';
const names={revenue:'매출',operatingIncome:'영업이익',netIncome:'순이익',eps:'EPS'};
const number=n=>Number.isFinite(n)?n.toLocaleString('ko-KR',{maximumFractionDigits:2}):'미제공';
const exact=n=>Number.isFinite(n)?n.toLocaleString('ko-KR',{maximumFractionDigits:20}):'미제공';
const pct=n=>Number.isFinite(n)?(n>0?'+':'')+number(n)+'%':'비교 자료 없음';
const metricText=m=>Number.isFinite(m?.surprisePct)?pct(m.surprisePct):m?.event==='PROFIT_SURPRISE'?'예상 적자 → 흑자':m?.event==='LOSS_SURPRISE'?'예상 흑자 → 적자':m?.reason||'미제공';
const primary=a=>a.market==='KR'?'operatingIncome':'eps';
const tone=n=>Number.isFinite(n)&&n!==0?n>0?'positive':'negative':'neutral';
const period=p=>p.period||p.reportDate;
const priorities={turnedToBeat:0,turnedToMiss:0,consecutiveBeats:1,consecutiveMisses:1,beatExpansion:2,missExpansion:2,beatDecelerating:2,epsAndRevenueBeat:3,revenueAndProfitBeat:3,profitSurprise:4,lossSurprise:4};
const priceSignals=new Set(['EARNINGS_BEAT_PRICE_DOWN','MISS_PRICE_UP']);
export function selectSurpriseSignals(signals=[]){
 return [...new Map(signals.filter(s=>!priceSignals.has(s.id)&&!['revenueBeat','profitBeat','epsBeat'].includes(s.id)).map(s=>[s.id+':'+s.label,s])).values()].sort((a,b)=>(priorities[a.id]??5)-(priorities[b.id]??5));
}
const heading=()=>`<div class="surprise-heading"><h2>실적 서프라이즈</h2><span class="surprise-help"><button type="button" aria-label="실적 서프라이즈란?" aria-describedby="surprise-help-text">?</button><span role="tooltip" id="surprise-help-text">실제 실적이 시장 예상치보다 얼마나 높거나 낮았는지를 나타냅니다.</span></span></div>`;
const basis=m=>m?.actualBasis==='adjusted'?'조정 EPS':m?.actualBasis==='GAAP'?'GAAP EPS':'EPS';
const metricName=(key,m)=>key==='eps'?basis(m):names[key];
function displayAmount(n,m){
 if(!Number.isFinite(n))return '미제공';
 const unit=m?.unit||'',perShare=/share|주/.test(unit),scale=!perShare&&Math.abs(n)>=1e9?1e9:!perShare&&Math.abs(n)>=1e6?1e6:1;
 return `${number(n/scale)}${scale===1e9?'십억':scale===1e6?'백만':''}`;
}
export function SurpriseComparison(point,market){
 const keys=(market==='KR'?['revenue','operatingIncome','netIncome','eps']:['eps','revenue','operatingIncome','netIncome']).filter(k=>Number.isFinite(point?.metrics[k]?.actual)||Number.isFinite(point?.metrics[k]?.estimate));
 if(!keys.length)return '<p class="research-note">실제치와 예상치가 없습니다.</p>';
 return `<table class="surprise-table"><caption class="sr-only">${esc(period(point))} 실제 실적과 예상치 비교</caption><thead><tr><th scope="col">항목</th><th scope="col">실제</th><th scope="col">예상</th><th scope="col">차이</th></tr></thead><tbody>${keys.map(k=>{const m=point.metrics[k];return `<tr><th scope="row">${esc(metricName(k,m))}<small>${esc(m.unit||'단위 미제공')}</small></th><td title="${esc(exact(m.actual)+' '+(m.unit||''))}">${esc(displayAmount(m.actual,m))}</td><td title="${esc(exact(m.estimate)+' '+(m.unit||''))}">${esc(displayAmount(m.estimate,m))}</td><td class="${tone(m.surprisePct)}" title="${esc(m.reason||'')}">${esc(metricText(m))}</td></tr>`;}).join('')}</tbody></table>`;
}
export function EarningsSurpriseTrendChart(points,key){
 const values=points.map(p=>p.metrics[key]?.surprisePct),valid=values.filter(Number.isFinite);
 if(!valid.length)return `<article class="surprise-chart"><h3>${names[key]} 예상 대비</h3><p class="research-note">비교 가능한 자료가 없습니다.</p></article>`;
 const min=Math.min(0,...valid),max=Math.max(0,...valid),y=v=>30+(max-v)/(max-min||1)*140,step=480/Math.max(1,points.length),x=i=>70+step*(i+.5);
 return `<article class="surprise-chart" data-surprise-chart="${key}"><h3>${names[key]} 예상 대비 <small>%</small></h3><svg viewBox="0 0 600 220" role="group" aria-label="${names[key]} 실적 서프라이즈 추이, 0% 기준"><line class="financial-zero" x1="65" x2="560" y1="${y(0)}" y2="${y(0)}"/><text x="55" y="${y(0)+4}" text-anchor="end">0%</text>${points.map((p,i)=>{const v=values[i],m=p.metrics[key],label=period(p)+' · 실제 '+exact(m?.actual)+' · 예상 '+exact(m?.estimate)+' '+(m?.unit||'')+' · '+metricText(m);return Number.isFinite(v)?`<g tabindex="0" role="button" data-surprise-point="${key}:${i}" aria-label="${esc(label)}"><title>${esc(label)}</title><rect class="surprise-hit" x="${x(i)-step/2}" y="15" width="${step}" height="170"/><rect class="surprise-bar ${tone(v)}" x="${x(i)-12}" y="${Math.min(y(v),y(0))}" width="24" height="${Math.max(2,Math.abs(y(v)-y(0)))}" rx="3"/><text class="surprise-chart-date ${i%2?'alternate':''}" x="${x(i)}" y="207" text-anchor="middle">${esc(p.period||p.reportDate.slice(2,7))}</text></g>`:`<text class="surprise-chart-date ${i%2?'alternate':''}" x="${x(i)}" y="207" text-anchor="middle">${esc(p.period||p.reportDate.slice(2,7))} —</text>`;}).join('')}</svg><div class="surprise-chart-tooltip" role="status" hidden></div></article>`;
}
function pricePanel(a){
 const latest=a.latest,reaction=latest.priceReaction,warning=(a.signals||[]).filter(s=>priceSignals.has(s.id));
 return `<h3>발표 후 주가</h3><p class="research-note">${esc(latest.reportDate)} 발표 · 장후 발표는 다음 거래일부터 반영</p><div class="surprise-reactions">${[[0,'첫 반영일'],[1,'1거래일 후'],[3,'3거래일 후'],[5,'5거래일 후']].map(([n,label])=>`<div><span>${label}</span><strong>${pct(reaction?.['day'+n])}</strong><small>${esc(reaction?.dates?.['day'+n]||'자료 부족')}</small></div>`).join('')}</div>${warning.map(s=>`<p class="surprise-price-warning"><strong>${esc(s.label)}</strong><span>${esc(metricName(a.core,latest.metrics[a.core]))} ${esc(metricText(latest.metrics[a.core]))} · 첫 반영일의 1거래일 후 주가 ${pct(reaction?.day1)}</span></p>`).join('')}<p class="research-note">${reaction?.baseDate?esc(reaction.baseDate)+' 종가 대비 · ':''}${esc(reaction?.basis||'주가 연결 미확인')}${reaction?.reason?' · '+esc(reaction.reason):''}</p>${Number.isFinite(latest.providerOneDayReaction)?`<details class="surprise-method"><summary>공급자 제공 주가 반응</summary><p class="research-note">Finviz 제공 1일 반응 ${pct(latest.providerOneDayReaction)} · 계산 시점·방법 미제공으로 위 계산과 구분합니다.</p></details>`:''}`;
}
export function EarningsSurpriseDetail(result){
 const a=result.analysis,latest=a.latest,key=primary(a);
 const panels=[['compare','실적 비교'],['trend','서프라이즈 추이'],['price','발표 후 주가']];
 return `<div class="surprise-detail"><div class="surprise-tabs" role="tablist" aria-label="실적 서프라이즈 상세">${panels.map(([id,label],i)=>`<button type="button" role="tab" id="surprise-tab-${id}" data-surprise-tab="${id}" aria-controls="surprise-panel-${id}" aria-selected="${i===0}" tabindex="${i===0?0:-1}">${label}</button>`).join('')}</div><section role="tabpanel" id="surprise-panel-compare" aria-labelledby="surprise-tab-compare"><div class="surprise-period-control"><h3>실적 비교</h3><label>발표 선택 <select data-surprise-period aria-label="실적 비교 발표 선택">${a.points.map((p,i)=>({p,i})).reverse().map(({p,i})=>`<option value="${i}">${esc(p.period?p.period+' · '+p.reportDate:p.reportDate+' 발표')}</option>`).join('')}</select></label></div><p class="research-note">${a.periodBasis==='publication'?'회계분기 미제공 · 발표일 기준':'기업 회계분기 기준'} · ${a.market==='US'?'미국 동부일자':'한국 일자'}</p><div data-surprise-comparison>${SurpriseComparison(latest,a.market)}</div></section><section role="tabpanel" id="surprise-panel-trend" aria-labelledby="surprise-tab-trend" hidden><h3>최근 ${a.points.length}${a.periodBasis==='publication'?'회 발표':'분기'} 추이</h3><p class="research-note">0% 위는 예상치 상회 · 아래는 하회</p><div class="financial-chart-grid">${[...new Set([key,'revenue'])].map(k=>EarningsSurpriseTrendChart(a.points,k)).join('')}</div><ul class="surprise-signals surprise-all-signals">${selectSurpriseSignals(a.signals).map(s=>`<li>${esc(s.label)}</li>`).join('')}</ul></section><section role="tabpanel" id="surprise-panel-price" aria-labelledby="surprise-tab-price" hidden>${pricePanel(a)}</section><details class="surprise-method"><summary>계산 기준·출처</summary><p class="research-note">(실제치 − 예상치) ÷ |예상치| × 100. 예상치가 0에 가깝거나 이익의 부호가 바뀌면 비율을 표시하지 않습니다. 결측·긴 공백·비교 기준 변경은 추세를 이어 붙이지 않습니다.</p>${a.points.slice().reverse().map(q=>`<p class="research-note">${esc(period(q))} · <a href="${safeLink(q.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(q.source||result.source||'원본')} ↗</a> · 수집 ${esc(updated(q.collectedAt))}</p>`).join('')}${(a.limitations||[]).map(l=>`<p class="research-note">${esc(l)}</p>`).join('')}</details><p class="research-note surprise-source">${esc(result.source||'출처 미제공')} · 조회 ${esc(updated(result.updatedAt))}${result.stale?' · 갱신 지연, 마지막 저장 자료':''}</p></div>`;
}
export function EarningsSurpriseCard(result,open=false){
 const a=result?.analysis;
 if(!a?.latest){
  if(!result||result.status==='pending')return `<section class="surprise-card" aria-busy="true">${heading()}<div class="surprise-skeleton" role="status" aria-label="실적 예상치 불러오는 중"><span></span><span></span><span></span></div></section>`;
  const failure=['error','disconnected','restricted','unavailable'].includes(result.status),message=failure?(result.message||'실적 예상치를 불러오지 못했습니다.'):'실적 컨센서스 데이터가 없습니다.';
  return `<section class="surprise-card">${heading()}<p class="research-note" role="status">${esc(message)}</p>${failure?'<button type="button" data-surprise-retry>다시 확인</button>':''}</section>`;
 }
 const latest=a.latest,key=primary(a),m=latest.metrics[key],sameCore=key===a.core,status=sameCore?a.status:'INSUFFICIENT',label=status==='STRONG_BEAT_EXPANSION'?'상회 확대':sameCore?a.label:'비교 자료 부족',color=['INSUFFICIENT','NEUTRAL'].includes(status)?'neutral':status.includes('MISS')?'negative':'positive';
 const recent=a.points.slice(-3),signals=sameCore?selectSurpriseSignals(a.signals).slice(0,3):[],hasFiscal=recent.every(p=>p.period)&&a.periodBasis!=='publication';
 return `<section class="surprise-card">${heading()}<div class="surprise-overview"><div class="surprise-primary"><strong class="surprise-state ${color}">${esc(label)}${result.stale?'<small>갱신 지연</small>':''}</strong><p class="surprise-value">${esc(metricName(key,m))} <strong>${esc(metricText(m))}</strong>${Number.isFinite(m?.surprisePct)?`<span>${m.surprisePct>0?'상회':m.surprisePct<0?'하회':'예상 부합'}</span>`:''}</p></div><div class="surprise-recent"><small>최근 ${recent.length}${hasFiscal?'분기':'회 발표'}</small><ol>${recent.map(p=>`<li><small>${esc(period(p))}</small><strong>${Number.isFinite(p.metrics[key]?.surprisePct)?pct(p.metrics[key].surprisePct):p.metrics[key]?.event?esc(metricText(p.metrics[key])):'비교 불가'}</strong></li>`).join('')}</ol></div></div>${signals.length?`<ul class="surprise-signals">${signals.map(s=>`<li>${esc(s.label)}</li>`).join('')}</ul>`:''}<details class="surprise-expand" ${open?'open':''}><summary><span class="surprise-expand-label">${open?'접기':'자세히 보기'}</span><span aria-hidden="true">›</span></summary>${EarningsSurpriseDetail(result)}</details></section>`;
}
export function mountEarningsSurprise(root,{market,ticker}){
 const controller=new AbortController(),signal=controller.signal;let busy=false,result=null;
 async function load(){if(busy||signal.aborted)return;busy=true;try{const response=await fetch('/api/earnings-surprise?'+new URLSearchParams({market,ticker,stored:'1'}),{signal:AbortSignal.any([signal,AbortSignal.timeout(150000)])});if(!response.ok)throw Error();result=await response.json();root.innerHTML=EarningsSurpriseCard(result,root.querySelector('.surprise-expand')?.open);}catch{if(!signal.aborted)root.innerHTML=EarningsSurpriseCard({status:'error',message:'실적 예상치를 불러오지 못했습니다. 다시 확인해 주세요.'});}finally{busy=false;}}
 function activate(tab,focus=false){
  root.querySelectorAll('[data-surprise-tab]').forEach(button=>{const selected=button===tab;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;root.querySelector('#'+button.getAttribute('aria-controls')).hidden=!selected;});if(focus)tab.focus();
 }
 function inspect(target){const node=target.closest('[data-surprise-point]');if(!node||!result?.analysis)return;const [key,index]=node.dataset.surprisePoint.split(':'),p=result.analysis.points[Number(index)],m=p.metrics[key],tip=node.closest('.surprise-chart').querySelector('.surprise-chart-tooltip');tip.innerHTML=`<strong>${esc(period(p))} · ${esc(metricName(key,m))}</strong><span>실제 ${exact(m.actual)} / 예상 ${exact(m.estimate)} ${esc(m.unit||'')}</span><b>${esc(metricText(m))}</b>`;tip.hidden=false;}
 root.innerHTML=EarningsSurpriseCard(null);
 root.addEventListener('click',e=>{if(e.target.closest('[data-surprise-retry]'))void load();const tab=e.target.closest('[data-surprise-tab]');if(tab)activate(tab);if(e.target.closest('[data-surprise-point]'))inspect(e.target);},{signal});
 root.addEventListener('toggle',e=>{if(e.target.matches('.surprise-expand'))e.target.querySelector('.surprise-expand-label').textContent=e.target.open?'접기':'자세히 보기';},{signal,capture:true});
 root.addEventListener('change',e=>{if(e.target.matches('[data-surprise-period]')&&result?.analysis){const p=result.analysis.points[Number(e.target.value)];if(p)root.querySelector('[data-surprise-comparison]').innerHTML=SurpriseComparison(p,result.analysis.market);}},{signal});
 root.addEventListener('keydown',e=>{const tab=e.target.closest('[data-surprise-tab]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=[...root.querySelectorAll('[data-surprise-tab]')],i=tabs.indexOf(tab);activate(tabs[e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length],true);},{signal});
 for(const event of ['pointerover','focusin'])root.addEventListener(event,e=>inspect(e.target),{signal});
 for(const event of ['pointerout','focusout'])root.addEventListener(event,e=>{const chart=e.target.closest('[data-surprise-chart]');if(chart&&!chart.contains(e.relatedTarget))chart.querySelector('.surprise-chart-tooltip').hidden=true;},{signal});
 root.addEventListener('keydown',e=>{if(e.key==='Escape')root.querySelectorAll('.surprise-chart-tooltip').forEach(t=>t.hidden=true);},{signal});
 void load();return {destroy(){controller.abort();}};
}
