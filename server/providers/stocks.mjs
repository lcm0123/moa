import {fscStocks} from './data-go-kr.mjs';
import {finvizStocks} from './finviz-stocks.mjs';
import {fetchProvider,unavailable,validNumber} from './base.mjs';
export async function stockProvider(env,market,params={},feature='display'){
 if(market==='KR'&&(env.KR_STOCKS_PROVIDER==='data_go_kr'||!env.KR_STOCKS_URL&&env.DATA_GO_KR_SERVICE_KEY))return fscStocks(env,params,feature);
 if(market==='US'&&!env.US_STOCKS_URL&&env.FINVIZ_API_KEY)return finvizStocks(env,params,feature);
 const result=await fetchProvider(env,`${market}_STOCKS`,params,feature);if(!['ready','empty'].includes(result.status))return result;
 if(result.items.some(s=>typeof s.id!=='string'||!s.id||typeof s.name!=='string'||typeof s.ticker!=='string'||s.market!==market||s.currency!==(market==='KR'?'KRW':'USD')||!validNumber(s.price)||s.price<0||!validNumber(s.changePct)||!validNumber(s.turnover)||s.turnover<0||!Number.isFinite(Date.parse(s.asOf))))return unavailable('종목 데이터 형식을 확인해야 합니다.','error',result.policy);
 return result;
}
export const koreanStocks=(env,params,feature)=>stockProvider(env,'KR',params,feature);
export const usStocks=(env,params,feature)=>stockProvider(env,'US',params,feature);
