import {mountSectorResearch} from './sector-research.js';
import {industryHierarchy} from './market-hierarchy.js';
import {mountSectorHistory} from './sector-history.js';
import {icon,escapeHtml as esc} from './components.js';
import {percentage,price,time,modeLabels} from './data.js';
import {requestChannel,reconcile,setText,setHTML} from './market-client.js';
import {treemapLayout} from './treemap.js';
export const universes={KR:[['KOSPI200','코스피200'],['KOSDAQ150','코스닥150']],US:[['SP500','S&P 500'],['NASDAQ100','나스닥100'],['DOW30','다우30']]};
const $=(s,root=document)=>root.querySelector(s);
function infoState(status,message){return '<div class="data-state '+status+'" role="'+(status==='error'?'alert':'status')+'"><div class="state-icon">'+icon(status==='loading'?'refresh':status==='error'?'alert':'grid')+'</div><strong>'+(status==='loading'?'구성종목을 확인하고 있어요':status==='error'?'데이터 연결 오류':status==='restricted'?'데이터 이용 권한 확인 필요':'데이터 연결 필요')+'</strong><p>'+esc(message||'구성종목·섹터 분류·시가총액·가격 연결 후 종목 타일을 표시합니다.')+'</p>'+(status==='loading'?'<div class="loading-bars"><i></i><i></i><i></i></div>':'<button class="secondary-button" data-map-action="refresh">'+icon('refresh')+' 다시 확인</button>')+'</div>';}
function colorClass(s){if(s.quoteAvailable===false||!Number.isFinite(s.changePct))return 'unpriced';return (s.changePct>0?'positive':s.changePct<0?'negative-tile':'neutral')+' level-'+Math.min(5,Math.max(1,Math.ceil(Math.abs(s.changePct))));}
function drawHierarchy(parent,sectors,{onSector,onIndustry,onStock,onPreview,onPreviewLeave,zoom=false}){
 const bounds=parent.getBoundingClientRect(),aspect=bounds.width/Math.max(1,bounds.height),full=!!parent.closest('.full-map-body');
 const boxes=zoom?sectors.map(s=>({...s,x:0,y:0,w:100,h:100})):treemapLayout(sectors,0,0,100,100,aspect);
 const position=(el,node)=>{el.style.left=node.x+'%';el.style.top=node.y+'%';el.style.width=node.w+'%';el.style.height=node.h+'%';};
 reconcile(parent,boxes,s=>s.id,()=>{
  const section=document.createElement('div');section.className='map-sector';section.innerHTML='<button class="map-sector-heading"></button><div class="map-sector-industries"></div>';
  section.querySelector('.map-sector-heading').addEventListener('click',()=>onSector(section.dataset.key));
  section.addEventListener('pointerenter',e=>onPreview(section,e));section.addEventListener('pointermove',e=>onPreview(section,e));section.addEventListener('pointerleave',onPreviewLeave);
  section.addEventListener('focusin',e=>{if(e.target.matches(':focus-visible'))onPreview(section,e);});section.addEventListener('focusout',e=>{if(!section.contains(e.relatedTarget))onPreviewLeave(e);});return section;
 },(section,sector)=>{
  section._sector=sector;position(section,sector);const sw=bounds.width*sector.w/100,sh=bounds.height*sector.h/100,sectorHeader=Math.min(sector.used!==undefined?44:full?28:20,sh*.25);
  section.style.setProperty('--sector-title-height',sectorHeader+'px');section.classList.toggle('tiny-sector-title',sectorHeader<12);
  const heading=section.querySelector('.map-sector-heading');setText(heading,sector.name+(sector.used!==undefined?' · ↑ '+sector.upRatio.toFixed(0)+'% · 중간 '+percentage(sector.median)+' · '+sector.used+'개':''));heading.title=heading.textContent+' 섹터 확대';heading.setAttribute('aria-label',sector.name+' 섹터 확대');
  const industryBoxes=treemapLayout(sector.industries,0,0,100,100,Math.max(1,sw-4)/Math.max(1,sh-sectorHeader-4));
  reconcile(section.querySelector('.map-sector-industries'),industryBoxes,industry=>industry.id,()=>{
   const region=document.createElement('div');region.className='map-industry';region.innerHTML='<button class="map-industry-heading"></button><div class="map-industry-stocks"></div>';
   region.querySelector('.map-industry-heading').addEventListener('click',()=>onIndustry(section.dataset.key,region.dataset.key));return region;
  },(region,industry)=>{
   region._industry=industry;position(region,industry);const iw=(sw-4)*industry.w/100,ih=(sh-sectorHeader-4)*industry.h/100,header=Math.max(0,Math.min(full?20:15,ih*.22));
   region.style.setProperty('--industry-title-height',header+'px');region.classList.toggle('tiny-industry-title',header<11||iw<38);
   const title=region.querySelector('.map-industry-heading');setText(title,industry.name);title.title=industry.name+' 산업 확대'+(industry.missing?' · Industry 미제공':'');title.setAttribute('aria-label',sector.name+' / '+industry.name+' 산업 확대');
   reconcile(region.querySelector('.map-industry-stocks'),treemapLayout(industry.stocks,0,0,100,100,Math.max(1,iw-2)/Math.max(1,ih-header-2)),s=>s.market+':'+s.id,()=>{
    const tile=document.createElement('button');tile.className='map-tile';tile.innerHTML='<strong></strong><small class="map-company-name"></small><span></span>';tile.addEventListener('click',()=>onStock(tile._stock));return tile;
   },(tile,stock)=>{
    tile._stock=stock;position(tile,stock);tile.className='map-tile '+colorClass(stock);
    setText(tile.querySelector('strong'),stock.market==='US'?stock.ticker:stock.name);setText(tile.querySelector('.map-company-name'),stock.market==='US'&&stock.name!==stock.ticker?stock.name:'');setText(tile.querySelector('span'),percentage(stock.changePct));tile.setAttribute('aria-label',stock.name+' '+stock.ticker+' '+(Number.isFinite(stock.changePct)?percentage(stock.changePct):'가격 데이터 없음')+' 종목 상세로 이동');
   });
  });
 });
 requestAnimationFrame(()=>measureLabels(parent));
}
function measureLabels(parent){
 const full=!!parent.closest('.full-map-body')||parent.clientWidth>=600;
 const tiles=[...parent.querySelectorAll('.map-tile')].map(tile=>({tile,width:tile.clientWidth,height:tile.clientHeight}));
 // Use readable type sizes for large / medium / compact tiles. Measure the ticker
 // first, so a second line of percentage text never displaces a name that fits.
 tiles.forEach(({tile,width,height})=>{
  const large=width>=88&&height>=58,medium=width>=54&&height>=34;
  tile.style.setProperty('--map-name-size',(large?(full?18:13):medium?(full?14:12):11)+'px');
  tile.style.setProperty('--map-change-size',(large&&full?14:11)+'px');
  tile.classList.remove('label-hidden','name-hidden','change-hidden');
  tile.classList.toggle('company-visible',width>=96&&height>=68&&!!tile.querySelector('.map-company-name').textContent);
 });
 const visibility=tiles.map(({tile,width,height})=>{
  const name=tile.querySelector('strong'),change=tile.querySelector('span'),availableWidth=width-4,availableHeight=height-4;
  const nameFits=width>=22&&name.scrollWidth<=availableWidth&&name.offsetHeight<=availableHeight;
  const changeFits=nameFits&&change.scrollWidth<=availableWidth&&name.offsetHeight+change.offsetHeight+2<=availableHeight;
  const company=tile.querySelector('.map-company-name');
  const companyFits=nameFits&&tile.classList.contains('company-visible')&&name.offsetHeight+company.offsetHeight+(changeFits?change.offsetHeight:0)+4<=availableHeight;
  return {tile,nameFits,changeFits,companyFits};
 });
 visibility.forEach(({tile,nameFits,changeFits,companyFits})=>{
  tile.classList.toggle('company-visible',companyFits);
  tile.classList.toggle('label-hidden',!nameFits);
  tile.classList.toggle('name-hidden',!nameFits);
  tile.classList.toggle('change-hidden',!changeFits);
 });
}
export function mountSectorMap(root,{navigate,onData,onSelection,initialMarket='KR',initialIndex,showHistory=true,onRefresh}){
 let pendingSector=null,dataEpoch=0;const state={market:initialMarket,indexId:initialIndex||universes[initialMarket][0][0],data:null,zoom:null,highlight:null};let opener,resizeFrame;
 const historyRoot=showHistory?document.createElement('section'):null;if(historyRoot)root.after(historyRoot);const history=historyRoot?mountSectorHistory(historyRoot,{market:state.market,indexId:state.indexId,navigate}):{select(){},refresh(){}};
 root.innerHTML='<div class="panel-heading"><div class="title-group"><h2 id="sector-title">섹터맵</h2></div><button class="map-expand-button" data-map-action="expand" aria-label="섹터맵 전체화면 확대">'+icon('grid')+' 확대</button></div><div class="sector-toolbar"><div class="map-market-controls"></div><span class="today-label">오늘 등락률</span></div><div class="map-index-controls"></div><div class="sector-scroll"><div class="sector-meta map-meta"></div><div class="hierarchy-map" aria-label="섹터·산업·종목 중첩 트리맵"></div><div class="map-state"></div><div class="excluded-note" hidden></div></div><div class="map-legend"><span class="negative">− 하락</span><i class="legend-scale"></i><span class="up">+ 상승</span><span class="unknown-legend">결측</span></div><div class="sector-foot"><p>섹터 → 산업 → 종목 · 크기 = 시가총액</p><span class="map-time">갱신 이력 없음</span></div>';
 const dialog=document.createElement('dialog');dialog.className='fullscreen-map-dialog';dialog.id='map-dialog';dialog.setAttribute('aria-labelledby','map-dialog-title');dialog.innerHTML='<div class="full-map-header"><div><div class="eyebrow">MOA · SECTOR MAP</div><h2 id="map-dialog-title">시장 섹터맵</h2></div><div class="full-map-tools"><button class="icon-button" data-map-action="refresh" aria-label="섹터맵 새로고침">'+icon('refresh')+'</button><button class="close-map" data-map-action="close" aria-label="전체화면 닫기">'+icon('close')+'<span>닫기</span><kbd>Esc</kbd></button></div></div><div class="full-map-controls"><div class="map-market-controls"></div><div class="map-index-controls"></div><span class="today-label">오늘 등락률</span></div><div class="full-map-caption"><button class="map-back" data-map-action="back" hidden>'+icon('arrow')+' 전체 섹터</button><div><h3 class="zoom-title"></h3><p class="map-meta"></p></div><span class="map-time"></span></div><div class="full-map-body"><div class="hierarchy-map" aria-label="전체화면 계층형 종목 트리맵"></div><div class="map-state"></div></div><div class="full-map-footer"><p class="map-calculation">종목 타일 면적은 시가총액 비례 · 섹터 등락률은 별도로 계산하지 않습니다.</p><div class="map-legend"><span class="negative">− 하락</span><i class="legend-scale"></i><span class="up">+ 상승</span><span class="unknown-legend">결측</span></div><button class="constituent-info" data-map-action="constituents">구성종목 출처·변경 내역</button></div><div class="constituent-panel" hidden></div>';document.body.append(dialog);
 const detailRoot=document.createElement('aside');detailRoot.className='sector-research-panel';detailRoot.hidden=true;$('.full-map-body',dialog).append(detailRoot);const research=mountSectorResearch(detailRoot,{navigate,beforeNavigate:()=>close()});detailRoot.addEventListener('sector-detail-close',()=>$('.full-map-body',dialog).classList.remove('has-research'));
 const tooltip=document.createElement('aside');tooltip.id='map-small-stocks';tooltip.className='map-small-stocks';tooltip.setAttribute('aria-label','산업별 종목 보기');tooltip.hidden=true;document.body.append(tooltip);
 let previewRegion=null,previewStocks=new Map(),hideTimer,ignoreFocusPreview=false;
 tooltip.addEventListener('pointerenter',()=>clearTimeout(hideTimer));tooltip.addEventListener('pointerleave',scheduleHide);
 tooltip.addEventListener('focusin',()=>clearTimeout(hideTimer));tooltip.addEventListener('focusout',e=>{if(!tooltip.contains(e.relatedTarget))scheduleHide(e);});
 tooltip.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();dismissPreview();}});
 tooltip.addEventListener('click',e=>{if(e.target.closest('[data-small-close]')){dismissPreview();return;}const button=e.target.closest('[data-small-stock]'),stock=button&&previewStocks.get(button.dataset.smallStock);if(stock){hidePreview();if(dialog.open)close();navigate('/stock/'+stock.market+'/'+encodeURIComponent(stock.id));}});
 const observer=new ResizeObserver(()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>render());});observer.observe(root);observer.observe(dialog);observer.observe($('.hierarchy-map',dialog));
 function controls(surface){
  const basis=surface.querySelector('.today-label');if(basis)setText(basis,state.market==='KR'?'전일 기준 등락률':'오늘 등락률');
  setHTML($('.map-market-controls',surface),'<div class="segmented" role="tablist" aria-label="섹터맵 시장">'+[['KR','국내'],['US','미국']].map(([v,n])=>'<button role="tab" aria-selected="'+(state.market===v)+'" tabindex="'+(state.market===v?0:-1)+'" class="'+(state.market===v?'active':'')+'" data-map-action="market" data-value="'+v+'">'+n+'</button>').join('')+'</div>');
  setHTML($('.map-index-controls',surface),'<div class="index-pills" role="tablist" aria-label="구성종목 지수">'+universes[state.market].map(([v,n])=>'<button role="tab" aria-selected="'+(state.indexId===v)+'" tabindex="'+(state.indexId===v?0:-1)+'" class="'+(state.indexId===v?'active':'')+'" data-map-action="index" data-value="'+v+'">'+n+'</button>').join('')+'</div>');
 }
 function currentName(){return universes[state.market].find(x=>x[0]===state.indexId)?.[1]||'';}
 function showPreview(section,event){
  if((event?.type.startsWith('pointer')&&event.pointerType!=='mouse')||(!event?.type.startsWith('pointer')&&ignoreFocusPreview))return;
  if(event?.target.closest('.map-sector-heading,.map-industry-heading')){hidePreview();return;}
  clearTimeout(hideTimer);
  const region=event?.target.closest('.map-industry')||section,industry=region._industry;
  const hovered=event?.target.closest('.map-tile')?._stock;
  if(previewRegion===region&&!tooltip.hidden){highlightStock(hovered);return;}
  const stocks=[...(industry?.stocks||section._sector.stocks)].sort((a,b)=>b.marketCap-a.marketCap);
  if(!stocks.length){hidePreview();return;}
  hidePreview();previewRegion=region;region.classList.add('preview-active');previewStocks=new Map(stocks.map(stock=>[stock.market+':'+stock.id,stock]));
  const hiddenCount=region.querySelectorAll('.map-tile.name-hidden').length;
  if(tooltip.parentNode!==(dialog.open?dialog:document.body))(dialog.open?dialog:document.body).append(tooltip);
  setHTML(tooltip,'<div class="small-stocks-heading"><div><span class="preview-sector-name">'+esc(section._sector.name)+'</span><strong>'+esc(industry?.name||'전체 산업')+'</strong><span>'+stocks.length+'개 종목'+(hiddenCount?' · 작은 타일 '+hiddenCount+'개 포함':'')+'</span></div><button class="icon-button" data-small-close aria-label="종목 목록 닫기">'+icon('close')+'</button></div><div class="small-stocks-columns" aria-hidden="true"><span>종목</span><span>'+ (state.data?.analysis==='monthly'?'기준일 종가':'현재가')+'</span><span>'+ (state.data?.analysis==='monthly'?'월 누적':'등락률')+'</span></div><div class="small-stocks-scroll">'+stocks.map(stock=>{
   const available=stock.quoteAvailable!==false,change=available?stock.changePct:null,direction=Number.isFinite(change)?(change>0?'up':change<0?'negative':'neutral-text'):'neutral-text';
   return '<button class="small-stock-row" data-small-stock="'+esc(stock.market+':'+stock.id)+'" aria-label="'+esc(stock.name)+' 종목 상세로 이동"><span class="small-stock-name" title="'+esc(stock.name)+'"><strong>'+esc(stock.name)+'</strong></span><span class="small-stock-price">'+(available?price(stock):'—')+'</span><span class="small-stock-change '+direction+'">'+percentage(change)+'</span></button>';
  }).join('')+'</div><p class="small-stocks-hint">'+esc(modeLabels[state.data?.mode]||'연결된 시세')+' · 종목을 누르면 상세로 이동합니다.</p>');
  tooltip.hidden=false;highlightStock(hovered);
  const r=region.getBoundingClientRect(),width=tooltip.offsetWidth,height=tooltip.offsetHeight,gap=12;
  const right=innerWidth-r.right-gap,left=r.left-gap;
  const x=right>=width?r.right+gap:left>=width?r.left-width-gap:(event?.clientX??r.right)+18;
  const y=event?.clientY??r.top;
  tooltip.style.left=Math.max(8,Math.min(innerWidth-width-8,x))+'px';tooltip.style.top=Math.max(8,Math.min(innerHeight-height-8,y-24))+'px';
 }
 function highlightStock(stock){for(const row of tooltip.querySelectorAll('[data-small-stock]'))row.classList.toggle('is-hovered',!!stock&&row.dataset.smallStock===stock.market+':'+stock.id);}
 function scheduleHide(event){if(tooltip.contains(event?.relatedTarget)||previewRegion?.contains(event?.relatedTarget))return;clearTimeout(hideTimer);hideTimer=setTimeout(hidePreview,220);}
 function dismissPreview(){const heading=previewRegion?.querySelector('.map-industry-heading,.map-sector-heading');hidePreview();ignoreFocusPreview=true;heading?.focus();ignoreFocusPreview=false;}
 function hidePreview(){clearTimeout(hideTimer);tooltip.hidden=true;previewRegion?.classList.remove('preview-active');previewRegion=null;}
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!tooltip.hidden){e.preventDefault();e.stopPropagation();dismissPreview();}});
 function close(){research.select(null);$('.full-map-body',dialog).classList.remove('has-research');hidePreview();dialog.close();document.body.classList.remove('modal-open');if(opener?.isConnected)opener.focus();}
 function open(sector=null,industry=null){hidePreview();if(!dialog.open)opener=document.activeElement;state.zoom=sector?{sectorId:sector,industryId:industry}:null;if(!dialog.open)dialog.showModal();document.body.classList.add('modal-open');controls(dialog);render();updateResearch();}
 function render(){
  const preview=tooltip.hidden?null:{region:previewRegion,scroll:$('.small-stocks-scroll',tooltip)?.scrollTop||0,left:tooltip.style.left,top:tooltip.style.top,full:dialog.open};
  hidePreview();
  const data=state.data,status=data?.status||'loading',items=industryHierarchy(data?.items||[]),name=currentName(),ready=items.length>0;
  for(const surface of [root,...(dialog.open?[dialog]:[])]){
   const full=surface===dialog,map=$('.hierarchy-map',surface),selection=full&&state.zoom?items.filter(s=>s.id===state.zoom.sectorId).map(s=>state.zoom.industryId?{...s,industries:s.industries.filter(i=>i.id===state.zoom.industryId)}:s):items;
   map.hidden=!ready;setHTML($('.map-state',surface),ready?'':infoState(status,data?.message));
   if(ready)drawHierarchy(map,selection,{zoom:full&&!!state.zoom,onSector:id=>open(id),onIndustry:(sector,industry)=>open(sector,industry),onStock:s=>{hidePreview();if(dialog.open)close();navigate('/stock/'+s.market+'/'+encodeURIComponent(s.id)+(state.data?.analysis==='monthly'?'?chartDate='+state.data.baseDate:''));},onPreview:showPreview,onPreviewLeave:scheduleHide});else map.replaceChildren();
   for(const node of map.querySelectorAll('.map-sector'))node.classList.toggle('rank-highlighted',node.dataset.key===state.highlight);
   for(const label of surface.querySelectorAll('.today-label'))setText(label,data?.analysis==='monthly'?Number(data.month.slice(5))+'월 누적 등락률':state.market==='KR'?'전일 기준 등락률':'오늘 등락률');
   const member=data?.constituents;setText($('.map-meta',surface),name+(member?' · '+member.total+'개 구성종목 · '+member.version:' · 구성종목 출처 확인 필요'));
   setText($('.map-time',surface),(data?.stale?'갱신 오류 · 마지막 ':'')+(data?.asOf?(modeLabels[data.mode]||'')+' · '+(data.asOfKind==='received'?'조회 ':'')+(data.asOfKind==='date'?data.asOf:time(data.asOf,true))+(data.session==='closed'?' · 장 마감':''):'갱신 이력 없음'));
  }
  if(data?.analysis==='monthly'){for(const surface of [root,dialog]){setText($('.map-time',surface),(data.startDate||'—')+' → '+(data.baseDate||'—')+' · '+(state.market==='KR'?'한국':'미국')+' 거래일'+(data.stale?' · 마지막 저장 집계':''));setText($('.map-meta',surface),name+' · 집계 '+(data.filteredCount??data.summary?.used??0)+' / 대상 '+(data.target??0)+'개');}setText($('.sector-foot p',root),data.areaNote||'');setText($('.map-calculation',dialog),data.calculation||'');}else setText($('.sector-foot p',root),'섹터 → 산업 → 종목 · 크기 = 시가총액');
  const excluded=$('.excluded-note',root);excluded.hidden=!data?.excluded?.length;setText(excluded,data?.excluded?.length?data.excluded.length+'개 종목 제외 · '+(data.analysis==='monthly'?'기준일 가격·분류·조정 검증 누락':'분류 또는 시가총액 누락'):'');
  if(dialog.open){$('.map-back',dialog).hidden=!state.zoom;setText($('.zoom-title',dialog),state.zoom?((items.find(s=>s.id===state.zoom.sectorId)?.name||'섹터 데이터 없음')+(state.zoom.industryId?' › '+(items.find(s=>s.id===state.zoom.sectorId)?.industries.find(i=>i.id===state.zoom.industryId)?.name||'산업 데이터 없음'):'')):name+' 전체 섹터');}
  // A normal quote refresh should not close a list the user is reading.
  if(preview)requestAnimationFrame(()=>{if(preview.region?.isConnected&&preview.full===dialog.open&&!previewRegion){showPreview(preview.region.closest('.map-sector'),{type:'refresh',target:preview.region});const scroll=$('.small-stocks-scroll',tooltip);if(scroll)scroll.scrollTop=preview.scroll;tooltip.style.left=Math.max(8,Math.min(innerWidth-tooltip.offsetWidth-8,parseFloat(preview.left)||8))+'px';tooltip.style.top=Math.max(8,Math.min(innerHeight-tooltip.offsetHeight-8,parseFloat(preview.top)||8))+'px';}});
 }

 function updateResearch(){const sector=industryHierarchy(state.data?.items||[]).find(s=>s.id===state.zoom?.sectorId);$('.full-map-body',dialog).classList.toggle('has-research',Boolean(dialog.open&&sector));research.select(dialog.open&&sector?{market:state.market,sector,feed:state.data}:null);}
 function resolvePendingSector(){if(!pendingSector||!state.data||state.data.status==='loading')return;const sector=state.data.items?.find(s=>s.name===pendingSector||s.id===pendingSector);pendingSector=null;open(sector?.id||null);}
 function openNamed(market,name){if(!['US','KR'].includes(market))return;pendingSector=name;if(state.market!==market){state.market=market;state.indexId=universes[market][0][0];controls(root);controls(dialog);history.select(state.market,state.indexId);refresh(true);}else if(state.data&&state.data.status!=='loading')resolvePendingSector();else refresh();}
 function refresh(clear=false){if(onRefresh?.(state,clear))return;const requestEpoch=++dataEpoch;if(clear){state.data=null;state.zoom=null;state.highlight=null;onData?.(null,{market:state.market,indexId:state.indexId});updateResearch();hidePreview();}requestChannel('hierarchical-map','/api/sectors?market='+state.market+'&indexId='+state.indexId,()=>{if(!state.data)render();},data=>{if(requestEpoch!==dataEpoch)return;if(data.status==='error'&&state.data?.status==='ready')state.data={...state.data,stale:true};else state.data=data;onData?.(state.data,{market:state.market,indexId:state.indexId});history.refresh(false,{...data.historyRecording,market:state.market,indexId:state.indexId});render();if(pendingSector){const found=state.data?.items?.find(s=>s.name===pendingSector||s.id===pendingSector);pendingSector=null;open(found?.id||null);}else if(dialog.open)updateResearch();});}
 function showConstituents(){const panel=$('.constituent-panel',dialog);panel.hidden=!panel.hidden;if(panel.hidden)return;const d=state.data,c=d?.constituents;setHTML(panel,c?'<strong>구성종목 출처: '+esc(c.source)+'</strong><p>버전 '+esc(c.version)+' · '+(c.effectiveAt?'적용일 '+time(c.effectiveAt,true):'공식 적용일 미제공 · 확인 '+time(c.observedAt,true))+' · '+c.total+'개 종목</p><p>변경 내역: '+(c.changes.length?c.changes.map(x=>esc(typeof x==='string'?x:JSON.stringify(x))).join(' / '):'공급된 변경 내역 없음')+'</p><p>제외: '+(d.excluded?.length?d.excluded.map(x=>esc(x.name+' ('+x.reason+')')).join(', '):'없음')+'</p>':'<strong>구성종목 출처 확인 필요</strong><p>'+esc(d?.message||'구성종목 데이터 연결 필요')+'</p>');}
 function handle(e){const b=e.target.closest('[data-map-action]');if(b){const action=b.dataset.mapAction;if(action==='expand')open();else if(action==='close')close();else if(action==='back'){state.zoom=null;render();updateResearch();}else if(action==='refresh')refresh();else if(action==='constituents')showConstituents();else if(action==='market'||action==='index'){if(action==='market'){state.market=b.dataset.value;state.indexId=universes[state.market][0][0];}else state.indexId=b.dataset.value;onSelection?.(state);history.select(state.market,state.indexId);controls(root);controls(dialog);refresh(true);const surface=dialog.open?dialog:root;surface.querySelector('[data-map-action="'+action+'"][data-value="'+(action==='market'?state.market:state.indexId)+'"]')?.focus();}}
  else if(!dialog.open&&(e.target.closest('.sector-scroll')&&!e.target.closest('.map-tile,.map-sector-heading,.map-industry-heading')))open();
 }
 function keys(e){if(!e.target.matches('[role="tab"]')||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.stopPropagation();e.preventDefault();const list=[...e.target.closest('[role="tablist"]').querySelectorAll('[role="tab"]')],i=list.indexOf(e.target),next=e.key==='Home'?0:e.key==='End'?list.length-1:(i+(e.key==='ArrowRight'?1:-1)+list.length)%list.length;list[next].click();}
 root.addEventListener('click',handle);dialog.addEventListener('click',handle);root.addEventListener('keydown',keys);dialog.addEventListener('keydown',keys);dialog.addEventListener('close',()=>{research.select(null);$('.full-map-body',dialog).classList.remove('has-research');hidePreview();document.body.classList.remove('modal-open');});
 controls(root);controls(dialog);render();
 // Explicit snapshots (for example monthly data) own the view immediately;
 // a daily response started before them must not overwrite data or metadata.
 return {refresh,open,openNamed,setData(data,selection){++dataEpoch;const changed=state.market!==selection.market||state.indexId!==selection.indexId;Object.assign(state,selection,{data});if(changed){state.zoom=null;state.highlight=null;}controls(root);controls(dialog);onData?.(data,selection);render();resolvePendingSector();if(dialog.open)updateResearch();},highlight(id){state.highlight=id;for(const surface of [root,dialog])for(const node of surface.querySelectorAll('.map-sector'))node.classList.toggle('rank-highlighted',node.dataset.key===id);},getState:()=>state};
}
