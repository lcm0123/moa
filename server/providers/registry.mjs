import {koreanStocks,usStocks} from './stocks.mjs';
import {indexProvider} from './indices.mjs';
import {futuresProvider} from './futures.mjs';
import {sectorProvider} from './sectors.mjs';
// Replace adapters independently; the browser never calls a vendor API.
export const providers={stocks:{KR:koreanStocks,US:usStocks},indices:{KR:env=>indexProvider(env,'KR'),US:env=>indexProvider(env,'US')},futures:{KR:env=>futuresProvider(env,'KR'),US:env=>futuresProvider(env,'US')},sectors:{KR:(env,indexId)=>sectorProvider(env,'KR',indexId),US:(env,indexId)=>sectorProvider(env,'US',indexId)}};
