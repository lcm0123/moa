import {escapeHtml as esc} from './components.js';
import {clientId} from './client-id.js';
import {chartPeriods,selectPeriod} from './stock-chart-model.js';
import {analysisData,chartUser,defaultAnalysisSettings,readAnalysisState,saveAnalysisState,saveAnalysisDefault} from './analysis-chart-model.js';
import {aggregateBars,configuredSeries,comparisonSeries,intervalLabel} from './stock-chart-analysis.js';
import {normalizeChartSettings,newIndicator,shiftDrawing,drawingIndex,panelIndicatorKinds,oscillatorKinds} from './stock-chart-state.js';
import {IchimokuPrimitive} from './ichimoku-primitive.js';
import {drawingMenu,comparisonMenu,indicatorNames} from './stock-chart-controls.js';
import {indicatorPicker,filterIndicatorPicker} from './stock-indicator-picker.js';
import {koreanChartEvents} from './korean-chart-events.js';

export function mountAnalysisChart(root,stock,feed){
 const model=analysisData(stock,feed),life=new AbortController(),signal=life.signal,key=stock.market+':'+stock.ticker,user=chartUser();
 let comparisons=[],searchResults=[],searchVersion=0,searchTimer,compareBusy=false,redo=[],indicatorQuery='',indicatorView='catalog',indicatorSettings=null;
 let {settings,drawings}=readAnalysisState(user,key),lib,chart,priceSeries,quoteLine,series=[],bars=[],computed=[],markers,events=[],selected=0,ichimokuPrimitives=[],menu=null,tool='select',draft=[],selectedDrawing=null,undo=[],dialog,placeholder,disposed=false,frame,drag=null,pendingDate;
 const colors={up:'#D84B52',down:'#3479D4',flat:'#8B97A8'},money=n=>Number.isFinite(n)?n.toLocaleString('ko-KR',{minimumFractionDigits:model.currency==='USD'?2:0,maximumFractionDigits:2}):'—';
 const stamp=at=>at&&Number.isFinite(Date.parse(at))?new Date(at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})+' KST':null;
 root.classList.add('kr-stock-chart','analysis-chart','kr-analysis','chart-basic');
 root.innerHTML=`<div class="sc-heading"><h2 id="stock-chart-title">주가 차트 <small>${esc(stock.ticker)}</small></h2><span>${esc(model.currency)} · 일봉 원천</span></div>
 <p class="kr-chart-baseline">${model.baseDate?'데이터 기준일 <strong>'+model.baseDate+'</strong> · '+(stock.market==='KR'?'전일 기준':'미국 거래일 종가'):'데이터 기준일 없음'}${model.stale?' · 마지막 저장 자료':''}</p>
 <div class="sc-toolbar"><select data-interval aria-label="봉 간격"><option value="day">일봉</option><option value="week">주봉</option><option value="month">월봉</option></select><select data-chart-type aria-label="차트 종류"><option value="candles">캔들</option><option value="line">선</option><option value="area">영역</option></select><div class="sc-periods" role="group" aria-label="조회 기간">${chartPeriods.map(([id,label])=>`<button data-period="${id}">${label}</button>`).join('')}</div></div>
 <details class="analysis-mobile-tools"><summary>상세 차트</summary><div class="sc-tools"><button data-menu="indicators">지표</button><button data-menu="drawings">그리기</button><button data-menu="compare">종목 비교</button><button data-menu="settings">설정</button><button data-fullscreen>전체 화면</button><button data-reset-view>초기화</button></div></details><div class="sc-menu" hidden></div><p class="sc-feedback" role="status" hidden></p>
 <div class="kr-chart-readout" aria-label="선택 봉 가격과 거래량"></div><div class="kr-chart-ma-values" aria-label="선택 봉 지표 값"></div><div class="kr-chart-aux-controls"></div>
 <div class="analysis-plot-layout"><aside class="analysis-draw-rail" aria-label="그리기 도구"><button data-tool="select" title="선택·이동" aria-label="선택·이동">↖</button><button data-tool="horizontal" title="수평선" aria-label="수평선">―</button><button data-tool="trend" title="추세선" aria-label="추세선">╱</button><button data-tool="range" title="사각형" aria-label="사각형">▭</button><button data-undo title="실행 취소" aria-label="실행 취소">↶</button></aside><div class="kr-analysis-stage"><div class="kr-chart-canvas" tabindex="0" role="group" aria-label="주가 분석 차트. 휠·두 손가락으로 확대, 드래그 이동, 가격 축 드래그로 세로 배율 조절"></div><svg class="kr-chart-drawings" aria-label="차트 그리기 객체"></svg><div class="kr-chart-status" role="status">차트 준비 중…</div></div></div>
 <div class="kr-chart-navigation"><div><button data-zoom="0.75" aria-label="차트 확대">＋</button><button data-zoom="1.3333" aria-label="차트 축소">−</button><button data-latest>최신 구간</button></div><span class="kr-chart-range"></span></div>
 <p class="kr-chart-return"></p><div class="analysis-comparison-summary" aria-live="polite"></div><div class="kr-chart-event-list" aria-label="차트 관련 실적·리포트·주요 일정"></div>
 <p class="kr-chart-coverage">${model.bars.length?`확보한 일봉 ${model.bars.length.toLocaleString()}개 · ${model.bars[0].date} ~ ${model.baseDate}`:'일봉 데이터 없음'}${model.historyWarning?' · '+esc(model.historyWarning):''}</p>
 <p class="kr-chart-source">${esc(model.source)}${stamp(model.receivedAt)?' · 일봉 동기화 '+esc(stamp(model.receivedAt)):''} · ${model.adjustment==='adjusted'?'수정주가':'수정주가 적용 여부 확인 필요'}</p>
 <p class="kr-chart-attribution"><a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">TradingView Lightweight Charts™</a> · Copyright (с) 2025 TradingView, Inc.</p>`;
 const $=s=>root.querySelector(s),canvas=$('.kr-chart-canvas'),overlay=$('.kr-chart-drawings'),status=$('.kr-chart-status');
 const controlRow=document.createElement('div');controlRow.className='analysis-control-row';$('.sc-toolbar').before(controlRow);controlRow.append($('.sc-toolbar'),$('.analysis-mobile-tools'));
 $('.sc-menu').classList.add('analysis-inspector');$('.analysis-plot-layout').append($('.sc-menu'));
 const picker=document.createElement('dialog');picker.className='indicator-picker-dialog';picker.id='indicator-picker-'+key.replace(/[^a-z0-9]/gi,'-');picker.setAttribute('aria-label','차트 지표 검색 및 설정');root.append(picker);
 $('[data-menu="indicators"]').setAttribute('aria-controls',picker.id);$('[data-menu="indicators"]').setAttribute('aria-haspopup','dialog');
 picker.addEventListener('cancel',e=>{e.preventDefault();menu=null;renderMenu();},{signal});
 picker.addEventListener('click',e=>{if(e.target!==picker)return;const r=picker.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom){menu=null;renderMenu();}},{signal});
 $('.analysis-draw-rail').insertAdjacentHTML('beforeend','<button data-redo disabled title="다시 실행 (Ctrl+Shift+Z)" aria-label="다시 실행">↷</button><button data-delete-selected disabled title="선택한 그리기 삭제" aria-label="선택한 그리기 삭제">×</button>');
 $('.kr-chart-navigation>div').insertAdjacentHTML('beforeend','<button data-reset-view>원래 보기</button>');
 const tell=text=>{const node=$('.sc-feedback');node.textContent=text;node.hidden=!text;};
 const persist=()=>{try{saveAnalysisState(user,key,{settings,drawings});}catch{tell('설정을 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.');}};
 const remember=()=>{undo.push(structuredClone(drawings));if(undo.length>40)undo.shift();redo=[];};
 function historyStep(forward=false){const from=forward?redo:undo,to=forward?undo:redo;if(!from.length)return;to.push(structuredClone(drawings));drawings=from.pop();selectedDrawing=null;draft=[];persist();renderMenu();scheduleDraw();}
 const day=t=>typeof t==='string'?t:t&&typeof t==='object'?`${t.year}-${String(t.month).padStart(2,'0')}-${String(t.day).padStart(2,'0')}`:null;
 function renderMenu(){
  root.querySelectorAll('[data-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tool===tool)));root.querySelectorAll('[data-undo]').forEach(b=>b.disabled=!undo.length);root.querySelectorAll('[data-redo]').forEach(b=>b.disabled=!redo.length);$('[data-delete-selected]').disabled=!selectedDrawing;
  const isIndicators=menu==='indicators',inline=$('.sc-menu');inline.hidden=!menu||isIndicators;root.querySelectorAll('[data-menu]').forEach(b=>b.setAttribute('aria-expanded',String(menu===b.dataset.menu)));
  if(!isIndicators&&picker.open){picker.close();$('[data-menu="indicators"]').focus({preventScroll:true});}
  if(!menu)return;
  const node=isIndicators?picker:inline,scroll=node.querySelector('.indicator-picker-scroll')?.scrollTop??node.scrollTop;
  const active=document.activeElement,restore=isIndicators&&node.contains(active)?{id:active.closest('[data-indicator-id]')?.dataset.indicatorId,attr:['data-config','data-color','data-indicator-settings','data-indicator-view','data-add-indicator','data-panel-height','data-collapse','data-mobile-aux'].find(a=>active.hasAttribute(a))}:null;
  if(restore?.attr)restore.value=active.getAttribute(restore.attr);
  node.innerHTML=isIndicators?indicatorPicker(settings,{view:indicatorView,expandedId:indicatorSettings,ohlc:model.bars.some(b=>b.ohlc),volume:model.bars.some(b=>Number.isFinite(b.volume))}):menu==='compare'?comparisonMenu(comparisons,{indices:false}):menu==='drawings'?drawingMenu(drawings,selectedDrawing,tool,undo.length>0):`<div class="sc-menu-heading"><strong>차트 설정</strong><button data-menu-close>닫기</button></div><div class="sc-settings-checks"><label><input type="checkbox" data-setting="grid" ${settings.grid?'checked':''}>격자 표시</label><label><input type="checkbox" data-setting="currentPrice" ${settings.currentPrice?'checked':''}>제공 현재가 수평선</label><label>가격 차트 높이 <input type="range" data-price-height min="300" max="800" step="20" value="${settings.priceHeight}" aria-label="가격 차트 높이"><output>${settings.priceHeight}px</output></label></div><div class="sc-draw-tools"><button data-save-default>기본 차트 설정으로 저장</button><button data-reset-settings>설정 초기화</button><button data-clear-drawings>이 종목의 그리기만 삭제</button></div><p class="sc-note">이 브라우저에 종목별로 저장합니다. 설정 초기화는 그리기를 지우지 않습니다.</p>`;
  if(isIndicators){node.querySelector('.sc-indicator-search').value=indicatorQuery;filterIndicatorPicker(node,indicatorQuery);node.querySelector('.indicator-picker-scroll').scrollTop=scroll;if(!picker.open){picker.showModal();node.querySelector('.sc-indicator-search').focus({preventScroll:true});}else if(restore?.attr){const scope=restore.id?node.querySelector(`[data-indicator-id="${CSS.escape(restore.id)}"]`):node;const next=scope?.querySelector(`[${restore.attr}="${CSS.escape(restore.value)}"]`);if(next&&!next.disabled)next.focus({preventScroll:true});else node.querySelector('.sc-indicator-search').focus({preventScroll:true});}}else node.scrollTop=scroll;
 }
 function inspect(index){
  if(!bars.length)return;selected=Math.max(0,Math.min(bars.length-1,index));const b=bars[selected];
  $('.kr-chart-readout').innerHTML=`<strong>${(b.startDate===b.endDate?b.date:b.startDate+' ~ '+b.endDate)+' ('+(stock.market==='KR'?'한국':'미국')+')'}</strong>${[['시가',b.open],['고가',b.high],['저가',b.low],['종가',b.close]].map(([label,value])=>`<span>${label} <b>${money(value)}</b></span>`).join('')}<span>거래량 <b>${Number.isFinite(b.volume)?b.volume.toLocaleString('ko-KR')+'주':'미제공'}</b></span>`;
  $('.kr-chart-ma-values').innerHTML=computed.filter(s=>Number.isFinite(s.values[selected])).map(s=>`<span style="--ma-color:${s.color}"><i></i>${esc(s.label)} <b>${money(s.values[selected])}</b></span>`).join('');
 }
 function inspectProjection(index){
  if(index>=bars.length+projection())return inspect(bars.length-1);
  $('.kr-chart-readout').innerHTML=`<strong>일목 선행 구간 +${index-bars.length+1}봉</strong><span>이동 표시된 계산값</span>`;
  $('.kr-chart-ma-values').innerHTML=computed.filter(s=>s.panel==='ichimoku'&&Number.isFinite(s.values[index])).map(s=>`<span style="--ma-color:${s.color}"><i></i>${esc(s.label)} <b>${money(s.values[index])}</b></span>`).join('');
 }
 async function searchComparisons(query){
  const version=++searchVersion,node=$('.sc-compare-results');if(!node)return;if(!query.trim()){node.textContent='';return;}
  node.textContent='종목을 찾고 있어요';
  try{const response=await fetch('/api/search?'+new URLSearchParams({q:query}),{signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});if(!response.ok)throw new Error();const data=await response.json();if(disposed||version!==searchVersion)return;searchResults=(data.items||[]).filter(s=>s.market+':'+s.ticker!==key);const target=$('.sc-compare-results');if(!target)return;target.innerHTML=searchResults.length?searchResults.map((s,i)=>`<button data-add-compare="${i}">${esc(s.name)} · ${esc(s.ticker)} · ${s.market}</button>`).join(''):'일치하는 종목이 없습니다.';}catch{if(!disposed&&version===searchVersion&&$('.sc-compare-results'))$('.sc-compare-results').textContent='검색 데이터를 불러오지 못했습니다.';}
 }
 async function addComparison(index){
  const selected=searchResults[index];if(!selected||compareBusy)return;if(comparisons.length>=3){tell('최대 3개 종목을 비교할 수 있습니다.');return;}const target=selected.market+':'+selected.ticker;if(comparisons.some(s=>s.key===target)){tell('이미 추가된 종목입니다.');return;}
  compareBusy=true;tell('비교 종목의 일봉을 확인하고 있어요');
  try{const response=await fetch('/api/stock?'+new URLSearchParams({market:selected.market,id:selected.id||selected.ticker}),{signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});if(!response.ok)throw new Error('비교 일봉 조회 실패');const data=await response.json(),item=data.items?.find(s=>s.market===selected.market&&s.ticker===selected.ticker);if(!item)throw new Error('종목 식별자 확인 필요');const next=analysisData(item,data);if(!data.policy?.chart||!next.bars.length)throw new Error('확인된 일봉 가격 이력이 없습니다.');if(disposed)return;comparisons.push({key:target,label:selected.name+' ('+selected.ticker+')',color:['#327fba','#d35477','#b7791f'][comparisons.length],bars:next.bars,source:next.source,baseDate:next.baseDate,adjustment:next.adjustment});renderChart();renderMenu();tell('같은 실제 거래일을 0%로 맞춰 비교합니다.');}catch(e){if(!disposed)tell(e.message||'비교 데이터를 불러오지 못했습니다.');}finally{compareBusy=false;}
 }
 function renderComparison(pane){
  const summary=$('.analysis-comparison-summary');summary.innerHTML='';if(!comparisons.length)return;const selected=selectPeriod(bars,settings.period).items,comparison=comparisonSeries(selected,comparisons,settings.interval);
  if(!comparison.baseDate){tell('선택 기간에 함께 비교할 수 있는 실제 거래일이 없습니다.');return;}
  summary.innerHTML=`<strong>종목 비교 · ${comparison.baseDate} 종가 = 0%</strong>${comparisons.map(c=>`<span style="color:${c.color}">${esc(c.label)} · ${esc(c.source)} · 기준일 ${esc(c.baseDate)} · ${c.adjustment==='adjusted'?'수정주가':'수정주가 여부 미확인'}</span>`).join('')}`;
  for(const s of comparison.series){const line=chart.addSeries(lib.LineSeries,{color:s.color,lineWidth:2,title:s.id==='base'?stock.ticker:s.label,priceLineVisible:false,lastValueVisible:false,priceFormat:{type:'percent'}},pane);line.setData(selected.map((b,i)=>Number.isFinite(s.values[i])?{time:b.date,value:s.values[i]}:{time:b.date}));series.push(line);}chart.panes()[pane].setHeight(160);
 }
 function openEvent(event){
  if(!event)return;if(event.reportId){root.dispatchEvent(new CustomEvent('kr-chart-open-report',{bubbles:true,detail:{reportId:event.reportId}}));return;}
  const link=event.href;if(typeof link==='string'&&link.startsWith('/')&&!link.startsWith('//')){const a=document.createElement('a');a.href=link;a.dataset.nav='';root.append(a);a.click();a.remove();}else document.querySelector('#recent-title')?.scrollIntoView({behavior:'smooth'});
 }
 function openEvents(date){const matching=koreanChartEvents(events,bars,stock.market).filter(e=>e.barDate===date);if(matching.length===1){openEvent(matching[0]);return;}const details=$('.kr-chart-event-list details');if(details){details.open=true;details.scrollIntoView({behavior:'smooth',block:'nearest'});}}
 function scheduleDraw(){cancelAnimationFrame(frame);frame=requestAnimationFrame(drawObjects);}
 function rangeChanged(range){
  if(range&&bars.length){const from=Math.max(0,Math.ceil(range.from)),to=Math.min(bars.length-1,Math.floor(range.to)),a=bars[from],b=bars[to];$('.kr-chart-range').textContent=a&&b?`${a.date} ~ ${b.date}`:'';
   $('.kr-chart-return').textContent=a&&b&&a.close>0?'화면 선택 기간 수익률 '+((b.close/a.close-1)*100>=0?'+':'')+((b.close/a.close-1)*100).toFixed(2)+'% · 첫 봉 종가 대비 마지막 봉 종가':'';
  }scheduleDraw();
 }
 const projection=()=>Math.max(0,...settings.indicators.filter(c=>c.enabled&&c.kind==='ichimoku'&&computed.some(s=>s.owner===c.id&&['spanA','spanB'].includes(s.component)&&s.values.slice(bars.length).some(Number.isFinite))).map(c=>c.displacement));
 function reset(){if(!chart||!bars.length)return;const selected=selectPeriod(bars,settings.period),from=bars.length-selected.items.length;chart.timeScale().setVisibleLogicalRange(bars.length===1?{from:-8,to:8}:{from:from-.7,to:bars.length-.3+projection()});priceSeries.priceScale().applyOptions({autoScale:true});inspect(bars.length-1);}
 function configChanged(resetRange=false){settings=normalizeChartSettings(settings);persist();renderChart(resetRange);renderMenu();}
 function controls(){
  $('[data-interval]').value=settings.interval;$('[data-chart-type]').value=settings.type;
  root.querySelectorAll('[data-period]').forEach(b=>b.setAttribute('aria-pressed',String(settings.period===b.dataset.period)));
  // Indicator controls live in the picker instead of scattering sliders above the chart.
  $('.kr-chart-aux-controls').innerHTML='';
 }
 function renderChart(resetRange=false){
  if(!lib||!model.bars.length||disposed)return;
  const previous=chart?.timeScale().getVisibleLogicalRange();ichimokuPrimitives=[];markers?.detach();markers=null;chart?.remove();chart=null;series=[];
  bars=aggregateBars(model.bars,settings.interval);computed=configuredSeries(bars,settings.indicators,settings.interval);if(settings.type==='candles'&&!bars.every(b=>b.ohlc))settings.type='line';const mobile=root.clientWidth<650;
  const panels=settings.indicators.filter(c=>c.enabled&&!c.collapsed&&panelIndicatorKinds.includes(c.kind)&&(!mobile||c.kind==='volume'||c.kind===settings.mobileAux||!settings.indicators.some(d=>d.enabled&&!d.collapsed&&d.kind===settings.mobileAux)));
  const priceHeight=mobile?Math.min(settings.priceHeight,380):settings.priceHeight;
  canvas.style.height=(priceHeight+panels.reduce((sum,c)=>sum+c.height,0)+(comparisons.length?160:0))+'px';
  chart=lib.createChart(canvas,{autoSize:true,layout:{background:{type:'solid',color:'#FFFFFF'},textColor:'#677587',fontFamily:'Pretendard, sans-serif',fontSize:12,attributionLogo:true,panes:{separatorColor:'#E5EAF0',separatorHoverColor:'#b8dcd4',enableResize:true}},grid:{vertLines:{visible:settings.grid,color:'#F0F3F7'},horzLines:{visible:settings.grid,color:'#EEF1F5'}},rightPriceScale:{borderColor:'#E5EAF0',minimumWidth:76,scaleMargins:{top:.12,bottom:.1}},timeScale:{borderColor:'#E5EAF0',timeVisible:false,minBarSpacing:.05,lockVisibleTimeRangeOnResize:true},localization:{locale:'ko-KR',dateFormat:'yyyy-MM-dd'},crosshair:{mode:lib.CrosshairMode.Normal},handleScroll:{mouseWheel:true,pressedMouseMove:tool==='select',horzTouchDrag:tool==='select',vertTouchDrag:false},handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:{time:true,price:true}}});
  const options={priceLineVisible:false,lastValueVisible:!(settings.currentPrice&&Number.isFinite(stock.price)),priceFormat:{type:'custom',formatter:money,minMove:model.currency==='KRW'?1:.01},upColor:colors.up,downColor:colors.down,wickUpColor:colors.up,wickDownColor:colors.down,borderVisible:false,color:'#087f73',lineColor:'#087f73',topColor:'#087f7330',bottomColor:'#087f7302'};
  priceSeries=chart.addSeries(settings.type==='candles'?lib.CandlestickSeries:settings.type==='area'?lib.AreaSeries:lib.LineSeries,options);
  priceSeries.setData(bars.map(b=>settings.type==='candles'?{time:b.date,open:b.open,high:b.high,low:b.low,close:b.close,color:b.open===b.close?colors.flat:undefined,wickColor:b.open===b.close?colors.flat:undefined}:{time:b.date,value:b.close}));
  quoteLine=settings.currentPrice&&Number.isFinite(stock.price)?priceSeries.createPriceLine({price:stock.price,color:'#087f73',lineWidth:1,lineStyle:2,axisLabelVisible:true,title:stock.market==='KR'?'제공값 '+(stock.baseDate||''):'제공 현재가'}):null;
  const addLine=(s,pane)=>{const line=chart.addSeries(s.panel==='histogram'?lib.HistogramSeries:lib.LineSeries,{color:s.color,lineWidth:Math.max(1,Math.min(4,Math.round(s.width))),lastValueVisible:false,priceLineVisible:false,autoscaleInfoProvider:['rsi','stochastic'].includes(s.panel)?()=>({priceRange:{minValue:0,maxValue:100}}):undefined,priceFormat:s.panel==='obv'?{type:'volume'}:{type:'custom',formatter:money,minMove:.01}},pane);line.setData(bars.map((b,i)=>Number.isFinite(s.values[i])?{time:b.date,value:s.values[i],...(s.panel==='histogram'?{color:s.values[i]>=0?colors.up:colors.down}:{})}:{time:b.date}));series.push(line);return line;};
  computed.filter(s=>s.panel==='price').forEach(s=>addLine(s,0));
  for(const c of settings.indicators.filter(c=>c.enabled&&c.kind==='ichimoku')){const primitive=new IchimokuPrimitive(computed.filter(s=>s.owner===c.id),c,bars.length);priceSeries.attachPrimitive(primitive);ichimokuPrimitives.push(primitive);}
  canvas.dataset.projectionBars=String(projection());
  panels.forEach((c,i)=>{const pane=i+1;if(c.kind==='volume'){const volume=chart.addSeries(lib.HistogramSeries,{title:'거래량',priceFormat:{type:'volume'},priceLineVisible:false,lastValueVisible:false},pane);volume.setData(bars.map(b=>Number.isFinite(b.volume)?{time:b.date,value:b.volume,color:b.close>=b.open?colors.up:colors.down}:{time:b.date}));series.push(volume);}else{const lines=computed.filter(s=>s.owner===c.id).map(s=>addLine(s,pane));for(const p of c.kind==='rsi'?[30,70]:c.kind==='stochastic'?[20,80]:c.kind==='macd'?[0]:[])lines[0]?.createPriceLine({price:p,color:'#9aa6b5',lineStyle:2,lineWidth:1,axisLabelVisible:true,title:''});}chart.panes()[pane].setHeight(c.height);});
  renderComparison(panels.length+1);
  chart.panes()[0].setStretchFactor(priceHeight);panels.forEach((c,i)=>chart.panes()[i+1].setStretchFactor(c.height));if(comparisons.length&&chart.panes()[panels.length+1])chart.panes()[panels.length+1].setStretchFactor(160);
  chart.subscribeCrosshairMove(e=>{const logical=e.point?chart.timeScale().coordinateToLogical(e.point.x):null;if(projection()&&logical!==null&&logical>bars.length-1){inspectProjection(Math.round(logical));return;}const i=bars.findIndex(b=>b.date===day(e.time));inspect(i>=0?i:bars.length-1);});
  chart.subscribeClick(e=>{if(e.hoveredObjectId&&String(e.hoveredObjectId).startsWith('event:')){openEvents(String(e.hoveredObjectId).slice(6));return;}if(e.paneIndex>0)return;const point=pointAt(e.point);if(tool!=='select'&&point){draft.push(point);if(draft.length===(tool==='horizontal'?1:2)){remember();const d={id:'draw-'+clientId(),kind:tool,points:[...draft],color:'#7562c7',width:2};drawings.push(d);selectedDrawing=d.id;draft=[];tool='select';chart.applyOptions({handleScroll:{pressedMouseMove:true,horzTouchDrag:true}});persist();renderMenu();tell('그리기를 저장했습니다. 선을 누르거나 드래그해 수정할 수 있습니다.');}scheduleDraw();}else{const i=bars.findIndex(b=>b.date===day(e.time));if(i>=0)inspect(i);}});
  chart.timeScale().subscribeVisibleLogicalRangeChange(rangeChanged);controls();renderEvents();root.querySelectorAll('[data-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tool===tool)));root.querySelectorAll('[data-undo]').forEach(b=>b.disabled=!undo.length);
  if(resetRange||!previous)reset();else chart.timeScale().setVisibleLogicalRange(previous);inspect(Math.min(selected,bars.length-1));status.hidden=true;scheduleDraw();
 }
 function renderEvents(){
  const list=koreanChartEvents(events,bars,stock.market),grouped=new Map();for(const event of list){if(!event.barDate)continue;if(!grouped.has(event.barDate))grouped.set(event.barDate,[]);grouped.get(event.barDate).push(event);}
  if(priceSeries){markers?.detach();markers=lib.createSeriesMarkers(priceSeries,[...grouped].map(([time,items])=>({time,position:'belowBar',shape:'circle',color:'#087f73',text:[...new Set(items.map(e=>e.label))].join('·')+(items.length>1?' '+items.length:''),id:'event:'+time})).sort((a,b)=>a.time.localeCompare(b.time)));}
  $('.kr-chart-event-list').innerHTML=list.length?`<details><summary>실적·리포트·주요 일정 ${list.length}건</summary><p>날짜 마커는 확인된 자료의 발생일을 표시합니다. 주가 변동의 원인을 뜻하지 않습니다.</p>${[...list].reverse().map(e=>`<div><button data-event-date="${e.date}" ${e.barDate?'':'disabled'}>${e.date} · ${e.label}</button><button data-event-open="${esc(e.id)}">${esc(e.title)}</button><small>${esc(e.source||'출처 미제공')}${e.barDate?'':' · 해당 날짜 일봉 없음'}</small></div>`).join('')}</details>`:'';
 }
 function pointAt(point){if(!chart||!point||point.x<0||point.y<0||point.y>chart.panes()[0].getHeight())return null;const logical=chart.timeScale().coordinateToLogical(point.x),price=priceSeries.coordinateToPrice(point.y),index=Math.round(logical);return logical!==null&&bars[index]&&Number.isFinite(price)&&price>=0?{date:bars[index].date,price}:null;}
 function drawObjects(){
  if(!chart||disposed)return;const width=chart.timeScale().width(),height=chart.panes()[0].getHeight();overlay.setAttribute('viewBox',`0 0 ${width} ${height}`);overlay.style.width=width+'px';overlay.style.height=height+'px';
  const xy=p=>({x:chart.timeScale().logicalToCoordinate(drawingIndex(bars,p.date)),y:priceSeries.priceToCoordinate(p.price)});
  overlay.innerHTML=drawings.map(d=>{const a=xy(d.points[0]),b=d.points[1]?xy(d.points[1]):null;if(a.x===null||a.y===null||b&&(b.x===null||b.y===null))return '';const selected=d.id===selectedDrawing,attrs=`data-drawing="${d.id}" tabindex="0" role="button" aria-label="${d.kind==='horizontal'?'수평선':d.kind==='trend'?'추세선':'가격 구간'} 선택" stroke="${d.color}" stroke-width="${d.width}"`;
   let shape=d.kind==='horizontal'?`<line ${attrs} x1="0" y1="${a.y}" x2="${width}" y2="${a.y}"/>`:d.kind==='trend'?`<line ${attrs} x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`:`<rect ${attrs} x="${Math.min(a.x,b.x)}" y="${Math.min(a.y,b.y)}" width="${Math.abs(b.x-a.x)}" height="${Math.abs(b.y-a.y)}" fill="${d.color}20"/>`;
   if(selected)shape+=[a,b].filter(Boolean).map((p,i)=>`<circle data-drawing="${d.id}" data-handle="${i}" cx="${p.x}" cy="${p.y}" r="6" fill="white" stroke="${d.color}" stroke-width="2"/>`).join('');return shape;
  }).join('')+draft.map(p=>{const a=xy(p);return `<circle cx="${a.x}" cy="${a.y}" r="5" fill="#7562c7"/>`;}).join('');
 }
 function focusDate(date){const i=bars.findIndex(b=>b.startDate<=date&&b.endDate>=date);if(i<0){if(!chart&&model.bars.some(b=>b.date===date)){pendingDate=date;return true;}return false;}chart.timeScale().setVisibleLogicalRange({from:Math.max(-1,i-20),to:Math.min(bars.length,i+10)});chart.setCrosshairPosition(bars[i].close,bars[i].date,priceSeries);inspect(i);return true;}
 function closeFullscreen(){if(!dialog)return;const old=dialog;dialog=null;placeholder.replaceWith(root);placeholder=null;root.classList.remove('kr-chart-fullscreen');old.close();old.remove();$('[data-fullscreen]').textContent='전체 화면';$('[data-fullscreen]').focus();scheduleDraw();}
 function fullscreen(){if(dialog){closeFullscreen();return;}placeholder=document.createComment('kr-chart');root.replaceWith(placeholder);dialog=document.createElement('dialog');dialog.className='kr-chart-dialog';dialog.setAttribute('aria-label',stock.ticker+' 주가 분석 차트 전체 화면');document.body.append(dialog);dialog.append(root);root.classList.add('kr-chart-fullscreen');dialog.addEventListener('cancel',e=>{e.preventDefault();closeFullscreen();},{signal});dialog.showModal();$('[data-fullscreen]').textContent='전체 화면 닫기';$('[data-fullscreen]').focus();scheduleDraw();}
 function setTool(next){tool=next;draft=[];chart?.applyOptions({handleScroll:{pressedMouseMove:tool==='select',horzTouchDrag:tool==='select'}});renderMenu();tell(tool==='select'?'':(tool==='horizontal'?'차트에서 가격 위치 한 곳을 누르세요.':'차트에서 시작점과 끝점을 누르세요.'));}
 root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.disabled)return;
  if(b.dataset.menu){menu=menu===b.dataset.menu?null:b.dataset.menu;renderMenu();return;}if(b.hasAttribute('data-menu-close')){menu=null;renderMenu();return;}
  if(b.dataset.indicatorView){indicatorView=b.dataset.indicatorView;renderMenu();picker.querySelector('.indicator-picker-scroll').scrollTop=0;return;}
  if(b.dataset.indicatorSettings){indicatorSettings=indicatorSettings===b.dataset.indicatorSettings?null:b.dataset.indicatorSettings;renderMenu();return;}
  if(b.dataset.addIndicator){const kind=b.dataset.addIndicator,existing=[...panelIndicatorKinds,'ichimoku'].includes(kind)&&settings.indicators.find(c=>c.kind===kind);if(existing){existing.enabled=true;}else if(settings.indicators.length<15)settings.indicators.push(newIndicator(kind,Number(b.dataset.preset)||undefined));else{picker.querySelector('.indicator-picker-feedback').textContent='지표는 최대 15개까지 추가할 수 있습니다.';return;}if(oscillatorKinds.includes(kind))settings.mobileAux=kind;configChanged(kind==='ichimoku');picker.querySelector('.indicator-picker-feedback').textContent=indicatorNames[kind]+' 추가됨 · 적용 중에서 설정할 수 있습니다.';}
  else if(b.dataset.removeIndicator){settings.indicators=settings.indicators.filter(c=>c.id!==b.dataset.removeIndicator);configChanged();}
  else if(b.dataset.addCompare){addComparison(Number(b.dataset.addCompare));}
  else if(b.dataset.removeCompare){comparisons=comparisons.filter(c=>c.key!==b.dataset.removeCompare);renderChart();renderMenu();}
  else if(b.dataset.period){settings.period=b.dataset.period;configChanged(true);}
  else if(b.hasAttribute('data-fullscreen'))fullscreen();else if(b.hasAttribute('data-reset-view'))reset();
  else if(b.dataset.zoom){const r=chart?.timeScale().getVisibleLogicalRange();if(r){const m=(r.from+r.to)/2,w=Math.max(3,Math.min(10000,(r.to-r.from)*Number(b.dataset.zoom)));chart.timeScale().setVisibleLogicalRange({from:m-w/2,to:m+w/2});}}
  else if(b.hasAttribute('data-latest')){const r=chart?.timeScale().getVisibleLogicalRange();if(r)chart.timeScale().setVisibleLogicalRange({from:bars.length+projection()-(r.to-r.from),to:bars.length+projection()});}
  else if(b.dataset.collapse){const c=settings.indicators.find(c=>c.id===b.dataset.collapse);c.collapsed=!c.collapsed;configChanged();}
  else if(b.dataset.mobileAux){settings.mobileAux=b.dataset.mobileAux;configChanged();}
  else if(b.dataset.tool)setTool(b.dataset.tool);
  else if(b.dataset.selectDrawing){selectedDrawing=b.dataset.selectDrawing;setTool('select');scheduleDraw();}
  else if(b.dataset.deleteDrawing){remember();drawings=drawings.filter(d=>d.id!==b.dataset.deleteDrawing);selectedDrawing=null;persist();renderMenu();scheduleDraw();}
  else if(b.hasAttribute('data-undo'))historyStep();
  else if(b.hasAttribute('data-redo'))historyStep(true);
  else if(b.hasAttribute('data-delete-selected')&&selectedDrawing){remember();drawings=drawings.filter(d=>d.id!==selectedDrawing);selectedDrawing=null;persist();renderMenu();scheduleDraw();}
  else if(b.hasAttribute('data-save-default')){try{saveAnalysisDefault(user,settings);tell('기본 차트 설정을 저장했습니다.');}catch{tell('기본 설정 저장 실패');}}
  else if(b.hasAttribute('data-reset-settings')){settings=defaultAnalysisSettings();configChanged(true);}
  else if(b.hasAttribute('data-clear-drawings')){remember();drawings=[];selectedDrawing=null;draft=[];persist();renderMenu();scheduleDraw();}
  else if(b.dataset.eventDate)focusDate(b.dataset.eventDate);
  else if(b.dataset.eventOpen)openEvent(events.find(v=>v.id===b.dataset.eventOpen));
 },{signal});
 root.addEventListener('change',e=>{const t=e.target,c=settings.indicators.find(c=>c.id===t.closest('[data-indicator-id]')?.dataset.indicatorId);
  if(t.type==='number'&&!t.checkValidity()){t.reportValidity();return;}
  if(c?.kind==='macd'&&['fast','slow'].includes(t.dataset.config)&&((t.dataset.config==='fast'&&Number(t.value)>=c.slow)||(t.dataset.config==='slow'&&Number(t.value)<=c.fast))){t.setCustomValidity('빠른 EMA 기간은 느린 EMA보다 작아야 합니다.');t.reportValidity();return;}
  if(t.matches('[data-interval]')){settings.interval=t.value;configChanged(true);}else if(t.matches('[data-chart-type]')){settings.type=t.value;configChanged();}
  else if(c&&t.dataset.config){const k=t.dataset.config;if(k.startsWith('width-'))c.widths[Number(k.slice(6))]=Number(t.value);else c[k]=['enabled','cloud'].includes(k)?t.checked:Number(t.value);configChanged();}
  else if(c&&t.hasAttribute('data-color')){c.colors[Number(t.dataset.color)]=t.value;configChanged();}
  else if(t.dataset.compareColor){const c=comparisons.find(c=>c.key===t.dataset.compareColor);if(c)c.color=t.value;renderChart();}
  else if(t.dataset.setting){settings[t.dataset.setting]=t.checked;configChanged();}
  else if(t.dataset.panelHeight){settings.indicators.find(c=>c.id===t.dataset.panelHeight).height=Number(t.value);configChanged();}
  else if(t.hasAttribute('data-price-height')){settings.priceHeight=Number(t.value);configChanged();}
 },{signal});
 root.addEventListener('input',e=>{if(e.target.matches('.sc-compare-search')){clearTimeout(searchTimer);searchTimer=setTimeout(()=>searchComparisons(e.target.value),250);}
  if(e.target.type==='number')e.target.setCustomValidity('');
  if(e.target.matches('.sc-indicator-search')){indicatorQuery=e.target.value;filterIndicatorPicker(picker,indicatorQuery);}},{signal});
 root.addEventListener('submit',e=>{const f=e.target.closest('[data-edit-drawing]');if(!f)return;e.preventDefault();const d=drawings.find(d=>d.id===f.dataset.editDrawing),v=new FormData(f);if(!d)return;remember();d.points=d.points.map((p,i)=>({date:v.get('date'+i),price:Number(v.get('price'+i))}));d.color=v.get('color');d.width=Number(v.get('width'));persist();renderMenu();scheduleDraw();},{signal});
 overlay.addEventListener('pointerdown',e=>{const target=e.target.closest('[data-drawing]');if(!target)return;e.preventDefault();e.stopPropagation();selectedDrawing=target.dataset.drawing;tool='select';remember();const rect=overlay.getBoundingClientRect();drag={pointer:e.pointerId,start:{x:e.clientX-rect.left,y:e.clientY-rect.top},original:structuredClone(drawings.find(d=>d.id===selectedDrawing)),handle:target.hasAttribute('data-handle')?Number(target.dataset.handle):null};overlay.setPointerCapture(e.pointerId);chart.applyOptions({handleScroll:{pressedMouseMove:false,horzTouchDrag:false}});renderMenu();scheduleDraw();},{signal});
 overlay.addEventListener('pointermove',e=>{if(!drag||drag.pointer!==e.pointerId)return;const r=overlay.getBoundingClientRect(),point={x:e.clientX-r.left,y:e.clientY-r.top},d=drawings.find(d=>d.id===selectedDrawing);if(!d)return;if(drag.handle!==null){const p=pointAt(point);if(p)d.points[drag.handle]=p;}else{const dx=chart.timeScale().coordinateToLogical(point.x)-chart.timeScale().coordinateToLogical(drag.start.x),dy=priceSeries.coordinateToPrice(point.y)-priceSeries.coordinateToPrice(drag.start.y);Object.assign(d,shiftDrawing(drag.original,dx,dy,bars));}scheduleDraw();},{signal});
 const release=()=>{if(!drag)return;drag=null;chart?.applyOptions({handleScroll:{pressedMouseMove:true,horzTouchDrag:true}});persist();renderMenu();};overlay.addEventListener('pointerup',release,{signal});overlay.addEventListener('pointercancel',release,{signal});
 root.addEventListener('keydown',e=>{if(e.key==='Escape'){if(tool!=='select'){setTool('select');scheduleDraw();e.preventDefault();}else if(menu){menu=null;renderMenu();e.preventDefault();e.stopPropagation();}}if(e.target.closest('input,select,textarea'))return;if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();historyStep(e.shiftKey||e.key.toLowerCase()==='y');return;}if(['Delete','Backspace'].includes(e.key)&&selectedDrawing){e.preventDefault();remember();drawings=drawings.filter(d=>d.id!==selectedDrawing);selectedDrawing=null;persist();renderMenu();scheduleDraw();}if(e.target===canvas&&['ArrowLeft','ArrowRight'].includes(e.key)&&bars.length){e.preventDefault();const i=Math.max(0,Math.min(bars.length-1,selected+(e.key==='ArrowLeft'?-1:1)));chart.setCrosshairPosition(bars[i].close,bars[i].date,priceSeries);inspect(i);}if(e.target.hasAttribute('data-drawing')&&e.key==='Enter'){selectedDrawing=e.target.dataset.drawing;menu='drawings';renderMenu();scheduleDraw();}},{signal});
 canvas.addEventListener('pointermove',scheduleDraw,{signal});canvas.addEventListener('wheel',scheduleDraw,{signal,passive:true});
 let mobile=root.clientWidth<650;const resize=new ResizeObserver(()=>{const next=root.clientWidth<650;if(next!==mobile){mobile=next;renderChart();}scheduleDraw();});resize.observe(canvas);
 // Disclosure is user controlled at every width; resizing must not reset it.
 const toolsDisclosure=$('.analysis-mobile-tools');
 toolsDisclosure.addEventListener('toggle',()=>{root.classList.toggle('chart-basic',!toolsDisclosure.open);if(!toolsDisclosure.open){menu=null;setTool('select');renderMenu();}scheduleDraw();},{signal});
 if(!model.bars.length){status.textContent=model.message;root.querySelectorAll('.sc-tools button,.sc-toolbar button,.sc-toolbar select,.analysis-draw-rail button,.kr-chart-navigation button').forEach(b=>b.disabled=true);}
 else import('/vendor/lightweight-charts/lightweight-charts.mjs').then(l=>{if(disposed)return;lib=l;renderChart(true);if(pendingDate){focusDate(pendingDate);pendingDate=null;}}).catch(()=>{if(!disposed)status.textContent='차트를 불러오지 못했습니다. 새로고침해 주세요.';});
 return {focusDate,updateEvents(next){events=next||[];if(chart)renderEvents();},updateIdentity(){},updateQuote(next){stock={...stock,...next};if(quoteLine&&Number.isFinite(stock.price))quoteLine.applyOptions({price:stock.price});},destroy(){disposed=true;life.abort();clearTimeout(searchTimer);resize.disconnect();cancelAnimationFrame(frame);if(picker.open)picker.close();picker.remove();if(dialog)closeFullscreen();markers?.detach();chart?.remove();root.classList.remove('kr-stock-chart','analysis-chart','kr-analysis','chart-basic');}};
}
