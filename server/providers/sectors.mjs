import {unavailable,validNumber} from './base.mjs';
import {industryHierarchy} from '../../dist/js/market-hierarchy.js';
import {constituentsProvider,universes} from './constituents.mjs';
import {classificationsProvider} from './classifications.mjs';
import {capitalizationProvider} from './capitalization.mjs';
import {stockProvider} from './stocks.mjs';
export async function sectorProvider(env,market,indexId=market==='KR'?'KOSPI200':'SP500'){
 if(universes[indexId]?.market!==market)return unavailable('시장과 지수 선택이 일치하지 않습니다.','error');
 const membership=await constituentsProvider(env,indexId);
 if(membership.status!=='ready')return {...membership,indexId,universe:universes[indexId].name,feeds:{constituents:membership}};
 const [classification,caps,quotes]=await Promise.all([classificationsProvider(env,market,indexId),capitalizationProvider(env,market,indexId),stockProvider(env,market,{indexId},'treemap')]);
 const feeds={constituents:{status:membership.status,source:membership.source,asOf:membership.asOf,policy:membership.policy},classification:{status:classification.status,source:classification.source,asOf:classification.asOf,policy:classification.policy},capitalization:{status:caps.status,source:caps.source,asOf:caps.asOf,policy:caps.policy},quotes:{status:quotes.status,source:quotes.source,asOf:quotes.asOf,policy:quotes.policy}};
 const failed=[classification,caps].find(f=>f.status!=='ready')||(!['ready','empty'].includes(quotes.status)?quotes:null);
 if(failed)return {...unavailable(failed.message||'섹터 분류·시가총액·가격 연결 필요',failed.status),indexId,universe:universes[indexId].name,feeds};
 const excluded=[],groups=new Map();
 for(const member of membership.items){
  const c=classification.items.find(x=>x.id===member.id&&x.market===market);
  const cap=caps.items.find(x=>x.id===member.id&&x.market===market);
  const quote=quotes.items.find(x=>x.id===member.id&&x.market===market);
  let reason=null;
  if(!c?.sectorId||!c?.sectorName||!c?.classification||!c?.mappingSource)reason='섹터 분류 매핑 없음';
  else if(!validNumber(cap?.marketCap)||cap.marketCap<=0||cap.currency!==(market==='KR'?'KRW':'USD')||!Number.isFinite(Date.parse(cap.asOf)))reason='시가총액 없음';
  if(reason){excluded.push({id:member.id,name:member.name,reason});continue;}
  // A member with capitalization/mapping but no price stays uncolored; no invented return.
  const industryName=typeof (c.industryName??c.industry)==='string'?(c.industryName??c.industry).trim()||null:null;
  const stock={id:member.id,name:member.name,ticker:member.ticker,market,currency:cap.currency,isin:quote?.isin||null,type:quote?.type||null,marketCap:cap.marketCap,capAsOf:cap.asOf,sectorId:c.sectorId,sectorName:c.sectorName,industryName,price:quote?.price??null,changePct:quote?.changePct??null,asOf:quote?.asOf??null,mode:quotes.mode,quoteAvailable:Number.isFinite(quote?.price)&&Number.isFinite(quote?.changePct),asOfKind:quote?.asOfKind,capAsOfKind:cap.asOfKind};
  if(!groups.has(c.sectorId))groups.set(c.sectorId,{id:c.sectorId,name:c.sectorName,classification:c.classification,mappingSource:c.mappingSource,marketCap:0,stocks:[]});
  const group=groups.get(c.sectorId);group.marketCap+=stock.marketCap;group.stocks.push(stock);
 }
 const items=industryHierarchy([...groups.values()]);
 return {status:items.length?'ready':'incomplete',message:items.length?'':'구성종목의 섹터 분류 또는 시가총액 연결 필요',items,excluded,indexId,universe:universes[indexId].name,constituents:{version:membership.version,effectiveAt:membership.effectiveAt,source:membership.source,asOf:membership.asOf,total:membership.items.length,changes:membership.changes||[],observedAt:membership.observedAt,changeNote:membership.changeNote},baseDate:quotes.baseDate,syncedAt:quotes.syncedAt,stale:membership.stale||classification.stale||caps.stale||quotes.stale,asOf:quotes.asOf,asOfKind:quotes.asOfKind,mode:quotes.mode,session:quotes.session,delayMinutes:quotes.delayMinutes,source:quotes.source,feeds,policy:{display:true,treemap:true},calculation:'종목 타일 면적은 공급받은 시가총액 비례입니다. 섹터 합계는 포함된 종목의 시가총액 합산이며 공식 섹터지수가 아닙니다. 섹터 등락률은 계산하지 않습니다.'};
}
