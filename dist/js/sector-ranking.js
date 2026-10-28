import {escapeHtml as esc,icon} from './components.js';
import {percentage,time,modeLabels} from './data.js';
import {sectorMark,sectorSymbol} from './sector-symbols.js';
import {reconcile} from './market-client.js';
export function sectorRankingRows(feed){
 if(feed?.analysis==='monthly')return (feed.items||[]).map(s=>({...s,changePct:s.median,total:s.used}));
 return (feed?.items||[]).map(sector=>{
  const seen=new Set(),all=(sector.stocks||[]).filter(s=>{const key=s.market+':'+s.id;if(seen.has(key))return false;seen.add(key);return true;});
  const stocks=all.filter(s=>s.quoteAvailable!==false&&Number.isFinite(s.marketCap)&&s.marketCap>0&&Number.isFinite(s.changePct));
  const cap=stocks.reduce((sum,s)=>sum+s.marketCap,0);
  return {...sector,changePct:cap?stocks.reduce((sum,s)=>sum+s.changePct*(s.marketCap/cap),0):null,used:stocks.length,total:all.length};
 });
}
export function mountSectorRanking(root,{onSelect}){
 let feed=null,selection={},sort='desc',chosen=null,context='';
 root.innerHTML=`<div class="panel-heading"><div class="title-group"><h2>섹터 등락률 순위</h2></div></div><div class="sector-ranking-controls"><span class="sector-ranking-universe"></span><select aria-label="섹터 등락률 정렬"><option value="desc">상승률순</option><option value="asc">하락률순</option></select></div><p class="sector-ranking-time"></p><ol class="sector-ranking-list"></ol><div class="sector-ranking-state" role="status"></div><div class="panel-foot"><span>구성종목 시가총액 가중 평균<br>공식 섹터지수 등락률이 아닙니다.</span></div>`;
 function render(){
  const rows=sectorRankingRows(feed).sort((a,b)=>Number.isFinite(a.changePct)&&Number.isFinite(b.changePct)?(sort==='asc'?a.changePct-b.changePct:b.changePct-a.changePct):Number.isFinite(a.changePct)?-1:Number.isFinite(b.changePct)?1:0);
  root.querySelector('.sector-ranking-universe').textContent=(selection.market==='KR'?'국내':'미국')+' · '+(feed?.universe||selection.indexId||'');
  root.querySelector('.panel-foot span').textContent=feed?.analysis==='monthly'?'선택 종목의 월 수익률 중간값 · 공식 섹터지수 아님':'구성종목 시가총액 가중 평균 · 공식 섹터지수 아님';
  root.querySelector('h2').textContent=feed?.analysis==='monthly'?'섹터 월간 중간값 순위':'섹터 등락률 순위';
  root.querySelector('.sector-ranking-time').textContent=feed?.analysis==='monthly'?(feed.startDate||'—')+' → '+(feed.baseDate||'—')+' · '+(feed.stale?'마지막 저장 집계':'종가 기준'):feed?.baseDate?'전일 기준 · '+feed.baseDate+(feed.stale?' · 마지막 저장값':''):feed?.asOf?(modeLabels[feed.mode]||'제공 시세')+' · '+(feed.asOfKind==='received'?'조회 ':'기준 ')+time(feed.asOf,true)+(feed.stale?' · 마지막 조회값':''):'기준 시각 확인 중';
  reconcile(root.querySelector('ol'),rows,s=>s.id,()=>{const li=document.createElement('li');li.innerHTML='<button></button>';li.firstChild.addEventListener('click',()=>{chosen=chosen===li.dataset.key?null:li.dataset.key;onSelect(chosen);render();});return li;},(li,s)=>{const button=li.firstChild;button.setAttribute('aria-pressed',String(chosen===s.id));button.innerHTML='<span class="sector-rank-number">'+(rows.indexOf(s)+1)+'</span>'+sectorMark(s)+'<span class="sector-rank-name"><strong>'+esc(sectorSymbol(s).label)+'</strong><small>'+esc(s.name)+' · '+s.used+'/'+s.total+'개</small></span><b class="'+(s.changePct>0?'up':s.changePct<0?'negative':'neutral-text')+'">'+percentage(s.changePct)+'</b>';button.title='맵에서 '+s.name+' 강조'+(s.used<s.total?' · 시세가 확인되는 종목만 집계':'');});
  const status=root.querySelector('.sector-ranking-state');status.hidden=rows.length>0;status.textContent=!feed?'섹터 데이터를 불러오고 있어요':feed.status==='error'?'섹터 데이터를 불러오지 못했습니다.':feed.message||'표시할 섹터 데이터가 없습니다.';
 }
 root.querySelector('select').addEventListener('change',e=>{sort=e.target.value;render();});
 return {update(next,current){feed=next;selection=current;const key=current.market+':'+current.indexId;if(context!==key){context=key;chosen=null;}render();}};
}
