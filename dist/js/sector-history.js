import {summarizeSectorMonth} from './sector-month-model.js';
import {monthSummaryMarkup,monthSectorMarkup} from './sector-month-view.js';
import {icon,escapeHtml as esc} from './components.js';
import {historyDetailMarkup} from './sector-history-detail.js';
import {kstDate} from './calendar-model.js';
import {monthCells,monthShift,monthLabel} from './sector-history-model.js';
import {sectorMark,sectorSymbol} from './sector-symbols.js';
import {requestChannel,setHTML,setText} from './market-client.js';
export function mountSectorHistory(root,initial){
 const state={...initial,month:kstDate().slice(0,7),data:null,selected:null,selectedSector:null,summarySector:null,summary:null,recording:null,basis:'reconstructed'};let opener,refreshTimer;
 root.className='surface sector-history-card';root.id='sector-history-card';root.setAttribute('aria-labelledby','sector-history-title');
 root.innerHTML='<div class="panel-heading"><div class="title-group">'+icon('calendar')+'<h2 id="sector-history-title">섹터 캘린더</h2></div><button class="icon-button" data-history-action="refresh" aria-label="섹터 기록 새로고침">'+icon('refresh')+'</button></div><div class="history-month"><button class="icon-button previous-month" data-history-action="previous" aria-label="이전 달">'+icon('chevron')+'</button><strong></strong><button class="icon-button" data-history-action="next" aria-label="다음 달">'+icon('chevron')+'</button><button class="history-today" data-history-action="today">이번 달</button></div><p class="history-universe"></p><div class="history-jump"><label>기록 월 <input type="month" aria-label="섹터 기록 월 선택"></label><button data-history-action="first">처음 기록</button></div><p class="history-range"></p><div class="history-half-legend"><span>위 <b>강한 섹터 3</b></span><span>아래 <b>약한 섹터 3</b></span></div><div class="history-weekdays" aria-hidden="true">'+['일','월','화','수','목','금','토'].map(d=>'<span>'+d+'</span>').join('')+'</div><div class="history-days" aria-label="섹터 강약 기록 달력"></div><p class="history-message" role="status"></p><section class="history-month-summary" aria-label="월간 섹터 강약 요약"></section><details class="history-symbol-guide"><summary>섹터 기호 안내</summary><div class="history-symbol-list"></div><p>색과 기호는 섹터를 구분합니다.</p></details><details class="history-method"><summary>기록 기준</summary><div class="history-method-copy"></div></details>';
 const dialog=document.createElement('dialog');dialog.className='content-dialog sector-history-dialog';dialog.id='sector-history-dialog';dialog.setAttribute('aria-labelledby','history-detail-title');document.body.append(dialog);
 function close(){dialog.close();document.body.classList.remove('modal-open');opener?.isConnected&&opener.focus();}
 function detail(){
  if(state.summarySector&&!state.selected){setHTML(dialog,monthSectorMarkup(state.summary,state.summarySector));return;}
  const record=state.data?.items?.find(x=>x.day===state.selected);
  const markup=historyDetailMarkup(record,state.selected,state.selectedSector,state.basis);
  setHTML(dialog,state.summarySector?markup.replace('<div class="history-detail-body">','<div class="history-detail-body"><button class="history-detail-back" data-history-action="month-back">'+icon('chevron')+' 월간 흐름으로</button>'):markup);
 }
 function dayMarkup(day,records){
  if(!day)return '<span class="history-day-spacer"></span>';
  const record=records.get(day),today=kstDate(),number=Number(day.slice(-2));
  const marks=side=>record?record[side].map(id=>{const s=record.sectors.find(x=>x.id===id);return s?sectorMark(s):'';}).join(''):'<span class="history-no-record">—</span>';
  const describe=side=>record?.[side].map(id=>sectorSymbol(record.sectors.find(x=>x.id===id)).label).join(', ');
  return '<button class="history-day '+(day===today?'is-today ':'')+(record?'has-record'+(record.missingCount?' has-partial-record':''):'')+'" data-history-action="day" data-day="'+day+'" '+(day>today?'disabled':'')+' aria-label="'+day+(record?(record.missingCount?' 일부 일봉 누락 · ':' ')+'강한 섹터 '+esc(describe('strong'))+' / 약한 섹터 '+esc(describe('weak')):' 기록 없음')+'"><span class="history-day-number">'+number+'</span><span class="history-half strong-half">'+marks('strong')+'</span><span class="history-half weak-half">'+marks('weak')+'</span></button>';
 }
 function render(){
  setText(root.querySelector('.history-month strong'),monthLabel(state.month));
  root.querySelector('[data-history-action="next"]').disabled=state.month>=kstDate().slice(0,7);
  const data=state.data,items=data?.items||[],records=new Map(items.map(r=>[r.day,r]));
  const reconstructed=state.basis==='reconstructed';
  const monthInput=root.querySelector('.history-jump input');monthInput.value=state.month;monthInput.max=kstDate().slice(0,7);
  const range=data?.range;root.querySelector('[data-history-action="first"]').hidden=!range?.first_day;
  setText(root.querySelector('.history-range'),reconstructed?(range?.days?range.first_day+' ~ '+range.last_day+' · '+range.days+'거래일 저장':'실제 일봉이 확인된 거래일만 기록합니다.'):'실제로 조회한 날짜의 마지막 관측값입니다.');
  setHTML(root.querySelector('.history-method-copy'),reconstructed?'<p>현재 구성종목과 현재 섹터 분류에 과거 일봉을 적용한 재계산입니다. '+(state.market==='KR'?'공공데이터에서 제공한 일간 등락률을':'종가 등락률을')+' 동일 비중으로 평균 내며 과거 당시의 지수나 공식 섹터지수가 아닙니다.</p><p>'+(state.market==='KR'?'한국':'미국')+' 거래일 기준입니다. 상장 전·일봉 누락 종목은 제외하고 날짜별 포함 수를 표시합니다. 과거 편입·편출은 반영하지 않으며, 제공 종가의 가격 조정 방식은 미확인입니다. 배당 포함 총수익률이 아닙니다.</p>':'<p>관측 당시 종목 시가총액으로 가중한 등락률입니다. 상위·하위는 상대 순위이며 공식 섹터지수가 아닙니다.</p><p>한국시간으로 관측한 날짜에 저장합니다. 시세 기준시각이 없는 데이터는 거래소 거래일 수익률로 확정하지 않습니다. '+(data?.automatic?'로컬 서버 실행 중 5분마다 갱신합니다.':'화면 조회 시 저장합니다.')+' 기록이 없는 날짜는 비워 둡니다.</p>');
  const universe={SP500:'S&P 500',NASDAQ100:'나스닥100',DOW30:'다우30',KOSPI200:'코스피200',KOSDAQ150:'코스닥150'}[state.indexId];
  setText(root.querySelector('.history-universe'),(state.market==='US'?'미국':'한국')+' · '+universe+(reconstructed?' · 현재 구성종목 기준 · '+(state.market==='KR'?'한국':'미국')+' 거래일':' · 관측일 KST'));
  setHTML(root.querySelector('.history-days'),monthCells(state.month).map(d=>dayMarkup(d,records)).join(''));
  const message=data?.job?.status==='running'?data.job.message+' · 완료되면 자동으로 표시합니다.':data?.job?.status==='error'?data.job.message:!data?'기록을 불러오는 중…':data.stale?'기록 갱신 실패 · 마지막 기록 표시':data.status==='error'||data.status==='restricted'?data.message:!reconstructed&&['error','incomplete','restricted'].includes(state.recording?.status)?state.recording.message:items.length?(items.some(r=>r.missingCount)?'점선 날짜는 일부 일봉이 누락되어 있습니다. 날짜를 눌러 포함 종목 수를 확인하세요.':'날짜를 누르면 전체 섹터 순위를 볼 수 있어요.'):data.message||'아직 이 달에 저장된 기록이 없습니다.';
  setText(root.querySelector('.history-message'),message);root.setAttribute('aria-busy',String(!data));
  state.summary=summarizeSectorMonth(items,{month:state.month,market:state.market,indexId:state.indexId,basis:state.basis,today:kstDate()});
  setHTML(root.querySelector('.history-month-summary'),monthSummaryMarkup(state.summary,{loading:!data,error:!!data&&['error','restricted','disconnected'].includes(data.status),stale:data?.stale===true}));
  const sectors=[...new Map(items.flatMap(r=>r.sectors).map(s=>[s.id,s])).values()];
  setHTML(root.querySelector('.history-symbol-list'),sectors.length?sectors.map(s=>'<span>'+sectorMark(s)+esc(sectorSymbol(s).label)+'</span>').join(''):'<span>첫 기록을 저장하면 기호를 볼 수 있어요.</span>');
  if(dialog.open)detail();
 }
 function refresh(clear=false,recording){
  clearTimeout(refreshTimer);if(clear)state.data=null;if(recording?.market===state.market&&recording?.indexId===state.indexId)state.recording=recording;
  requestChannel('sector-history','/api/sector-history?market='+state.market+'&indexId='+state.indexId+'&month='+state.month+'&basis='+state.basis,render,data=>{state.data=data.status==='error'&&state.data?.items?.length?{...state.data,stale:true}:data;render();if(data.job?.status==='running')refreshTimer=setTimeout(()=>refresh(),15000);});
 }
 function select(market,indexId){if(!['KR','US'].includes(market))return;if(dialog.open)close();state.basis='reconstructed';state.market=market;state.indexId=indexId;state.selected=null;state.selectedSector=null;state.summarySector=null;state.recording=null;refresh(true);}
 function handle(e){const button=e.target.closest('[data-history-action]');if(!button)return;const action=button.dataset.historyAction;
  if(action==='close')close();
  else if(action==='month-sector'){if(state.summary?.status!=='ready')return;state.summarySector=button.dataset.sector;state.selected=null;state.selectedSector=null;opener=button;detail();dialog.showModal();document.body.classList.add('modal-open');}
  else if(action==='month-day'){state.selected=button.dataset.day;state.selectedSector=state.summarySector;detail();dialog.scrollTop=0;dialog.querySelector('[data-history-action="month-back"]')?.focus();}
  else if(action==='month-back'){state.selected=null;state.selectedSector=null;detail();dialog.scrollTop=0;}
  else if(action==='day'){if(!state.data||['error','restricted'].includes(state.data.status))return;state.summarySector=null;state.selected=button.dataset.day;state.selectedSector=null;opener=button;detail();dialog.showModal();document.body.classList.add('modal-open');}
  else if(action==='sector'){state.selectedSector=button.dataset.sector;detail();dialog.scrollTop=0;dialog.querySelector('.history-detail-back')?.focus();}
  else if(action==='sectors'){const previous=state.selectedSector;state.selectedSector=null;detail();[...dialog.querySelectorAll('[data-sector]')].find(b=>b.dataset.sector===previous)?.focus();}
  else if(action==='stock'){const record=state.data?.items?.find(x=>x.day===state.selected),stock=record?.sectors.find(s=>s.id===state.selectedSector)?.stocks?.find(s=>s.id===button.dataset.stock);if(stock&&initial.navigate){close();initial.navigate('/stock/'+stock.market+'/'+encodeURIComponent(stock.id));}}
  else if(action==='refresh')refresh();
  else if(action==='first'&&state.data?.range?.first_day){state.month=state.data.range.first_day.slice(0,7);refresh(true);}
  else if(['previous','next','today'].includes(action)){state.month=action==='today'?kstDate().slice(0,7):monthShift(state.month,action==='previous'?-1:1);refresh(true);}
 }
 root.querySelector('.history-jump input').addEventListener('change',e=>{if(/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)&&e.target.value<=kstDate().slice(0,7)){state.month=e.target.value;refresh(true);}});
 root.addEventListener('click',handle);dialog.addEventListener('click',handle);dialog.addEventListener('close',()=>document.body.classList.remove('modal-open'));
 refresh();return {select,refresh};
}
