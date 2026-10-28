import {escapeHtml as esc} from './components.js';
import {pct,tone,at,ret} from './crypto-format.js';
import {krwAmount,krwBasis} from './crypto-krw.js';

// Membership comes from the verified provider mapping, never from a coin symbol.
export function mountCryptoSectorDetail(root,onSelect){
 const dialog=document.createElement('dialog');
 dialog.className='crypto-sector-dialog';
 dialog.setAttribute('aria-labelledby','crypto-sector-detail-title');
 dialog.innerHTML=`<div class="panel-heading"><div><small>분야별 성과</small><h2 id="crypto-sector-detail-title"></h2></div><button class="icon-button" data-sector-close aria-label="분야 구성 코인 닫기">✕</button></div><div class="crypto-sector-detail-summary"></div><div class="crypto-sector-detail-controls"><div class="crypto-periods" role="group" aria-label="분야 구성 코인 범위"><button data-scope="primary" aria-pressed="true">성과 집계 코인</button><button data-scope="all" aria-pressed="false">전체 소속 코인</button></div><input type="search" aria-label="분야 안에서 코인 검색" placeholder="코인명·티커 검색"></div><p class="crypto-sector-detail-note"></p><div class="crypto-sector-detail-list"></div><footer class="crypto-sector-detail-source"></footer>`;
 root.append(dialog);
 const $=s=>dialog.querySelector(s);
 let data,key,period,label,scope='primary',opener;
 const primary=c=>(c.primary?.id||'unclassified')===key;
 const belongs=c=>key==='unclassified'?!(c.categories||[]).length:(c.categories||[]).some(s=>s.id===key);
 function render(){
  if(!data||!key)return;
  const group=data.sectors.find(s=>s.id===key),category=data.categories.find(s=>s.id===key);
  const name=group?.label||category?.label||'미분류',members=data.items.filter(primary),all=data.items.filter(belongs);
  const q=$('input').value.trim().toLocaleLowerCase().replace(/\s/g,'');
  const coins=(scope==='primary'?members:all).filter(c=>!q||(c.name+' '+c.symbol).toLocaleLowerCase().replace(/\s/g,'').includes(q)).sort((a,b)=>(ret(b,period)??-Infinity)-(ret(a,period)??-Infinity)||a.name.localeCompare(b.name));
  $('#crypto-sector-detail-title').textContent=name+' 구성 코인';
  $('.crypto-sector-detail-summary').innerHTML=`<strong class="${tone(group?.value)}">${pct(group?.value)}</strong><span>${esc(label)} · ${data.method==='cap'?'시가총액 가중':'동일가중 평균'}<small>상승 ${group?.rising||0} · 하락 ${group?.falling||0} · ${group?.count||0}/${members.length}개 계산</small></span>`;
  $('[data-scope="primary"]').textContent=`성과 집계 코인 ${members.length}`;
  $('[data-scope="all"]').textContent=`전체 소속 코인 ${all.length}`;
  for(const b of dialog.querySelectorAll('[data-scope]'))b.setAttribute('aria-pressed',String(b.dataset.scope===scope));
  $('.crypto-sector-detail-note').textContent=(scope==='primary'?'대표 분야가 '+name+'인 코인 · 기간 데이터 부족·거래대금 0은 성과 계산 제외':'다른 대표 분야의 코인도 포함 · 위 성과는 대표 분야 기준')+' · 코인을 누르면 상세 차트로 이동합니다.';
  const list=$('.crypto-sector-detail-list'),scroll=list.scrollTop,active=document.activeElement?.closest('[data-sector-coin]')?.dataset.sectorCoin;
  list.innerHTML=coins.map(c=>`<button class="crypto-sector-coin" data-sector-coin="${esc(c.id)}"><span class="crypto-sector-coin-name"><b>${esc(c.name)}</b><small>${esc(c.symbol)}${!primary(c)?' · 대표 '+esc(c.primary?.label||'미분류'):''}</small></span><span class="crypto-sector-coin-price"><b>${krwAmount(c.price,data.conversion)} <small>원</small></b><small>거래대금 ${krwAmount(c.quoteVolume,data.conversion,true)}원 · 최근 24시간</small></span><span class="crypto-sector-coin-return ${tone(ret(c,period))}"><b>${Number.isFinite(ret(c,period))?pct(ret(c,period)):'데이터 없음'}</b><small>${esc(label)}</small></span><time>${at(c.asOf)}</time></button>`).join('')||'<div class="crypto-empty">'+(q?'검색 결과가 없습니다.':'확인된 구성 코인이 없습니다.')+'</div>';
  list.scrollTop=scroll;
  if(active)list.querySelector(`[data-sector-coin="${CSS.escape(active)}"]`)?.focus({preventScroll:true});
  $('.crypto-sector-detail-source').textContent=`가격: Binance Spot · ${krwBasis(data.conversion)} · 분야: CoinGecko · 분류 수집 ${at(data.metadata?.receivedAt)}${data.metadata?.stale?' · 일부 수집 또는 갱신 지연':''} · ${data.stale?'시세 갱신 지연 · 마지막 정상값':'가격 기준 시각은 코인별 표시'}`;
 }
 dialog.addEventListener('click',e=>{
  const button=e.target.closest('button');
  if(button?.hasAttribute('data-sector-close'))dialog.close();
  if(button?.dataset.scope){scope=button.dataset.scope;$('.crypto-sector-detail-list').scrollTop=0;render();}
  if(button?.dataset.sectorCoin){dialog.close();onSelect(button.dataset.sectorCoin);}
 });
 dialog.addEventListener('close',()=>{if(opener?.isConnected)opener.focus({preventScroll:true});else root.querySelector(`[data-field="${CSS.escape(key||'')}"]`)?.focus({preventScroll:true});});
 dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();dialog.close();}});
 $('input').addEventListener('input',()=>{$('.crypto-sector-detail-list').scrollTop=0;render();});
 return {
  open(id,next,nextPeriod,nextLabel,trigger){key=id;data=next;period=nextPeriod;label=nextLabel;scope='primary';opener=trigger;$('input').value='';render();$('.crypto-sector-detail-list').scrollTop=0;dialog.showModal();},
  update(next,nextPeriod,nextLabel){data=next;period=nextPeriod;label=nextLabel;if(dialog.open)render();},
  destroy(){dialog.close();dialog.remove();}
 };
}
