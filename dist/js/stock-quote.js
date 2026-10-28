import {escapeHtml as esc} from './components.js';
import {price,percentage,time,dailyQuoteMeta} from './data.js';
import {usMarketSession} from './us-market-session.js';
const direction=n=>n>0?'up':n<0?'negative':'neutral-text';
export function stockQuoteMarkup(stock,data,now=Date.now()){
 if(stock.baseDate){const change=Number.isFinite(stock.change)?(stock.change>=0?'+':'−')+price({...stock,price:Math.abs(stock.change)}):'—';return '<p class="detail-quote-label">전일 기준 종가 · '+esc(stock.baseDate)+'</p><div class="detail-price">'+price(stock)+'</div><div class="detail-change '+direction(stock.changePct)+'">'+change+' · '+percentage(stock.changePct)+' <span>직전 거래일 종가 대비</span></div><p class="detail-quote-note">'+esc(dailyQuoteMeta(stock))+'</p><p class="quote-refresh-error" role="status" hidden></p>'; }
 const q=stock.quoteSession,current=stock.market==='US'?usMarketSession(now):null,received=stock.asOfKind==='received'||data.asOfKind==='received';
 const sameSession=!q||!current||q.id===current.id&&q.dateEt===current.dateEt;
 const label=current?.label||'전일 대비 등락률',waiting=current?.supported&&!sameSession;
 const value=waiting?null:stock.changePct;
 return '<p class="detail-quote-label">현재가</p><div class="detail-price">'+price(stock)+'</div><div class="detail-change '+direction(value)+'">'+percentage(value)+' <span>'+esc(label)+'</span></div>'+(waiting?'<p class="quote-session-basis">현재 시간대 시세 갱신 대기</p>':current?.id==='daymarket'?'<p class="quote-session-basis">주간거래 시세 미제공</p>':'')+'<p class="detail-quote-note">'+(received?'조회 시각 '+time(stock.asOf||data.receivedAt,true)+' · 체결 시각 미제공':'시세 기준 '+time(stock.asOf,true))+'</p><p class="quote-refresh-error" role="status" hidden></p>';
}
