import {dollars,at} from './crypto-format.js';
// Reuses the stock preview's local Lightweight Charts 5.2 renderer.
export function mountCryptoChart(root,{demo=false}={}){
 let chart,series,abort,version=0,dead=false,id,stamp,days=0,lib;
 const ranges=[[7,'1주'],[30,'1개월'],[90,'3개월'],[180,'6개월'],[365,'1년'],[1095,'3년'],[0,'전체']];
 root.innerHTML='<div class="crypto-chart-tools" role="group" aria-label="일봉 조회 기간">'+ranges.map(([d,n])=>`<button data-days="${d}" aria-pressed="${d===days}">${n}</button>`).join('')+'</div><small class="crypto-chart-range"></small><div class="crypto-chart-plot"></div><div class="crypto-chart-state" role="status"></div><div class="crypto-chart-readout"></div><small class="crypto-chart-source"></small>';
 const plot=root.querySelector('.crypto-chart-plot'),state=root.querySelector('.crypto-chart-state'),readout=root.querySelector('.crypto-chart-readout'),source=root.querySelector('.crypto-chart-source'),range=root.querySelector('.crypto-chart-range');
 const dayText=t=>typeof t==='string'?t:t&&typeof t==='object'?`${t.year}-${String(t.month).padStart(2,'0')}-${String(t.day).padStart(2,'0')}`:new Date(Number(t)*1000).toISOString().slice(0,10);
 async function load(){
  const mine=++version;abort?.abort();abort=new AbortController();chart?.remove();chart=null;plot.hidden=true;state.hidden=false;state.textContent='과거 가격을 불러오고 있어요';readout.textContent='';source.textContent='';range.textContent='';
  try{
   const response=await fetch('/api/crypto/chart?'+new URLSearchParams({id,days,...(demo?{demo:'1'}:{})}),{signal:abort.signal});const data=await response.json();if(mine!==version||dead)return;if(!response.ok)throw new Error(data.message||'차트 조회 실패');
   const daily=data.interval==='daily';
   source.textContent=[data.source,'USD',data.dataAsOf?'일봉 기준 '+data.dataAsOf:null,data.receivedAt?'수신 '+at(data.receivedAt):null,data.stale?'갱신 지연':null,data.message].filter(Boolean).join(' · ');
   if(data.available)range.textContent=`보유 일봉 ${data.available.first} ~ ${data.available.last} · ${data.totalBars.toLocaleString('ko-KR')}개${data.complete?'':' · 일부 구간'}`;
   if(data.points.length<2){state.textContent=data.message||'과거 가격 데이터 없음';if(data.points[0])readout.textContent=(data.points[0].date||at(data.points[0].at))+' · '+dollars(data.points[0].price);return;}
   lib??=await import('/vendor/lightweight-charts/lightweight-charts.mjs');if(mine!==version||dead)return;state.hidden=true;plot.hidden=false;
   chart=lib.createChart(plot,{autoSize:true,layout:{background:{type:'solid',color:'#fff'},textColor:'#8B97A8',fontFamily:'Pretendard, sans-serif',fontSize:11},grid:{vertLines:{visible:false},horzLines:{color:'#F0F3F7'}},rightPriceScale:{borderVisible:false,alignLabels:true},timeScale:{timeVisible:!daily,borderColor:'#E5EAF0',...(daily?{}:{tickMarkFormatter:t=>at(new Date(Number(t)*1000).toISOString()).replace(' KST','')})},localization:{locale:'ko-KR',timeFormatter:t=>daily?dayText(t):at(new Date(Number(t)*1000).toISOString()),priceFormatter:v=>dollars(v)},crosshair:{mode:lib.CrosshairMode.Normal},handleScroll:{mouseWheel:false,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},handleScale:{mouseWheel:true,pinch:true}});
   series=chart.addSeries(lib.LineSeries,{color:'#087F73',lineWidth:2,priceLineVisible:false,priceFormat:{type:'custom',minMove:0.00000001,formatter:v=>dollars(v)}});
   const lookup=new Map(data.points.map(p=>[daily?p.date:Math.floor(Date.parse(p.at)/1000),p]));
   const points=[...lookup].map(([time,p])=>({time,value:p.price})).sort((a,b)=>a.time<b.time?-1:a.time>b.time?1:0);series.setData(points);chart.timeScale().fitContent();
   const show=p=>{if(!p){readout.textContent='';return;}const key=daily?dayText(p.time):p.time,bar=lookup.get(key);readout.textContent=daily&&bar?`${key} · 시 ${dollars(bar.open)} · 고 ${dollars(bar.high)} · 저 ${dollars(bar.low)} · 종 ${dollars(bar.close)}`:(daily?key:at(new Date(p.time*1000).toISOString()))+' · '+dollars(p.value);};
   show(points.at(-1));chart.subscribeCrosshairMove(e=>show(e.seriesData.get(series)||points.at(-1)));
  }catch(e){if(mine!==version||dead||e.name==='AbortError')return;state.textContent='차트를 불러오지 못했습니다. '+e.message;}
 }
 const onClick=e=>{const b=e.target.closest('[data-days]');if(!b)return;days=Number(b.dataset.days);root.querySelectorAll('[data-days]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.days)===days)));if(id)load();};root.addEventListener('click',onClick);
 return {select(next,receivedAt){if(next===id&&stamp===receivedAt)return;id=next;stamp=receivedAt;load();},destroy(){dead=true;++version;abort?.abort();chart?.remove();root.removeEventListener('click',onClick);}};
}
