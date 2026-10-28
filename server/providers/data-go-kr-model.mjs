import {makeFscExact,parseFscJsonExact} from './fsc-exact.mjs';
export {makeFscExact,stampFscRows,fscHash} from './fsc-exact.mjs';
// FSC official V2 guides: data.go.kr/data/{15094808,15094806,15094807}/openapi.do.
export const fscOperations={
 stocks:{family:'stocks',path:'GetStockSecuritiesInfoService_V2/getStockPriceInfo_V2',type:'stock'},
 etf:{family:'products',path:'GetSecuritiesProductInfoService_V2/getETFPriceInfo_V2',type:'ETF'},
 etn:{family:'products',path:'GetSecuritiesProductInfoService_V2/getETNPriceInfo_V2',type:'ETN'},
 elw:{family:'products',path:'GetSecuritiesProductInfoService_V2/getELWPriceInfo_V2',type:'ELW'},
 indices:{family:'indices',path:'GetMarketIndexInfoService_V2/getStockMarketIndex_V2',type:'index'}
};
export const fscSource='금융위원회 · 공공데이터포털 / KRX';
export function fscDate(value){const s=String(value||'').replaceAll('-','');if(!/^\d{8}$/.test(s))return null;const d=s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6);return Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d?d:null;}
export const kstDate=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
export const dateBefore=(date,n=1)=>new Date(Date.parse(date+'T00:00:00Z')-n*86400000).toISOString().slice(0,10);
export function fscNumber(value){if(value===null||value===undefined||String(value).trim()==='')return null;const s=String(value).trim();if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s))return null;const n=Number(s);return Number.isFinite(n)?n:null;}
export function normalizeFscItem(row,operation,syncedAt,context={}){
 const def=fscOperations[operation],baseDate=fscDate(row.basDt),price=fscNumber(row.clpr);if(!def||!baseDate||price===null||price<0)throw new Error('INVALID_DATA');
 const fscExact=makeFscExact(row,{operation,endpoint:def.path,receivedAt:syncedAt,...context});
 const common={market:'KR',currency:'KRW',price,change:fscNumber(row.vs),changePct:fscNumber(row.fltRt),volume:fscNumber(row.trqu),turnover:fscNumber(row.trPrc),fscExact,open:fscNumber(row.mkp),high:fscNumber(row.hipr),low:fscNumber(row.lopr),baseDate,asOf:baseDate,asOfKind:'date',syncedAt,mode:'previous_close',session:'unknown',source:fscSource,provider:'data_go_kr',changeBasis:'previous_close',type:def.type,history:[],adjustment:'unverified'};
 for(const field of ['volume','turnover','open','high','low'])if(common[field]!==null&&common[field]<0)throw new Error('INVALID_DATA');
 if(operation==='indices'){
  if(typeof row.idxNm!=='string'||!row.idxNm.trim())throw new Error('INVALID_DATA');
  // Exact names only, never a sector, ETF or futures substitute.
  const normalized=row.idxNm.replace(/\s/g,''),id=({'코스피':'KOSPI','코스닥':'KOSDAQ','코스피200':'KOSPI200','KOSPI':'KOSPI','KOSDAQ':'KOSDAQ','KOSPI200':'KOSPI200'})[normalized]||'FSC:'+String(row.idxCsf||'')+':'+row.idxNm;
  return {...common,id,name:row.idxNm,value:price,currency:'POINT',instrumentType:'cash_index',classification:row.idxCsf||null};
 }
 const ticker=String(row.srtnCd||'').toUpperCase(),isin=String(row.isinCd||'').toUpperCase();
 if(!/^[0-9][0-9A-Z]{5}$/.test(ticker)||!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)||!String(row.itmsNm||'').trim())throw new Error('INVALID_DATA');
 return {...common,id:ticker,ticker,isin,name:row.itmsNm,exchange:row.mrktCtg||'KRX',country:null,marketCap:fscNumber(row.mrktTotAmt),sharesOutstanding:fscNumber(operation==='stocks'?row.lstgStCnt:row.stLstgCnt),sector:null,industry:null};
}
export function fscPolicy(env,family){
 if(env.LOCAL_PREVIEW===true)return {display:true,chart:true,ranking:true,treemap:true};
 let settings={};try{settings=JSON.parse(env.DATA_GO_KR_PUBLIC_POLICY||'{}')[family]||{}}catch{}
 const reviewed=!!fscDate(env.DATA_GO_KR_LICENSE_REVIEWED_AT);
 return {display:reviewed&&settings.display===true,chart:reviewed&&settings.display===true&&settings.chart===true,ranking:reviewed&&settings.display===true&&settings.ranking===true,treemap:reviewed&&settings.display===true&&settings.treemap===true};
}
export function nextFscSync(now){
 const date=kstDate(now);let next=Date.parse(date+'T13:15:00+09:00');if(next<=now)next+=86400000;
 while([0,6].includes(new Date(next+9*3600000).getUTCDay()))next+=86400000;
 return next;
}
export function parseFscResponse(text,http=200){
 let d;try{d=parseFscJsonExact(text)}catch{}
 const code=String(d?.response?.header?.resultCode??text.match(/<(?:returnReasonCode|resultCode)>([^<]{1,20})</)?.[1]??'');
 if(http!==200)throw Object.assign(new Error('HTTP_'+http),{code:'HTTP_'+http});
 if(!['00','0'].includes(code))throw Object.assign(new Error('FSC_'+( /^[0-9]{1,3}$/.test(code)?code:'FORMAT')),{code:code?'FSC_'+(/^[0-9]{1,3}$/.test(code)?code:'FORMAT'):'SCHEMA_CHANGED'});
 const b=d?.response?.body,total=Number(b?.totalCount),page=Number(b?.pageNo),size=Number(b?.numOfRows),raw=b?.items?.item;
 if(!b||[b.totalCount,b.pageNo,b.numOfRows].some(value=>typeof value!=='string'||!/^\d+$/.test(value))||!Number.isSafeInteger(total)||total<0||!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(size)||size<1)throw Object.assign(new Error('INVALID_RESPONSE'),{code:'SCHEMA_CHANGED'});
 const items=Array.isArray(raw)?raw:raw&&typeof raw==='object'?[raw]:[];
 if(total>0&&!items.length)throw Object.assign(new Error('INCOMPLETE_RESPONSE'),{code:'INCOMPLETE_PAGE'});
 if(items.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw Object.assign(new Error('INVALID_RESPONSE'),{code:'SCHEMA_CHANGED'});
 return {items,total,page,size,itemShape:Array.isArray(raw)?'array':'object'};
}
