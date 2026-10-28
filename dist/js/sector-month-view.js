import {escapeHtml as esc,icon} from './components.js';
import {percentage} from './data.js';
import {sectorMark,sectorSymbol} from './sector-symbols.js';
const direction=n=>n>0?'up':n<0?'negative':'neutral-text';
const shortDate=day=>day?.slice(5).replace('-','.')||'—';
const label=s=>sectorSymbol(s).label;
const metric=s=>s.basis==='reconstructed'?'기록 누적 등락률':'평균 관측 등락률';
const limitNote=s=>s.basis==='reconstructed'?'기록된 일별 등락률만 복리 누적 · 월 전체 수익률 아님':'관측 등락률의 단순 평균 · 월간 수익률 아님';
const caveats=s=>[
 s.partialDays?`일부 종목 누락 ${s.partialDays}일`:null,
 s.excludedSectors?`기간 중 기록이 부족한 섹터 ${s.excludedSectors}개 제외`:null,
 s.membershipChanged?'기간 중 구성종목 기준 변경 포함':null
].filter(Boolean).join(' · ');

export function monthSummaryMarkup(summary,{loading=false,error=false,stale=false}={}){
 const header='<div class="month-summary-heading"><h3>'+Number(summary?.month?.slice(5))+'월 섹터 요약</h3><span>'+(stale?'저장된 기록':summary?.days?summary.days+'일 집계':'')+'</span></div>';
 if(loading||error||!summary||summary.status!=='ready')return header+'<p class="month-summary-empty" role="status">'+(loading?'월간 흐름을 집계하고 있어요.':error?'월간 요약을 불러오지 못했습니다.':summary?.status==='insufficient'?'비교할 기록이 부족합니다. 같은 섹터의 기록이 2일 이상 필요합니다.':'이 달에는 요약할 섹터 기록이 없습니다.')+'</p>';
 const rows=(sectors,side)=>'<section class="month-summary-group"><h4>'+(side==='strong'?'상대 강세':'상대 약세')+' <span>TOP '+sectors.length+'</span></h4><ol>'+sectors.map((s,i)=>'<li><button data-history-action="month-sector" data-sector="'+esc(s.id)+'" aria-label="'+esc(label(s))+' 월간 흐름 보기"><span class="month-sector-name"><small>'+(i+1)+'</small>'+sectorMark(s)+'<strong>'+esc(label(s))+'</strong></span><span class="month-sector-metric"><b class="'+direction(s.value)+'">'+percentage(s.value)+'</b><small>'+(side==='strong'?'상위 3위 ':'하위 3위 ')+(side==='strong'?s.strongDays:s.weakDays)+'일</small></span></button></li>').join('')+'</ol></section>';
 const best=summary.sectors[0],worst=summary.sectors.at(-1),recent=summary.recentLeader;
 const analysis=summary.spread<0.000001?'기록 기준으로 섹터 간 등락률 차이가 없습니다.':esc(label(best))+' '+percentage(best.value)+'로 가장 높고, '+esc(label(worst))+' '+percentage(worst.value)+'로 가장 낮습니다. 격차는 '+summary.spread.toFixed(2)+'%p입니다.';
 return header+'<p class="month-summary-scope">'+shortDate(summary.firstDay)+'–'+shortDate(summary.lastDay)+' · '+metric(summary)+'</p><div class="month-summary-groups">'+rows(summary.strong,'strong')+rows(summary.weak,'weak')+'</div><div class="month-summary-analysis"><p>'+analysis+'</p><p>'+summary.sectors.length+'개 중 '+summary.positiveSectors+'개 상승 · '+summary.negativeSectors+'개 하락'+(recent?'<br>최근 5개 기록 1위: '+esc(label(recent))+' <b class="'+direction(recent.value)+'">'+percentage(recent.value)+'</b>':'')+'</p></div><p class="month-summary-basis">'+limitNote(summary)+(caveats(summary)?'<br>'+esc(caveats(summary)):'')+'</p>';
}

export function monthSectorMarkup(summary,sectorId){
 const s=summary?.sectors.find(s=>s.id===sectorId);
 const header='<div class="dialog-heading"><div><div class="eyebrow">MONTHLY SECTOR REVIEW</div><h2 id="history-detail-title">'+esc(summary.month)+' · '+esc(s?label(s):'섹터')+' 흐름</h2></div><button class="icon-button" data-history-action="close" aria-label="섹터 기록 닫기">'+icon('close')+'</button></div>';
 if(!s)return header+'<div class="history-detail-body"><p>집계할 섹터 기록이 없습니다.</p></div>';
 return header+'<div class="history-detail-body"><div class="history-sector-summary">'+sectorMark(s)+'<span><strong>'+esc(label(s))+'</strong><small>'+metric(summary)+' · '+summary.days+'일</small></span><b class="'+direction(s.value)+'">'+percentage(s.value)+'</b></div><div class="month-sector-stats"><span>상위 3위 <b>'+s.strongDays+'일</b></span><span>하위 3위 <b>'+s.weakDays+'일</b></span><span>상승 기록 <b>'+s.positiveDays+'일</b></span></div><p class="history-stock-context">날짜를 누르면 그날의 종목별 내역을 볼 수 있어요.</p><div class="month-sector-days">'+s.days.map(d=>'<button data-history-action="month-day" data-day="'+d.day+'" aria-label="'+esc(d.day+' '+label(s))+' 종목별 기록 보기"><span>'+esc(d.day)+'</span><span>'+(d.strong?'<small class="history-rank-tag">상위 3위</small>':d.weak?'<small class="history-rank-tag weak">하위 3위</small>':'')+'</span><b class="'+direction(d.value)+'">'+percentage(d.value)+'</b>'+icon('chevron')+'</button>').join('')+'</div><p class="history-detail-note">'+limitNote(summary)+'<br>'+(summary.basis==='reconstructed'?'현재 구성종목·분류 기준의 일별 동일 비중 계산. 공식 섹터지수가 아닙니다.':'관측 당시 시가총액 가중 등락률 기준. 종가 수익률이 아닙니다.')+(caveats(summary)?'<br>'+esc(caveats(summary)):'')+'</p></div>';
}
