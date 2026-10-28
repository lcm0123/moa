import {krxClassifications} from './krx-membership.mjs';
import {fetchProvider} from './base.mjs';
import {finvizClassifications} from './finviz-stocks.mjs';
export const classificationsProvider=(env,market,indexId)=>market==='KR'&&!env.KR_CLASSIFICATIONS_URL&&env.DATA_GO_KR_SERVICE_KEY?krxClassifications(env,indexId):market==='US'&&!env.US_CLASSIFICATIONS_URL&&env.FINVIZ_API_KEY?finvizClassifications(env,indexId):fetchProvider(env,`${market}_CLASSIFICATIONS`,{indexId},'treemap');
