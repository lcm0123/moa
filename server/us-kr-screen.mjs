import {finvizCsv,parseCsv,csvNumber,requireFinviz} from './providers/finviz-client.mjs';
import {parseScreener} from './providers/finviz-stocks.mjs';
import {usSecurityTypes} from './providers/us-security-types.mjs';
import {stockType} from './stock-ranking.mjs';
// Reuse the Finviz CSV client/cache and stock parser, but request only the 500+
// index members and eleven necessary columns instead of parsing 11k full rows.
export async function industryScreen(env){
 requireFinviz(env,'display');const metadata=await usSecurityTypes(env);if(metadata.stale)throw Error('상품 분류 갱신 지연');
 const items=new Map();let receivedAt=null;
 for(const [index,f] of [['SP500','idx_sp500'],['NASDAQ100','idx_ndx'],['DOW30','idx_dji']]){
  const d=await finvizCsv(env,'/export/screener',{v:'152',c:'1,2,3,4,5,6,64,65,66,67,81',f},120000),base=parseScreener(d.text),raw=parseCsv(d.text,['Relative Volume']);
  const [min,max]={SP500:[400,550],NASDAQ100:[80,125],DOW30:[25,35]}[index];if(base.length<min||base.length>max)throw Error('지수 구성 응답 누락');
  receivedAt=receivedAt&&receivedAt<d.receivedAt?receivedAt:d.receivedAt;
  for(const [i,s] of base.entries()){const type=stockType(s,metadata),prior=items.get(s.ticker);if(prior&&(prior.industry!==s.industry||prior.name!==s.name))throw Error('중복 구성종목 식별 충돌');items.set(s.ticker,{...s,relativeVolume:csvNumber(raw[i]['Relative Volume']),indices:[...(prior?.indices||[]),index],securityType:type?.type,isEtf:type?.isEtf??null});}
 }
 return {items:[...items.values()],receivedAt,stale:false,typeAvailable:true};
}
