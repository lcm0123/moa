import {tradingViewConfig,validWidgetSymbol,tradingViewLink} from './tradingview-model.js';
const symbol=new URLSearchParams(location.search).get('symbol'),container=document.querySelector('.tradingview-widget-container');
const notify=state=>parent.postMessage({type:'moa-tradingview',symbol,state},location.origin);
if(!validWidgetSymbol(symbol)){container.textContent='거래소·종목 코드 확인이 필요합니다.';notify('error');}
else {
 // Isolated host URL prevents the page's tvwidgetsymbol query parameter from
 // overriding the stock being researched. No account or API credentials enter it.
 const canonical=new URL(location.href);canonical.search=new URLSearchParams({symbol});canonical.hash='';history.replaceState(null,'',canonical);
 const link=container.querySelector('a');link.href=tradingViewLink(symbol);link.firstElementChild.textContent=symbol+' 차트';
 let seen=null,ready=false;const timer=setTimeout(()=>{if(!ready)notify('slow');},20000);
 const observer=new MutationObserver(()=>{const iframe=container.querySelector('iframe');if(!iframe||iframe===seen)return;seen=iframe;iframe.title=symbol+' TradingView 차트';iframe.addEventListener('load',()=>{ready=true;clearTimeout(timer);notify('loaded');},{once:true});});observer.observe(container,{childList:true,subtree:true});
 const script=document.createElement('script');script.src='https://s3.tradingview.com/tv.js';script.type='text/javascript';script.async=true;script.addEventListener('load',()=>{const target=container.querySelector('.tradingview-widget-container__widget');target.id='moa-tradingview-widget';try{new TradingView.widget({...tradingViewConfig(symbol),container_id:target.id});}catch{notify('error');}},{once:true});script.addEventListener('error',()=>{clearTimeout(timer);container.querySelector('.tradingview-widget-container__widget').innerHTML='<p class="embed-error">TradingView 차트를 불러오지 못했습니다.</p>';notify('error');},{once:true});container.append(script);
 addEventListener('pagehide',()=>{clearTimeout(timer);observer.disconnect();},{once:true});
}
