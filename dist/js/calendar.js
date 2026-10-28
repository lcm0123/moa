import { icon, escapeHtml as esc } from './components.js';
import { setText, setHTML } from './market-client.js';
import { kstDate, kstClock, nextKstMidnight, chooseHeadline, chronological, countryNames, shiftDay, validDay, wallTimeToInstant, isMajorEconomic, homeEconomicEvents, calendarMonth, shiftCalendarMonth } from './calendar-model.js';

import {earningsLargeCap,present,economicMetrics,economicTooltip,earningsTooltip,earningsSession,groupEarnings,filterEarnings,usd,epsDifference,signedUsd} from './calendar-presentation.js';
import {renderMonthGrid,monthCaption} from './calendar-month.js';
import {readWatchlist,toggleWatchlist} from './watchlist.js';
import {economicLabel,economicPeriod} from './economic-labels.js';

const EMPTY_TEXT = '오늘 예정된 주요 일정이 없습니다';
const ERROR_TEXT = '일정을 불러오지 못했습니다';
const dateCaption = date => new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',month:'long',day:'numeric',weekday:'short'}).format(new Date(date+'T12:00:00+09:00'));
const timeLabel = event => event.startsAt ? '한국시간 '+kstClock(event.startsAt) : '시간 미정';
const isEnded = (event, now) => event.startsAt && Date.parse(event.startsAt) <= now;

export function mountCalendar({host, page, navigate, now = () => Date.now(), fetcher = (...args) => fetch(...args)}) {
 const state = {date:kstDate(now()),status:'loading',items:[],providerUpdatedAt:null,canManage:false,pageDate:null,pageItems:[],pageStatus:'loading',pageTab:'economic',earningsQuery:'',watchOnly:false,market:'all',pageLayout:'list',all:false,pageError:null,pageMeta:null};
 let todayVersion=0,pageVersion=0,clockTimer,editing=null,saving=false,returnFocus;
 const requests=new Map();
 host.innerHTML='<div class="agenda-card"><button class="agenda-trigger" popovertarget="agenda-popover" aria-controls="agenda-popover" aria-expanded="false"><span class="agenda-first">'+icon('calendar')+'<strong>오늘의 주요 일정</strong><span class="agenda-count">…</span>'+icon('down')+'</span><span class="agenda-highlights">일정을 불러오는 중입니다</span></button><a data-nav class="agenda-earnings-link">실적 발표 '+icon('chevron')+'</a></div>';
 const trigger=host.querySelector('button');
 const popover=document.createElement('div');
 popover.id='agenda-popover';popover.className='agenda-popover';popover.setAttribute('popover','auto');popover.setAttribute('role','dialog');popover.setAttribute('aria-labelledby','agenda-popover-title');
 popover.innerHTML='<div class="agenda-popover-heading"><div><h2 id="agenda-popover-title">오늘의 주요 일정</h2><p class="agenda-date"></p></div><button class="icon-button" data-calendar="close-popover" aria-label="오늘 일정 닫기">'+icon('close')+'</button></div><div class="agenda-popover-content" aria-live="polite"></div><div class="agenda-popover-footer"><button class="agenda-add" data-calendar="add" hidden>'+icon('plus')+' 일정 등록</button><a data-nav class="agenda-all">전체 일정 보기 '+icon('chevron')+'</a></div>';
 document.body.append(popover);
 const editor=document.createElement('dialog');editor.className='calendar-editor';editor.setAttribute('aria-labelledby','calendar-editor-title');
 document.body.append(editor);
 const $=(selector,root=host)=>root.querySelector(selector);
 const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('moa-calendar'):null;

 async function getDate(date,key,tab='economic',dateTo=null) {
  requests.get(key)?.abort();const controller=new AbortController();requests.set(key,controller);
  const timeout=setTimeout(()=>controller.abort(),25000);
  try {
   const response=await fetcher((tab==='earnings'?'/api/calendar/earnings?stored=1&date='+date+'&dateTo='+shiftDay(date,6):'/api/calendar?stored=1&date='+date+(dateTo?'&dateTo='+dateTo:'')),{cache:'no-store',signal:controller.signal});
   const result=await response.json();
   if(!response.ok)throw new Error(result.error||ERROR_TEXT);
   if(result.date!==date||!Array.isArray(result.items))throw new Error(ERROR_TEXT);
   return result;
  } finally {clearTimeout(timeout);}
 }
 function tooltip(lines,id){return '<span class="calendar-tip"><button type="button" class="calendar-info" data-calendar="tooltip" aria-label="'+esc(lines.join(' / '))+'" aria-describedby="'+id+'" aria-expanded="false">'+icon('info')+'</button><span class="calendar-tooltip" id="'+id+'" role="tooltip">'+lines.map((line,i)=>{const split=i===0?line.indexOf(' · '):-1;return split<0?'<span>'+esc(line)+'</span>':'<span class="tip-first-line"><span class="tip-title">'+esc(line.slice(0,split))+'</span><span>'+esc(line.slice(split))+'</span></span>';}).join('')+'</span></span>';}
 function eventRows(items,compact=false) {
  return chronological(items).map(event=>{
   const released=present(event.actual),ended=isEnded(event,now()),metrics=economicMetrics(event),label=economicLabel(event),major=isMajorEconomic(event);
   const labels=[event.featured?'직접 지정':null,released?'발표 완료':ended?'예정 시각 경과':null,economicPeriod(event.period),event.timeNote].filter(Boolean);
   return '<li class="calendar-event-row '+(major?'economic-important ':'')+(ended?'event-ended':'')+'"><time'+(event.startsAt?' datetime="'+esc(event.startsAt)+'"':'')+'>'+(event.startsAt?kstClock(event.startsAt):'시간 미정')+'</time><div class="calendar-event-text"><span class="event-country">'+countryNames[event.country]+(compact?'':' · '+esc(event.source||'관리자 등록'))+'</span><div class="economic-event-heading"><strong title="'+esc(label.originalTitle)+'">'+esc(label.title)+'</strong>'+(major?'<span class="economic-major-badge">✓ 중요</span>':'')+'</div>'+(label.description?'<span class="economic-explanation">'+esc(label.description)+'</span>':'')+(metrics.length?'<div class="calendar-metrics">'+metrics.map(([key,value])=>'<span><small>'+key+'</small> <b>'+esc(value)+'</b></span>').join('')+'</div>':'')+'<div class="event-labels">'+labels.map(label=>'<span>'+esc(label)+'</span>').join('')+'</div></div>'+tooltip(economicTooltip(event),(compact?'home-':'page-')+event.id)+(!compact&&state.canManage?'<button class="calendar-edit-button" data-calendar="'+(event.readOnly?'priority':'edit')+'" data-id="'+esc(event.id)+'" aria-label="'+esc(label.title)+(event.readOnly?' 주요 일정 '+(event.featured?'해제':'지정'):' 수정')+'">'+(event.readOnly?(event.featured?'주요 해제':'주요 지정'):'수정')+'</button>':'')+'</li>';
  }).join('');
 }
 function earningsRows(items){
  const favorites=readWatchlist();
  return groupEarnings(items,favorites).map(group=>'<section class="earnings-date-group" aria-label="'+esc(group.date)+'"><h2>'+(group.date==='unconfirmed'?'한국 날짜 미확정':dateCaption(group.date)+' <small>KST</small>')+'<span>'+group.items.length+'건</span></h2><div class="earnings-columns" aria-hidden="true"><span>종목 · 발표 시점</span><span>EPS 예상 / 실제</span><span>매출 예상 / 실제</span><span>시가총액</span></div><ul class="earnings-list">'+group.items.map(item=>{
   const saved=favorites.includes('US:'+item.ticker),diff=epsDifference(item),released=Number.isFinite(item.epsActual)||Number.isFinite(item.revenueActual);
   const metric=(label,estimate,actual,compact)=>Number.isFinite(estimate)||Number.isFinite(actual)?'<div class="earnings-metric"><small>'+label+'</small>'+[Number.isFinite(estimate)?'<span><i>예상</i> '+usd(estimate,compact)+'</span>':null,Number.isFinite(actual)?'<span><i>실제</i> <b>'+usd(actual,compact)+'</b></span>':null].filter(Boolean).join('')+'</div>':'<div class="earnings-metric"></div>';
   return '<li class="earnings-row" data-ticker="'+esc(item.ticker)+'"><div class="earnings-identity"><button class="icon-button earnings-star '+(saved?'saved':'')+'" data-calendar="favorite" data-ticker="'+esc(item.ticker)+'" aria-pressed="'+saved+'" aria-label="'+esc(item.ticker)+' 관심종목 '+(saved?'삭제':'추가')+'">'+icon('star')+'</button><div><a data-nav href="/stock/US/'+encodeURIComponent(item.ticker)+'"><strong>'+esc(item.ticker)+'</strong>'+(earningsLargeCap(item)?'<span class="earnings-large-cap" tabindex="0" title="대형주 · 시가총액 100억 달러 이상" aria-label="대형주 · 시가총액 100억 달러 이상">◆ 대형주</span>':'')+'<span>'+esc(item.name)+'</span></a><div class="earnings-session">'+esc(earningsSession(item))+(released?' <b>발표 완료</b>':'')+'</div><div class="earnings-origin">미국 '+esc(item.originalDate)+' · ET</div>'+'<div class="earnings-explore-links"><a data-nav href="/stock/US/'+encodeURIComponent(item.ticker)+'?tab=financial">실적·재무</a><a data-nav href="/stock/US/'+encodeURIComponent(item.ticker)+'?tab=filings">공시</a><button data-calendar="compare" data-ticker="'+esc(item.ticker)+'">비교 추가</button></div><small class="earnings-confirmation">'+(item.dateConfirmed===true?'확정 일정':'일정 확정 여부 미확인')+(item.startsAt?' · 한국 '+kstDate(item.startsAt)+' '+kstClock(item.startsAt)+' KST':' · 발표 시각 미확인')+'</small>'+(item.indices.length?'<div class="earnings-indices">'+item.indices.map(index=>({SP500:'S&P 500',NASDAQ100:'나스닥100',DOW30:'다우30'}[index]||index)).join(' · ')+'</div>':'')+'</div></div><div>'+metric(item.epsBasis==='adjusted'?'조정 EPS':item.epsBasis==='GAAP'?'GAAP EPS':'EPS · 기준 미확인',item.epsEstimate,item.epsActual,false)+(diff!==null?'<span class="earnings-difference">예상 대비 '+signedUsd(diff)+'</span>':released&&Number.isFinite(item.epsEstimate)?'<small>예상치 확정 시각 미확인 · 차이 미계산</small>':'')+'</div>'+metric('매출',item.revenueEstimate,item.revenueActual,true)+'<div class="earnings-cap">'+(Number.isFinite(item.marketCap)?'<small>시가총액</small>'+usd(item.marketCap,true):'')+'</div>'+tooltip(earningsTooltip(item),'tip-'+item.id)+'</li>';
  }).join('')+'</ul></section>').join('');
 }
 function positionPopover() {
  if(!popover.matches(':popover-open'))return;
  const rect=trigger.getBoundingClientRect(),width=Math.min(470,innerWidth-32),height=popover.offsetHeight;
  popover.style.width=width+'px';
  popover.style.left=Math.max(16,Math.min(innerWidth-width-16,rect.left))+'px';
  popover.style.top=Math.max(12,rect.bottom+8+height>innerHeight-12?rect.top-height-8:rect.bottom+8)+'px';
 }
 function armClock() {
  clearTimeout(clockTimer);
  const current=now(),times=state.items.filter(e=>e.startsAt&&Date.parse(e.startsAt)>current).map(e=>Date.parse(e.startsAt)+30);
  const next=Math.min(current+60000,nextKstMidnight(current)+30,...times);
  clockTimer=setTimeout(()=>{
   if(kstDate(now())!==state.date)refreshToday();else {renderToday();if(state.pageDate)renderPageList();}
  },Math.max(40,next-current));
 }
 function renderToday() {
  const selection=chooseHeadline(state.items,now()),ready=state.status==='ready',count=selection.items.length,highlights=homeEconomicEvents(state.items,now());
  setText($('.agenda-count'),ready?count+'건':state.status==='error'?'—':'…');
  const message=state.status==='loading'?'일정을 불러오는 중입니다':state.status==='error'?ERROR_TEXT:EMPTY_TEXT;
  const html=ready&&highlights.length?highlights.map(event=>'<span class="agenda-highlight"><strong>'+esc(economicLabel(event).title)+'</strong><small>'+(event.startsAt?kstClock(event.startsAt)+' KST':'시간 미정')+' · '+countryNames[event.country]+(isEnded(event,now())?' · 종료':'')+'</small></span>').join(''):'<span class="agenda-preview">'+message+'</span>';
  setHTML($('.agenda-highlights'),html);$('.agenda-highlights').style.setProperty('--agenda-count',Math.max(1,highlights.length));
  $('.agenda-earnings-link').href='/calendar?tab=earnings&date='+state.date;
  host.classList.toggle('agenda-error',state.status==='error');
  trigger.setAttribute('aria-label','오늘의 주요 일정 · '+(ready?count+'건 · ':'')+(highlights.length?highlights.map(e=>timeLabel(e)+' · '+economicLabel(e).title).join(' / '):message));
  trigger.setAttribute('aria-busy',String(state.status==='loading'));
  setText($('.agenda-date',popover),dateCaption(state.date)+' · 한국시간'+(state.providerUpdatedAt?' · 조회 '+kstClock(state.providerUpdatedAt):''));
  const content=state.status==='error'?'<div class="agenda-message" role="alert">'+ERROR_TEXT+'<button data-calendar="retry">다시 시도</button></div>':state.status==='loading'?'<div class="agenda-message" role="status">일정을 불러오는 중입니다</div>':count?'<ol class="agenda-event-list">'+eventRows(selection.items,true)+'</ol>':'<div class="agenda-message">'+EMPTY_TEXT+'</div>';
  setHTML($('.agenda-popover-content',popover),content);
  $('.agenda-all',popover).href='/calendar?date='+state.date;
  $('.agenda-add',popover).hidden=!state.canManage;
  positionPopover();armClock();
 }
 async function refreshToday() {
  const version=++todayVersion,day=kstDate(now()),background=state.status==='ready'&&state.date===day;state.date=day;if(!background){state.status='loading';state.items=[];renderToday();}
  try {const result=await getDate(day,'today');if(version!==todayVersion)return;
   if(kstDate(now())!==day){refreshToday();return;}
   state.items=result.items;state.providerUpdatedAt=result.providerUpdatedAt||null;state.canManage=result.canManage===true;state.status='ready';
  }catch {if(version!==todayVersion)return;state.status='error';state.items=[];}
  renderToday();
 }
 function hidePopover(){if(popover.matches(':popover-open'))popover.hidePopover();}
 const pageUrl=(date=state.pageDate,tab=state.pageTab,all=state.all,layout=state.pageLayout)=>'/calendar?date='+date+'&tab='+tab+(all&&tab==='economic'?'&view=all':'')+(tab==='economic'&&layout==='month'?'&layout=month':'')+(tab==='earnings'&&state.earningsQuery?'&q='+encodeURIComponent(state.earningsQuery):'')+(state.watchOnly?'&scope=watchlist':'')+(state.market!=='all'?'&market='+state.market:'');
 function renderPageList() {
  if(!state.pageDate||!$('.calendar-page-content',page))return;
  const earnings=state.pageTab==='earnings',month=!earnings&&state.pageLayout==='month',items=(earnings?filterEarnings(state.pageItems,state.earningsQuery):state.all?state.pageItems:state.pageItems.filter(isMajorEconomic)).filter(e=>(state.market==='all'||(e.market||e.country)===state.market)&&(!earnings||!state.watchOnly||readWatchlist().includes((e.market||'US')+':'+e.ticker)));
  const empty=earnings?(state.earningsQuery?'선택한 기간에 일치하는 종목의 실적 발표가 없습니다':state.watchOnly?'이 기간에 저장된 관심종목 실적 일정이 없습니다':'이 기간에 저장된 실적 일정이 없습니다'):state.all?'이 날짜에 등록된 경제 일정이 없습니다':'이 날짜에 예정된 주요 경제 일정이 없습니다';
  let content=state.pageStatus==='loading'?'<div class="calendar-page-message" role="status">일정을 불러오는 중입니다</div>':state.pageStatus==='error'?'<div class="calendar-page-message" role="alert">'+esc(state.pageError||ERROR_TEXT)+'<button class="secondary-button" data-calendar="retry-page">다시 시도</button></div>':items.length?earnings?earningsRows(items):'<ol class="calendar-day-list">'+eventRows(items)+'</ol>':'<div class="calendar-page-message">'+icon('calendar')+'<strong>'+empty+'</strong>'+(!earnings&&!state.all&&state.pageItems.length?'<button class="secondary-button" data-calendar="all">전체 '+state.pageItems.length+'건 보기</button>':'')+'</div>';
  if(month&&state.pageStatus==='ready'){
   const selectedItems=items.filter(e=>e.dateKst===state.pageDate&&e.dateConfirmed!==false),unconfirmed=items.filter(e=>e.dateConfirmed===false);
   content=renderMonthGrid(items,state.pageDate,kstDate(now()))+'<div class="economic-selected-day"><h2>'+dateCaption(state.pageDate)+' <small>'+selectedItems.length+'건 · KST</small></h2>'+(selectedItems.length?'<ol class="calendar-day-list">'+eventRows(selectedItems)+'</ol>':'<p class="calendar-date-empty">'+(state.all?'이 날짜에 예정된 경제 일정이 없습니다':'이 날짜에 예정된 주요 경제 일정이 없습니다')+'</p>')+'</div>'+(unconfirmed.length?'<div class="economic-selected-day"><h2>한국 날짜 미확정 <small>'+unconfirmed.length+'건</small></h2><ol class="calendar-day-list">'+eventRows(unconfirmed)+'</ol></div>':'');
  }
  setHTML($('.calendar-page-content',page),content);
  setText($('.calendar-result-count',page),state.pageStatus==='ready'?items.length+'건':'');
  $('.calendar-admin-tools',page).hidden=earnings||!state.canManage;
  setText($('.calendar-data-stamp',page),state.pageStatus==='ready'?(state.pageMeta?.message||'저장된 일정')+(state.pageMeta?.providerUpdatedAt?' · 자료 기준 '+kstDate(state.pageMeta.providerUpdatedAt)+' '+kstClock(state.pageMeta.providerUpdatedAt)+' KST':''):'');
  const membership=$('.earnings-membership-status',page);if(membership)setText(membership,state.pageStatus==='ready'&&state.pageMeta?.membershipStatus!=='ready'?'지수 편입 정보 일부 미확인 · 확인된 목록만 우선 정렬':'');
 }
 async function openPage(day,options={}) {
  hidePopover();const nextDay=validDay(day)?day:kstDate(now()),nextTab=options.tab==='earnings'?'earnings':'economic',nextLayout=options.layout==='month'?'month':'list';
  const cached=nextTab==='economic'&&state.pageTab==='economic'&&nextLayout==='month'&&state.pageLayout==='month'&&state.pageStatus==='ready'&&state.pageDate?.slice(0,7)===nextDay.slice(0,7)?{items:state.pageItems,meta:state.pageMeta}:null;
  state.earningsQuery=String(options.q||'').slice(0,100);state.watchOnly=options.scope==='watchlist';state.market=['KR','US'].includes(options.market)?options.market:'all';state.pageDate=nextDay;state.pageTab=nextTab;state.pageLayout=nextLayout;state.all=options.view==='all';state.pageStatus='loading';state.pageItems=[];state.pageMeta=null;
  const earnings=state.pageTab==='earnings',month=!earnings&&state.pageLayout==='month';document.title=(earnings?'실적 발표':'경제 일정')+' · MOA';
  page.innerHTML='<div class="calendar-page-title"><div><div class="eyebrow">MARKET CALENDAR</div><h1>시장 일정</h1><p>경제지표와 기업 실적을 한곳에서</p></div><div class="calendar-admin-tools" hidden><button class="primary-button" data-calendar="add">'+icon('plus')+' 일정 등록</button></div></div><div class="calendar-view-bar"><div class="calendar-tabs" role="tablist" aria-label="일정 종류">'+[['economic','경제 일정'],['earnings','실적 발표']].map(([id,label])=>'<button id="calendar-tab-'+id+'" role="tab" aria-controls="calendar-panel" aria-selected="'+(state.pageTab===id)+'" tabindex="'+(state.pageTab===id?0:-1)+'" data-calendar="tab" data-tab="'+id+'">'+label+'</button>').join('')+'</div>'+(!earnings?'<div class="calendar-layout-switch" role="group" aria-label="경제 일정 표시 방식"><button data-calendar="layout" data-layout="list" aria-pressed="'+!month+'">목록</button><button data-calendar="layout" data-layout="month" aria-pressed="'+month+'">'+icon('calendar')+' 달력</button></div>':'')+'</div><section id="calendar-panel" class="surface calendar-day-panel" role="tabpanel" aria-labelledby="calendar-tab-'+state.pageTab+'"><div class="calendar-date-toolbar"><div class="calendar-date-controls"><button class="icon-button" data-calendar="previous" aria-label="이전 '+(earnings?'7일':month?'달':'날짜')+'">'+icon('chevron','rotate-left')+'</button><label><span class="sr-only">일정 날짜</span><input id="calendar-date" type="date" value="'+state.pageDate+'"></label><button class="icon-button" data-calendar="next" aria-label="다음 '+(earnings?'7일':month?'달':'날짜')+'">'+icon('chevron')+'</button><button class="calendar-today-button" data-calendar="today">오늘</button></div>'+(earnings?'<span class="earnings-order-label">관심종목 → 주요 지수 → 시가총액 · ◆ 대형주: 100억 달러 이상</span>':'<div class="calendar-filter" role="group" aria-label="경제 일정 중요도"><button data-calendar="major" aria-pressed="'+!state.all+'">주요 일정</button><button data-calendar="all" aria-pressed="'+state.all+'">전체 보기</button></div>')+'</div>'+'<div class="calendar-explore-filters"><label>시장 <select data-calendar-market aria-label="일정 시장">'+[['all','전체'],['KR','국내'],['US','미국']].map(([v,l])=>'<option value="'+v+'" '+(state.market===v?'selected':'')+'>'+l+'</option>').join('')+'</select></label>'+(earnings?'<button data-calendar="watch-only" aria-pressed="'+state.watchOnly+'">'+(state.watchOnly?'관심종목만':'전체 종목')+'</button>':'')+'</div>'+(earnings?'<label class="earnings-search">'+icon('search')+'<input type="search" maxlength="100" aria-label="실적 발표 종목명·티커 검색" placeholder="선택한 7일 내 종목명·티커 검색" value="'+esc(state.earningsQuery)+'"></label>':'')+'<div class="calendar-day-caption"><strong>'+(month?monthCaption(state.pageDate):dateCaption(state.pageDate))+(earnings?' ~ '+dateCaption(shiftDay(state.pageDate,6)):'')+'</strong><span class="calendar-result-count"></span><span class="calendar-timezone">KST</span></div><div class="calendar-page-content" aria-live="polite"></div></section><div class="calendar-page-note"><span>'+(earnings?'BMO 미국 장 시작 전 · AMC 미국 장 마감 후 · 한국 날짜는 공급사 발표 시점 기준':'한국시간(KST) · 주요 일정은 핵심 지표와 중요도, 직접 지정 기준')+'</span><span class="calendar-data-stamp"></span></div>'+(earnings?'<p class="earnings-membership-status"></p>':'');
  if(cached){state.pageItems=cached.items;state.pageMeta=cached.meta;state.pageStatus='ready';renderPageList();return;}
  await refreshPage();
 }
 async function refreshPage() {
  const day=state.pageDate,tab=state.pageTab,month=tab==='economic'&&state.pageLayout==='month';if(!day)return;const version=++pageVersion;state.pageStatus='loading';state.pageError=null;renderPageList();
  try{const range=month?calendarMonth(day):null;const result=await getDate(range?.first||day,'page',tab,range?.last);if(version!==pageVersion||day!==state.pageDate||tab!==state.pageTab)return;state.pageItems=result.items;state.pageMeta=result;if(tab==='economic')state.canManage=result.canManage===true;state.pageStatus='ready';}
  catch(error){if(version!==pageVersion)return;state.pageStatus='error';state.pageError=['실적 데이터 연결 필요','실적 데이터 이용 권한 확인 필요'].includes(error.message)?error.message:tab==='earnings'?'실적 발표를 불러오지 못했습니다':ERROR_TEXT;}
  renderPageList();
 }
 function closeEditor(){if(saving)return;editor.close();if(returnFocus?.isConnected)returnFocus.focus();}
 function openEditor(item=null) {
  if(!state.canManage)return;
  hidePopover();returnFocus=document.activeElement;editing=item;
  const day=item?.dateKst||state.pageDate||kstDate(now()),clock=item?.startsAt?kstClock(item.startsAt):'',unknown=!!item&&!item.startsAt;
  editor.innerHTML='<div class="dialog-heading"><div><div class="eyebrow">LOCAL ADMIN</div><h2 id="calendar-editor-title">'+(item?'경제 일정 수정':'경제 일정 등록')+'</h2></div><button type="button" class="icon-button" data-calendar="close-editor" aria-label="일정 편집 닫기">'+icon('close')+'</button></div><form class="calendar-form"><label class="form-wide">일정명<input name="title" maxlength="160" required value="'+esc(item?.title||'')+'" placeholder="등록할 경제지표 또는 중앙은행 일정"></label><label>국가<select name="country"><option value="KR"'+(item?.country!=='US'?' selected':'')+'>한국</option><option value="US"'+(item?.country==='US'?' selected':'')+'>미국</option></select></label><label>중요도<select name="importance">'+[['high','높음'],['medium','보통'],['low','낮음']].map(([value,label])=>'<option value="'+value+'"'+((item?.importance||'high')===value?' selected':'')+'>'+label+'</option>').join('')+'</select></label><label>날짜<input name="date" type="date" required value="'+day+'"></label><label>시간<input name="time" type="time" value="'+clock+'"'+(unknown?' disabled':' required')+'></label><label class="form-wide">입력 시간대<select name="zone"'+(unknown?' disabled':'')+'><option value="Asia/Seoul">한국시간 (Asia/Seoul)</option><option value="America/New_York">미국 동부시간 (America/New_York)</option></select></label><label class="calendar-check form-wide"><input name="unknown" type="checkbox"'+(unknown?' checked':'')+'> 시간 미정 <span>날짜는 한국시간 기준</span></label><label class="calendar-check form-wide"><input name="featured" type="checkbox"'+(item?.featured?' checked':'')+'> 주요 일정으로 우선 표시</label><p class="calendar-form-help form-wide">중요도 높은 일정과 지정한 주요 일정이 홈 카드에 표시됩니다.</p><p class="calendar-time-preview form-wide" aria-live="polite"></p><p class="calendar-form-error form-wide" role="alert"></p><div class="calendar-form-actions form-wide"><button type="button" class="secondary-button" data-calendar="close-editor">취소</button><button type="submit" class="primary-button">저장</button></div></form>';
  editor.showModal();previewTime();
 }
 function formValues(){const form=$('form',editor),unknown=form.elements.unknown.checked;return {title:form.elements.title.value,country:form.elements.country.value,importance:form.elements.importance.value,featured:form.elements.featured.checked,startsAt:unknown?null:wallTimeToInstant(form.elements.date.value,form.elements.time.value,form.elements.zone.value),dateKst:form.elements.date.value,...(editing?{version:editing.version}:{})};}
 function previewTime(){
  const form=$('form',editor);if(!form)return;const unknown=form.elements.unknown.checked;
  form.elements.time.disabled=unknown;form.elements.time.required=!unknown;form.elements.zone.disabled=unknown;if(unknown)form.elements.zone.value='Asia/Seoul';
  let text='';try{if(unknown)text='한국시간 '+form.elements.date.value+' · 시간 미정';else if(form.elements.date.value&&form.elements.time.value){const instant=wallTimeToInstant(form.elements.date.value,form.elements.time.value,form.elements.zone.value);text='표시 시각: 한국시간 '+kstDate(instant)+' '+kstClock(instant);}}catch(error){text=error.message;}
  setText($('.calendar-time-preview',editor),text);
 }
 async function save(e){
  e.preventDefault();if(saving)return;const errorNode=$('.calendar-form-error',editor);setText(errorNode,'');
  let payload;try{payload=formValues();}catch(error){setText(errorNode,error.message);return;}
  saving=true;editor.querySelectorAll('button').forEach(b=>b.disabled=true);setText($('[type="submit"]',editor),'저장 중…');
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
  try{
   const response=await fetcher('/api/calendar'+(editing?'/'+editing.id:''),{method:editing?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
   const result=await response.json();if(!response.ok||!result.item)throw new Error(result.error||'일정을 저장하지 못했습니다. 입력 내용은 유지됩니다.');
   saving=false;closeEditor();refreshToday();channel?.postMessage('updated');
   if(!page.hidden)navigate(pageUrl(result.item.dateKst));
  }catch(error){setText(errorNode,error.name==='AbortError'?'저장 응답을 확인하지 못했습니다. 전체 일정에서 저장 여부를 확인해 주세요.':error.message);}
  finally{clearTimeout(timeout);saving=false;editor.querySelectorAll('button').forEach(b=>b.disabled=false);setText($('[type="submit"]',editor),'저장');}
 }
 async function setPriority(button){
  const item=state.pageItems.find(e=>e.id===button.dataset.id);if(!item)return;button.disabled=true;
  try{
   const response=await fetcher('/api/calendar/preferences/'+item.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:item.dateKst,featured:!item.featured}),signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw new Error();await refreshPage();refreshToday();channel?.postMessage('updated');
  }catch{button.disabled=false;button.textContent='저장 실패 · 재시도';}
 }
 function handle(e){
  const button=e.target.closest('[data-calendar]');if(!button)return;const action=button.dataset.calendar;
  if(action==='tooltip'){const open=button.getAttribute('aria-expanded')!=='true';document.querySelectorAll('.calendar-info').forEach(b=>b.setAttribute('aria-expanded','false'));button.setAttribute('aria-expanded',String(open));}
  else if(action==='favorite'){try{toggleWatchlist('US',button.dataset.ticker);page.querySelector('[data-calendar="favorite"][data-ticker="'+button.dataset.ticker+'"]')?.focus({preventScroll:true});}catch{button.setAttribute('aria-label','관심종목을 저장하지 못했습니다');}}
  else if(action==='watch-only'){state.watchOnly=!state.watchOnly;history.replaceState(history.state,'',pageUrl());button.setAttribute('aria-pressed',String(state.watchOnly));button.textContent=state.watchOnly?'관심종목만':'전체 종목';renderPageList();}
  else if(action==='compare'){const item=state.pageItems.find(x=>x.ticker===button.dataset.ticker);if(item)dispatchEvent(new CustomEvent('moa-compare-add',{detail:{market:'US',ticker:item.ticker,name:item.name}}));}
  else if(action==='tab'){navigate(pageUrl(state.pageDate,button.dataset.tab));$('#calendar-tab-'+button.dataset.tab,page)?.focus();}
  else if(action==='layout')navigate(pageUrl(state.pageDate,'economic',state.all,button.dataset.layout));
  else if(action==='day'){navigate(pageUrl(button.dataset.date));page.querySelector('[data-calendar="day"][data-date="'+button.dataset.date+'"]')?.focus({preventScroll:true});$('.economic-selected-day',page)?.scrollIntoView({behavior:'smooth',block:'nearest'});}
  else if(action==='major'||action==='all')navigate(pageUrl(state.pageDate,'economic',action==='all'));
  else if(action==='close-popover')hidePopover();else if(action==='retry')refreshToday();else if(action==='add')openEditor();else if(action==='priority')setPriority(button);else if(action==='edit')openEditor(state.pageItems.find(item=>item.id===button.dataset.id));else if(action==='close-editor')closeEditor();else if(action==='retry-page')refreshPage();else if(action==='today')navigate(pageUrl(kstDate(now())));else if(action==='previous'||action==='next')navigate(pageUrl(state.pageTab==='economic'&&state.pageLayout==='month'?shiftCalendarMonth(state.pageDate,action==='previous'?-1:1):shiftDay(state.pageDate,(action==='previous'?-1:1)*(state.pageTab==='earnings'?7:1))));
 }
 popover.addEventListener('click',handle);page.addEventListener('click',handle);editor.addEventListener('click',handle);
 page.addEventListener('keydown',e=>{const b=e.target.closest('[data-calendar="day"]');if(!b)return;const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[e.key];if(!delta)return;e.preventDefault();const day=shiftDay(b.dataset.date,delta);navigate(pageUrl(day));page.querySelector('[data-calendar="day"][data-date="'+day+'"]')?.focus({preventScroll:true});});
 page.addEventListener('input',e=>{if(!e.target.matches('.earnings-search input'))return;state.earningsQuery=e.target.value.slice(0,100);history.replaceState(history.state,'',pageUrl());renderPageList();});
 page.addEventListener('change',e=>{if(e.target.matches('[data-calendar-market]')){state.market=e.target.value;history.replaceState(history.state,'',pageUrl());renderPageList();}if(e.target.id==='calendar-date'&&validDay(e.target.value))navigate(pageUrl(e.target.value));});
 const updateFavorites=()=>{if(state.pageTab==='earnings'&&state.pageStatus==='ready')renderPageList();};
 addEventListener('moa-watchlist',updateFavorites);addEventListener('storage',updateFavorites);
 document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.calendar-info').forEach(b=>{b.setAttribute('aria-expanded','false');if(b===document.activeElement)b.blur();});});
 document.addEventListener('click',e=>{if(!e.target.closest('.calendar-tip'))document.querySelectorAll('.calendar-info').forEach(b=>b.setAttribute('aria-expanded','false'));});
 editor.addEventListener('input',previewTime);editor.addEventListener('change',previewTime);editor.addEventListener('submit',save);editor.addEventListener('cancel',e=>{if(saving)e.preventDefault();});
 popover.addEventListener('toggle',e=>{trigger.setAttribute('aria-expanded',String(e.newState==='open'));positionPopover();});
 addEventListener('resize',positionPopover);addEventListener('scroll',positionPopover,true);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){refreshToday();if(!page.hidden)refreshPage();}});
 const poll=setInterval(()=>{if(!document.hidden){refreshToday();if(!page.hidden)refreshPage();}},60000);
 if(channel)channel.onmessage=()=>{refreshToday();if(!page.hidden)refreshPage();};
 refreshToday();
 return {openPage,today:()=>kstDate(now()),refresh:refreshToday,hidePopover,leavePage(){state.pageDate=null;++pageVersion;},destroy(){clearInterval(poll);clearTimeout(clockTimer);for(const r of requests.values())r.abort();channel?.close();removeEventListener('moa-watchlist',updateFavorites);removeEventListener('storage',updateFavorites);}};
}
