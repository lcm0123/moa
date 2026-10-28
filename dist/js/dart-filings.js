import {escapeHtml as esc} from './components.js';
const groups=[['all','전체'],['major','주요'],['regular','정기·실적'],['ownership','지분·임원'],['other','기타']];
const day=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(d);
const stamp=v=>v?new Date(v).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})+' KST':'갱신 이력 없음';
export function mountDartFilings(root,{ticker}){
 let active=false,destroyed=false,controller,timer,version=0,page=1,group='all',receipt=new URLSearchParams(location.search).get('receipt'),focused=false;
 if(!/^\d{14}$/.test(receipt||''))receipt=null;
 const receiptDay=receipt?.slice(0,8).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
 root.classList.add('sec-panel','dart-panel');
 root.innerHTML=`<div class="research-heading"><div><h2>DART 공시</h2><p>OpenDART · 접수일 기준 · 원문 제공</p></div><button data-dart="refresh">새로고침</button></div><div class="sec-view-switch dart-groups" role="group" aria-label="공시 분류">${groups.map(([v,l])=>`<button data-dart-group="${v}" aria-pressed="${v==='all'}">${l}</button>`).join('')}</div><form class="sec-filters dart-period"><label>기간 시작<input type="date" name="from" aria-label="공시 기간 시작" required value="${receiptDay||day(new Date(Date.now()-90*86400000))}"></label><label>기간 종료<input type="date" name="to" aria-label="공시 기간 종료" required max="${day(new Date())}" value="${receiptDay||day(new Date())}"></label><button type="submit" class="secondary-button">기간 검색</button></form><p class="sec-status" role="status"></p><div class="sec-content"></div><footer class="sec-coverage"></footer>`;
 const $=s=>root.querySelector(s);
 function schedule(){clearTimeout(timer);if(active&&!destroyed)timer=setTimeout(load,15000);}
 async function load(){
  if(!active||destroyed)return;const n=++version;controller?.abort();controller=new AbortController();
  const q=new URLSearchParams({ticker,from:$('[name=from]').value,to:$('[name=to]').value,group,page});if(receipt)q.set('receipt',receipt);
  try{const r=await fetch('/api/dart-filings?'+q,{signal:controller.signal}),d=await r.json();if(n!==version)return;if(!r.ok)throw Error(d.message||'공시 조회 실패');
   $('.sec-status').textContent=d.message||'';
   $('.sec-content').innerHTML=`<div class="sec-list-count"><span>${d.total||0}건 · 최신 접수순</span><span>${esc(d.name||ticker)}${d.corpCode?' · 고유번호 '+esc(d.corpCode):''}</span></div>`+(d.items?.length?d.items.map(f=>`<article class="sec-row dart-row${receipt===f.receipt?' dart-highlight':''}" id="dart-${f.receipt}" tabindex="-1" data-receipt="${f.receipt}"><div class="sec-row-meta"><b>${esc(f.typeLabel)}</b>${f.badges.map(b=>`<strong class="dart-amendment">${esc(b)}</strong>`).join('')}<span>접수 ${esc(f.received_date)} · KST 일자 기준</span></div><a class="sec-title" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.title)} ↗</a><div class="sec-row-foot"><span>제출인 ${esc(f.submitter)}</span><span>접수번호 ${f.receipt}</span></div></article>`).join(''):`<p class="research-empty">${esc(d.message||'선택한 기간·유형의 공시가 없습니다.')}</p>`)+`<div class="sec-pager"><button data-dart="previous" ${page<=1?'disabled':''}>이전</button><span>${page} / ${d.pages||1}</span><button data-dart="next" ${page>=(d.pages||1)?'disabled':''}>다음</button></div>`;
   $('.sec-coverage').textContent='OpenDART · 마지막 정상 갱신 '+stamp(d.syncedAt)+' · 저장된 목록 조회 · 접수 시각은 API 미제공 · 정정 전 공시도 보존합니다. 주요: 주요사항·발행 / 정기·실적: 정기공시와 실적 발표 제목 / 기타: 감사·거래소 등 나머지 유형.';
   if(receipt&&!focused){const row=$('#dart-'+receipt);if(row){row.classList.add('dart-highlight');row.scrollIntoView({block:'center'});row.focus({preventScroll:true});focused=true;}}
  }catch(e){if(n===version&&!controller.signal.aborted)$('.sec-status').textContent=e.message||'공시 연결 오류 · 이전 목록 유지';}finally{if(n===version)schedule();}
 }
 function reset(){page=1;receipt=null;focused=false;const u=new URL(location.href);u.searchParams.delete('receipt');history.replaceState(null,'',u.pathname+u.search);}
 const click=e=>{const filter=e.target.closest('[data-dart-group]');if(filter){group=filter.dataset.dartGroup;reset();for(const b of root.querySelectorAll('[data-dart-group]'))b.setAttribute('aria-pressed',String(b===filter));load();return;}const action=e.target.closest('[data-dart]')?.dataset.dart;if(action==='previous')page--;else if(action==='next')page++;if(action)load();};
 const submit=e=>{e.preventDefault();reset();load();};root.addEventListener('click',click);$('.dart-period').addEventListener('submit',submit);
 return {setVisible(v){active=v;clearTimeout(timer);if(v)load();else{version++;controller?.abort();}},destroy(){destroyed=true;version++;clearTimeout(timer);controller?.abort();root.removeEventListener('click',click);$('.dart-period')?.removeEventListener('submit',submit);}};
}
