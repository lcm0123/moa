import {verifiedSecFallback} from '../server/catalyst/provider-health.mjs';
// Only issuer-bound, security-current evidence can satisfy fallback; metadata alone cannot.
export async function officialSecFallback({cache=[],ready,authority,read,asset=null,ir=[],annual=[],other=[]}){
 const attempts=[];
 for(const source of cache){if(source.body&&ready(source)&&authority(source)&&(!asset||verifiedSecFallback(source,asset)))return {sources:[{...source,cacheReused:true}],tier:'VERIFIED_SEC_CACHE',attempts};}
 for(const [tier,items] of [['COMPANY_OFFICIAL_IR',ir],['VERIFIED_ANNUAL_REPORT',annual],['OTHER_OFFICIAL_SOURCE',other]]){
  for(const item of items.slice(0,2)){
   const result=await read(item);attempts.push({tier,status:result.status,code:result.code||null});
   if(result.status==='read'&&result.body&&ready(result)&&authority(result)&&(!asset||verifiedSecFallback(result,asset)))return {sources:[result],tier,attempts};
  }
 }
 return {sources:[],tier:null,code:'SEC_ACCESS_UNAVAILABLE',attempts};
}
