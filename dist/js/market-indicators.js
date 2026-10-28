import {indexDefinitions,futuresDefinitions,modeLabels,time,dailyQuoteMeta} from './data.js';
import {escapeHtml as esc} from './components.js';
export function indexEmptyMarkup(feed){
 if(!feed)return '연결 확인 중…';
 if(feed.source==='FMP')return '<strong>FMP · 데이터 연결 필요</strong><span>'+esc(feed.message||'지수 조회 상태 확인 필요')+'</span>';
 if(feed.source==='Twelve Data'){
  const title=feed.status==='error'?'Twelve Data 조회 오류':feed.status==='restricted'?'Twelve Data 표시 권한 확인 필요':'Twelve Data · 현물지수 미확인';
  return '<strong>'+title+'</strong><span>'+(feed.status==='incomplete'?'키 등록됨 · 확인된 미국 현물지수 응답 없음':esc(feed.message))+'</span>'+(feed.checks?.length?'<details class="index-connection-checks"><summary>지수별 확인 결과</summary><ul>'+feed.checks.map(c=>'<li><b>'+esc(c.name)+'</b><span>'+esc(c.message||'확인 필요')+'</span></li>').join('')+'</ul></details>':'');
 }
 return feed.status==='error'?'현물지수 조회에 실패했습니다.':feed.status==='restricted'?'현물지수 표시 권한 확인 필요':'<strong>조회 가능한 현물지수가 없습니다</strong><span>SPX · COMP · NDX · DJI</span><small>별도 현물지수 데이터 연결 필요</small>';
}
export function indicatorDefinitions(market,indices){
 const supported=indexDefinitions[market].map(([id,name])=>({id,name,type:'indices'}));
 const cash=market==='US'?supported.filter(def=>indices?.status==='ready'&&indices.policy?.display&&indices.items?.some(item=>item.id===def.id&&Number.isFinite(item.value)&&(Number.isFinite(item.changePct)||indices.source==='FMP'&&item.instrumentType==='cash_index')&&Number.isFinite(Date.parse(item.asOf))&&item.instrumentType!=='futures_reference')):supported;
 return {cash,futures:market==='KR'?[]:futuresDefinitions[market].map(([id,name])=>({id,name,type:'futures'})),macro:market==='KR'?[{id:'USDKRW',name:'원·달러 환율',type:'macro'},{id:'KTB10Y',name:'국고채 10년',type:'macro'}]:[]};
}
const fixed=(n,d=2)=>n.toLocaleString('ko-KR',{minimumFractionDigits:d,maximumFractionDigits:d});
const signed=(n,d=2)=>(n>0?'+':n<0?'−':'±')+fixed(Math.abs(n),d);
export function macroValue(item){return !Number.isFinite(item?.value)?'—':item.id==='USDKRW'?'1달러 = '+fixed(item.value)+'원':fixed(item.value,3)+'%';}
export function macroChange(item){return !Number.isFinite(item?.change)?'전일 비교 자료 없음':(item.change>0?'↑ ':item.change<0?'↓ ':'→ ')+(item.id==='USDKRW'?signed(item.change)+'원'+(Number.isFinite(item.changePct)?' ('+signed(item.changePct)+'%)':''):Number.isFinite(item.changeBp)?signed(item.changeBp)+'bp':'비교 자료 없음');}
export function macroMeta(item,feed){if(item?.provider==='twelve_data_fx')return (item.stale?'갱신 지연 · ':'')+'Twelve Data · 5분 갱신 · '+(item.session==='closed'?'시장 마감 · ':'')+'시세 '+time(item.asOf,true);return item?(item.stale?'갱신 실패 · 마지막 자료 · ':'')+'한국은행 ECOS · 일별 자료 · 기준 '+item.baseDate:'한국은행 ECOS · '+(feed?.message||'데이터 연결 필요');}
export function indicatorMeta(item,feed){
 if(!item)return feed?.provider==='data_go_kr'?(feed.message||'데이터 연결 필요'):'갱신 이력 없음';
 if(item.baseDate)return dailyQuoteMeta({...item,stale:item.stale||feed.stale});
 if(feed.source==='FMP')return (item.stale?'갱신 실패 · 마지막 ':'')+(item.asOfKind==='date'?'기준 '+item.asOf+' (미국 거래일)':'기준 '+time(item.asOf,true))+' · FMP'+(item.mode==='unverified'?' · 지연 여부 미확인':'');
 const reference=item.instrumentType==='futures_reference';
 // A futures reference is always delayed, regardless of a parent feed's mode.
 const mode=reference?'delayed':item.mode||feed.mode;
 const delay=item.delayMinutes??feed.delayMinutes;
 const label=mode==='delayed'?(Number.isFinite(delay)&&delay>0?delay+'분 지연':'지연 시세'):mode==='unverified'?'시세 지연 여부 미확인':(modeLabels[mode]||'시세 상태 미확인');
 const received=reference||item.asOfKind==='received'||feed.asOfKind==='received';
 return (feed.stale?'갱신 실패 · 마지막 ':'')+label+' · '+(received?'조회 ':'갱신 ')+time(item.asOf,true)+(received?' · 시세시각 미제공':'');
}

export function indexHistoryMarkup(item){
 const history=(item?.history||[]).filter(p=>Number.isFinite(p.value)&&Number.isFinite(Date.parse(p.at))).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
 if(history.length<2)return '<div class="chart-unavailable"><span></span>추이 데이터 없음</div>';
 const start=Date.parse(history[0].at),end=Date.parse(history.at(-1).at);if(end<=start)return '';
 const low=Math.min(...history.map(p=>p.value)),high=Math.max(...history.map(p=>p.value)),range=high-low||1;
 const points=history.map(p=>((Date.parse(p.at)-start)/(end-start)*180).toFixed(2)+','+(35-(p.value-low)/range*31).toFixed(2)).join(' '),color=item.neutral?'var(--secondary)':Number.isFinite(item.changePct)?(item.changePct<0?'var(--down)':'var(--up)'):'var(--brand)',label=item.neutral?'일별 자료':'일봉 종가';
 return '<svg class="sparkline" viewBox="0 0 180 39" preserveAspectRatio="none" role="img" aria-label="'+esc(history[0].at+'부터 '+history.at(-1).at+'까지 '+label)+'"><title>'+esc(label+' · '+history[0].at+' ~ '+history.at(-1).at)+'</title><polyline points="'+points+'" fill="none" stroke="'+color+'" stroke-width="1.7" vector-effect="non-scaling-stroke"/></svg><span class="index-chart-range">'+esc(history[0].at.slice(5).replace('-','.'))+'<span>'+(item.neutral?'일별':'일봉')+'</span>'+esc(history.at(-1).at.slice(5).replace('-','.'))+'</span>';
}
