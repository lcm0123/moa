import {usSecurityTypes} from './providers/us-security-types.mjs';

export function stockType(stock,metadata){
 // Explicit provider product types override a generic industry classification.
 const type=String(stock.type||'').toUpperCase();
 if(['ETF','ETN','ELW','STOCK','COMMON_STOCK','PREFERRED_STOCK'].includes(type))return {isEtf:type==='ETF',type,basis:'provider product type'};
 const exact=metadata?.items?.[stock.ticker];if(exact)return exact;
 // Finviz denotes a share class with a hyphen; the ACT directory uses a dot.
 // Only the one-letter class suffix convention is normalized, never names.
 if(stock.market==='US'&&/^[A-Z]{1,5}-[A-Z]$/.test(stock.ticker))return metadata?.items?.[stock.ticker.replace('-', '.')]||null;
 return null;
}
export function rankedItems(items,kind,metadata){
 const unique=new Map(items.map(s=>[s.market+':'+s.id,s]));let excluded=0,unknown=0;
 const eligible=[...unique.values()].filter(s=>{
  if(kind==='turnover'){const type=stockType(s,metadata);if(type?.isEtf){excluded++;return false;}if(!type)unknown++;}
  return Number.isFinite(s[kind])&&s[kind]>=0;
 }).sort((a,b)=>b[kind]-a[kind]||a.ticker.localeCompare(b.ticker));
 return {items:eligible.slice(0,100).map((s,i)=>({...s,rank:i+1,...(kind==='turnover'?{rankingSecurityType:stockType(s,metadata)}:{})})),excluded,unknown,eligibleCount:eligible.length,candidateCount:unique.size};
}
export async function stockRanking(env,provider,market,kind){
 // Finviz exports the full universe; FSC loads all pages for one baseline date.
 // Never limit to 100 before the ETF filter, otherwise replacements are lost.
 const result=await provider(env,{sort:kind,...(kind==='turnover'?{}:{limit:100})},'ranking');
 let metadata;
 if(kind==='turnover'&&market==='US'&&result.items.some(s=>!stockType(s))){
  try{metadata=await usSecurityTypes(env);}catch(error){return {...result,market,items:[],status:'error',rankingFilter:'exclude_etf_v1',message:error.message};}
 }
 const ranked=rankedItems(result.items,kind,metadata);
 return {...result,market,items:ranked.items,status:result.status==='ready'&&!ranked.items.length?'empty':result.status,
  ...(kind==='turnover'?{rankingFilter:'exclude_etf_v1',etfExcluded:true,excludedEtfCount:ranked.excluded,candidateCount:ranked.candidateCount,eligibleCount:ranked.eligibleCount,
   classification:{source:metadata?.source||result.source,receivedAt:metadata?.receivedAt||result.syncedAt||result.asOf,stale:!!metadata?.stale,unknownCount:ranked.unknown,displayedUnknownCount:ranked.items.filter(s=>!s.rankingSecurityType).length}}:{})};
}
