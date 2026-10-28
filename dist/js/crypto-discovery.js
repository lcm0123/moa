// Presentation groups reference provider category IDs, never hand-picked memberships.
export const CRYPTO_CATEGORY_BUTTONS=[
 {id:'binance-smart-chain',label:'BSC',ids:['binance-smart-chain']},
 {id:'solana-ecosystem',label:'Solana',ids:['solana-ecosystem']},
 {id:'real-world-assets-rwa',label:'RWA',ids:['real-world-assets-rwa']},
 {id:'meme-token',label:'밈',ids:['meme-token']},
 {id:'payment-solutions',label:'Payments',ids:['payment-solutions']},
 {id:'artificial-intelligence',label:'AI',ids:['artificial-intelligence']},
 {id:'layers',label:'Layer 1 / Layer 2',ids:['layer-1','layer-2']},
 {id:'gaming',label:'게임',ids:['gaming']},
 {id:'decentralized-finance-defi',label:'DeFi',ids:['decentralized-finance-defi']},
 {id:'stablecoins',label:'스테이블코인',ids:['stablecoins']},
 {id:'unclassified',label:'미분류',ids:[]}
];
export const FEATURED_ASSETS=['BTC','ETH','BNB'];
export function matchesCryptoCategory(coin,id){
 if(!id)return true;
 if(id==='unclassified')return !(coin.categories||[]).length;
 const ids=CRYPTO_CATEGORY_BUTTONS.find(g=>g.id===id)?.ids||[id];
 return (coin.categories||[]).some(c=>ids.includes(c.id));
}
export function cryptoHighlights(items){
 const valid=items.filter(c=>Number.isFinite(c.price)&&c.price>0);
 return [
  {id:'majors',title:'주요 코인',note:'BTC · ETH · BNB',items:FEATURED_ASSETS.map(s=>valid.find(c=>c.baseAsset===s)).filter(Boolean)},
  {id:'gainers',title:'상승률 상위',note:'최근 24시간 · Binance 기준',items:valid.filter(c=>c.returns?.day>0&&c.quoteVolume>0).sort((a,b)=>b.returns.day-a.returns.day||a.id.localeCompare(b.id)).slice(0,3)},
  {id:'volume',title:'거래대금 상위',note:'최근 24시간 · 원화 환산',items:valid.filter(c=>c.quoteVolume>0).sort((a,b)=>b.quoteVolume-a.quoteVolume||a.id.localeCompare(b.id)).slice(0,3)}
 ];
}
