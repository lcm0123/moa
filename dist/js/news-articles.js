import {escapeHtml as esc} from './components.js';
import {inlineNewsMarkup,mergeInlineUpdate} from './news-inline.js';
const clock=v=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})+' KST':'발행 시각 미확인';
const articleClock=a=>a.providerTimeMeaning==='NAVER_DISTRIBUTION'?(a.providerProvidedAt?'네이버 제공 '+clock(a.providerProvidedAt):'네이버 제공 시각 미확인')+' · 원문 발표 시각 미확인':clock(a.publishedAt);
const safe=v=>{try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const validStock=s=>s&&(['KR','US'].includes(s.market))&&(s.market==='KR'?/^[0-9A-Z]{6}$/:/^[A-Z0-9.^/-]{1,24}$/).test(s.ticker||'');
export function newsStockMarkup(stock,quote){
 if(!validStock(stock))return '';
 const ready=quote?.status==='ready'&&quote.market===stock.market&&quote.ticker===stock.ticker;
 const pct=ready&&Number.isFinite(quote.changePct)?quote.changePct:null;
 const asOf=ready?(quote.baseDate?quote.baseDate+' 종가':(quote.asOfKind==='received'?'조회 ':'시세 기준 ')+clock(quote.asOf)):'';
 const change=pct===null?(ready?'등락률 미제공':quote?.reason||'시세 확인 중'):(pct>0?'+':pct<0?'−':'')+Math.abs(pct).toFixed(2)+'%';
 const meta=[stock.name,stock.ticker,stock.relationship==='BUSINESS'?'사업 근거로 연결한 기업':'기사에 언급된 기업',quote?.source,asOf,ready&&(quote.stale?'이전 저장 시세':quote.baseDate?'일별 시세':'지연·스냅샷 시세')].filter(Boolean).join(' · ');
 return `<a class="nc-news-stock" data-nav href="/stock/${stock.market}/${encodeURIComponent(stock.ticker)}?tab=company" title="${esc(meta)}" aria-label="${esc(meta+' · '+change)}"><span>${esc(stock.market==='KR'?stock.name:stock.ticker)}</span><span class="${pct>0?'up':pct<0?'negative':'neutral-text'}">${esc(change)}</span>${ready&&(quote.stale||quote.baseDate)?`<span class="nc-news-quote-tag">${quote.stale?'이전': '종가'}</span>`:''}</a>`;
}
const relatedStocks=a=>(a.relation?.candidates||[]).map(c=>({...c.asset,relationship:'BUSINESS'}));
export function newsRelationsMarkup(article,quotes={}){
 const r=article.relation;if(!r)return '';
 if(r.format==='inline-v2')return inlineNewsMarkup(r);
 const coverage=r.diagnostics?` · 사업 색인 ${r.diagnostics.indexedCompanies}개 기업${r.diagnostics.indexTruncated?' · 일부 범위':''}`:'';
 const checking=['QUEUED','RUNNING'].includes(r.verification?.status)?' · 본문 추가 확인 중':'';
 if(!['READY','MATCHED'].includes(r.status))return `<p class="nc-news-relation-state" role="status">${esc((r.message||'사업 연결 확인 중')+checking+coverage)}</p>${r.verification&&!['QUEUED','RUNNING','READY','NO_CONNECTION'].includes(r.verification.status)?`<p class="nc-news-relation-state">본문 분석: ${esc(r.verification.message)}</p>`:''}`;
 const proof=(e,label)=>safe(e?.url)?`<div><strong>${label}</strong><p>${esc(e.quote)}</p><a href="${esc(safe(e.url))}" target="_blank" rel="noopener noreferrer">${esc(e.publisher||e.title||'근거 원문')} ↗</a></div>`:'';
 const local=r.status==='MATCHED';
 return `<div class="nc-news-relations"><span class="nc-news-relation-label">${local?'제품·사업 연관 · 영향 미확인':'사업 근거로 연결 · 국내'}${esc(checking)}</span>${r.candidates.map(c=>`<div class="nc-news-relation"><div>${newsStockMarkup({...c.asset,relationship:'BUSINESS'},quotes[c.asset.market+':'+c.asset.ticker])}<span class="nc-news-relation-type">${local?'저장 공시 대조':c.relationship==='INDIRECT'?'간접 사업 연결':'제품·시장 연결'}${c.mentionedInArticle?' · 기사에도 언급':''}</span></div><p>${esc(c.reason)}</p><details data-news-proof="${esc(article.id+':'+c.asset.id)}"><summary>연결 근거</summary><div class="nc-news-proof">${proof(c.eventEvidence,local?'기사 제목·제공 발췌문 (전문 검증 전)':'뉴스에서 확인한 변화')}${proof(c.businessEvidence,'기업 사업 근거')}${local?`<p>같은 제품군 또는 사용 시장에 관한 사업 자료입니다. 규격 일치·수혜 방향·이번 사건의 납품은 확인하지 않았습니다.</p><p>공시일 ${esc(c.businessEvidence.publishedAt||'미확인')}</p>`:`<p>조건: ${esc(c.conditions?.join(' · ')||'규격·발주·공급사 선정 확인 필요')}</p>`}${c.weakening?.length?`<p>연결이 약해지는 조건: ${esc(c.weakening.join(' · '))}</p>`:''}<p>${c.confirmedSupply?'이번 사건의 공급 근거 확인':'이번 사건의 납품·매출 발생은 미확인'} · 분석 ${esc(clock(c.asOf))}</p>${local&&r.verification?`<p>본문 추가 분석: ${esc(r.verification.message)}</p>`:''}</div></details></div>`).join('')}${r.transportMessage?`<p class="nc-news-relation-state">${esc(r.transportMessage)}</p>`:''}${r.stale?'<p class="nc-news-relation-state">이전 분석 결과 · 근거의 새 변경사항은 미반영</p>':''}</div>`;
}
export const relationNeedsPolling=r=>r?.format==='inline-v2'?['waiting','verifying','partial','invalidated','deferred'].includes(r.status):!r||r.autoEligible||['UNASSESSED','QUEUED','RUNNING','RETRY'].includes(r.status)||['QUEUED','RUNNING'].includes(r.verification?.status);
export function relationRequestDelayed(r){if(r?.format==='inline-v2')return {...r,transportMessage:'상태 조회 지연 · 자동 재확인'};return ['READY','MATCHED'].includes(r?.status)?{...r,transportMessage:'본문 분석 상태 조회 지연 · 저장된 연결 유지'}:{...r,status:'RETRY',message:'사업 연결 상태 조회 지연 · 자동 재확인',autoEligible:false};}
export function domesticCollectionText(c){
 if(!c)return '국내 기업 자료 수집 현황 확인 중';
 const state={COLLECTING:'수집 중',REGISTERING:'종목 목록 갱신 중',WAITING:'순차 수집 대기',WORKER_WAIT:'다른 작업 완료 대기',PROVIDER_WAIT:'DART 응답 제한으로 대기',BUDGET_WAIT:'오늘 수집 한도 도달 · 다음 날 재개',ERROR:'수집 연결 오류 · 자동 재확인',CONFIG_REQUIRED:'수집 설정 필요',DISABLED:'자동 수집 꺼짐'}[c.state]||'상태 확인 중';
 return `DART 국내 ${c.target.toLocaleString('ko-KR')}개 기업 대상 · 사업 자료 ${c.indexed.toLocaleString('ko-KR')}개 확보 · 제품 매출 ${c.product.toLocaleString('ko-KR')}개 · 수출 자료 ${c.export.toLocaleString('ko-KR')}개 · ${state}${c.current?' ('+c.current.name+')':''}${c.failed?' · 재시도·확인 필요 '+c.failed+'개':''}${c.registry?.unmappedListedInstruments?' · 종목코드 매핑 미확인 '+c.registry.unmappedListedInstruments+'개':''}${c.registryError?' · DART 종목 목록 갱신 지연':''}`;
}
export function newsArticleMarkup(article,quotes={}){
 const url=safe(article.originalUrl||article.url),brief=article.brief,ready=brief?.status==='READY'&&brief.text,title=ready?brief.text:article.title;
 const label=ready?'한국어 요약':brief?.message||'한국어 요약 준비 중';
 return `<article class="nc-news-item" data-news-id="${esc(article.id)}"><div class="nc-news-copy"><h3>${url?`<a href="${esc(url)}" title="${esc(article.title)}" target="_blank" rel="noopener noreferrer">${esc(title)}</a>`:esc(title)}</h3><div class="nc-news-meta"><span>${esc(article.publisher)}</span>${article.stocks?.length?'<span>기사 언급</span>':''}${(article.stocks||[]).map(s=>newsStockMarkup(s,quotes[s.market+':'+s.ticker])).join('')}<time>${esc(articleClock(article))}</time>${!ready?`<span class="nc-news-brief-state">${esc(label)}</span>`:''}${article.stocksStatus==='ERROR'?'<span>종목 연결 오류</span>':''}<details class="nc-news-original"><summary>원제</summary><p>${esc(article.title)} ${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">원문 ↗</a>`:''}</p></details></div>${newsRelationsMarkup(article,quotes)}</div></article>`;
}
export function mountNewsArticles(host,{api,signal}){
 let region='KR',data=null,loading=false,sequence=0,visible=6,summaryActive=false,summaryTimer=null,quotes={},quoteActive=false,relationActive=false,relationTimer=null;const pollCounts=new Map();
 host.innerHTML=`<div class="nc-news-top"><div class="nc-news-tabs" role="group" aria-label="뉴스 지역"><button type="button" data-news-region="KR" aria-pressed="true">국내 · 경제 뉴스</button><button type="button" data-news-region="US" aria-pressed="false">해외 · 뉴스사</button></div><button type="button" data-news-refresh aria-label="뉴스 목록 새로고침">새로고침</button></div><form class="nc-news-search" role="search"><label><span class="nc-news-search-label">경제 뉴스 검색</span><input name="q" maxlength="80" placeholder="기업명, 반도체, 전력망…" autocomplete="off"></label><label class="nc-news-publisher" hidden>뉴스사<select name="publisher"><option value="all">전체</option><option value="cnbc">CNBC</option><option value="bbc">BBC News</option></select></label><button type="submit">검색</button></form><div class="nc-news-topics" aria-label="자주 찾는 뉴스"></div><p class="nc-news-note nc-muted">뉴스를 선택하면 기사 본문을 확인해 관련 기업을 찾습니다.</p><p class="nc-news-state" role="status"></p><div class="nc-news-list"></div><button type="button" data-news-more hidden>뉴스 더 보기</button><p class="nc-news-basis nc-muted"></p>`;
 const form=host.querySelector('form'),state=host.querySelector('.nc-news-state'),list=host.querySelector('.nc-news-list'),basis=host.querySelector('.nc-news-basis');
 host.querySelector('.nc-news-note').textContent='1분마다 새 뉴스 확인 · 원문과 공시의 사업 근거를 확인한 연결만 자동 표시';
 host.querySelector('.nc-news-note').insertAdjacentHTML('afterend','<div class="nc-news-live" role="status">자동 수집 상태 확인 중…</div><p class="nc-news-collection nc-muted" role="status">국내 기업 자료 수집 현황 확인 중</p><details class="nc-news-usage"><summary>오늘 뉴스 분석 사용량</summary><div class="nc-news-usage-body">사용량 확인 중…</div></details>');
 const refreshTimer=setInterval(()=>{if(!document.hidden&&!signal.aborted&&host.getBoundingClientRect().bottom>0&&host.getBoundingClientRect().top<innerHeight){void load(true);void loadUsage();}},30000);
 signal.addEventListener('abort',()=>{clearTimeout(summaryTimer);clearTimeout(relationTimer);clearInterval(refreshTimer);},{once:true});
 async function loadUsage(){
  try{const u=await api('/usage?at='+Date.now());if(signal.aborted)return;host.querySelector('.nc-news-live').textContent=newsLiveText(u);host.querySelector('.nc-news-usage-body').innerHTML=newsUsageMarkup(u);host.querySelector('.nc-news-collection').textContent=domesticCollectionText(u.businessCollection);}
  catch{if(!signal.aborted)host.querySelector('.nc-news-live').textContent='자동 수집 상태 연결 오류 · 30초 뒤 재확인';}
 }
 function topics(){host.querySelector('.nc-news-topics').innerHTML=(region==='KR'?['경제','기업','반도체','전력망','바이오','자동차']:['전체','AI','energy','chips','earnings','trade']).map(q=>`<button type="button" data-news-query="${esc(q==='전체'?'':q)}">${esc(q)}</button>`).join('');}
 function render(){
  if(!data)return;
  const anchor=[...list.children].find(el=>el.getBoundingClientRect().bottom>90),anchorId=anchor?.dataset.newsId,anchorTop=anchor?.getBoundingClientRect().top;
  const opened=new Set([...list.querySelectorAll('[data-news-proof][open]')].map(d=>d.dataset.newsProof));
  const ids=new Set(data.items.slice(0,visible).map(a=>a.id));for(const el of [...list.children])if(!ids.has(el.dataset.newsId))el.remove();
  for(const [index,a] of data.items.slice(0,visible).entries()){
   const html=newsArticleMarkup(a,quotes),existing=[...list.children].find(el=>el.dataset.newsId===a.id);
   if(existing){if(existing.dataset.rendered!==html){const box=document.createElement('template');box.innerHTML=html;const replacement=box.content.firstElementChild;replacement.dataset.rendered=html;existing.replaceWith(replacement);}}
   else{const box=document.createElement('template');box.innerHTML=html;const el=box.content.firstElementChild;el.dataset.rendered=html;list.insertBefore(el,list.children[index]||null);}
  }
  for(const d of list.querySelectorAll('[data-news-proof]'))d.open=opened.has(d.dataset.newsProof);
  if(anchorId){const current=[...list.children].find(el=>el.dataset.newsId===anchorId);if(current&&anchorTop<innerHeight&&anchorTop<90)window.scrollBy(0,current.getBoundingClientRect().top-anchorTop);} 
  const warnings=(data.warnings||[]).map(w=>`${w.provider}: ${w.message}${w.stale?' 마지막으로 받은 목록을 표시합니다.':''}`).join(' ');
  state.textContent=warnings||(!data.items.length?(region==='KR'?'경제 분야로 확인된 뉴스가 없습니다. 다른 검색어로 찾아보세요.':'조건에 맞는 뉴스가 없습니다. 다른 검색어로 찾아보세요.'):'');
  host.querySelector('[data-news-more]').hidden=data.items.length<=visible;
  const quoteBasis=[...new Set(data.items.slice(0,visible).flatMap(a=>(a.stocks||[]).map(s=>{const q=quotes[s.market+':'+s.ticker];return q?.status==='ready'?(s.market==='KR'?'국내 ':'미국 ')+(q.baseDate?q.baseDate+' 종가':(q.asOfKind==='received'?'조회 ':'기준 ')+clock(q.asOf))+(q.stale?' · 이전 저장 시세':''):null;})).filter(Boolean))];
  basis.textContent=[data.scope,...(data.providers||[]).map(p=>`${p.name} 조회 ${p.fetchedAt?clock(p.fetchedAt):'미확인'}`),'뉴스 요약은 제목·제공 발췌문 기준',...quoteBasis].filter(Boolean).join(' · ');
 }
 async function loadQuotes(){
  if(signal.aborted||quoteActive||!data)return;
  const keys=[...new Set(data.items.slice(0,visible).flatMap(a=>[...(a.stocks||[]),...relatedStocks(a)].filter(validStock).map(s=>s.market+':'+s.ticker)))].filter(k=>!quotes[k]);if(!keys.length)return;
  quoteActive=true;
  try{const response=await fetch('/api/watchlist?symbols='+encodeURIComponent(keys.join(',')),{signal}),value=await response.json();if(!response.ok)throw Error('QUOTE_FAILED');if(signal.aborted)return;
   for(const k of keys){const row=(value.items||[]).find(q=>q.key===k);quotes[k]=row||{status:'unavailable',reason:'시세 미확인'};}
  }catch{if(!signal.aborted)for(const k of keys)quotes[k]={status:'unavailable',reason:'시세 연결 오류'};}
  finally{quoteActive=false;if(!signal.aborted){render();void loadQuotes();}}
 }
 async function summarizeVisible(attempt=0){
  if(signal.aborted||summaryActive||loading||!data||data.inlineV2)return;
  const seq=sequence,ids=data.items.slice(0,visible).filter(a=>!a.brief||attempt>0&&a.brief.status==='PENDING').slice(0,6).map(a=>a.id);if(!ids.length)return;
  summaryActive=true;for(const a of data.items)if(ids.includes(a.id))a.brief={status:'PENDING',message:'한국어 요약 중'};render();let pending=false;
  try{const response=await api('/article-summaries',{articleIds:ids});if(signal.aborted||seq!==sequence)return;
   const updates=new Map(response.items.map(a=>[a.id,a]));data.items=data.items.filter(a=>!ids.includes(a.id)||updates.has(a.id)).map(a=>updates.has(a.id)?{...a,...updates.get(a.id),relation:a.relation}:a);pending=response.items.some(a=>a.brief?.status==='PENDING');render();
  }catch{if(!signal.aborted&&seq===sequence){for(const a of data.items)if(ids.includes(a.id))a.brief={status:'FAILED',message:'요약 연결 오류 · 원제 표시'};render();}}
  finally{summaryActive=false;if(!signal.aborted){clearTimeout(summaryTimer);if(seq!==sequence)void summarizeVisible();else if(pending&&attempt<3)summaryTimer=setTimeout(()=>void summarizeVisible(attempt+1),5000);else if(!pending)void summarizeVisible();}}
 }
 async function relateVisible(attempt=0){
  if(signal.aborted||document.hidden||relationActive||loading||!data)return;
  const seq=sequence,ids=data.items.slice(0,visible).filter(a=>relationNeedsPolling(a.relation)&&(!data.inlineV2||(pollCounts.get(a.id)||0)<20&&[...list.children].some(el=>el.dataset.newsId===a.id&&el.getBoundingClientRect().bottom>0&&el.getBoundingClientRect().top<innerHeight))).slice(0,6).map(a=>a.id);if(!ids.length)return;
  relationActive=true;let pending=false,delayed=false;
  try{for(const id of ids)pollCounts.set(id,(pollCounts.get(id)||0)+1);const response=await (data.inlineV2?api('/article-relations?ids='+encodeURIComponent(ids.join(','))):api('/article-relations',{articleIds:ids}));if(signal.aborted||seq!==sequence)return;const updates=new Map(response.items.map(a=>[a.id,a.relation]));data.items=data.items.map(a=>updates.has(a.id)?(data.inlineV2?mergeInlineUpdate(a,updates.get(a.id)):{...a,relation:updates.get(a.id)}):a);pending=response.items.some(a=>relationNeedsPolling(a.relation));delayed=response.items.some(a=>a.relation.status==='RETRY');render();void loadQuotes();}
  catch{delayed=true;pending=true;if(!signal.aborted&&seq===sequence){for(const a of data.items)if(ids.includes(a.id))a.relation=relationRequestDelayed(a.relation);render();}}
  finally{relationActive=false;if(!signal.aborted){clearTimeout(relationTimer);if(seq!==sequence)void relateVisible();else if(pending&&attempt<(delayed?3:240))relationTimer=setTimeout(()=>void relateVisible(attempt+1),data?.inlineV2?15000:delayed?2000*2**attempt:5000);else if(!pending)void relateVisible();}}
 }
 async function load(background=false){
  if(background&&(loading||summaryActive||relationActive))return;
  const seq=++sequence;clearTimeout(summaryTimer);clearTimeout(relationTimer);loading=true;if(!background)state.textContent='뉴스를 불러오는 중…';list.setAttribute('aria-busy','true');host.querySelector('[data-news-refresh]').disabled=true;
  const params=new URLSearchParams({region,q:form.elements.q.value.trim(),publisher:region==='KR'?'all':form.elements.publisher.value});
  try{const value=await api('/articles?'+params);if(signal.aborted||seq!==sequence)return;
   const oldItems=data?.items||[],anchor=background?[...list.children].find(el=>el.getBoundingClientRect().top>=80):null,anchorId=anchor?oldItems[[...list.children].indexOf(anchor)]?.id:null,top=anchor?.getBoundingClientRect().top;
   if(background&&value.inlineV2&&data){const fresh=new Map(value.items.map(a=>[a.id,a]));value.items=[...data.items.filter(a=>fresh.has(a.id)).map(a=>fresh.get(a.id)),...value.items.filter(a=>!data.items.some(b=>b.id===a.id))];}data=value;if(!background){visible=6;pollCounts.clear();}loading=false;render();
   if(anchorId){const index=data.items.findIndex(a=>a.id===anchorId),element=list.children[index];if(element)window.scrollBy(0,element.getBoundingClientRect().top-top);}
   void loadQuotes();void summarizeVisible();relationTimer=setTimeout(()=>void relateVisible(),800);}
  catch(e){if(!signal.aborted&&seq===sequence){state.textContent=e.message+' 잠시 후 자동으로 다시 확인합니다.';loading=false;}}
  finally{if(seq===sequence){list.removeAttribute('aria-busy');host.querySelector('[data-news-refresh]').disabled=false;}}
 }
 form.addEventListener('submit',e=>{e.preventDefault();void load();},{signal});
 form.elements.publisher.addEventListener('change',()=>void load(),{signal});
 host.addEventListener('click',e=>{
  const tab=e.target.closest('[data-news-region]');if(tab&&tab.dataset.newsRegion!==region){region=tab.dataset.newsRegion;data=null;list.innerHTML='';basis.textContent='';form.elements.q.value='';form.elements.publisher.value='all';host.querySelectorAll('[data-news-region]').forEach(b=>b.setAttribute('aria-pressed',String(b===tab)));host.querySelector('.nc-news-publisher').hidden=region==='KR';host.querySelector('.nc-news-search-label').textContent=region==='KR'?'경제 뉴스 검색':'최근 해외 기사에서 검색';form.elements.q.placeholder=region==='KR'?'기업명, 반도체, 전력망…':'영문 키워드 · 최근 RSS 기사 내 검색';topics();void load();}
  const q=e.target.closest('[data-news-query]');if(q){form.elements.q.value=q.dataset.newsQuery;void load();}
  if(e.target.closest('[data-news-refresh]')){quotes={};void load();void loadUsage();}
  if(e.target.closest('[data-news-more]')){visible+=6;render();void loadQuotes();void summarizeVisible();void relateVisible();}
 },{signal});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){void load(true);void loadUsage();}},{signal});
 topics();void load();void loadUsage();
 return {setBusy(){}};
}
export function newsLiveText(u){
 const live=u.live||{},reasons={BUDGET_WAIT:'일일 토큰 예산 도달 · 다음 예산 갱신 대기',MEMORY_WAIT:'서버 메모리 확보 대기',CONFIGURATION_REQUIRED:'자동 분석 API 설정 필요',QUEUE_FULL:'대기열 가득 참 · 다음 수집 때 재확인'};
 return [live.enabled?`${Math.round((live.pollMs||60000)/1000)}초마다 수집`: '서버 자동 수집 중지',live.stale?'수집 상태 갱신 지연':live.status==='FEED_ERROR'||live.status==='ERROR'?'뉴스 수집 연결 오류':live.status==='PARTIAL'?'일부 뉴스 제공처 연결 지연':null,live.lastSuccessAt?'최근 수집 '+clock(live.lastSuccessAt):null,`분석 중 ${u.queue?.running||0}건 · 대기 ${u.queue?.pending||0}건`,reasons[live.deferred]].filter(Boolean).join(' · ');
}
export function newsUsageMarkup(u){
 const n=v=>Number(v||0).toLocaleString('ko-KR'),ai=u.ai||{},budget=u.budget||{};
 return `<div class="nc-news-usage-grid"><span>AI 호출 <strong>${n(ai.calls)}회</strong></span><span>확인된 사용량 <strong>${n(ai.settledTokens)} 토큰</strong></span><span>분석 접수 <strong>${n(u.jobs?.total)}건</strong></span><span>외부 검색 <strong>${n(u.searches?.completedJobRequests)}회</strong></span></div><p>뉴스 AI 비용 추정 ${ai.pricedCalls?'$'+Number(ai.estimatedUsd||0).toFixed(4):'계산 자료 없음'} · 세부 기록 ${n(ai.pricedCalls)}회 기준${ai.unitemizedCalls?` · ${n(ai.unitemizedCalls)}회는 입력·출력 내역이 없어 비용 미포함`:''}</p><p>공유 AI 예산 ${n(budget.used)} / ${n(budget.hard)} 토큰 · ${esc(budget.day||'')} UTC · 미정산 예약 포함</p><p>${esc((u.providers||[]).map(p=>`${p.provider} ${n(p.requests)}회`).join(' · '))} · 피드 호출은 기록 적용 이후</p><p>${esc(u.scope||'')} · 검색 횟수는 완료된 분석 기준</p>`;
}
