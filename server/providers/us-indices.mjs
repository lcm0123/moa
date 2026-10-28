import {getPolicy,unavailable} from './base.mjs';

// Consumes a server-side index adapter. No stock-provider import or Finviz key.
export const cashIndices=Object.freeze([
 {id:'SPX',name:'S&P 500'}, {id:'COMP',name:'나스닥 종합'},
 {id:'NDX',name:'나스닥 100'}, {id:'DJI',name:'다우 산업평균'}
]);
const modes=new Set(['realtime','delayed','previous_close']);
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value));
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const checksFor=(code,message)=>cashIndices.map(index=>({...index,status:code,message,quoteAccess:code==='access_denied'?'denied':'unverified'}));
function failure(policy,status,code,message,extra={}){
 return {...unavailable(message,status,policy),checks:checksFor(code,message),...extra};
}
export function validateIndexResponse(data,receivedAt,policy){
 if(!data||!Array.isArray(data.items)||typeof data.source!=='string'||!data.source.trim()||!['open','closed','pre','post','unknown'].includes(data.session))return failure(policy,'error','invalid_response','지수 공급 응답 형식을 확인해야 합니다.',{receivedAt});
 const items=[],checks=[];
 for(const index of cashIndices){
  const matches=data.items.filter(row=>row?.id===index.id),row=matches[0];
  let code=null,message=null;
  if(!matches.length){code='not_returned';message='응답에 이 지수가 없습니다.';}
  else if(matches.length!==1){code='duplicate';message='같은 지수가 중복 반환되었습니다.';}
  else if(row.error==='not_entitled'){code='access_denied';message='공급처가 이 지수의 접근 권한을 거부했습니다.';}
  else if(row.error==='not_found'){code='not_found';message='공급처에서 이 지수를 찾지 못했습니다.';}
  else if(row.instrumentType!=='cash_index'||typeof row.providerSymbol!=='string'||!row.providerSymbol.trim()){code='identity_unverified';message='현물지수 구분과 공급처 심볼 확인이 필요합니다.';}
  else if(!finite(row.value)||row.value<=0||!finite(row.change)||!finite(row.changePct)){code='invalid_values';message='지수값·전일 대비·등락률 확인이 필요합니다.';}
  else if(!timestamp(row.asOf)||row.asOfKind!=='quote'||Date.parse(row.asOf)>Date.parse(receivedAt)+300000){code='invalid_timestamp';message='공급사 시세 기준시각 확인이 필요합니다.';}
  const mode=row?.mode??data.mode;
  if(!code&&!modes.has(mode)){code='mode_unverified';message='실시간·지연·전일 종가 구분 확인이 필요합니다.';}
  if(code){checks.push({...index,status:code,message,quoteAccess:code==='access_denied'?'denied':'unverified'});continue;}
  const delayMinutes=mode==='delayed'&&finite(row.delayMinutes??data.delayMinutes)&&(row.delayMinutes??data.delayMinutes)>0?(row.delayMinutes??data.delayMinutes):null;
  const item={...index,providerSymbol:row.providerSymbol,instrumentType:'cash_index',value:row.value,change:row.change,changePct:row.changePct,asOf:row.asOf,asOfKind:'quote',mode,delayMinutes};
  if(policy.chart&&Array.isArray(row.history))item.history=row.history.filter(point=>point&&timestamp(point.at)&&finite(point.value)).map(({at,value})=>({at,value}));
  items.push(item);checks.push({...index,status:'ready',quoteAccess:'available',providerSymbol:row.providerSymbol,quoteAsOf:row.asOf,mode,delayMinutes});
 }
 const latest=items.reduce((best,row)=>!best||Date.parse(row.asOf)>Date.parse(best)?row.asOf:best,null);
 const feedModes=new Set(items.map(row=>row.mode));
 return {status:items.length?'ready':'incomplete',items,checks,source:data.source.trim(),asOf:latest,receivedAt,asOfKind:'quote',mode:feedModes.size===1?items[0].mode:null,session:data.session,policy,
  message:items.length===cashIndices.length?'':items.length?'검증된 현물지수만 표시합니다.':'표시 가능한 현물지수 응답이 없습니다.'};
}
export async function usIndexProvider(env,{probe=false}={}){
 const policy=getPolicy(env,'US_INDICES');
 if(!env.US_INDICES_URL?.trim())return failure(policy,'disconnected','not_configured','별도 현물지수 API 설정 필요');
 let url;
 try{
  url=new URL(env.US_INDICES_URL);
  // Never retry cash indices through stock/screener/futures exports. This does
  // not assert that Finviz has no separate index API.
  const wrongFinvizExport=/(^|\.)finviz\.com$/i.test(url.hostname)&&/^\/export\/(stock|screener|futures)(\/|$)/i.test(url.pathname);
  if(url.protocol!=='https:'||url.username||url.password||wrongFinvizExport)throw new Error();
 }catch{return failure(policy,'error','invalid_endpoint','별도 현물지수 공급처의 HTTPS 주소를 설정해 주세요.');}
 if(!probe&&env.US_INDICES_ENABLED!=='true')return failure(policy,'disconnected','pending_verification','현물지수 연결 검증 대기');
 if(!probe&&!policy.display)return failure(policy,'restricted','display_not_permitted','현물지수 표시 권한 설정 필요');
 try{
  const response=await fetch(url,{headers:{Accept:'application/json',...(env.US_INDICES_KEY?{Authorization:'Bearer '+env.US_INDICES_KEY}:{})},redirect:'error',signal:AbortSignal.timeout(10000)});
  const receivedAt=new Date().toISOString(),extra={receivedAt,httpStatus:response.status};
  if(response.status===401)return failure(policy,'restricted','authentication_required','지수 API 인증을 확인해 주세요.',extra);
  if(response.status===403)return failure(policy,'restricted','access_denied','지수 API 계정·요금제의 접근 권한 확인이 필요합니다.',extra);
  if(response.status===429)return failure(policy,'error','rate_limited','지수 API 요청 한도에 도달했습니다.',extra);
  if(!response.ok)return failure(policy,'error','http_error','지수 API 응답 오류',extra);
  if(Number(response.headers.get('Content-Length')||0)>2000000)return failure(policy,'error','invalid_response','지수 응답 크기를 확인해 주세요.',extra);
  // Do not forward vendor error bodies, arbitrary fields or credentials to clients.
  const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0,text='';
  while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>2000000){await reader.cancel();return failure(policy,'error','invalid_response','지수 응답 크기를 확인해 주세요.',extra);}text+=decoder.decode(part.value,{stream:true});}
  text+=decoder.decode();let data;try{data=JSON.parse(text);}catch{return failure(policy,'error','invalid_response','지수 JSON 응답 형식을 확인해 주세요.',extra);}
  return {...validateIndexResponse(data,receivedAt,policy),httpStatus:response.status};
 }catch{return failure(policy,'error','connection_error','별도 지수 API 연결에 실패했습니다.');}
}
