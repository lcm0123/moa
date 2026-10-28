import {mountHomeLayout} from './home-layout.js';
import {mountHomeRanking} from './home-ranking.js';
import {mountBusinessDirectory} from './business-directory.js';
import {mountCompareSelection} from './compare-selection.js';
import {mountCompanyCompare} from './company-compare.js';
import {uiState} from './ui-copy.js';
import {mountFilingNotifications} from './filing-notifications.js';
import {mountScreener} from './screener.js';
import {mountMacro} from './macro-explorer.js';
import {mountMonthlyFlow} from './monthly-flow.js';
import {mountCrypto} from './crypto-binance-page.js';
import {mountStockPreview} from './stock-preview.js';
import {mountSectorRanking} from './sector-ranking.js';
import {mountStockResearch} from './stock-research.js';

import {openMarketChart} from './market-chart.js';
import {stockQuoteMarkup} from './stock-quote.js';
import {readWatchlist,toggleWatchlist} from './watchlist.js';
import {mountWatchlist} from './watchlist-view.js';
import {watchButton,syncWatchButtons} from './watch-button.js';
import {mountReports} from './reports.js';
import {mountStockChart} from './stock-chart.js';
import {icon,escapeHtml as esc,sparkline} from './components.js';
import {percentage,price,time,modeLabels,dailyQuoteMeta} from './data.js';
import {indicatorDefinitions,indicatorMeta,indexEmptyMarkup,indexHistoryMarkup,macroValue,macroChange,macroMeta} from './market-indicators.js';
import {requestChannel,reconcile,setText,setHTML} from './market-client.js';
import {mountSectorMap} from './sector-map.js';
import {mountCalendar} from './calendar.js';
import {readPreferences,savePreferences} from './market-preferences.js';
const $=s=>document.querySelector(s),state={market:'KR',rankMarket:'KR',rankKind:'turnover',sectorMarket:'KR',indices:null,futures:null,macro:null,ranking:null,sectors:null,activeSector:null};
let businessDirectoryView,companyCompareView,compareSelection,screenerView,macroView,cryptoView,preview,sectorRanking,ranking;
let researchView,watchlist,calendar,searchTimer,searchOptions=[],searchIndex=-1,restoreFocus,detailVersion=0,stockChart,reportsView,quoteTimer;
const num=n=>Number.isFinite(n)?n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
const polarity=n=>n>0?'up':n<0?'negative':'neutral-text';
function tabs(group,values,active){return '<div class="segmented" role="tablist" aria-label="'+({'market':'시장 지표','sector-market':'섹터맵 시장','rank-market':'종목 시장'}[group])+'">'+values.map(([v,n])=>'<button role="tab" aria-selected="'+(v===active)+'" tabindex="'+(v===active?0:-1)+'" class="'+(v===active?'active':'')+'" data-action="'+group+'" data-value="'+v+'">'+n+'</button>').join('')+'</div>';}
function stateBox(kind='disconnected',message='',retry=''){
 const [title,desc,i]=uiState(kind);
 return '<div class="data-state '+kind+'" role="'+(kind==='error'?'alert':'status')+'"><div class="state-icon">'+icon(i)+'</div><strong>'+title+'</strong><p>'+esc(message||desc)+'</p>'+(kind==='loading'?'<div class="loading-bars"><i></i><i></i><i></i></div>':retry?'<button class="secondary-button" data-action="'+retry+'">'+icon('refresh')+' 다시 시도</button>':'')+'</div>';
}
function meta(d){if(d?.baseDate)return (d.source?d.source+' · ':'')+dailyQuoteMeta(d);return !d?'연결 확인 중':!d.asOf?'갱신 이력 없음':(d.source?d.source+' · ':'')+(modeLabels[d.mode]||'집계')+(d.mode==='delayed'&&d.delayMinutes?' '+d.delayMinutes+'분':'')+' · '+(d.asOfKind==='received'?'조회 ':'')+time(d.asOf,true)+(d.session==='closed'?' · 장 마감':'');}
function shell(){
 document.title='MOA · 국내와 미국 시장';
 $('#header').innerHTML='<a class="brand" href="/" data-nav><span class="brand-mark"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 24V11l10 8L26 5v19"/></svg></span><span>MOA</span></a><nav class="desktop-nav" aria-label="주 메뉴"><a href="/" data-nav class="nav-link active">홈</a><button class="nav-link" data-action="go-market">시장</button><button class="nav-link" data-action="go-sector">섹터</button><a href="/screener" data-nav class="nav-link" data-action="screener">스크리너</a><a href="/business" data-nav class="nav-link" data-action="business">기업 탐색</a><button class="nav-link" data-action="calendar">경제 일정</button><button class="nav-link" data-action="reports">리포트</button><a href="/crypto" data-nav class="nav-link" data-action="crypto">가상화폐</a><a href="/macro" data-nav class="nav-link" data-action="macro">매크로</a></nav><div class="header-end"><div class="search-box">'+icon('search')+'<input id="global-search" placeholder="종목·사업 키워드 검색" type="search" aria-label="국내·미국 종목 검색" role="combobox" aria-expanded="false" aria-controls="search-results" aria-autocomplete="list" autocomplete="off"><kbd>/</kbd><div id="search-results" class="search-results" role="listbox" hidden></div></div><button class="connection-button" data-action="data-info" aria-label="데이터 연결 안내">'+icon('globe')+'<span>데이터 연결</span></button></div>';
 $('#rail').innerHTML=[['home','홈','home'],['chart','시장','go-market'],['grid','섹터','go-sector'],['search','스크리너','screener'],['grid','기업 탐색','business'],['calendar','경제 일정','calendar'],['report','리포트','reports'],['globe','가상화폐','crypto'],['search','매크로','macro']].map(([i,n,a])=>'<button class="rail-link '+(a==='home'?'active':'')+'" data-action="'+a+'" aria-label="'+n+'">'+icon(i)+'<span>'+n+'</span></button>').join('')+'<button class="rail-link rail-bottom" data-action="data-info" aria-label="데이터 안내">'+icon('info')+'<span>안내</span></button>';
 mountHomeLayout($('#main'),{state,tabs});
 $('#watch-panel').remove();$('#detail').remove();
 document.body.insertAdjacentHTML('beforeend','<nav class="mobile-nav" aria-label="모바일 메뉴 · 좌우로 스크롤">'+[['home','홈','home'],['chart','시장','go-market'],['grid','섹터','go-sector'],['search','스크리너','screener'],['grid','기업 탐색','business'],['calendar','경제 일정','calendar'],['report','리포트','reports'],['globe','가상화폐','crypto'],['search','매크로','macro']].map(([i,n,a])=>'<button data-action="'+a+'" class="'+(a==='home'?'active':'')+'">'+icon(i)+'<span>'+n+'</span></button>').join('')+'</nav>');
}
function renderIndexCards(){
 const {cash,futures,macro}=indicatorDefinitions(state.market,state.indices),grid=$('#index-grid'),us=state.market==='US';
 grid.classList.toggle('us-indices',us);grid.classList.toggle('kr-indices',!us);grid.classList.toggle('has-cash',us&&cash.length>0);
 grid.style.setProperty('--indicator-count',String(us?Math.max(1,cash.length)+futures.length:cash.length+macro.length));
 grid.tabIndex=0;grid.setAttribute('aria-label','시장 지표 · 화면이 좁으면 좌우로 스크롤');
 if(grid.dataset.market!==state.market){grid.dataset.market=state.market;grid.replaceChildren();if(us)setHTML(grid,'<section class="instrument-group cash-group" aria-labelledby="cash-group-title"><div class="instrument-group-heading"><h3 id="cash-group-title">현물 지수</h3></div><div class="cash-index-cards"></div><div class="cash-index-empty" role="status"></div></section><section class="instrument-group futures-group" aria-labelledby="futures-group-title"><div class="instrument-group-heading"><h3 id="futures-group-title">지수 선물</h3><span class="futures-mode"></span></div><div class="futures-index-cards"></div><p class="futures-basis"></p></section>');}
 setText($('#market .title-group h2'),us?'미국 시장 지표':'시장 지표');
 if(us){const empty=grid.querySelector('.cash-index-empty');empty.hidden=cash.length>0;setHTML(empty,indexEmptyMarkup(state.indices));setText(grid.querySelector('.futures-mode'),state.futures?.references?.length?'지연 시세 · 참고시세':state.futures?.mode==='delayed'?'지연 시세':'선물');}
 if(us)setText(grid.querySelector('.futures-basis'),state.futures?.changeBasis==='provider_daily'?'Finviz 제공 일간 등락액·등락률 · 포인트 기준':state.futures?.references?.length?'Finviz 일간 등락률 · Performance 조회값':'일간 등락: 공급처 전일 종가 또는 정산가 기준 · 연결 후 확인');
 const renderCards=(parent,definitions)=>reconcile(parent,definitions,x=>state.market+':'+x.id,def=>{const el=document.createElement('article');el.className='indicator-card';el.innerHTML='<div class="indicator-name"><h3></h3><span></span></div><div class="indicator-contract"></div><div class="indicator-value"></div><div class="indicator-change"></div><div class="indicator-previous" hidden></div>'+(def.type!=='futures'?'<div class="indicator-chart"></div>':'')+'<div class="indicator-meta"></div>'+(def.type!=='futures'?'<button class="indicator-chart-open" data-action="market-chart"><span>확대</span></button>':'');return el;},(el,def)=>{
  const data=state[def.type],item=data?.items?.find(s=>s.id===def.id)||data?.references?.find(s=>s.id===def.id),reference=item?.instrumentType==='futures_reference';
  el.classList.toggle('futures-text-card',def.type==='futures');
  setText(el.querySelector('h3'),def.name);setText(el.querySelector('.indicator-name span'),def.type==='futures'?(reference?'선물 참고':'선물'):'지수');
  setText(el.querySelector('.indicator-contract'),def.type==='futures'?(reference?item.symbol+' · 계약명·계약월 미제공':item?item.contractName+' · '+item.contractMonth:'계약명·계약월 연결 필요'):data?.source==='FMP'&&item?(item.closeLabel||item.valueLabel||'시세 지연 여부 미확인')+(item.closeDate?' · '+item.closeDate+' (미국)':''):'');
  setText(el.querySelector('.indicator-value'),item?num(item.value):'—');
  const ch=el.querySelector('.indicator-change');ch.className='indicator-change '+(item&&Number.isFinite(item.changePct)?polarity(item.changePct):'muted');setText(ch,item?(Number.isFinite(item.change)?(item.change>=0?'+':'−')+num(Math.abs(item.change))+(Number.isFinite(item.changePct)?' ('+percentage(item.changePct)+')':''):(Number.isFinite(item.changePct)?percentage(item.changePct)+' · 당일 변동':'등락 정보 미제공')):data?.status==='error'?'데이터 오류':data?.status==='restricted'?'이용 권한 확인 필요':'데이터 연결 필요');
  if(def.type==='futures'&&item){setText(ch,Number.isFinite(item.change)?(item.change>=0?'+':'−')+num(Math.abs(item.change))+' pt'+(Number.isFinite(item.changePct)?' ('+percentage(item.changePct)+')':''):Number.isFinite(item.changePct)?percentage(item.changePct):'등락 데이터 없음');ch.title=data?.changeNote||(Number.isFinite(item.change)?'공급사 제공 일간 등락액·등락률':'공급사 일간 등락률 · 등락액을 확인할 수 없는 응답');}
  const previous=el.querySelector('.indicator-previous');previous.hidden=!(data?.source==='FMP'&&Number.isFinite(item?.previousClose));setText(previous,previous.hidden?'':'전 거래일 종가 '+num(item.previousClose));
  const chart=el.querySelector('.indicator-chart'),history=data?.policy?.chart&&Array.isArray(item?.history)?item.history.filter(x=>Number.isFinite(x.value)).slice(-90):[],daily=item?.historyKind==='daily'||data?.source==='FMP',sig=JSON.stringify([Boolean(item),item?.changePct,history]);
  if(chart){chart.classList.toggle('index-daily-chart',daily&&history.length>1);if(chart.dataset.signature!==sig){chart.dataset.signature=sig;setHTML(chart,daily?indexHistoryMarkup({...item,history}):history.length>1?sparkline(0,item.changePct<0,false,history.map(x=>x.value)):'<div class="chart-unavailable"><span></span>'+(item?'추이 데이터 없음':'차트 데이터 연결 필요')+'</div>');}
  }
  setText(el.querySelector('.indicator-meta'),indicatorMeta(item,data));el.title=[def.name,el.querySelector('.indicator-contract').textContent,el.querySelector('.indicator-previous').textContent,ch.title].filter(Boolean).join(' · ');
  el.classList.toggle('macro-card',def.type==='macro');
  if(def.type==='macro'){
   setText(el.querySelector('.indicator-name span'),def.id==='USDKRW'?'환율':'금리');
   setText(el.querySelector('.indicator-contract'),item?.basis||(def.id==='USDKRW'?'매매기준율 · 1 USD당 KRW':'국고채 10년 · 연 수익률'));
   setText(el.querySelector('.indicator-value'),macroValue(item));ch.className='indicator-change neutral-text';
   setText(ch,item?macroChange(item):data?.status==='error'?'자료 조회 실패':'데이터 연결 필요');
   ch.title=item?.provider==='twelve_data_fx'?item.basis:item?.previousDate?'직전 공표일 '+item.previousDate+' 대비'+(def.id==='KTB10Y'?' · (이번 금리 − 직전 금리) × 100bp':''):'';
   setText(el.querySelector('.indicator-meta'),macroMeta(item,data));
   el.querySelector('.indicator-meta').title=item?.syncedAt?'마지막 동기화 '+time(item.syncedAt,true):'';
  }
  const open=el.querySelector('.indicator-chart-open');if(open){open.dataset.id=def.id;open.dataset.kind=def.type;open.dataset.name=def.name;open.setAttribute('aria-label',def.name+' 차트 확대');}
 });
 if(us){renderCards(grid.querySelector('.cash-index-cards'),cash);renderCards(grid.querySelector('.futures-index-cards'),futures);}else renderCards(grid,[...cash,...macro]);
 setHTML($('#feed-status'),(us?[['indices','지수'],['futures','선물']]:[['indices','지수'],['macro','환율·금리']]).map(([key,label])=>'<span>'+label+' <b class="'+((state[key]?.status==='ready'||state[key]?.referenceStatus==='ready')&&!state[key]?.stale?'connected':'')+'">'+(state[key]?.stale?'갱신 오류':state[key]?.status==='ready'?'연결됨':state[key]?.referenceStatus==='ready'?'참고시세 연결':state[key]?.status==='error'?'연결 오류':state[key]?.status==='restricted'?'권한 확인':state[key]?.source==='Twelve Data'&&state[key]?.configured?'미확인':'연결 필요')+'</b></span>').join(''));setText($('#market-note'),!us?(state.macro?.items?.some(i=>i.provider==='twelve_data_fx')?'환율: Twelve Data 외환 시세 · 5분 갱신 / 금리: ECOS 일별 · 1bp = 0.01%p':'환율·금리: ECOS 일별 자료 · 직전 공표일 대비 · 1bp = 0.01%p'):state.indices?.source==='FMP'||state.indices?.source==='Twelve Data'&&state.indices?.status!=='ready'?state.indices.message:state.futures?.references?.length?'Finviz 선물 참고시세 · 계약명·계약월 미제공'+(state.indices?.status==='ready'?'':' · 현물지수는 별도 데이터 연결 필요'):state.indices?.message||'연결되지 않은 지표는 값을 표시하지 않습니다.');updateConnection();
}
function updateConnection(){const count=[state.indices,state.market==='US'?state.futures:state.macro,...(state.ranking?.groups||[]),state.sectors].filter(d=>(d?.status==='ready'||d?.referenceStatus==='ready')&&!d.stale).length;const node=$('.connection-label');node.classList.toggle('has-data',count>0);setHTML(node,'<i></i> '+(count?'일부 데이터 연결됨':'데이터 연결 전'));}
function loadIndicators(clear=false){if(clear){state.indices=null;state.futures=null;state.macro=null;}renderIndexCards();for(const type of (state.market==='US'?['indices','futures']:['indices','macro']))requestChannel(type,type==='macro'?'/api/domestic-macro':'/api/'+type+'?market='+state.market,null,data=>{if(data.status==='error'&&(state[type]?.status==='ready'||state[type]?.referenceStatus==='ready'))state[type]={...state[type],stale:true};else state[type]=data;renderIndexCards();});}
function loadRanking(clear=false){ranking?.load(clear);}
let sectorMap,monthlyFlow;
function loadSectors(clear=false){sectorMap.refresh(clear);}
function showDialog(title,content,wide=false){const d=$('#content-dialog');restoreFocus=document.activeElement;d.classList.toggle('wide-dialog',wide);d.innerHTML='<div class="dialog-heading"><div><div class="eyebrow">MOA</div><h2 id="content-title">'+esc(title)+'</h2></div><button class="icon-button" data-action="close-dialog" aria-label="닫기">'+icon('close')+'</button></div><div class="dialog-body">'+content+'</div>';if(!d.open)d.showModal();document.body.classList.add('modal-open');}
function closeDialog(){state.activeSector=null;$('#content-dialog').close();document.body.classList.remove('modal-open');if(restoreFocus?.isConnected)restoreFocus.focus();}
function dataInfo(){showDialog('데이터 연결 및 이용 안내','<div class="info-intro">'+icon('globe')+'<div><h3>허용된 데이터만 표시합니다.</h3><p>데이터 공급사와 섹터 매핑의 연결 상태에 따라 정보를 제공합니다. 임의 시세나 추정 분류는 사용하지 않습니다.</p></div></div><div class="provider-status-list">'+[['미국 주식','Finviz 시세 · 거래량 · 일봉 차트'],['미국 섹터맵','S&P 500 · 나스닥100 · 다우30 실제 구성종목'],['미국 선물','Finviz 참고시세 · 계약명·계약월 미제공'],['국내 주식·ETF·ETN·ELW·지수','금융위원회 공공데이터 · 전일 기준 · 실제 기준일 표시']].map(([a,b])=>'<div><strong>'+a+'</strong><span>'+b+'</span></div>').join('')+'</div><p class="dialog-hint">공개 표시 · 차트 생성 · 순위 계산 · 섹터맵 생성 권한은 공급 모듈별로 관리합니다. 키는 서버에서만 사용합니다.</p><p class="dialog-hint">현재 Finviz 응답에 거래대금이 없는 종목은 현재가 × 거래량을 추정 거래대금으로 표시합니다. 실제 체결대금 합계와 다를 수 있습니다. 조회 시각은 거래소 시세 기준시각이 아닙니다. 선물 참고시세를 현물지수로 대체하지 않습니다.</p>');}
function hideSearch(){$('#search-results').hidden=true;$('#global-search').setAttribute('aria-expanded','false');$('#global-search').removeAttribute('aria-activedescendant');searchIndex=-1;}
function search(){const q=$('#global-search').value.trim();searchIndex=-1;$('#global-search').removeAttribute('aria-activedescendant');if(!q){hideSearch();return;}const results=$('#search-results');results.hidden=false;$('#global-search').setAttribute('aria-expanded','true');requestChannel('search','/api/search?q='+encodeURIComponent(q),()=>{setHTML(results,'<div class="search-empty">검색 중…</div>');searchOptions=[];},data=>{searchOptions=data.items||[];setHTML(results,'<div class="search-heading">종목 검색 <span>국내 · 미국</span></div>'+(searchOptions.length?searchOptions.map((s,i)=>'<div class="search-result-row"><button id="search-option-'+i+'" class="search-result" role="option" aria-selected="false" data-action="search-select" data-index="'+i+'"><span class="stock-avatar">'+esc(s.ticker.slice(0,2))+'</span><span><strong>'+esc(s.name)+'</strong><small>'+esc(s.ticker)+' · '+(s.market==='KR'?'국내':'미국')+(s.baseDate?' · 전일 기준 '+esc(s.baseDate)+(s.type&&s.type!=='stock'?' · '+esc(s.type):''):'')+'</small>'+(s.businessSummary?'<small class="search-business">'+esc(s.businessSummary.slice(0,90))+'</small>':'')+'</span><span class="search-price">'+price(s)+'</span></button>'+watchButton(s,'search-watch-button')+'</div>').join(''):'<div class="search-empty">'+(data.status==='disconnected'?'데이터 연결 필요':data.status==='error'?'연결 오류 · 검색어를 다시 입력해 주세요':'검색 결과가 없습니다.')+'</div>')+'<div class="search-hint">↑ ↓ 이동 · Enter 선택 · Esc 닫기</div>');});}
// Watchlist edits update personal state; document collection is not a UI side effect.
addEventListener('moa-watchlist',()=>syncWatchButtons());addEventListener('storage',()=>syncWatchButtons());
function selectSearch(index){const s=searchOptions[Number(index)];if(!s)return;hideSearch();navigate('/stock/'+s.market+'/'+encodeURIComponent(s.id));}
function toast(message){setText($('#toast'),message);$('#toast').classList.add('visible');setTimeout(()=>$('#toast').classList.remove('visible'),3000);}
let routeGeneration=0;
function saveRoutePosition(){history.replaceState({...history.state,moaScroll:window.scrollY},'');}
function navigate(path){const from=location.pathname+location.search;if(from!==path){saveRoutePosition();history.pushState({moaFrom:from},'',path);}route();}
function returnToWork(){if(history.state?.moaFrom){history.back();}else navigate('/');}
function mountDetailChart(stock,feed){
 const root=$('#stock-chart');
 try{return mountStockChart(root,stock,feed);}
 catch{setHTML(root,'<div class="data-state error" role="alert"><strong>차트를 표시하지 못했습니다</strong><p>차트 화면을 준비하는 중 문제가 발생했습니다. 위 시세는 그대로 확인할 수 있습니다.</p><button class="secondary-button" data-action="retry-detail">다시 시도</button></div>');return null;}
}
async function route(){const generation=++routeGeneration,scroll=history.state?.moaScroll;await renderRoute();if(generation===routeGeneration&&Number.isFinite(scroll))requestAnimationFrame(()=>window.scrollTo({top:scroll,behavior:'instant'}));}
async function renderRoute(){
 companyCompareView?.destroy();companyCompareView=null;
 businessDirectoryView?.destroy();businessDirectoryView=null;
 // Retired research URLs drop saved chat/thesis parameters before rendering home.
 if(/^\/catalyst(?:\/|$)/.test(location.pathname))history.replaceState(null,'','/');
 if(/^\/managers(?:\/|$)/.test(location.pathname))history.replaceState(null,'','/');
 screenerView?.destroy();screenerView=null;const isScreener=location.pathname==='/screener';$('#screener-page').hidden=!isScreener;
 macroView?.destroy();macroView=null;const isMacro=location.pathname==='/macro';$('#macro-page').hidden=!isMacro;
 cryptoView?.destroy();cryptoView=null;const isCrypto=/^\/crypto(?:\/[^/]+)?$/.test(location.pathname);$('#crypto-page').hidden=!isCrypto;
 watchlist?.setVisible(location.pathname==='/');researchView?.destroy();researchView=null;
 clearTimeout(quoteTimer);
 stockChart?.destroy();stockChart=null;reportsView?.destroy();reportsView=null;
 const isReports=location.pathname==='/reports';$('#reports-page').hidden=!isReports;
 const isCalendar=location.pathname==='/calendar';$('#calendar-page').hidden=!isCalendar;calendar?.hidePopover();
 const isBusiness=['/business','/compare'].includes(location.pathname);
 document.querySelectorAll('.desktop-nav .nav-link,.rail-link,.mobile-nav button').forEach(el=>{const active=isBusiness?el.dataset.action==='business':isScreener?el.dataset.action==='screener':isMacro?el.dataset.action==='macro':isCrypto?el.dataset.action==='crypto':isReports?el.dataset.action==='reports':isCalendar?el.dataset.action==='calendar':(el.dataset.action==='home'||el.matches('a[href="/"]'));el.classList.toggle('active',active);if(active)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
 if(location.pathname==='/business'){ $('#dashboard').hidden=true;$('#stock-page').hidden=false;calendar?.leavePage();++detailVersion;document.title='기업 사업정보 · MOA';businessDirectoryView=mountBusinessDirectory($('#stock-page'),{navigate});return;}
 if(location.pathname==='/compare'){ $('#dashboard').hidden=true;$('#stock-page').hidden=false;calendar?.leavePage();++detailVersion;document.title='기업 비교 · MOA';companyCompareView=mountCompanyCompare($('#stock-page'),{navigate});return;}
 if(isScreener){$('#dashboard').hidden=true;$('#stock-page').hidden=true;calendar?.leavePage();++detailVersion;document.title='미국 종목 스크리너 · MOA';screenerView=mountScreener($('#screener-page'));window.scrollTo(0,0);return;}
 if(isMacro){$('#dashboard').hidden=true;$('#stock-page').hidden=true;calendar?.leavePage();++detailVersion;document.title='매크로 분석 · MOA';macroView=mountMacro($('#macro-page'));window.scrollTo(0,0);return;}
 if(isCrypto){$('#dashboard').hidden=true;$('#stock-page').hidden=true;calendar?.leavePage();++detailVersion;document.title='가상화폐 · MOA';cryptoView=mountCrypto($('#crypto-page'),{navigate});window.scrollTo(0,0);return;}
 if(isReports){$('#dashboard').hidden=true;$('#stock-page').hidden=true;calendar?.leavePage();++detailVersion;document.title='리포트 · MOA';reportsView=mountReports($('#reports-page'));window.scrollTo(0,0);return;}
 if(isCalendar){$('#dashboard').hidden=true;$('#stock-page').hidden=true;++detailVersion;await calendar.openPage(new URLSearchParams(location.search).get('date'),Object.fromEntries(new URLSearchParams(location.search)));return;}
 calendar?.leavePage();
 const match=location.pathname.match(/^\/stock\/(KR|US)\/([^/]+)$/);$('#dashboard').hidden=!!match;$('#stock-page').hidden=!match;detailVersion++;
 if(!match){document.title='MOA · 국내와 미국 시장';window.scrollTo({top:0,behavior:'instant'});const q=new URLSearchParams(location.search);if(q.get('sector'))sectorMap?.openNamed(q.get('market'),q.get('sector'));return;}
 const version=detailVersion,market=match[1],id=decodeURIComponent(match[2]);document.title=id+' · MOA';$('#stock-page').innerHTML='<button class="back-button" data-action="return-work">'+icon('arrow')+' 이전 작업으로 돌아가기</button><div class="surface stock-detail-content">'+stateBox('loading','종목 정보를 확인하고 있어요')+'</div><section id="stock-research"></section>';
 let verifiedProfile=null,chartEvents=[];const missingQuoteHeader=()=>'<h1>'+esc(verifiedProfile?.name||id)+'</h1><p class="research-note">'+esc([id,verifiedProfile?.exchange].filter(Boolean).join(' · '))+'</p>';researchView=mountStockResearch($('#stock-research'),{market,ticker:id,navigate,onEvents:events=>{if(version!==detailVersion)return;chartEvents=events;stockChart?.updateEvents?.(events);},onIdentity:profile=>{if(version!==detailVersion)return;verifiedProfile=profile;stockChart?.updateIdentity?.(profile);const placeholder=$('.unquoted-identity');if(placeholder){setHTML(placeholder,missingQuoteHeader());document.title=profile.name+' · MOA';}},onChartDate:date=>{if(stockChart?.focusDate(date))$('#stock-chart').scrollIntoView({behavior:'smooth',block:'start'});else toast('해당 날짜의 차트 데이터가 없습니다.');}});
 await requestChannel('detail','/api/stock?market='+market+'&id='+encodeURIComponent(id),null,data=>{if(version!==detailVersion)return;const s=data.items?.[0];if(!s){setHTML($('.stock-detail-content'),'<div class="unquoted-identity">'+missingQuoteHeader()+'</div>'+stateBox(data.status==='ready'?'empty':data.status,'종목 시세 데이터 연결이 필요합니다.','retry-detail')+'<section class="stock-chart" id="stock-chart" aria-labelledby="stock-chart-title"></section>');stockChart=mountDetailChart({...verifiedProfile,market,ticker:id},data);return;}document.title=s.name+' · MOA';
 setHTML($('.stock-detail-content'),'<div class="detail-identity"><span class="stock-avatar">'+esc(s.ticker.slice(0,2))+'</span><div><h1>'+esc(s.name)+'</h1><p>'+esc(s.ticker)+' · '+esc(s.exchange||market)+'</p>'+watchButton(s,'detail-watch-button',true)+'<button class="secondary-button detail-compare" data-action="compare-stock" data-market="'+esc(market)+'" data-ticker="'+esc(s.ticker)+'" data-name="'+esc(s.name)+'">비교에 추가</button>'+'</div><span class="detail-feed">'+esc(data.source||'공급사')+' · '+esc(modeLabels[data.mode]||'제공 시세')+'</span></div><div class="stock-quote-summary">'+stockQuoteMarkup(s,data)+'</div><p class="research-note">'+esc([s.sector,s.industry].filter(Boolean).join(' · '))+'</p><section class="stock-chart" id="stock-chart" aria-labelledby="stock-chart-title"></section>');
 stockChart=mountDetailChart({...s,...verifiedProfile,market,ticker:s.ticker},data);stockChart?.updateEvents?.(chartEvents);researchView?.setQuote(s,data);const chartDate=new URLSearchParams(location.search).get('chartDate');if(chartDate)stockChart?.focusDate(chartDate);
 if(market==='US')quoteTimer=setTimeout(()=>refreshDetailQuote(version,market,id),60000);
 });if(version!==detailVersion)return;window.scrollTo(0,0);$('#stock-page h1')?.setAttribute('tabindex','-1');$('#stock-page h1')?.focus({preventScroll:true});
}
async function refreshDetailQuote(version,market,id){
 if(version!==detailVersion)return;
 if(!document.hidden){
  try{const response=await fetch('/api/stock?'+new URLSearchParams({market,id,quotesOnly:'1'}),{signal:AbortSignal.timeout(20000)}),data=await response.json();if(version!==detailVersion)return;if(!response.ok||data.status!=='ready'||!data.items?.[0])throw new Error('quote unavailable');setHTML($('.stock-quote-summary'),stockQuoteMarkup(data.items[0],data));stockChart?.updateQuote?.(data.items[0],data);}
  catch{if(version!==detailVersion)return;const note=$('.quote-refresh-error');if(note){note.hidden=false;note.textContent='시세 갱신 실패 · 마지막 조회값';}}
 }
 quoteTimer=setTimeout(()=>refreshDetailQuote(version,market,id),60000);
}
function activate(button){button.closest('[role="tablist"]').querySelectorAll('[role="tab"]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-selected',String(b===button));b.tabIndex=b===button?0:-1;});}
const actions={screener:()=>navigate('/screener'),macro:()=>navigate('/macro'),crypto:()=>navigate('/crypto'),'market-chart':b=>{const feed=state[b.dataset.kind],item=[...(feed?.items||[]),...(feed?.references||[])].find(i=>i.id===b.dataset.id);openMarketChart({market:state.market,kind:b.dataset.kind,id:b.dataset.id,name:b.dataset.name,item,feed});},'watch-stock':b=>{try{if(b.dataset.available!=='true'&&!readWatchlist().includes(b.dataset.market+':'+b.dataset.ticker))return;toggleWatchlist(b.dataset.market,b.dataset.ticker);}catch(error){toast(error.message||'관심종목을 저장하지 못했습니다.');}},home:()=>navigate('/'),'go-market':()=>{navigate('/');$('#market').scrollIntoView({behavior:'smooth'});},'go-sector':()=>{navigate('/');$('#sectors').scrollIntoView({behavior:'smooth'});},market:b=>{activate(b);state.market=b.dataset.value;savePreferences(state);loadIndicators(true);},'rank-market':b=>{monthlyFlow?.deactivate();activate(b);state.rankMarket=b.dataset.value;savePreferences(state);loadRanking(true);},'rank-kind':b=>{monthlyFlow?.deactivate();if(!['turnover','volume'].includes(b.dataset.value))return;activate(b);state.rankKind=b.dataset.value;savePreferences(state);loadRanking(true);},'sector-market':b=>{activate(b);state.sectorMarket=b.dataset.value;loadSectors(true);},'refresh-all':()=>{loadIndicators();loadRanking();loadSectors();calendar.refresh();watchlist?.refresh();},'refresh-ranking':()=>loadRanking(),'refresh-sectors':()=>loadSectors(),'data-info':dataInfo,'close-dialog':closeDialog,'search-select':b=>selectSearch(b.dataset.index),'retry-detail':route,calendar:()=>navigate('/calendar?date='+calendar.today()),reports:()=>navigate('/reports')};
document.addEventListener('kr-chart-open-report',e=>researchView?.openReport?.(e.detail.reportId));
document.addEventListener('click',e=>{const star=e.target.closest('[data-action="watch-stock"]');if(!star)return;e.preventDefault();e.stopPropagation();if(!star.disabled)actions['watch-stock'](star);},true);
actions['return-work']=returnToWork;
actions['business']=()=>navigate('/business');
actions['compare-stock']=b=>compareSelection?.add({market:b.dataset.market,ticker:b.dataset.ticker,name:b.dataset.name});
document.addEventListener('click',e=>{const a=e.target.closest('a[data-nav]');if(a&&a.target!=='_blank'&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&e.button===0){e.preventDefault();hideSearch();navigate(new URL(a.href).pathname+new URL(a.href).search);return;}const b=e.target.closest('[data-action]');if(b)actions[b.dataset.action]?.(b);if(!e.target.closest('.search-box'))hideSearch();});
document.addEventListener('input',e=>{if(e.target.id==='global-search'){clearTimeout(searchTimer);searchTimer=setTimeout(search,220);}});
document.addEventListener('keydown',e=>{if(e.defaultPrevented||e.isComposing||e.keyCode===229)return;if(e.key==='/'&&!e.target.closest('input,select,textarea,[contenteditable],[role="textbox"]')&&!document.querySelector('dialog[open]')){e.preventDefault();$('#global-search').focus();}
 if(e.target.id==='global-search'){const options=[...$('#search-results').querySelectorAll('[role="option"]')];if(e.key==='Escape')hideSearch();if(['ArrowDown','ArrowUp'].includes(e.key)&&options.length){e.preventDefault();searchIndex=(searchIndex+(e.key==='ArrowDown'?1:-1)+options.length)%options.length;options.forEach((b,i)=>b.setAttribute('aria-selected',String(i===searchIndex)));e.target.setAttribute('aria-activedescendant',options[searchIndex].id);options[searchIndex].scrollIntoView({block:'nearest'});}if(e.key==='Enter'&&options.length&&!$('#search-results').hidden){e.preventDefault();selectSearch(Math.max(0,searchIndex));}}
 if(e.target.matches('[role="tab"]')&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const tabs=[...e.target.closest('[role="tablist"]').querySelectorAll('[role="tab"]')],idx=tabs.indexOf(e.target),next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(idx+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].focus();tabs[next].click();}
});
$('#content-dialog').addEventListener('close',()=>{state.activeSector=null;document.body.classList.remove('modal-open');});
$('#content-dialog').addEventListener('click',e=>{if(e.target===$('#content-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialog();}});
addEventListener('popstate',route);
async function start(){
 let config={};try{const r=await fetch('/api/market-config',{signal:AbortSignal.timeout(4000)});if(r.ok)config=await r.json();}catch{}
 Object.assign(state,readPreferences(config));shell();
 compareSelection=mountCompareSelection({navigate,notify:toast});
 await mountFilingNotifications($('.header-end'),{navigate}).ready;
 preview=mountStockPreview($('#stock-preview'),{onSelection:key=>$('#rank-body').querySelectorAll('[data-stock-key]').forEach(tr=>tr.classList.toggle('preview-selected',tr.dataset.stockKey===key))});
 ranking=mountHomeRanking($('#ranking'),{state,preview,getMonthlyFlow:()=>monthlyFlow,meta,stateBox,onUpdate:updateConnection,navigate,scrollPreview:()=>$('#stock-preview').scrollIntoView({block:'nearest',behavior:'smooth'})});
 sectorRanking=mountSectorRanking($('#sector-ranking'),{onSelect:id=>sectorMap.highlight(id)});
 watchlist=mountWatchlist($('#market-watchlist-view'),{navigate,notify:toast,onCompare:s=>compareSelection.add(s),addStock:()=>{const input=$('#global-search');input.focus();input.scrollIntoView({block:'center',behavior:'smooth'});if(input.value)search();}});calendar=mountCalendar({host:$('#today-agenda'),page:$('#calendar-page'),navigate});sectorMap=mountSectorMap($('#sectors'),{navigate,showHistory:false,initialMarket:state.sectorMarket,initialIndex:state.sectorIndex,onRefresh:(s,clear)=>{if(monthlyFlow?.isActive()){if(clear)monthlyFlow.select(s);else monthlyFlow.refresh();return true;}return false;},onSelection:s=>{state.sectorMarket=s.market;state.sectorIndex=s.indexId;savePreferences(state);},onData:(data,selection)=>{state.sectors=data;sectorRanking.update(data,selection);updateConnection();}});monthlyFlow=mountMonthlyFlow($('#monthly-flow'),{initialActive:false,initialMarket:state.sectorMarket,initialIndex:state.sectorIndex,onData:(data,selection)=>{ranking.renderMonthly(data);sectorMap.setData(data,selection);},onMode:active=>{document.body.classList.toggle('monthly-active',active);if(!active){ranking.showDaily();loadSectors();}}});loadIndicators();loadRanking();loadSectors();route();
}
start();
setInterval(()=>{if(sectorMap&&!document.hidden&&location.pathname==='/'){loadIndicators();loadRanking();loadSectors();}},60000);
if(document.modelContext?.registerTool){const lifecycle=new AbortController();addEventListener('pagehide',()=>lifecycle.abort(),{once:true});const tool={name:'read_market_data_status',description:'Read current data connection states without changing page state.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:(input={})=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new Error('No input fields are accepted');return {indices:state.indices?.status,futures:state.futures?.status,sectors:state.sectors?.status};}};try{Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}}

