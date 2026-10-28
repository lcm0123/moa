import {icon} from './components.js';

function pageHeadingMarkup(){
 return [
  '<div class="page-heading">',
  '<div><div class="eyebrow">MARKET OVERVIEW</div><h1>오늘의 시장</h1></div>',
  '<div id="today-agenda" class="today-agenda"></div>',
  '<div class="page-heading-right"><span class="connection-label"><i></i> 데이터 연결 전</span>',
  '<button class="icon-button" data-action="refresh-all" aria-label="모든 패널 새로고침">',icon('refresh'),'</button></div>',
  '</div>',
 ].join('');
}

function marketPanelMarkup(state,tabs){
 return [
  '<section id="market" class="surface market-panel" aria-label="시장 정보">',
  '<div id="market-indices-view" role="region" aria-label="지수·선물">',
  '<div class="panel-heading"><div class="title-group"><h2>시장 지표</h2>',
  tabs('market',[['KR','국내'],['US','미국']],state.market),
  '</div><div id="feed-status" class="feed-status"><span>지수 <b>연결 필요</b></span><span>선물 <b>연결 필요</b></span></div></div>',
  '<div id="index-grid" class="market-index-grid"></div>',
  '<div class="market-footer"><span>',icon('info'),'<span id="market-note">연결되지 않은 지표는 값을 표시하지 않습니다.</span></span><span>기준 시간 KST</span></div>',
  '</div><div id="market-watchlist-view" role="region" aria-label="관심종목"></div>',
  '</section>',
 ].join('');
}

function rankingToolbarMarkup(state,tabs){
 const kinds=[['turnover','거래대금 순위'],['volume','거래량 순위']];
 const kindTabs=kinds.map(([value,label])=>{
  const active=state.rankKind===value;
  return '<button class="tab '+(active?'active':'')+'" role="tab" aria-selected="'+active+'" data-action="rank-kind" data-value="'+value+'" tabindex="'+(active?0:-1)+'">'+label+'</button>';
 }).join('');
 return [
  '<div class="ranking-toolbar"><div class="tabs" role="tablist" aria-label="순위 종류">',kindTabs,'</div>',
  tabs('rank-market',[['all','전체'],['KR','국내'],['US','미국']],state.rankMarket),
  '</div>',
 ].join('');
}

function rankingPanelMarkup(state,tabs){
 return [
  '<section class="surface ranking-panel" id="ranking" aria-labelledby="ranking-title">',
  '<div class="panel-heading"><div class="title-group"><h2 id="ranking-title">종목 순위</h2><span class="top100">TOP 100</span></div>',
  '<button class="icon-button" data-action="refresh-ranking" aria-label="종목 순위 새로고침">',icon('refresh'),'</button></div>',
  rankingToolbarMarkup(state,tabs),
  '<div id="rank-description" class="rank-description">순위 데이터 확인 중</div>',
  '<div id="rank-scroll" class="rank-scroll" tabindex="0" role="region" aria-label="종목 순위 1위부터 100위까지 스크롤">',
  '<table class="ranking-table"><caption class="sr-only">종목 순위, 종목명과 티커, 현재가, 등락률, 거래대금</caption>',
  '<thead><tr><th scope="col" class="rank-cell">순위</th><th scope="col" class="name-cell">종목명 · 티커</th>',
  '<th scope="col" class="numeric">현재가</th><th scope="col" class="numeric">등락률</th><th scope="col" class="numeric amount-cell">거래대금 <span>↓</span></th></tr></thead>',
  '<tbody id="rank-body"></tbody></table><div id="rank-state"></div></div>',
  '<div class="panel-foot"><span id="rank-count">0개 종목</span><span id="rank-meta">갱신 이력 없음</span></div>',
  '</section>',
 ].join('');
}

function sectorPanelMarkup(tabs){
 return [
  '<section id="sectors" class="surface sector-panel" aria-labelledby="sector-title">',
  '<div class="panel-heading"><div class="title-group"><h2 id="sector-title">섹터맵</h2></div>',
  '<button class="icon-button" data-action="refresh-sectors" aria-label="섹터맵 새로고침">',icon('refresh'),'</button></div>',
  '<div class="sector-toolbar">',tabs('sector-market',[['KR','국내'],['US','미국']],'KR'),'<span>오늘 등락률</span></div>',
  '<div class="sector-scroll"><div id="sector-meta" class="sector-meta">코스피200 · WICS 분류 연결 필요</div>',
  '<div id="sector-map" class="sector-map" aria-label="섹터 시가총액 트리맵"></div><div id="sector-state"></div><div id="sector-excluded" class="excluded-note" hidden></div></div>',
  '<div class="map-legend"><span>하락</span><i class="legend-scale"></i><span>상승</span></div>',
  '<div class="sector-foot"><p>크기 = 시가총액 · 색상 = 당일 등락률</p><span id="sector-time">갱신 이력 없음</span></div>',
  '</section>',
 ].join('');
}

function dashboardFooterMarkup(){
 return '<footer class="dashboard-footer"><span>시세는 공급 상태와 이용 권한에 따라 표시됩니다.</span><button data-action="data-info">데이터 이용 안내 '+icon('chevron')+'</button></footer>';
}

function pageHostsMarkup(){
 return ['stock-page','calendar-page','reports-page','crypto-page','macro-page','screener-page']
  .map(id=>'<div id="'+id+'" hidden></div>').join('');
}

// Build only the existing page hosts. Data loading and event ownership stay
// with app.js and the modules mounted into these stable root IDs.
export function mountHomeLayout(root,{state,tabs}){
 root.innerHTML=[
  '<div id="dashboard">',
  pageHeadingMarkup(),marketPanelMarkup(state,tabs),
  '<section id="monthly-flow" class="surface monthly-flow" aria-label="이번 달 시장 흐름"></section>',
  '<div class="dashboard-bottom">',rankingPanelMarkup(state,tabs),sectorPanelMarkup(tabs),'</div>',
  dashboardFooterMarkup(),'</div>',pageHostsMarkup(),
 ].join('');

 const find=selector=>root.querySelector(selector),doc=root.ownerDocument;
 find('#market').after(find('#today-agenda'));

 const watchSurface=doc.createElement('section');
 watchSurface.className='surface watchlist-surface';
 watchSurface.setAttribute('aria-label','관심종목');
 watchSurface.append(find('#market-watchlist-view'));
 find('.dashboard-bottom').after(watchSurface);

 const grid=find('.dashboard-bottom');
 grid.insertBefore(Object.assign(doc.createElement('section'),{id:'stock-preview',className:'surface stock-preview-panel'}),find('#sectors'));
 grid.append(Object.assign(doc.createElement('section'),{id:'sector-ranking',className:'surface sector-ranking-panel'}));
}
