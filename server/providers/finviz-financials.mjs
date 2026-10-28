import {requireFinviz, FinvizError, csvNumber} from './finviz-client.mjs';
import {cachedResearch} from '../research-cache.mjs';
import {financialYoY} from '../financial-model.mjs';

const fields={I:{revenue:'Total Revenue',operatingIncome:'Operating Income',netIncome:'Net Income',eps:'EPS (Diluted)'},C:{operatingCashFlow:'Cash from Operating Activities',capex:'Capital Expenditures',freeCashFlow:'Free Cash Flow'}};
const source='Finviz · FactSet';
const fail=()=>{throw new FinvizError('Finviz 재무제표 응답 형식 또는 회계기간 확인 필요');};
function isoDate(value){
 const m=String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(!m)return null;
 const date=new Date(Date.UTC(+m[3],+m[1]-1,+m[2]));return date.getUTCMonth()===+m[1]-1&&date.getUTCDate()===+m[2]?date.toISOString().slice(0,10):null;
}
export function parseFinvizStatement(payload,ticker,sheet,now=Date.now()){
 const kind=sheet[0],quarter=sheet[1]==='Q',d=payload?.data,currency=payload?.currency;
 if(!fields[kind]||!['A','Q'].includes(sheet[1])||!d||!/^\w{3}$/.test(currency||'')||!Array.isArray(d.Period)||!d.Period.length||!Object.values(fields[kind]).some(k=>Array.isArray(d[k])))fail();
 const length=d.Period.length;
 for(const key of ['Period End Date','Period Length',...Object.values(fields[kind]).filter(k=>d[k]!=null)])if(!Array.isArray(d[key])||d[key].length!==length)fail();
 const rows=[],seen=new Set(),url=`https://finviz.com/stock?t=${encodeURIComponent(ticker)}&p=d&ty=${quarter?'eq':'ea'}`;
 for(let i=0;i<length;i++){
  const period=d.Period[i];if(period==='TTM')continue;
  const match=String(period).match(quarter?/^(\d{4})Q([1-4])$/:/^(\d{4})FY$/),end=isoDate(d['Period End Date'][i]);
  if(!match||!end||d['Period Length'][i]!==`${quarter?3:12} Months`||seen.has(end))fail();
  seen.add(end);if(end>new Date(now).toISOString().slice(0,10))continue;
  // Supplier gives period end and duration, not exact fiscal start or filing date.
  const finish=new Date(end+'T00:00:00Z'),start=new Date(Date.UTC(finish.getUTCFullYear(),finish.getUTCMonth()-(quarter?2:11),1)).toISOString().slice(0,10);
  const values={};
  for(const [key,field]of Object.entries(fields[kind])){
   const raw=d[field]?.[i],n=csvNumber(raw);if(n===null){if(raw!=null&&!['','-','N/A'].includes(String(raw).trim()))fail();continue;}
   if(key==='capex'&&n>0)continue; // Do not turn an unverified inflow into spending.
   values[key]={value:n*(key==='eps'?1:1e6)*(key==='capex'?-1:1),start,end,startDerived:true,unit:currency+(key==='eps'?'/shares':''),tag:'Finviz:'+field,basis:'Finviz-FactSet',fy:+match[1],quarter:quarter?'Q'+match[2]:null,interval:quarter?'quarter':'annual',filedAt:null,accession:`finviz:${ticker}:${period}`,source,url,sourceUrlLabel:'Finviz 재무제표',rawValue:n,rawUnit:key==='eps'?currency+'/shares':'million '+currency};
  }
  if(values.freeCashFlow){const cf=values.operatingCashFlow,cap=values.capex,fcf=values.freeCashFlow;if(cf&&cap&&Math.abs(cf.value-cap.value-fcf.value)<=20000){fcf.formula='영업현금흐름 − 설비투자 (Finviz Capital Expenditures)';fcf.inputs=[cf,cap];}else delete values.freeCashFlow;}
  rows.push({end,fy:+match[1],label:`FY ${match[1]}${quarter?' Q'+match[2]:''}`,values});
 }
 return {currency,rows:rows.sort((a,b)=>a.end.localeCompare(b.end))};
}
export function combineFinvizStatements(statements,ticker,now=Date.now()){
 const parsed=Object.fromEntries(Object.entries(statements).map(([sheet,payload])=>[sheet,parseFinvizStatement(payload,ticker,sheet,now)]));
 if(new Set(Object.values(parsed).map(p=>p.currency)).size!==1)fail();
 const merge=suffix=>{
  const income=parsed['I'+suffix],cash=parsed['C'+suffix];
  const rows=income.rows.map(row=>{const c=cash.rows.find(c=>c.end===row.end&&c.label===row.label);return {...row,values:{...row.values,...c?.values}};});
  for(const row of rows)for(const [key,p]of Object.entries(row.values)){const prev=rows.find(r=>r.fy===row.fy-1&&r.values[key]?.quarter===p.quarter);p.yoy=financialYoY(p,prev?.values[key]);}
  return rows;
 };
 const annual=merge('A'),quarterly=merge('Q');
 if(!annual.length&&!quarterly.length)throw new FinvizError('Finviz에 확인 가능한 재무제표가 없습니다.','empty');
 return {status:'ready',annual,quarterly,currency:parsed.IA.currency,source,basisLabel:'Finviz 재무제표',fcfDefinition:'FCF = 영업현금흐름 − 설비투자 (Finviz Capital Expenditures)',limitations:['Finviz 제공 회계연도·분기 기준 · TTM 제외','공시 접수번호·발표일 및 정확한 회계기간 시작일은 미제공','금액은 백만 단위에서 환산 · EPS는 주당 금액','FCF는 제공값과 영업현금흐름−설비투자가 일치할 때만 표시'],ratios:[]};
}
export async function fetchFinvizStatement(env,ticker,sheet){
 requireFinviz(env);
 if(!/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(ticker)||!['IA','IQ','CA','CQ'].includes(sheet))throw new FinvizError('Finviz 재무 조회 종목 또는 기간 확인 필요');
 try{
  const url=new URL('https://elite.finviz.com/api/statement');for(const [k,v]of Object.entries({t:ticker,so:'F',s:sheet,auth:env.FINVIZ_API_KEY.trim()}))url.searchParams.set(k,v);
  const response=await fetch(url,{headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new FinvizError(`Finviz 재무 연결 오류 (HTTP ${response.status})`);
  if(!/application\/json/i.test(response.headers.get('content-type')||''))fail();
  const reader=response.body.getReader(),decoder=new TextDecoder();let text='',bytes=0;
  while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>1000000){await reader.cancel();fail();}text+=decoder.decode(part.value,{stream:true});}
  return JSON.parse(text+decoder.decode());
 }catch(error){if(error instanceof FinvizError)throw error;throw new FinvizError('Finviz 재무 데이터를 불러오지 못했습니다.');}
}
export async function finvizFinancials(env,ticker){
 requireFinviz(env);
 const data=await cachedResearch(env,'finviz:statements:v1:'+ticker,21600000,async()=>{
  const statements={};for(const sheet of ['IA','IQ','CA','CQ'])statements[sheet]=await fetchFinvizStatement(env,ticker,sheet);
  return combineFinvizStatements(statements,ticker);
 });
 return {...data,updatedAt:data.cacheUpdatedAt,identityStatus:'provider_ticker',identitySource:`https://finviz.com/stock?t=${encodeURIComponent(ticker)}`,message:data.stale?'Finviz 갱신 실패 · 마지막 저장 자료':''};
}
