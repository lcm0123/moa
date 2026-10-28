// Only non-secret presentation defaults cross the server boundary.
export function marketConfig(env){
 const us=Boolean(env.US_STOCKS_URL||env.FINVIZ_API_KEY);
 const market=us&&!env.KR_STOCKS_URL&&!env.DATA_GO_KR_SERVICE_KEY?'US':'KR';
 return {defaultMarket:market,defaultRanking:market==='US'&&env.FINVIZ_API_KEY&&!env.US_STOCKS_URL?'volume':'turnover'};
}
