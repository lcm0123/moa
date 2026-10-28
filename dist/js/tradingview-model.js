// TradingView widgets use their own data. Never feed our quote/history into them.
// Exchange must come from the stock provider or the verified SEC/DART profile.
export function tradingViewIdentity(stock){
 const ticker=String(stock?.ticker||'').trim().toUpperCase(),exchange=String(stock?.exchange||'').trim().toUpperCase();
 if(stock?.market==='KR'&&/^\d{6}$/.test(ticker)&&['KRX','KOSPI','KOSDAQ','코스피','코스닥'].includes(exchange))return {symbol:'KRX:'+ticker,embeddable:false,reason:'국내 주식은 TradingView 외부 위젯 제공 시장으로 확인되지 않았습니다.'};
 if(stock?.market!=='US'||!/^[A-Z][A-Z0-9.\-]{0,14}$/.test(ticker))return null;
 const exchanges={'NASDAQ':'NASDAQ','NASDAQ GLOBAL SELECT':'NASDAQ','NASDAQ GLOBAL MARKET':'NASDAQ','NASDAQ CAPITAL MARKET':'NASDAQ','NYSE':'NYSE','NEW YORK STOCK EXCHANGE':'NYSE','AMEX':'AMEX','NYSE AMERICAN':'AMEX','OTC':'OTC'};
 const prefix=exchanges[exchange];if(!prefix)return null;
 // These share-class aliases were verified against TradingView symbol pages.
 const symbolTicker=({'BRK-B':'BRK.B','BRK-A':'BRK.A'}[ticker])||ticker;
 return {symbol:prefix+':'+symbolTicker,embeddable:true};
}
export const validWidgetSymbol=s=>typeof s==='string'&&/^(NASDAQ|NYSE|AMEX|OTC):[A-Z][A-Z0-9.\-]{0,14}$/.test(s);
export function tradingViewConfig(symbol){if(!validWidgetSymbol(symbol))throw new Error('Unverified chart symbol');return {autosize:true,symbol,interval:'D',timezone:'Asia/Seoul',theme:'light',style:'1',locale:'kr',allow_symbol_change:false,hide_top_toolbar:false,hide_side_toolbar:false,hide_legend:false,hide_volume:false,withdateranges:true,calendar:false,details:false,hotlist:false,save_image:true,backgroundColor:'#ffffff',gridColor:'rgba(229, 234, 240, 0.6)',watchlist:[],compareSymbols:[],studies:[],support_host:'https://www.tradingview.com'};}
export function tradingViewLink(symbol){return 'https://www.tradingview.com/chart/?'+new URLSearchParams({symbol});}
