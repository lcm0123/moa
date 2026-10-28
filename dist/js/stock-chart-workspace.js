import {escapeHtml as esc} from './components.js';
import {clientId} from './client-id.js';
import {percentage,time,modeLabels} from './data.js';
import {chartPeriods,normalizeBars,selectPeriod} from './stock-chart-model.js';
import {chartWindow,zoomWindow} from './market-chart-model.js';
import {aggregateBars,configuredSeries,comparisonSeries,dailyComparisonPoints,intervalLabel} from './stock-chart-analysis.js';
import {readChartState,saveChartState,saveDefaultChart,initialChartSettings,normalizeChartSettings,newIndicator,palette,shiftDrawing} from './stock-chart-state.js';
import {analysisGeometry,analysisMarkup,metric} from './stock-chart-renderer.js';
import {indicatorMenu,drawingMenu,settingsMenu,comparisonMenu} from './stock-chart-controls.js';

export function mountStockChart(root,stock,data){
 const daily=normalizeBars(data.policy?.chart?stock.history:[]),key=stock.market+':'+stock.ticker,uid='sc-'+clientId(),abort=new AbortController(),signal=abort.signal;
 let {settings,drawings}=readChartState(key),bars=[],series=[],window={start:0,count:0},g,visible=[],viewSeries=[],comparison=null;
 let selected=null,selectedDrawing=null,tool='select',draft=null,undo=[],menu=null,priceScale=1,dialog=null,placeholder=null,resizeFrame,searchTimer,searchVersion=0,comparisonBusy=false,disposed=false;
 let comparisons=[],searchResults=[],indexCatalog=null,quote=stock.price,quoteTime=stock.asOf,quoteMode=data.mode||stock.mode,quoteChange=stock.changePct,quoteBasis=stock.changeBasis;
 const pointers=new Map();let gesture=null;
 root.classList.add('analysis-chart');
 root.innerHTML=`<div class="sc-heading"><h2 id="stock-chart-title">주가 차트 <small>${esc(stock.ticker)}</small></h2><span>${esc(stock.currency||'USD')} · 일봉 원천</span></div>
 <div class="sc-toolbar"><label class="sc-select"><span class="sr-only">봉 간격</span><select data-interval aria-label="봉 간격"><option value="day">일봉</option><option value="week">주봉</option><option value="month">월봉</option></select></label><label class="sc-select"><span class="sr-only">차트 종류</span><select data-chart-type aria-label="차트 종류"><option value="candles">캔들</option><option value="line">선</option><option value="area">영역</option></select></label><div class="sc-periods" role="group" aria-label="조회 기간">${chartPeriods.map(([id,label])=>`<button data-period="${id}">${label}</button>`).join('')}</div></div>
 <div class="sc-tools"><button data-menu="indicators" aria-expanded="false">지표</button><button data-menu="drawings" aria-expanded="false">그리기</button><button data-menu="compare" aria-expanded="false">종목 비교</button><button data-menu="settings" aria-expanded="false">설정</button><button data-fullscreen>전체 화면</button><button data-reset-view title="선택한 조회 기간과 자동 가격 축으로 복원">초기화</button></div>
 <div class="sc-menu" hidden></div><p class="sc-feedback" role="status" hidden></p>
 <div class="sc-summary"></div><div class="sc-readout" aria-label="선택 봉의 가격과 거래량"></div><div class="sc-legend" aria-label="선택 봉의 지표 값"></div>
 <div class="sc-mobile-aux" hidden><button data-mobile-aux="rsi">RSI</button><button data-mobile-aux="macd">MACD</button></div>
 <div class="sc-stage"><svg class="sc-svg" tabindex="0" role="img" aria-label="주가 분석 차트. 좌우 방향키로 봉 이동, 더하기 빼기로 확대 축소"></svg><div class="sc-panel-controls"></div></div>
 <div class="sc-navigation"><div><button data-zoom="0.75" aria-label="차트 확대">＋</button><button data-zoom="1.3333" aria-label="차트 축소">−</button><button data-pan="-1" aria-label="이전 구간">←</button><button data-pan="1" aria-label="다음 구간">→</button><button data-latest>최신 구간</button></div><span class="sc-view-range"></span></div>
 <p class="sc-note sc-instructions">휠·두 손가락으로 확대 · 차트 드래그로 이동 · 오른쪽 가격 축 드래그로 배율 조절</p><p class="sc-note sc-source"></p>`;
 const $=s=>root.querySelector(s),svg=$('.sc-svg'),stage=$('.sc-stage'),menuEl=$('.sc-menu');
 const money=n=>Number.isFinite(n)?n.toLocaleString('en-US',{minimumFractionDigits:stock.currency==='KRW'?0:2,maximumFractionDigits:stock.currency==='KRW'?0:2}):'—';
 const tell=message=>{const node=$('.sc-feedback');node.textContent=message;node.hidden=!message;};
 const persist=()=>{try{saveChartState(key,{settings,drawings});}catch{tell('브라우저 저장 공간에 저장하지 못했습니다. 현재 화면에서는 사용할 수 있습니다.');}};
 const remember=()=>{undo.push(structuredClone(drawings));if(undo.length>40)undo.shift();};
 function rebuild(resetWindow=true){
  settings=normalizeChartSettings(settings);bars=aggregateBars(daily,settings.interval);series=configuredSeries(bars,settings.indicators,settings.interval);
  if(settings.type==='candles'&&!bars.every(b=>b.ohlc)){settings.type='line';tell('OHLC가 없는 구간이 있어 종가 선으로 표시합니다.');}
  if(resetWindow)resetView();else{window=chartWindow(bars.length,window.start,window.count);draw();}persist();
 }
 function resetView(){const range=selectPeriod(bars,settings.period);window=chartWindow(bars.length,bars.length-range.items.length,range.items.length);priceScale=1;selected=null;draw();}
 function sourceText(){
  $('.sc-source').textContent=(stock.historySource||'공급사 제공 일봉')+' · '+(daily.length?`${daily[0].date} ~ ${daily.at(-1).date} · ${daily.length.toLocaleString()}개 일봉`:'일봉 없음')+(stock.historyReceivedAt?' · 일봉 조회 '+time(stock.historyReceivedAt,true):'')+' · 수정주가 적용 여부: 공급사 확인 필요 · 현재가 '+(modeLabels[quoteMode]||'조회값')+(quoteTime?' · 조회 '+time(quoteTime,true):'')+' · 현재가는 마지막 일봉 종가와 별도입니다.';
 }
 function updateReadout(index){
  if(!visible.length)return;const i=Math.max(0,Math.min(visible.length-1,index)),b=visible[i];
  $('.sc-readout').innerHTML=`<strong>${esc(b.startDate===b.endDate?b.date:b.startDate+' ~ '+b.endDate)} <small>${intervalLabel[settings.interval]}</small></strong>`+[['시',b.open],['고',b.high],['저',b.low],['종',b.close]].map(([label,v])=>`<span>${label} <b>${money(v)}</b></span>`).join('')+`<span>거래량 <b>${metric(b.volume)}</b></span>`;
  $('.sc-legend').innerHTML=viewSeries.map(s=>`<span><i style="background:${s.color};height:${s.width}px"></i>${esc(s.label)} <b>${Number.isFinite(s.values[i])?metric(s.values[i]):'데이터 부족'}</b></span>`).join('');
  if(comparison)$('.sc-legend').innerHTML+=comparison.series.map(s=>`<span><i style="background:${s.color}"></i>${esc(s.id==='base'?stock.ticker:s.label)} <b>${percentage(s.values[i])}</b></span>`).join('');
 }
 function inspect(index){
  if(!g||!visible.length)return;selected=Math.max(0,Math.min(visible.length-1,index));updateReadout(selected);
  const b=visible[selected],x=g.x(selected),y=g.y(b.close),date=b.date;
  svg.querySelector('.sc-crosshair').innerHTML=`<line x1="${x}" x2="${x}" y1="${g.top}" y2="${g.bottom}"/><line x1="${g.left}" x2="${g.width-g.right}" y1="${y}" y2="${y}"/><circle cx="${x}" cy="${y}" r="3"/><rect x="${Math.max(g.left,Math.min(g.width-g.right-86,x-43))}" y="${g.height-24}" width="86" height="21" rx="3"/><text x="${Math.max(g.left+43,Math.min(g.width-g.right-43,x))}" y="${g.height-9}" text-anchor="middle">${date}</text>`;
  svg.querySelector('.sc-crosshair').setAttribute('visibility','visible');svg.setAttribute('aria-label',`${date} 시가 ${money(b.open)} 고가 ${money(b.high)} 저가 ${money(b.low)} 종가 ${money(b.close)} 거래량 ${metric(b.volume)}`);
 }
 function draw(preservePanelControls=false){
  sourceText();$('[data-interval]').value=settings.interval;$('[data-chart-type]').value=settings.type;
  root.querySelectorAll('[data-period]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.period===settings.period)));
  if(!bars.length){stage.innerHTML=`<div class="stock-chart-empty">${esc(stock.historyError||(data.policy?.chart?'표시할 일봉 데이터가 없습니다.':'차트 이용 권한 확인 필요'))}</div>`;root.querySelectorAll('.sc-toolbar button,.sc-toolbar select,.sc-tools button,.sc-navigation button').forEach(b=>b.disabled=true);return;}
  visible=bars.slice(window.start,window.start+window.count);viewSeries=series.map(s=>({...s,values:s.values.slice(window.start,window.start+window.count)}));
  comparison=comparisons.length?comparisonSeries(visible,comparisons,settings.interval):null;
  const width=Math.max(220,stage.clientWidth);
  g=analysisGeometry({bars:visible,series:viewSeries,settings,width,fullscreen:Boolean(dialog),priceScale,quote,comparison});
  svg.setAttribute('viewBox',`0 0 ${width} ${g.height}`);svg.setAttribute('height',g.height);
  svg.innerHTML=analysisMarkup({g,bars:visible,allBars:bars,start:window.start,series:viewSeries,settings,drawings,selectedDrawing,draft,quote,comparison,uid});
  if(preservePanelControls)g.panels.forEach((p,i)=>{$('.sc-panel-controls').children[i].style.top=p.head+'px';});
  else $('.sc-panel-controls').innerHTML=g.panels.map(p=>`<div class="sc-panel-heading" style="top:${p.head}px"><strong>${p.title}</strong>${p.kind==='comparison'?`<small>${comparison.baseDate?comparison.baseDate+' 기준':'공통 가격 이력이 없습니다'}</small>`:`<div><label>높이 <input type="range" data-panel-height="${p.id}" aria-label="${p.title} 패널 높이" min="60" max="350" step="5" value="${p.height}" ${p.collapsed?'disabled':''}></label><button data-panel-collapse="${p.id}" aria-expanded="${!p.collapsed}" aria-label="${p.title} ${p.collapsed?'펼치기':'접기'}">${p.collapsed?'펼치기':'접기'}</button></div>`}</div>`).join('');
  const range=selectPeriod(bars,settings.period),ret=range.returnPct;
  $('.sc-summary').innerHTML=`<div class="sc-return-values"><span>선택 기간 수익률 <strong class="${ret>0?'up':ret<0?'negative':''}">${percentage(ret)}</strong></span>${quoteBasis==='previous_close'?`<span class="sc-daily-return">조회값 전일 대비 <b class="${quoteChange>0?'up':quoteChange<0?'negative':''}">${percentage(quoteChange)}</b></span>`:''}</div><small>${range.start} ~ ${range.end} · 첫 봉 종가 대비 · 전일 대비 등락률과 별도${range.partial?' · 제공 이력 부족':''}</small>`;
  $('.sc-view-range').textContent=`화면 ${visible[0].date} ~ ${visible.at(-1).date} · ${visible.length}개 ${intervalLabel[settings.interval]}`;
  const auxiliaries=settings.indicators.filter(c=>c.enabled&&['rsi','macd'].includes(c.kind));$('.sc-mobile-aux').hidden=!(width<600&&auxiliaries.length===2);
  root.querySelectorAll('[data-mobile-aux]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mobileAux===settings.mobileAux)));
  if(selected!==null)inspect(Math.min(selected,visible.length-1));else updateReadout(visible.length-1);
  stage.classList.toggle('sc-is-drawing',tool!=='select');
 }
 function renderMenu(){
  menuEl.hidden=!menu;root.querySelectorAll('[data-menu]').forEach(b=>b.setAttribute('aria-expanded',String(b.dataset.menu===menu)));
  if(!menu)return;
  menuEl.innerHTML=menu==='indicators'?indicatorMenu(settings):menu==='drawings'?drawingMenu(drawings,selectedDrawing,tool,undo.length>0):menu==='settings'?settingsMenu(settings,priceScale):comparisonMenu(comparisons);
 }
 function setMenu(name){menu=menu===name?null:name;renderMenu();if(menu==='compare')$('.sc-compare-search').focus();else if(menu==='indicators')$('.sc-indicator-search').focus();}
 function closeFullscreen(){if(!dialog)return;const old=dialog;dialog=null;placeholder.replaceWith(root);placeholder=null;root.classList.remove('sc-fullscreen');old.close();old.remove();$('[data-fullscreen]').textContent='전체 화면';draw();$('[data-fullscreen]').focus();}
 function fullscreen(){if(dialog){closeFullscreen();return;}placeholder=document.createComment('stock-chart');root.replaceWith(placeholder);dialog=document.createElement('dialog');dialog.className='sc-fullscreen-dialog';dialog.setAttribute('aria-label',stock.ticker+' 전체 화면 분석 차트');document.body.append(dialog);dialog.append(root);root.classList.add('sc-fullscreen');dialog.addEventListener('cancel',e=>{e.preventDefault();closeFullscreen();},{signal});dialog.showModal();$('[data-fullscreen]').textContent='전체 화면 닫기';draw();$('[data-fullscreen]').focus();}
 function changeView(factor,anchor=.5){window=zoomWindow(bars.length,window,factor,anchor);selected=null;draw();}
 function completeDrawing(){persist();renderMenu();draw();}
 root.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b||b.disabled)return;
  if(b.hasAttribute('data-menu'))setMenu(b.dataset.menu);
  else if(b.hasAttribute('data-menu-close')){const previous=menu;menu=null;renderMenu();root.querySelector(`[data-menu="${previous}"]`)?.focus();}
  else if(b.dataset.period){settings.period=b.dataset.period;resetView();persist();}
  else if(b.hasAttribute('data-reset-view'))resetView();
  else if(b.hasAttribute('data-fullscreen'))fullscreen();
  else if(b.dataset.zoom)changeView(Number(b.dataset.zoom));
  else if(b.dataset.pan){window=chartWindow(bars.length,window.start+Number(b.dataset.pan)*Math.max(1,window.count*.3),window.count);selected=null;draw();}
  else if(b.hasAttribute('data-latest')){window=chartWindow(bars.length,bars.length-window.count,window.count);selected=null;draw();}
  else if(b.dataset.addIndicator){const kind=b.dataset.addIndicator,preset=Number(b.dataset.preset)||undefined;const existing=settings.indicators.find(c=>c.kind===kind&&(!['sma','ema'].includes(kind)||c.period===preset));if(existing)existing.enabled=true;else if(settings.indicators.length<15){const c=newIndicator(kind,preset);if(kind==='sma')c.colors[0]=palette[[5,20,60,120,200].indexOf(preset)%palette.length];settings.indicators.push(c);}else tell('지표는 최대 15개까지 추가할 수 있습니다.');rebuild(false);renderMenu();}
  else if(b.dataset.removeIndicator){settings.indicators=settings.indicators.filter(c=>c.id!==b.dataset.removeIndicator);rebuild(false);renderMenu();}
  else if(b.dataset.panelCollapse){const c=settings.indicators.find(c=>c.id===b.dataset.panelCollapse);c.collapsed=!c.collapsed;persist();draw();}
  else if(b.dataset.mobileAux){settings.mobileAux=b.dataset.mobileAux;persist();draw();}
  else if(b.dataset.tool){tool=b.dataset.tool;draft=null;renderMenu();draw();}
  else if(b.dataset.selectDrawing){selectedDrawing=b.dataset.selectDrawing;tool='select';renderMenu();draw();}
  else if(b.dataset.deleteDrawing){remember();drawings=drawings.filter(d=>d.id!==b.dataset.deleteDrawing);selectedDrawing=null;completeDrawing();}
  else if(b.hasAttribute('data-undo')){if(undo.length){drawings=undo.pop();selectedDrawing=null;draft=null;completeDrawing();}}
  else if(b.hasAttribute('data-save-default')){try{saveDefaultChart(settings);tell('기본 차트 설정을 저장했습니다.');}catch{tell('기본 설정을 저장하지 못했습니다.');}}
  else if(b.hasAttribute('data-reset-settings')){settings=initialChartSettings();tool='select';draft=null;rebuild();renderMenu();tell('차트 설정을 초기화했습니다. 그리기는 유지됩니다.');}
  else if(b.hasAttribute('data-clear-drawings')){remember();drawings=[];selectedDrawing=null;draft=null;completeDrawing();tell('이 종목의 그리기를 삭제했습니다. 그리기 메뉴의 실행 취소로 복원할 수 있습니다.');}
  else if(b.dataset.removeCompare){comparisons=comparisons.filter(c=>c.key!==b.dataset.removeCompare);renderMenu();draw();}
  else if(b.dataset.compareIndex!==undefined)await addComparison(searchResults[Number(b.dataset.compareIndex)]);
 },{signal});
 root.addEventListener('change',e=>{
  const el=e.target,c=settings.indicators.find(c=>c.id===el.closest('[data-indicator-id]')?.dataset.indicatorId);
  if(el.matches('[data-interval]')){settings.interval=el.value;draft=null;rebuild();}
  else if(el.matches('[data-chart-type]')){settings.type=el.value;rebuild(false);}
  else if(c&&(el.dataset.config||el.dataset.color!==undefined)){
   if(el.dataset.color!==undefined)c.colors[Number(el.dataset.color)]=el.value;
   else if(el.dataset.config.startsWith('width-'))c.widths[Number(el.dataset.config.slice(6))]=Number(el.value);
   else c[el.dataset.config]=el.type==='checkbox'?el.checked:Number(el.value);
   rebuild(false);renderMenu();
  }else if(el.dataset.setting){settings[el.dataset.setting]=el.checked;persist();draw();}
  else if(el.dataset.compareColor){const c=comparisons.find(c=>c.key===el.dataset.compareColor);if(c)c.color=el.value;draw();}
 },{signal});
 root.addEventListener('input',e=>{
  const el=e.target;
  const c=settings.indicators.find(c=>c.id===el.closest('[data-indicator-id]')?.dataset.indicatorId);
  if(c&&(el.dataset.config||el.dataset.color!==undefined)&&el.type!=='checkbox'&&el.value!==''&&el.checkValidity()){
   if(el.dataset.color!==undefined)c.colors[Number(el.dataset.color)]=el.value;
   else if(el.dataset.config.startsWith('width-'))c.widths[Number(el.dataset.config.slice(6))]=Number(el.value);
   else c[el.dataset.config]=Number(el.value);
   rebuild(false);
  }
  else if(el.matches('.sc-indicator-search')){const q=el.value.trim().toLowerCase();menuEl.querySelectorAll('[data-catalog]').forEach(row=>row.hidden=!row.dataset.keywords.includes(q));}
  else if(el.dataset.panelHeight){const c=settings.indicators.find(c=>c.id===el.dataset.panelHeight);c.height=Number(el.value);persist();draw(true);}
  else if(el.hasAttribute('data-price-scale')){priceScale=Number(el.value);draw();}
  else if(el.dataset.compareColor){const c=comparisons.find(c=>c.key===el.dataset.compareColor);if(c)c.color=el.value;draw();}
  else if(el.matches('.sc-compare-search')){clearTimeout(searchTimer);const version=++searchVersion;searchTimer=setTimeout(()=>searchComparison(el.value,version),250);}
 },{signal});
 root.addEventListener('submit',e=>{
  const form=e.target.closest('[data-edit-drawing]');if(!form)return;e.preventDefault();const drawing=drawings.find(d=>d.id===form.dataset.editDrawing);if(!drawing)return;
  const f=new FormData(form),points=drawing.points.map((_,i)=>({date:f.get('date'+i),price:Number(f.get('price'+i))}));remember();drawings=drawings.map(d=>d.id===drawing.id?{...d,points,color:f.get('color'),width:Number(f.get('width'))}:d);completeDrawing();
 },{signal});
 function point(e){const rect=svg.getBoundingClientRect(),x=(e.clientX-rect.left)*g.width/rect.width,y=(e.clientY-rect.top)*g.height/rect.height;return {x,y,index:Math.max(0,Math.min(visible.length-1,Math.floor((x-g.left)/g.step))),price:Math.max(0,g.priceAt(y))};}
 function pinchStart(){const [a,b]=[...pointers.values()];return {kind:'pinch',distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),window:{...window},anchor:Math.max(0,Math.min(1,((a.x+b.x)/2-g.left)/g.plotWidth))};}
 svg.addEventListener('pointerdown',e=>{
  if(!g||e.button!==0)return;svg.focus({preventScroll:true});const p=point(e);pointers.set(e.pointerId,p);svg.setPointerCapture(e.pointerId);
  if(pointers.size===2){gesture=pinchStart();draft=null;return;}if(pointers.size>2)return;
  const drawing=e.target.closest('[data-drawing-id]'),handle=e.target.closest('[data-handle]');
  gesture={kind:p.x>g.width-g.right&&p.y<=g.priceBottom?'scale':drawing&&tool==='select'?'drawing':'pan',p,window:{...window},priceScale,moved:false,pricePerPixel:(g.high-g.low)/(g.priceBottom-g.top),drawings:structuredClone(drawings),drawing:drawing?.dataset.drawingId,handle:handle?Number(handle.dataset.handle):null};
  if(gesture.kind==='drawing'){selectedDrawing=gesture.drawing;renderMenu();draw();}inspect(p.index);
 },{signal});
 svg.addEventListener('pointermove',e=>{
  if(!g)return;const p=point(e);if(pointers.has(e.pointerId))pointers.set(e.pointerId,p);
  if(!gesture){if(e.pointerType==='mouse')inspect(p.index);if(draft&&p.y<=g.priceBottom){draft.points[1]={date:visible[p.index].date,price:p.price};draw();}return;}
  if(gesture.kind==='pinch'&&pointers.size>=2){const [a,b]=[...pointers.values()],distance=Math.max(1,Math.hypot(a.x-b.x,a.y-b.y));window=zoomWindow(bars.length,gesture.window,gesture.distance/distance,gesture.anchor);selected=null;draw();return;}
  const dx=p.x-gesture.p.x,dy=p.y-gesture.p.y;gesture.moved ||= Math.hypot(dx,dy)>3;
  if(gesture.kind==='scale'){priceScale=Math.max(.15,Math.min(10,gesture.priceScale*Math.exp(dy/140)));draw();}
  else if(gesture.kind==='drawing'){
   const original=gesture.drawings.find(d=>d.id===gesture.drawing);if(!original)return;const deltaPrice=-dy*gesture.pricePerPixel,deltaBars=Math.round(dx/g.step);
   drawings=gesture.drawings.map(d=>d.id!==original.id?d:gesture.handle===null?shiftDrawing(d,deltaBars,deltaPrice,bars):{...d,points:d.points.map((v,i)=>i===gesture.handle?{date:visible[p.index].date,price:Math.max(0,original.points[i].price+deltaPrice)}:v)});draw();
  }else if(tool==='select'&&gesture.moved){window=chartWindow(bars.length,gesture.window.start-Math.round(dx/g.step),gesture.window.count);selected=null;draw();}
  else inspect(p.index);
 },{signal});
 function pointerEnd(e,cancel=false){
  if(!gesture)return;const previous=gesture,p=g?point(e):null;pointers.delete(e.pointerId);if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);
  if(previous.kind==='pinch'){if(pointers.size){const remaining=[...pointers.values()][0];gesture={kind:'pan',p:remaining,window:{...window},moved:true};}else gesture=null;return;}
  gesture=null;
  if(cancel){if(previous.kind==='drawing')drawings=previous.drawings;draw();return;}
  if(previous.kind==='drawing'&&previous.moved){undo.push(previous.drawings);if(undo.length>40)undo.shift();completeDrawing();return;}
  if(previous.kind==='pan'&&!previous.moved&&p.y>=g.top&&p.y<=g.priceBottom&&p.x<g.width-g.right){
   if(tool==='select'){selectedDrawing=null;renderMenu();draw();inspect(p.index);return;}
   const pt={date:visible[p.index].date,price:p.price};
   if(tool==='horizontal'){remember();const d={id:clientId(),kind:tool,points:[pt],color:'#7562c7',width:1.5};drawings.push(d);selectedDrawing=d.id;tool='select';completeDrawing();}
   else if(!draft){draft={id:'draft',kind:tool,points:[pt,pt],color:'#7562c7',width:1.5};draw();tell('두 번째 점을 선택하세요. Esc로 취소합니다.');}
   else{remember();const d={...draft,id:clientId(),points:[draft.points[0],pt]};drawings.push(d);selectedDrawing=d.id;draft=null;tool='select';tell('');completeDrawing();}
  }
 }
 svg.addEventListener('pointerup',e=>pointerEnd(e),{signal});svg.addEventListener('pointercancel',e=>pointerEnd(e,true),{signal});
 svg.addEventListener('pointerleave',()=>{if(!gesture){selected=null;svg.querySelector('.sc-crosshair')?.setAttribute('visibility','hidden');updateReadout(visible.length-1);}},{signal});
 svg.addEventListener('wheel',e=>{if(!g)return;e.preventDefault();const p=point(e);changeView(Math.exp(Math.max(-.4,Math.min(.4,e.deltaY*.002))),(p.x-g.left)/g.plotWidth);},{signal,passive:false});
 svg.addEventListener('dblclick',e=>{if(point(e).x>g.width-g.right){priceScale=1;draw();}},{signal});
 root.addEventListener('keydown',e=>{
  if(e.key==='Escape'){if(draft){draft=null;tool='select';tell('');renderMenu();draw();e.preventDefault();}else if(menu){menu=null;renderMenu();e.preventDefault();}else if(dialog){e.preventDefault();closeFullscreen();}return;}
  if(e.target.matches('input,select,textarea'))return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){if(undo.length){e.preventDefault();drawings=undo.pop();selectedDrawing=null;completeDrawing();}}
  else if(e.key==='Delete'&&selectedDrawing){e.preventDefault();remember();drawings=drawings.filter(d=>d.id!==selectedDrawing);selectedDrawing=null;completeDrawing();}
  else if(e.target===svg&&['ArrowLeft','ArrowRight','Home','End','+','-','='].includes(e.key)){e.preventDefault();if(['+','=','-'].includes(e.key))changeView(e.key==='-'?1.25:.8);else inspect(e.key==='Home'?0:e.key==='End'?visible.length-1:(selected??visible.length-1)+(e.key==='ArrowLeft'?-1:1));}
 },{signal});
 async function getJSON(url){const response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(25000)])});if(!response.ok)throw new Error('데이터 조회에 실패했습니다.');return response.json();}
 async function searchComparison(query,version){
  const target=$('.sc-compare-results');if(!target)return;const q=query.trim();if(!q){target.textContent='종목명 또는 지수명을 입력하세요.';return;}target.textContent='검색 중…';
  try{const [stocks,indices]=await Promise.allSettled([getJSON('/api/search?'+new URLSearchParams({q})),indexCatalog?Promise.resolve(indexCatalog):getJSON('/api/indices?market=US')]);
   if(disposed||version!==searchVersion||menu!=='compare')return;if(indices.status==='fulfilled')indexCatalog=indices.value;
   const matches=value=>String(value||'').toLowerCase().replace(/[\s&]/g,'').includes(q.toLowerCase().replace(/[\s&]/g,''));
   const cash=(indexCatalog?.items||[]).filter(i=>Number.isFinite(i.value??i.price)&&[i.name,i.id,i.id==='SPX'?'S&P 500 SP500':i.id==='COMP'?'나스닥 NASDAQ':i.id==='DJI'?'다우 DOW':''].some(matches)).map(i=>({...i,kind:'index',market:'US',ticker:i.id}));
   searchResults=[...cash,...(stocks.status==='fulfilled'?stocks.value.items||[]:[]).map(s=>({...s,kind:'stock'}))].filter(s=>!(s.kind==='stock'&&s.market===stock.market&&s.ticker===stock.ticker));
   $('.sc-compare-results').innerHTML=searchResults.length?searchResults.slice(0,12).map((s,i)=>`<button data-compare-index="${i}"><strong>${esc(s.name)}</strong><span>${esc(s.ticker)} · ${s.kind==='index'?'현물 지수':s.market==='KR'?'국내':'미국'}</span></button>`).join(''):stocks.status==='rejected'?'검색 데이터를 불러오지 못했습니다.':'검색 결과가 없습니다.';
  }catch{if(!disposed&&version===searchVersion&&menu==='compare')$('.sc-compare-results').textContent='검색 데이터를 불러오지 못했습니다.';}
 }
 async function addComparison(item){
  if(!item||comparisonBusy)return;if(comparisons.length>=3){tell('비교 대상은 최대 3개입니다.');return;}const compKey=item.kind+':'+item.market+':'+item.ticker;if(comparisons.some(c=>c.key===compKey)){tell('이미 추가한 비교 대상입니다.');return;}
  comparisonBusy=true;tell('비교 일봉을 불러오는 중…');
  try{const payload=await getJSON(item.kind==='index'?'/api/market-chart?'+new URLSearchParams({market:'US',kind:'indices',id:item.id}):'/api/stock?'+new URLSearchParams({market:item.market,id:item.id||item.ticker}));
   if(disposed)return;const history=item.kind==='index'?dailyComparisonPoints(payload):normalizeBars(payload.items?.[0]?.history||[]);
   if(payload.status!=='ready'||!payload.policy?.chart||!history.length)throw new Error('이 대상은 이용 가능한 일봉 가격 이력이 없습니다.');
   comparisons.push({key:compKey,label:item.ticker,color:palette[(comparisons.length+1)%palette.length],bars:history});tell('');renderMenu();draw();
  }catch(error){if(!disposed)tell(error.name==='TimeoutError'?'가격 이력 조회 시간이 초과되었습니다.':error.message||'비교 이력을 불러오지 못했습니다.');}finally{comparisonBusy=false;}
 }
 rebuild();let observedWidth=root.clientWidth;
 const observer=new ResizeObserver(()=>{if(root.clientWidth===observedWidth)return;observedWidth=root.clientWidth;cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{if(!disposed&&bars.length)draw();});});observer.observe(root);
 return {focusDate(date){if(!daily.some(b=>b.date===date))return false;settings.interval='day';rebuild(false);const index=bars.findIndex(b=>b.date===date);if(index<0)return false;window=chartWindow(bars.length,Math.max(0,index-20),Math.min(50,bars.length));draw();inspect(index-window.start);return true;},updateQuote(next,feed){quote=next.price;quoteTime=next.asOf;quoteMode=feed.mode||next.mode;quoteChange=next.changePct;quoteBasis=next.changeBasis;draw();},destroy(){disposed=true;abort.abort();observer.disconnect();clearTimeout(searchTimer);cancelAnimationFrame(resizeFrame);if(dialog){const old=dialog;dialog=null;placeholder?.replaceWith(root);old.close();old.remove();}root.classList.remove('analysis-chart','sc-fullscreen');}};
}
