import {fscIndices} from './data-go-kr.mjs';
import {withFscIndexHistory} from './fsc-index-history.mjs';
import {fetchProvider,unavailable,validNumber} from './base.mjs';
import {usIndexProvider} from './us-indices.mjs';
import {twelveIndexProvider} from './twelve-data-indices.mjs';
import {fmpIndexProvider} from './fmp-indices.mjs';
export async function indexProvider(env,market){if(market==='KR'&&(env.KR_INDICES_PROVIDER==='data_go_kr'||!env.KR_INDICES_URL&&env.DATA_GO_KR_SERVICE_KEY))return withFscIndexHistory(env,await fscIndices(env));if(market==='US')return env.FMP_API_KEY?.trim()?fmpIndexProvider(env):env.TWELVE_DATA_API_KEY?.trim()&&!env.US_INDICES_URL?.trim()?twelveIndexProvider(env):usIndexProvider(env);const result=await fetchProvider(env,`${market}_INDICES`);if(result.status==='ready'&&result.items.some(x=>!x.id||!x.name||!validNumber(x.value)||!validNumber(x.change)||!validNumber(x.changePct)||!Number.isFinite(Date.parse(x.asOf))))return unavailable('지수 데이터 형식을 확인해야 합니다.','error',result.policy);return result;}
