import {one} from './store.mjs';
import {decimal} from './profile-calculations.mjs';
// Reuse the financial service's DB cache. No requests, no annual / 4 and no
// assumption that internal segment revenue uses the issuer-total denominator.
export async function cachedCompanyRevenue(store,asset){
 if(asset.market!=='KR'||!asset.issuerId)return [];
 const output=[];
 for(const interval of ['quarter','annual']){
  const row=await one(store.db,'SELECT payload,updated_at FROM research_cache WHERE cache_key=?','dart:financials:v7:'+asset.issuerId+':'+interval);
  if(!row)continue;let data;try{data=JSON.parse(row.payload);}catch{continue;}
  for(const period of (data[interval==='quarter'?'quarterly':'annual']||[])){
   const r=period.values?.revenue,amountExact=decimal(r?.value);
   if(!r||amountExact===null||r.unit!=='KRW'||!['CFS','OFS'].includes(r.basis)||!/^\d{14}$/.test(r.accession||''))continue;
   output.push({amountExact,unit:'KRW',scope:r.basis==='CFS'?'CONSOLIDATED':'SEPARATE',period:{start:r.start,end:r.end,label:period.label,type:interval==='quarter'?'SINGLE_QUARTER':'ANNUAL',fiscalYear:r.fy},source:'OpenDART',sourceUrl:'https://dart.fss.or.kr/dsaf001/main.do?rcpNo='+r.accession,accession:r.accession,publishedAt:r.filedAt,cacheUpdatedAt:row.updated_at,valueOrigin:r.derived||r.inputs?.length?'DERIVED':'DISCLOSED',usage:'TOTAL_REVENUE_CROSSCHECK_ONLY'});
  }
 }
 return output;
}
