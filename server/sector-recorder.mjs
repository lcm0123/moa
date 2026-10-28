import {sectorProvider} from './providers/sectors.mjs';
import {historyPolicy,recordSectorSnapshot} from './sector-history.mjs';
// Local application job, active only while the existing preview server is running.
export function startSectorRecorder(env){
 let running=false;
 const collect=async()=>{
  if(running||!historyPolicy(env).store)return;
  running=true;
  try{
   const targets=[];
   if(env.FINVIZ_API_KEY||env.US_STOCKS_URL)targets.push(...['SP500','NASDAQ100','DOW30'].map(id=>['US',id]));
   if(env.KR_STOCKS_URL||env.DATA_GO_KR_SERVICE_KEY)targets.push(['KR','KOSPI200'],['KR','KOSDAQ150']);
   for(const [market,id] of targets){const data=await sectorProvider(env,market,id);await recordSectorSnapshot(env,data,market,id);}
  }catch{console.error('Sector history: collection failed; no synthetic data saved.');}finally{running=false;}
 };
 void collect();const timer=setInterval(collect,5*60000);timer.unref();return ()=>clearInterval(timer);
}
