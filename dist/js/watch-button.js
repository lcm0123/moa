import {icon,escapeHtml as esc} from './components.js';
import {readWatchlist} from './watchlist.js';
export function watchButtonState(stock,keys=readWatchlist()){
 const saved=keys.includes(stock.market+':'+stock.ticker),available=Number.isFinite(stock.price);
 const label=saved?'관심종목 해제':'관심종목 추가';
 return {saved,available,label,disabled:!saved&&!available,name:(stock.name||stock.ticker)+' '+label};
}
export function watchButton(stock,className='',text=false){
 const state=watchButtonState(stock);
 return '<button type="button" class="watch-toggle '+esc(className)+'" data-action="watch-stock" data-market="'+esc(stock.market)+'" data-ticker="'+esc(stock.ticker)+'" data-stock-name="'+esc(stock.name||stock.ticker)+'" data-available="'+state.available+'" aria-pressed="'+state.saved+'" aria-label="'+esc(state.name)+'" title="'+state.label+'" '+(state.disabled?'disabled':'')+'>'+icon('star')+(text?' <span>'+state.label+'</span>':'')+'</button>';
}
export function syncWatchButtons(root=document){
 const keys=readWatchlist();root.querySelectorAll('[data-action="watch-stock"]').forEach(button=>{
  const state=watchButtonState({market:button.dataset.market,ticker:button.dataset.ticker,name:button.dataset.stockName,price:button.dataset.available==='true'?0:null},keys);
  button.setAttribute('aria-pressed',String(state.saved));button.setAttribute('aria-label',state.name);button.title=state.label;button.disabled=state.disabled;
  if(button.querySelector('span'))button.querySelector('span').textContent=state.label;
 });
}
