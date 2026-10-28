import {krxConstituents} from './krx-membership.mjs';
import {finvizConstituents} from './finviz-stocks.mjs';
import {fetchProvider,unavailable} from './base.mjs';
export const universes={KOSPI200:{market:'KR',name:'코스피200'},KOSDAQ150:{market:'KR',name:'코스닥150'},SP500:{market:'US',name:'S&P 500'},NASDAQ100:{market:'US',name:'나스닥100'},DOW30:{market:'US',name:'다우30'}};
export async function constituentsProvider(env,indexId){
 const universe=universes[indexId];if(!universe)return unavailable('지원하지 않는 지수입니다.','error');
 if(universe.market==='KR'&&!env.KR_CONSTITUENTS_URL&&env.DATA_GO_KR_SERVICE_KEY)return krxConstituents(env,indexId);
 if(indexId==='KOSDAQ150'&&env.KOSDAQ150_SOURCE_CONFIRMED!=='true')return unavailable('코스닥150의 정확한 구성종목 출처 확인이 필요합니다. 코스닥 시가총액 상위 150개로 대체하지 않습니다.');
 if(universe.market==='US'&&!env.US_CONSTITUENTS_URL&&env.FINVIZ_API_KEY)return finvizConstituents(env,indexId);
 const result=await fetchProvider(env,`${universe.market}_CONSTITUENTS`,{indexId},'treemap');if(result.status!=='ready')return result;
 if(result.indexId!==indexId||result.verified!==true||!result.version||!Number.isFinite(Date.parse(result.effectiveAt))||result.items.some(s=>!s.id||!s.ticker||!s.name||s.market!==universe.market)||new Set(result.items.map(s=>s.id)).size!==result.items.length)return unavailable('지수 구성종목의 출처·버전·적용일을 확인해야 합니다.','incomplete',result.policy);
 return result;
}
