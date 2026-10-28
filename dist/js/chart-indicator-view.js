import {indicatorPath} from './technical-indicators.js';
export const indicatorColor=id=>'var(--'+id+')';
export function settingsMarkup(settings){
 return '<div class="chart-indicator-options" id="chart-indicator-options" hidden><fieldset><legend>가격 위에 표시 · 종가 기준</legend><div class="indicator-checkboxes">'+[5,20,60,120].map(n=>'<label><input type="checkbox" data-sma="'+n+'" '+(settings.sma.includes(n)?'checked':'')+'><i style="--series-color:var(--sma-'+n+')"></i>SMA '+n+'일</label>').join('')+'<label><input type="checkbox" data-bollinger '+(settings.bollinger?'checked':'')+'><i style="--series-color:var(--bollinger)"></i>볼린저밴드 (20, 2)</label></div></fieldset><p>보조지표는 거래량 아래에서 MACD 또는 RSI를 선택하세요.</p><details><summary>계산 기준</summary><p>거래일 일봉 종가 기준 · SMA는 단순평균, EMA는 초기 SMA 후 2/(기간+1) 가중치, RSI는 Wilder 방식입니다. 볼린저밴드는 20일 평균 ± 모집단 표준편차의 2배입니다. 횡보 구간의 RSI는 50으로 표시합니다.</p><p>화면 이전의 제공된 모든 일봉을 계산에 사용합니다. 초기 데이터가 부족한 구간은 비워두며, 제공 이력·수정주가 기준에 따라 다른 서비스와 값이 다를 수 있습니다.</p></details></div>';
}
export function overlayEntries(indicators,settings){
 const rows=settings.sma.map(n=>({id:'sma-'+n,label:'SMA '+n,value:indicators?.sma[n]??null}));
 if(settings.bollinger)rows.push(...[['upper','BB 상단'],['middle','BB 중심'],['lower','BB 하단']].map(([key,label])=>({id:'bollinger',key,label,value:indicators?.bb[key]??null})));
 return rows;
}
export function auxiliaryEntries(indicators,kind){
 return kind==='rsi'?[{id:'rsi',label:'RSI 14',value:indicators?.rsi??null}]:[
  {id:'macd',label:'MACD',value:indicators?.macd??null},
  {id:'macd-signal',label:'Signal 9',value:indicators?.signal??null},
  {id:'histogram',label:'Histogram',value:indicators?.histogram??null}
 ];
}
export function overlayMarkup(items,settings,g){
 let result='';
 const path=(id,values,dash='')=>'<path class="chart-indicator-line '+dash+'" data-series="'+id+'" style="stroke:'+indicatorColor(id)+'" d="'+indicatorPath(values,g.x,g.y)+'"/>';
 if(settings.bollinger){
  result+='<g class="chart-bollinger">'+['upper','middle','lower'].map(key=>path('bollinger',items.map(b=>b.indicators.bb[key]),key==='middle'?'indicator-dashed':'')).join('')+'</g>';
 }
 for(const n of settings.sma)result+=path('sma-'+n,items.map(b=>b.indicators.sma[n]));
 return result;
}
export function auxiliaryGeometry(items,kind,g){
 const top=g.bottom+56,bottom=top+110,values=items.flatMap(b=>auxiliaryEntries(b.indicators,kind).map(v=>v.value)).filter(Number.isFinite);
 const max=kind==='rsi'?100:Math.max(0,...values),min=kind==='rsi'?0:Math.min(0,...values),pad=kind==='rsi'?0:Math.max((max-min)*.1,.01);
 const low=min-pad,high=max+pad,y=v=>bottom-(v-low)/(high-low)*(bottom-top);
 return {top,bottom,low,high,y,height:bottom+28,hasData:values.length>0};
}
export function auxiliaryMarkup(items,kind,g,a,width){
 const ticks=kind==='rsi'?[0,30,70,100]:[a.low,0,a.high];
 let result='<g class="chart-auxiliary" data-indicator="'+kind+'">';
 result+=ticks.map(value=>'<line class="chart-gridline '+(value===0||kind==='rsi'&&(value===30||value===70)?'indicator-reference':'')+'" data-level="'+value+'" x1="'+g.left+'" x2="'+(width-g.right)+'" y1="'+a.y(value)+'" y2="'+a.y(value)+'"/><text class="chart-axis-label" x="'+(width-g.right+9)+'" y="'+(a.y(value)+4)+'">'+(kind==='rsi'?value:value.toFixed(2))+'</text>').join('');
 if(kind==='macd'){
  const barWidth=Math.max(.5,Math.min(10,g.plotWidth/items.length*.68));
  result+='<g class="macd-histogram">'+items.map((b,i)=>{const v=b.indicators.histogram;if(!Number.isFinite(v))return '';return '<rect class="'+(v>=0?'up':'negative')+'" x="'+(g.x(i)-barWidth/2)+'" y="'+Math.min(a.y(0),a.y(v))+'" width="'+barWidth+'" height="'+Math.abs(a.y(v)-a.y(0))+'"/>';}).join('')+'</g>';
 }
 const series=kind==='rsi'?[['rsi','rsi']]:[['macd','macd'],['signal','macd-signal']];
 result+=series.map(([key,id])=>'<path class="chart-indicator-line" data-series="'+id+'" style="stroke:'+indicatorColor(id)+'" d="'+indicatorPath(items.map(b=>b.indicators[key]),g.x,a.y)+'"/>').join('');
 if(!a.hasData)result+='<text class="chart-axis-label" x="'+g.left+'" y="'+(a.top+45)+'">계산에 필요한 일봉이 부족합니다.</text>';
 return result+'</g>';
}
