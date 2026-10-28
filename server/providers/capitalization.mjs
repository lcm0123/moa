import {fscCapitalization} from './krx-membership.mjs';
import {fetchProvider} from './base.mjs';
import {finvizCapitalization} from './finviz-stocks.mjs';
export const capitalizationProvider=(env,market,indexId)=>market==='KR'&&!env.KR_CAPITALIZATION_URL&&env.DATA_GO_KR_SERVICE_KEY?fscCapitalization(env):market==='US'&&!env.US_CAPITALIZATION_URL&&env.FINVIZ_API_KEY?finvizCapitalization(env,indexId):fetchProvider(env,`${market}_CAPITALIZATION`,{indexId},'treemap');
