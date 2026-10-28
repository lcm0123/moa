import {escapeHtml as esc} from './components.js';
const labels={individual:'개인',foreign:'외국인합계',institution:'기관합계'};
const amount=v=>Number.isSafeInteger(v)?`${v>0?'+':''}${v.toLocaleString('ko-KR')}원`:'데이터 없음';
const compact=v=>Number.isSafeInteger(v)?`${v>0?'+':''}${(v/1e8).toLocaleString('ko-KR',{maximumFractionDigits:2})}억`:'데이터 없음';
const time=v=>v?new Date(v).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})+' KST':'갱신 이력 없음';
export function mountKrInvestors(root,{ticker=null}={}){
 let scope=ticker||'KOSPI',investor='individual',version=0,request;const lifecycle=new AbortController();
 root.classList.add('surface','kr-investors');
 root.innerHTML=`<div class="kr-flow-heading"><div><h2>투자자별 매매동향</h2><p>일별 순매수액 · 장마감 집계 · 당일 자료 제외</p></div>${ticker?'':`<select data-flow-market aria-label="투자자 매매동향 시장"><option value="KOSPI">코스피</option><option value="KOSDAQ">코스닥</option></select>`}</div><div class="kr-flow-body" aria-live="polite"></div>`;
 const body=root.querySelector('.kr-flow-body');
 function render(data){
  const latest=data.items?.at(-1),values=latest?.values||{},items=data.items||[];
  body.innerHTML=`${data.message?`<p class="kr-flow-status">${esc(data.message)}</p>`:''}${latest?`<p class="kr-flow-meta">${esc(data.baseDate)} 거래일 · ${data.stale?'갱신 지연 · 마지막 저장값':'장마감 집계'} · 단위 원</p><div class="kr-flow-values">${Object.entries(labels).map(([key,label])=>`<div><span>${label}</span><strong class="${values[key]>0?'positive':values[key]<0?'negative':''}" title="${amount(values[key])}">${compact(values[key])}</strong><small>${esc(data.baseDate)} 기준</small></div>`).join('')}</div><details><summary>일별 기록 ${items.length}일</summary><div class="kr-flow-scroll" tabindex="0" role="region" aria-label="일별 투자자 순매수액"><table><thead><tr><th>거래일</th>${Object.values(labels).map(label=>`<th>${label}</th>`).join('')}</tr></thead><tbody>${[...items].reverse().map(r=>`<tr><td>${esc(r.tradeDate)}</td>${Object.keys(labels).map(key=>`<td>${amount(r.values[key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`:''}${!ticker?`<div class="kr-flow-heading"><h3>순매수 상위 종목</h3><select data-flow-investor aria-label="순매수 순위 투자자">${Object.entries(labels).map(([key,label])=>`<option value="${key}" ${key===investor?'selected':''}>${label}</option>`).join('')}</select></div>${data.rankingDate?`<p class="kr-flow-meta">${esc(data.rankingDate)} 거래일 · 갱신 ${esc(time(data.rankingCollectedAt))} · 양수 순매수액 상위 ${data.ranking.length}개</p>`:''}${data.ranking?.length?`<div class="kr-flow-scroll" tabindex="0" role="region" aria-label="투자자 순매수 종목 순위"><table><thead><tr><th>순위</th><th>종목</th><th>순매수액</th></tr></thead><tbody>${data.ranking.map(r=>`<tr><td>${r.rank}</td><td><a data-nav href="/stock/KR/${esc(r.ticker)}">${esc(r.name)} <small>${esc(r.ticker)}</small></a></td><td>${amount(r.netValue)}</td></tr>`).join('')}</tbody></table></div>`:`<p class="kr-flow-meta">${data.rankingDate?'해당 거래일에 확인된 양수 순매수 종목이 없습니다.':'검증·수집된 순위 자료가 없습니다.'}</p>`}`:''}<footer><a href="https://data.krx.co.kr/" target="_blank" rel="noopener noreferrer">KRX 정보데이터시스템</a> · pykrx<br>거래일 ${esc(data.baseDate||'확인 불가')} · 갱신 ${esc(time(data.collectedAt))}${data.attemptedAt?`<br>최근 수집 시도 ${esc(time(data.attemptedAt))}`:''}</footer>`;
 }
 async function load(){
  const n=++version;request?.abort();request=new AbortController();body.innerHTML='<p class="kr-flow-status">저장된 매매동향을 확인하고 있습니다.</p>';
  try{const response=await fetch(`/api/kr-investors?scope=${encodeURIComponent(scope)}&investor=${investor}`,{signal:request.signal});if(!response.ok)throw Error('request');const data=await response.json();if(n===version&&!lifecycle.signal.aborted)render(data);}
  catch(error){if(error.name!=='AbortError'&&n===version&&!lifecycle.signal.aborted)body.innerHTML='<p class="kr-flow-status">매매동향 연결 실패 · 페이지를 다시 열어 확인해 주세요.</p>';}
 }
 root.addEventListener('change',event=>{if(event.target.matches('[data-flow-market]'))scope=event.target.value;else if(event.target.matches('[data-flow-investor]'))investor=event.target.value;else return;load();},{signal:lifecycle.signal});
 load();return {refresh:load,destroy(){++version;request?.abort();lifecycle.abort();}};
}
