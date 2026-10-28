import {escapeHtml as esc} from './components.js';
import {updated} from './research-view.js';
import {chart} from './earnings-flow.js';
const num=n=>Number.isFinite(n)?n.toLocaleString('ko-KR',{maximumFractionDigits:2}):'—';
const signed=n=>Number.isFinite(n)?(n>0?'+':'')+num(n):'—';
export function EarningsInflectionDetail(f){
 const p=f.points||[];
 return `<div class="inflection-detail"><p class="research-note">${esc(f.method)} · 표시 ${p.length}분기</p><div class="financial-chart-grid">${chart(p,'매출 YoY',q=>q.revenueYoy,'%')}${chart(p,'영업이익 YoY',q=>q.metrics.operatingIncome.yoy,'%','operatingIncome')}${chart(p,'영업이익률',q=>q.margin,'%')}${chart(p,'EPS YoY',q=>q.metrics.eps.yoy,'%','eps')}</div><p class="research-note">영업이익·EPS의 비교 기준이 0 이하이거나 현재 값이 음수이면 성장률을 계산하지 않습니다.</p>${f.limitations.map(l=>`<p class="research-note">${esc(l)}</p>`).join('')}<p class="research-note">일회성 손익 등 공시 본문의 전수 검증은 포함되지 않습니다. 숫자 기준 변화 탐지이며 주가 전망이 아닙니다.</p><p class="research-note">${esc(f.version)} · 자료 갱신 ${esc(updated(f.updatedAt))}</p></div>`;
}
export function EarningsInflectionCard(result,open=false){
 const f=result?.flow;if(!f)return `<section class="inflection-card" id="earnings-inflection"><h2>실적 흐름</h2><p role="status">${result?.status==='unavailable'?'분기 재무를 불러오지 못했습니다.':'분기 재무를 확인하고 있습니다…'}</p>${result?.status==='unavailable'?'<button data-inflection-retry>다시 확인</button>':''}</section>`;
 const tone=f.score===null||f.gate?'neutral':f.score>0?'positive':f.score<0?'negative':'neutral';
 return `<section class="inflection-card" id="earnings-inflection"><div class="inflection-heading"><h2>실적 흐름</h2><small>${esc(f.quarter||'기준 분기 미확인')}</small></div><div class="inflection-result"><strong class="inflection-badge ${tone}">${esc(f.label)}</strong><span>${f.score===null?'점수 산출 보류':(f.gate?'합산 점수':'실적 변곡점')+' <b>'+signed(f.score)+'</b>'}</span></div><p class="inflection-summary">${esc(f.summary)}</p><p class="research-note">최근 ${f.coverage.trend}분기 비교${!f.coverage.eps?' · EPS 비교 자료 부족':''}${f.stale?' · 갱신 지연':''}</p><dl class="inflection-evidence">${f.evidence.map(e=>`<div><dt>${esc(e.label)}</dt><dd>${Number.isFinite(e.from)&&Number.isFinite(e.to)?`${signed(e.from)}${esc(e.unit)} <span>→</span> ${signed(e.to)}${esc(e.unit)}`:'비교 자료 없음'}</dd></div>`).join('')}</dl>${f.evidence[0]?.fromEnd?`<p class="research-note">${esc(f.evidence[0].fromEnd)} → ${esc(f.end)} 종료 분기 · 영업손실은 증가율 대신 금액으로 비교</p>`:''}<details ${open?'open':''}><summary>자세히 보기 <span aria-hidden="true">›</span></summary>${EarningsInflectionDetail(f)}</details></section>`;
}
export function mountEarningsInflection(root,{market,ticker}){
 const abort=new AbortController();let timer,busy=false;
 const render=d=>{root.innerHTML=EarningsInflectionCard(d,root.querySelector('#earnings-inflection>details')?.open);};
 async function load(){if(busy||abort.signal.aborted)return;busy=true;clearTimeout(timer);try{const r=await fetch('/api/earnings-flow?'+new URLSearchParams({market,ticker}),{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(20000)])});if(!r.ok)throw Error();const d=await r.json();render(d);if(d.status==='pending'||d.refreshing)timer=setTimeout(load,10000);}catch{if(!abort.signal.aborted)render({status:'unavailable'});}finally{busy=false;}}
 root.addEventListener('click',e=>{if(e.target.closest('[data-inflection-retry]'))void load();},{signal:abort.signal});render(null);void load();
 return {destroy(){abort.abort();clearTimeout(timer);}};
}
