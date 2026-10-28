import {escapeHtml as esc} from './components.js';
import {indicatorPath} from './technical-indicators.js';
import {drawingIndex} from './stock-chart-state.js';

export const metric=value=>Number.isFinite(value)?value.toLocaleString('en-US',{maximumFractionDigits:2}):'—';
const compact=value=>new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(value);
const line=(x1,y1,x2,y2,attrs='')=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${attrs}/>`;
const label=(x,y,text,attrs='')=>`<text x="${x}" y="${y}" class="sc-axis" ${attrs}>${esc(text)}</text>`;
const path=(values,x,y,color,width=1.6)=>`<path d="${indicatorPath(values,x,y)}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round"/>`;

export function analysisGeometry({bars,series,settings,width,fullscreen=false,priceScale=1,quote,comparison}){
 const left=8,right=width<500?62:80,plotWidth=Math.max(1,width-left-right),top=16;
 const priceBottom=top+(fullscreen?Math.max(300,Math.min(550,innerHeight*.47)):width<500?275:330);
 const vals=bars.flatMap(b=>b.ohlc?[b.low,b.high]:[b.close]);
 for(const s of series.filter(s=>s.panel==='price'))vals.push(...s.values.filter(Number.isFinite));
 // This is the independently supplied quote, never the last daily close.
 if(settings.currentPrice&&Number.isFinite(quote))vals.push(quote);
 const min=Math.min(...vals),max=Math.max(...vals),mid=(min+max)/2,span=Math.max(max-min,max*.01,.01)*1.16*priceScale;
 const low=mid-span/2,high=mid+span/2;
 const x=i=>left+plotWidth*(i+.5)/Math.max(1,bars.length),y=v=>priceBottom-(v-low)/(high-low)*(priceBottom-top);
 const panels=[];let bottom=priceBottom+8;
 let configs=settings.indicators.filter(c=>c.enabled&&['volume','rsi','macd'].includes(c.kind));
 if(width<600&&configs.some(c=>c.kind==='rsi')&&configs.some(c=>c.kind==='macd'))configs=configs.filter(c=>c.kind==='volume'||c.kind===settings.mobileAux);
 for(const c of configs){const head=bottom;bottom+=32;const p={id:c.id,kind:c.kind,title:{volume:'거래량',rsi:'RSI '+c.period,macd:`MACD ${c.fast}, ${c.slow}, ${c.signal}`}[c.kind],head,top:bottom,bottom:bottom+(c.collapsed?0:c.height),collapsed:c.collapsed,height:c.height};
  const values=c.kind==='volume'?bars.map(b=>b.volume):series.filter(s=>s.panel===c.kind||c.kind==='macd'&&s.panel==='histogram').flatMap(s=>s.values);
  const valid=values.filter(Number.isFinite);p.empty=!valid.length;
  p.low=c.kind==='volume'||c.kind==='rsi'?0:Math.min(0,...valid);p.high=c.kind==='rsi'?100:Math.max(c.kind==='volume'?1:.001,...valid);
  if(c.kind==='macd'){const pad=(p.high-p.low)*.1;p.low-=pad;p.high+=pad;}
  p.y=v=>p.bottom-(v-p.low)/(p.high-p.low)*(p.bottom-p.top);panels.push(p);bottom=p.bottom+8;
 }
 if(comparison){const values=comparison.series.flatMap(s=>s.values).filter(Number.isFinite),p={id:'comparison',kind:'comparison',title:'종목 비교 · 공통 시작일 0%',head:bottom,top:bottom+32,bottom:bottom+202,collapsed:false};
  const min=Math.min(0,...values),max=Math.max(0,...values),pad=Math.max((max-min)*.08,.1);p.low=min-pad;p.high=max+pad;p.y=v=>p.bottom-(v-p.low)/(p.high-p.low)*(p.bottom-p.top);panels.push(p);bottom=p.bottom+8;
 }
 return {width,left,right,plotWidth,top,priceBottom,low,high,x,y,panels,bottom,height:bottom+28,step:plotWidth/Math.max(1,bars.length),priceAt:py=>low+(priceBottom-py)/(priceBottom-top)*(high-low)};
}

export function analysisMarkup({g,bars,allBars,start,series,settings,drawings,selectedDrawing,draft,quote,comparison,uid}){
 let html=`<defs><clipPath id="${uid}-price"><rect x="${g.left}" y="${g.top}" width="${g.plotWidth}" height="${g.priceBottom-g.top}"/></clipPath></defs>`;
 for(let i=0;i<=4;i++){const v=g.low+(g.high-g.low)*i/4,py=g.y(v);if(settings.grid)html+=line(g.left,py,g.width-g.right,py,'class="sc-grid"');html+=label(g.width-g.right+7,py+4,metric(v));}
 const cw=Math.max(.6,Math.min(14,g.step*.7)),closes=bars.map(b=>b.close);
 html+=`<g clip-path="url(#${uid}-price)">`;
 if(settings.type==='candles')html+=bars.map((b,i)=>b.ohlc?`<g class="${b.close>=b.open?'sc-up':'sc-down'}">${line(g.x(i),g.y(b.high),g.x(i),g.y(b.low))}<rect x="${g.x(i)-cw/2}" y="${Math.min(g.y(b.open),g.y(b.close))}" width="${cw}" height="${Math.max(1,Math.abs(g.y(b.open)-g.y(b.close)))}"/></g>`:'').join('');
 else {const d=indicatorPath(closes,g.x,g.y);if(settings.type==='area')html+=`<path d="${d} L${g.x(bars.length-1)},${g.priceBottom} L${g.x(0)},${g.priceBottom} Z" fill="var(--brand)" opacity=".09"/>`;html+=path(closes,g.x,g.y,'var(--brand)',2);if(bars.length===1)html+=`<circle cx="${g.x(0)}" cy="${g.y(bars[0].close)}" r="3" fill="var(--brand)"/>`;}
 html+=series.filter(s=>s.panel==='price').map(s=>path(s.values,g.x,g.y,s.color,s.width)).join('');
 if(settings.currentPrice&&Number.isFinite(quote))html+=line(g.left,g.y(quote),g.width-g.right,g.y(quote),'class="sc-quote-line"');
 html+=drawings.concat(draft?[draft]:[]).map(d=>{
  const pts=d.points.map(p=>({x:g.x(drawingIndex(allBars,p.date)-start),y:g.y(p.price)})),a=pts[0],b=pts[1]||a;
  const shape=d.kind==='horizontal'?line(g.left,a.y,g.width-g.right,a.y):d.kind==='trend'?line(a.x,a.y,b.x,b.y):`<rect x="${Math.min(a.x,b.x)}" y="${Math.min(a.y,b.y)}" width="${Math.max(1,Math.abs(b.x-a.x))}" height="${Math.max(1,Math.abs(b.y-a.y))}" fill="${d.color}" fill-opacity=".1"/>`;
  const selected=d.id===selectedDrawing;
  return `<g data-drawing-id="${esc(d.id)}" stroke="${d.color}" stroke-width="${d.width}" class="sc-drawing">${shape}<g class="sc-drawing-hit" stroke="transparent" stroke-width="14">${shape}</g>${selected?pts.map((p,i)=>`<circle data-handle="${i}" cx="${d.kind==='horizontal'?g.left+g.plotWidth/2:p.x}" cy="${p.y}" r="6" fill="white" stroke-width="2"/>`).join(''):''}</g>`;
 }).join('');html+='</g>';
 if(settings.currentPrice&&Number.isFinite(quote)&&g.y(quote)>=g.top&&g.y(quote)<=g.priceBottom)html+=`<g class="sc-quote-tag"><rect x="${g.width-g.right}" y="${g.y(quote)-10}" width="${g.right}" height="20" rx="3"/>${label(g.width-g.right+5,g.y(quote)+4,metric(quote))}</g>`;
 for(const p of g.panels){
  html+=line(g.left,p.head,g.width,p.head,'class="sc-separator"');if(p.collapsed)continue;
  const clip=`${uid}-${p.id}`;html+=`<defs><clipPath id="${clip}"><rect x="${g.left}" y="${p.top}" width="${g.plotWidth}" height="${p.bottom-p.top}"/></clipPath></defs>`;
  const references=p.kind==='rsi'?[30,70]:p.kind==='volume'?[p.high]:[0];
  for(const v of references)html+=line(g.left,p.y(v),g.width-g.right,p.y(v),'class="sc-reference"')+label(g.width-g.right+7,p.y(v)+4,p.kind==='volume'?compact(v):metric(v)+(p.kind==='comparison'?'%':''));
  html+=`<g clip-path="url(#${clip})">`;
  if(p.kind==='volume')html+=bars.map((b,i)=>Number.isFinite(b.volume)?`<rect class="${b.ohlc?(b.close>=b.open?'sc-up':'sc-down'):'sc-flat'}" x="${g.x(i)-cw/2}" y="${p.y(b.volume)}" width="${cw}" height="${p.bottom-p.y(b.volume)}" opacity=".5"/>`:'').join('');
  else if(p.kind==='comparison')html+=comparison.series.map(s=>path(s.values,g.x,p.y,s.color,s.width)).join('');
  else {if(p.kind==='macd'){const hist=series.find(s=>s.panel==='histogram');if(hist){const hw=Math.max(.5,Math.min(g.step*.9,cw*hist.width/1.2));html+=hist.values.map((v,i)=>Number.isFinite(v)?`<rect x="${g.x(i)-hw/2}" y="${Math.min(p.y(0),p.y(v))}" width="${hw}" height="${Math.max(.5,Math.abs(p.y(v)-p.y(0)))}" fill="${hist.color}" opacity="${v>=0?.7:.32}"/>`:'').join('');}}html+=series.filter(s=>s.panel===p.kind).map(s=>path(s.values,g.x,p.y,s.color,s.width)).join('');}
  html+='</g>';if(p.empty)html+=label(g.left+12,p.top+24,'계산할 데이터가 부족합니다');
 }
 const ticks=Math.min(bars.length,g.width<500?3:6),indices=[...new Set(Array.from({length:ticks},(_,i)=>Math.round(i*(bars.length-1)/Math.max(1,ticks-1))))];
 for(const [n,i] of indices.entries())html+=label(g.x(i),g.height-6,g.width<500?bars[i].date.slice(2):bars[i].date,`text-anchor="${n===0?'start':n===indices.length-1?'end':'middle'}"`);
 html+=`<g class="sc-crosshair" visibility="hidden"></g>`;return html;
}
