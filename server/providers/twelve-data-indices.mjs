import {twelveRequest,TwelveDataError} from './twelve-data-client.mjs';
import {getPolicy} from './base.mjs';

export const twelveIndexTargets=Object.freeze([
 {id:'SPX',name:'S&P 500',names:['sp500','sp500index','standardpoors500','standardpoors500index']},
 {id:'COMP',name:'나스닥 종합',names:['nasdaqcomposite','nasdaqcompositeindex']},
 {id:'NDX',name:'나스닥 100',names:['nasdaq100','nasdaq100index']},
 {id:'DJI',name:'다우 산업평균',names:['dowjonesindustrialaverage','dowjonesindustrialaverageindex']}
]);
const normalized=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const number=v=>(typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&Number.isFinite(Number(v))?Number(v):null;
export function findTwelveIndex(catalog,target){
 // The /indices catalog defines identity; ambiguous stock tickers are never used.
 const found=(catalog||[]).filter(r=>['United States','US'].includes(r.country)&&r.currency==='USD'&&target.names.includes(normalized(r.name))&&typeof r.symbol==='string'&&r.symbol&&r.exchange);
 return found.length===1?found[0]:null;
}
function problem(response){
 const code=Number(response.data?.code||response.httpStatus);
 if(code===401)return ['authentication_error','Twelve Data 키 인증 실패'];
 if(code===403||/starting with|upgrade|plan/i.test(response.data?.message||''))return ['access_denied','현재 요금제의 지수 접근 권한 확인 필요'];
 if(code===429)return ['rate_limited','조회 한도 대기'];
 return ['provider_error','Twelve Data 지수 조회 실패'];
}
export function parseTwelveIndexQuote(response,instrument,target){
 const q=response.data;
 if(response.httpStatus!==200||q?.status==='error')return {error:problem(response)};
 if(q.symbol!==instrument.symbol||q.exchange!==instrument.exchange||q.currency!=='USD'||!target.names.includes(normalized(q.name)))return {error:['identity_unverified','현물지수와 다른 종목 응답 · 표시 제외']};
 const value=number(q.close),change=number(q.change),changePct=number(q.percent_change),seconds=number(q.last_quote_at),received=Date.parse(response.receivedAt);
 if(value===null||value<=0||change===null||changePct===null)return {error:['invalid_values','지수값·등락률 미제공']};
 if(seconds===null||seconds<=0||seconds*1000>received+300000||!Number.isFinite(+new Date(seconds*1000)))return {error:['invalid_timestamp','시세 갱신 시각 미제공']};
 return {item:{id:target.id,name:target.name,providerSymbol:instrument.symbol,instrumentType:'cash_index',value,change,changePct,asOf:new Date(seconds*1000).toISOString(),asOfKind:'quote',mode:'unverified'}};
}
export async function twelveIndexProvider(env){
 const policy=env.LOCAL_PREVIEW===true?{display:true,chart:true,ranking:false,treemap:false}:getPolicy(env,'US_INDICES');
 const base={source:'Twelve Data',configured:!!env.TWELVE_DATA_API_KEY?.trim(),policy,items:[],asOf:null,mode:null,session:'unknown',checks:[]};
 if(!base.configured)return {...base,status:'disconnected',message:'Twelve Data 키 설정 필요'};
 if(!policy.display)return {...base,status:'restricted',message:'Twelve Data 공개 표시 권한 설정 필요'};
 try{
  const catalog=await twelveRequest(env,'/indices',{show_plan:'true'});
  if(catalog.httpStatus!==200||catalog.data?.status==='error'||!Array.isArray(catalog.data?.data)){const [status,message]=problem(catalog);return {...base,status:'error',message,checks:twelveIndexTargets.map(({id,name})=>({id,name,status,message}))};}
  const result={...base,status:'incomplete',receivedAt:catalog.receivedAt,catalogCheckedAt:catalog.receivedAt,checks:[],items:[]};
  for(const target of twelveIndexTargets){
   const instrument=findTwelveIndex(catalog.data.data,target);
   if(!instrument){result.checks.push({id:target.id,name:target.name,status:'symbol_unverified',message:'공급사 지수 목록에서 미확인'});continue;}
   try{
    const quote=await twelveRequest(env,'/quote',{symbol:instrument.symbol,exchange:instrument.exchange}),parsed=parseTwelveIndexQuote(quote,instrument,target);
    if(parsed.error){result.checks.push({id:target.id,name:target.name,status:parsed.error[0],message:parsed.error[1],httpStatus:quote.httpStatus});continue;}
    const item=parsed.item;
    if(policy.chart){
     try{const response=await twelveRequest(env,'/time_series',{symbol:instrument.symbol,exchange:instrument.exchange,interval:'1day',outputsize:'30',timezone:'UTC'}),s=response.data;
      if(response.httpStatus===200&&s.status==='ok'&&s.meta?.symbol===instrument.symbol&&s.meta?.exchange===instrument.exchange&&/index/i.test(s.meta?.type||'')&&Array.isArray(s.values))item.history=s.values.filter(p=>/^\d{4}-\d\d-\d\d$/.test(p.datetime)&&Number.isFinite(Date.parse(p.datetime))&&number(p.close)>0).map(p=>({at:p.datetime+'T00:00:00Z',value:number(p.close)})).reverse();
     }catch{item.history=[];}
    }
    result.items.push(item);result.checks.push({id:target.id,name:target.name,status:'ready',providerSymbol:instrument.symbol,quoteAsOf:item.asOf,mode:item.mode});
   }catch(e){result.checks.push({id:target.id,name:target.name,status:e instanceof TwelveDataError?e.code:'provider_error',message:'지수 조회 대기 또는 연결 오류'});}
  }
  result.status=result.items.length?'ready':'incomplete';result.mode=result.items.length?'unverified':null;result.asOf=result.items.reduce((last,item)=>last&&last>item.asOf?last:item.asOf,null);
  result.message=result.items.length?'Twelve Data · 조회 가능한 현물지수만 표시':'Twelve Data 키 등록됨 · 미국 현물지수 4종의 공급사 심볼 미확인';
  if(!result.items.length&&result.checks.some(c=>c.status!=='symbol_unverified'))result.message='Twelve Data 연결됨 · 지수별 조회 상태 확인 필요';
  return result;
 }catch(e){return {...base,status:'error',message:e instanceof TwelveDataError&&e.code==='key_missing'?'Twelve Data 키 설정 필요':e instanceof TwelveDataError&&['minute_limit','daily_limit'].includes(e.code)?'Twelve Data 조회 한도 대기':'Twelve Data 지수 목록을 불러오지 못했습니다.'};}
}
