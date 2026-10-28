import {escapeHtml as esc,icon} from './components.js';
import {hubLabels as labels,hubExamples as examples,hubFields,hubMenu,hubLegal} from './macro-hub-ui.js';
import {macroLinePoints} from './macro-chart-model.js';
const fmt=v=>Number.isFinite(v)?v.toLocaleString('ko-KR',{maximumFractionDigits:Math.abs(v)>0&&Math.abs(v)<.01?4:2}):'—';
const signed=v=>Number.isFinite(v)?(v>0?'+':'')+fmt(v):'—';
const stamp=s=>s&&Number.isFinite(Date.parse(s))?new Date(s).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})+' KST':'미제공';
const period=(date,f)=>!date?'관측값 없음':f==='M'?date.slice(0,7):f==='Q'?date.slice(0,4)+' Q'+Math.ceil(Number(date.slice(5,7))/3):date;
const adjustment=s=>({NSA:'계절 미조정',SA:'계절조정',SAAR:'계절조정 · 연율'})[s]||s;
const sources=s=>`<span>${esc((s.metadata?.sources||[]).join(' · '))}</span><a href="${esc(s.sourceUrl)}" target="_blank" rel="noopener noreferrer" data-macro-source="${esc(s.id)}">FRED ${icon('external')}</a>`;
const comparison=(label,p,s)=>`<span title="${esc(p?`${p.from} → ${p.to} · ${s.comparisons.formula} · ${adjustment(s.metadata.seasonalShort)}`:'같은 기준의 비교 관측값이 없습니다.')}" aria-label="${label} ${p?signed(p.value)+' '+p.unit:'비교 불가'}">${label} <b>${p?signed(p.value)+' '+esc(p.unit):'—'}</b></span>`;
function card(s){return `<article class="surface macro-indicator macro-chart-card" id="macro-${esc(s.id)}"><header class="macro-card-heading"><div><h3>${esc(s.name)}</h3><small>${esc(s.id)} · ${esc(period(s.latest?.date,s.frequency))}</small></div><button class="macro-reset" data-macro-reset="${esc(s.id)}" title="전체 관측 기간으로 돌아가기">전체</button></header><div class="macro-comparisons">${comparison('YoY',s.comparisons?.yoy,s)}${comparison('MoM',s.comparisons?.mom,s)}</div>${s.stale||s.delayed||s.latestMissing||!s.historyComplete?`<p class="macro-warning">${!s.historyComplete?'전체 이력 조회 실패 · 저장된 구간':s.stale?'갱신 실패 · 마지막 정상값':s.latestMissing?'최신 관측 결측 · 마지막 유효값':'갱신 지연'}${s.error?' ('+esc(s.error)+')':''}</p>`:''}<div class="macro-chart-toolbar"><span>${esc(s.rawHistory?s.transformLabel:s.unit)} · ${esc(adjustment(s.metadata.seasonalShort))}</span>${s.rawHistory?`<select data-macro-view="${esc(s.id)}" aria-label="${esc(s.name)} 차트 표시 방식"><option value="transformed">${s.transform==='yoy'?'YoY':'전월 증감'}</option><option value="raw">원자료</option></select>`:''}</div><p class="macro-chart-value">${esc(period(s.latest?.date,s.frequency))} · ${fmt(s.latest?.value)} ${esc(s.unit)}</p><div class="macro-canvas" data-macro-canvas="${esc(s.id)}" aria-label="${esc(s.name)} 전체 기간 차트"></div><footer class="macro-chart-footer"><span>${esc(s.history[0]?.date||'—')} ~ ${esc(s.history.at(-1)?.date||'—')}</span>${sources(s)}</footer><details class="macro-data-info"><summary>자료 정보</summary><p>${esc(s.description)}</p><p>차트: ${esc(s.formula)} · ${esc(s.unit)}<br>원자료: ${esc(s.metadata.units)} · ${esc(s.cadence)}</p><p>YoY / MoM: ${esc(s.comparisons?.formula||'비교 자료 없음')}<br>전년·전월의 같은 관측 기간을 비교합니다. 일·주별은 기준일 이전 10일·8일 이내 유효값, 분기 자료의 MoM은 제공하지 않습니다. 비율·스프레드는 %p 변화로 표시합니다.</p><p>FRED 갱신 ${esc(s.fredUpdatedAt)} (원본 시간대)<br>서버 조회 ${stamp(s.retrievedAt)}</p><p>결측값과 계산 전 초기 구간은 채우지 않습니다. 현재 수정된 자료이며, 원자료 보기에는 최초 관측값부터 포함합니다.</p><p>${esc(s.metadata.usage?.label)}</p>${s.metadata.notes?`<details><summary>원본 주석·저작권 고지</summary><p class="macro-source-notes">${esc(s.metadata.notes)}</p></details>`:''}</details></article>`;}
function unavailable(data){const items=data.unavailableIndicators||[];return items.length?`<div class="macro-unavailable">${items.map(s=>`<p><b>${esc(s.name)}</b> · ${s.error==='USAGE_UNVERIFIED'?'공개 표시 승인 설정 필요':'현재 데이터 확인 불가'} <a href="${esc(s.sourceUrl)}" target="_blank" rel="noopener noreferrer">FRED 원본 ↗</a></p>`).join('')}</div>`:'';}
export function mountMacro(root){
 let disposed=false,version=0,controller,charts=new Map(),data=null,lib,renderVersion=0,activeTopic=null;
 const query=new URLSearchParams(location.search);
 root.innerHTML=`<section class="macro-explorer"><div class="page-heading"><div><div class="eyebrow">MACRO ANALYSIS HUB</div><h1>매크로 분석</h1><p class="macro-subtitle">질문에 맞는 주요 경제지표를 비교합니다.</p></div><span class="macro-provider">FRED · 12개 분야</span></div><section class="surface macro-question"><form><label for="macro-question-input">어떤 경제 흐름이 궁금하세요?</label><div class="macro-input-row"><span>${icon('search')}</span><input id="macro-question-input" type="search" maxlength="300" required placeholder="하이일드 스프레드와 금융시장 상황은?" autocomplete="off"><button type="submit" class="primary-button">찾아보기 ${icon('arrow')}</button></div><div class="macro-options"><label>지역 <select name="region" aria-label="매크로 지역"><option value="US">미국</option><option value="KR">한국</option><option value="auto">질문에서 확인</option></select></label><span>차트는 FRED 전체 관측 기간 · 휠 확대, 드래그 이동</span></div></form><div class="macro-examples">${examples.map((q,i)=>`<button data-macro-example="${i}">${esc(q)}</button>`).join('')}</div></section><section class="macro-results" aria-live="polite"></section>${hubMenu()}${hubLegal}</section>`;
 const $=s=>root.querySelector(s),form=$('form'),input=$('#macro-question-input'),region=form.elements.region,results=$('.macro-results');
 input.value=query.get('q')||'';region.value=query.get('region')||'US';
 const clearCharts=()=>{++renderVersion;for(const {chart,resize} of charts.values()){resize?.disconnect();chart.remove();}charts.clear();};
 function track(ids,action){if(navigator.doNotTrack==='1'||!ids.length)return;fetch('/api/macro/usage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids,action}),keepalive:true}).catch(()=>{});}
 async function run(topic){
  if(!input.value.trim())return;activeTopic=topic||null;root.querySelectorAll('.macro-browse button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.macroTopic===activeTopic)));controller?.abort();controller=new AbortController();const current=++version;
  const params=new URLSearchParams({q:input.value.trim(),region:region.value,years:'all'});if(topic)params.set('topic',topic);history.replaceState({},'','/macro?'+params);
  clearCharts();results.innerHTML='<div class="surface macro-empty" role="status"><span class="macro-loading"></span><h2>지표와 전체 관측 이력 불러오는 중</h2><p>처음 조회한 지표는 수집 후 서버에 저장합니다.</p></div>';
  try{const response=await fetch('/api/macro?'+params,{signal:controller.signal});const body=await response.json();if(current!==version||disposed)return;if(!response.ok)throw Error();data=body;render();track(data.core?.map(s=>s.id)||[],'view');}
  catch(e){if(e.name==='AbortError'||disposed||current!==version)return;results.innerHTML='<div class="surface macro-empty" role="alert"><h2>연결 오류 · 자료를 불러오지 못했습니다</h2><button class="secondary-button" data-macro-retry>다시 시도</button></div>';}
 }
 function render(){
  clearCharts();const a=data.analysis;let html=`<div class="macro-understood"><span>${esc(a.region==='US'?'미국':a.region==='KR'?'한국':'지역 확인 필요')}</span>${a.topics.map(t=>`<span>${esc(labels[t])}</span>`).join('')}<span>전체 관측 기간</span></div>`;
  if(data.status==='clarify')html+=`<div class="surface macro-empty"><h2>${esc(data.message)}</h2><div class="macro-choices">${a.needsRegion?'<button data-macro-region="US">미국</button><button data-macro-region="KR">한국</button>':Object.entries(labels).map(([t,n])=>`<button data-macro-topic="${t}">${n}</button>`).join('')}</div></div>`;
  else if(data.status==='domestic')html+=`<p class="macro-domestic-note">${esc(data.message)}</p><div class="macro-core">${data.domestic.map(s=>`<article class="surface macro-indicator"><h3>${esc(s.name)}</h3><p class="macro-value">${fmt(s.value)} <span>${esc(s.unit)}</span></p><p>직전 공표일 대비 ${signed(s.id==='KTB10Y'?s.changeBp:s.change)} ${s.id==='KTB10Y'?'bp':'원'}</p><p>관측 ${esc(s.baseDate)} · 일별 자료${s.stale?' · 갱신 지연':''}</p><p>한국은행 ECOS · 조회 ${stamp(s.syncedAt)}</p><button class="macro-text-button" data-macro-domestic="${esc(s.id)}">추세 차트 보기 →</button></article>`).join('')}</div>`;
  else if(data.status!=='ready')html+=`<div class="surface macro-empty"><h2>${esc(data.message||'데이터 연결 필요')}</h2><button class="secondary-button" data-macro-retry>다시 시도</button></div>${unavailable(data)}`;
  else html+=unavailable(data)+hubFields(data,card);
  results.innerHTML=html;if(data.status==='ready')void drawCharts();
 }
 async function drawCharts(){
  const generation=renderVersion;
  try{lib??=await import('/vendor/lightweight-charts/lightweight-charts.mjs');if(disposed||generation!==renderVersion)return;
   for(const s of [...data.core,...data.related]){
    const canvas=root.querySelector(`[data-macro-canvas="${s.id}"]`);if(!canvas||charts.has(s.id)||canvas.closest('details:not([open])'))continue;
    if(s.history.filter(p=>Number.isFinite(p.value)).length<2){canvas.innerHTML='<p class="macro-chart-empty">차트를 그릴 관측값이 부족합니다.</p>';continue;}
    const chart=lib.createChart(canvas,{autoSize:true,layout:{background:{color:'#fff'},textColor:'#7a8998',fontFamily:'Pretendard, sans-serif',fontSize:10,attributionLogo:true},grid:{vertLines:{visible:false},horzLines:{color:'#f0f3f6'}},rightPriceScale:{borderVisible:false,minimumWidth:48,scaleMargins:{top:.12,bottom:.12}},timeScale:{borderVisible:false,timeVisible:false,minBarSpacing:.001},localization:{locale:'ko-KR',priceFormatter:fmt},crosshair:{mode:lib.CrosshairMode.Normal},handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:true},handleScroll:{mouseWheel:false,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false}});
    const line=chart.addSeries(lib.LineSeries,{color:'#087f73',lineWidth:2,priceLineVisible:false,lastValueVisible:false});
    const entry={chart,line,canvas,s};charts.set(s.id,entry);setChart(entry,false);
    entry.resize=new ResizeObserver(()=>requestAnimationFrame(()=>{if(charts.get(s.id)===entry)chart.timeScale().fitContent();}));entry.resize.observe(canvas);
    chart.subscribeCrosshairMove(e=>{const p=entry.points.get(e.time)||entry.latest;canvas.previousElementSibling.textContent=`${period(p?.date,s.frequency)} · ${fmt(p?.value)} ${entry.unit}`;});
   }
  }catch{root.querySelectorAll('.macro-canvas').forEach(c=>{if(!c.querySelector('canvas'))c.innerHTML='<p class="macro-chart-empty">차트를 준비하지 못했습니다. FRED 원본에서 확인해 주세요.</p>';});}
 }
 function setChart(entry,raw){const {s,chart,line,canvas}=entry,h=raw?s.rawHistory:s.history;entry.points=new Map(h.map(p=>[p.date,p]));entry.latest=h.filter(p=>Number.isFinite(p.value)).at(-1);entry.unit=raw?s.metadata.units:s.unit;line.setData(macroLinePoints(h));chart.timeScale().fitContent();canvas.previousElementSibling.textContent=`${period(entry.latest?.date,s.frequency)} · ${fmt(entry.latest?.value)} ${entry.unit}`;canvas.parentElement.querySelector('.macro-chart-toolbar>span').textContent=(raw?'원자료':s.rawHistory?s.transformLabel:s.unit)+' · '+adjustment(s.metadata.seasonalShort);}
 const submit=e=>{e.preventDefault();void run();};form.addEventListener('submit',submit);
 const click=async e=>{const b=e.target.closest('button,a');if(!b)return;
  if(b.dataset.macroExample!==undefined){input.value=examples[Number(b.dataset.macroExample)];region.value='US';void run();}
  else if(b.hasAttribute('data-macro-retry'))void run(activeTopic);
  else if(b.dataset.macroTopic){input.value=(region.value==='KR'?'한국 ':'미국 ')+labels[b.dataset.macroTopic];void run(b.dataset.macroTopic);results.scrollIntoView({behavior:'smooth',block:'start'});}
  else if(b.dataset.macroRegion){region.value=b.dataset.macroRegion;void run(activeTopic);}
  else if(b.dataset.macroReset)charts.get(b.dataset.macroReset)?.chart.timeScale().fitContent();
  else if(b.dataset.macroSource)track([b.dataset.macroSource],'click');
  else if(b.dataset.macroDomestic){const item=data.domestic.find(s=>s.id===b.dataset.macroDomestic);const {openMarketChart}=await import('./market-chart.js');if(!disposed)openMarketChart({market:'KR',kind:'macro',id:item.id,name:item.name,item,feed:{items:data.domestic,source:'한국은행 ECOS',policy:{chart:true}}});}
 };
 const change=e=>{const entry=charts.get(e.target.dataset.macroView);if(entry)setChart(entry,e.target.value==='raw');};
 const toggle=e=>{if(e.target.matches('.macro-related')&&e.target.open)void drawCharts();};
 root.addEventListener('click',click);root.addEventListener('change',change);root.addEventListener('toggle',toggle,true);
 if(input.value)void run(query.get('topic'));else results.innerHTML='<div class="macro-welcome"><p>질문하거나 아래에서 분야를 선택해 보세요.</p></div>';
 return {destroy(){disposed=true;++version;controller?.abort();clearCharts();root.removeEventListener('click',click);root.removeEventListener('change',change);root.removeEventListener('toggle',toggle,true);form.removeEventListener('submit',submit);}};
}
