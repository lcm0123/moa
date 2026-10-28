import {fmpRequest} from './fmp-client.mjs';
// A successful HTTP request does not imply redistribution or that 'quarter' returned quarters.
export function segmentationStatus(response){
 if(response.error==='access_denied'||[402,403].includes(response.httpStatus))return 'PLAN_RESTRICTED';
 if(response.error&&response.error!=='empty')return 'REQUEST_FAILED';
 if(!response.data?.length)return 'NO_SEGMENT_DATA';
 return response.data.some(r=>/^Q[1-4]$/.test(r.period)&&r.data&&typeof r.data==='object')?'QUARTER_AVAILABLE':response.data.every(r=>['FY','annual'].includes(r.period))?'ANNUAL_ONLY':'REQUEST_FAILED';
}
export async function checkFmpBusinessSupport(env,symbol='AAPL'){
 const results=[];
 for(const path of ['/stable/revenue-product-segmentation','/stable/revenue-geographic-segmentation'])for(const period of ['quarter','annual']){
  const start=performance.now();try{const r=await fmpRequest(env,path,{symbol,period});results.push({symbol,path,requestedPeriod:period,httpStatus:r.httpStatus,status:segmentationStatus(r),rows:Array.isArray(r.data)?r.data.length:0,returnedPeriods:[...new Set((Array.isArray(r.data)?r.data:[]).map(x=>x.period))],dateRange:Array.isArray(r.data)?[r.data.at(-1)?.date,r.data[0]?.date]:[],latencyMs:Math.round(performance.now()-start),cached:!!r.cached,rights:'ACCOUNT_PERMISSION_UNCONFIRMED',publicDisplay:false});}catch(e){results.push({symbol,path,requestedPeriod:period,status:'REQUEST_FAILED',reason:e.code==='key_missing'?'KEY_NOT_CONFIGURED':'REQUEST_FAILED',rights:'ACCOUNT_PERMISSION_UNCONFIRMED',publicDisplay:false});}
 }
 return {checkedAt:new Date().toISOString(),results,documentation:'https://site.financialmodelingprep.com/developer/docs/stable/revenue-product-segmentation',note:'기간 옵션과 실제 반환 기간을 별도로 기록합니다. 계정별 장기 보관·외부 표시 권한 확인 전 숫자 공개를 제한합니다.'};
}
