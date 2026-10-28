import {comparison,withMargins,selectPeriods} from './financial-dashboard.js';

export const fundamentalBriefVersion='fundamental-brief-1';
const metricKeys=['revenue','operatingIncome','netIncome','operatingCashFlow','capex','freeCashFlow','eps'];
const required=['revenue','operatingIncome','freeCashFlow'];
const invalidStatus=new Set(['mapping_error','restricted','not_applicable']);
const known=value=>typeof value==='string'&&value.length>0&&!['UNKNOWN','UNSPECIFIED'].includes(value);
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const duration=p=>(Date.parse(p.end)-Date.parse(p.start))/86400000+1;
const scope=p=>p?.scope||p?.basis;
const format=n=>n.toLocaleString('ko-KR',{maximumFractionDigits:2});
const signed=(n,suffix='%')=>(n>0?'+':'')+format(n)+suffix;
export function fundamentalSafeLink(value){
 if(typeof value!=='string')return null;
 if(/^\/(?:reports|stock)(?:[/?#]|$)/.test(value)&&!/[\\\u0000-\u0020]/.test(value)&&!/%5c/i.test(value))return value;
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}
}
function validPoint(p,row,type){
 if(!p||!Number.isFinite(p.value)||!known(p.unit)||!known(p.tag)||!known(p.basis)||!known(p.accession)||!date(p.start)||!date(p.end)||p.end!==row.end||!fundamentalSafeLink(p.url))return false;
 const days=duration(p);return type==='annual'?days>=330&&days<=380:days>=70&&days<=110;
}
export function comparableBriefPoints(current,previous){
 if(!current||!previous||!date(current.start)||!date(current.end)||!date(previous.start)||!date(previous.end))return false;
 if(![current.value,previous.value].every(Number.isFinite)||!['unit','tag','basis'].every(k=>known(current[k])&&current[k]===previous[k])||!known(scope(current))||scope(current)!==scope(previous))return false;
 const gap=(Date.parse(current.end)-Date.parse(previous.end))/86400000;
 return gap>=330&&gap<=400&&Math.abs(duration(current)-duration(previous))<=14;
}
const samePeriod=(a,b)=>a&&b&&a.unit===b.unit&&a.basis===b.basis&&scope(a)===scope(b)&&a.start===b.start&&a.end===b.end&&a.accession===b.accession;
function normalRows(rows,type){
 const groups=new Map(),signatures=new Map();
 for(const row of rows||[]){
  if(!date(row?.end))continue;
  const values=Object.fromEntries(metricKeys.filter(k=>validPoint(row.values?.[k],row,type)).map(k=>[k,row.values[k]]));
  if(!Object.keys(values).length)continue;
  // A revision conflict is not resolved using response order. Keep only an
  // unambiguous row for each end date; the collector owns revision resolution.
  const signature=JSON.stringify(values);
  if(groups.has(row.end)){if(signatures.get(row.end)!==signature)groups.set(row.end,null);continue;}
  signatures.set(row.end,signature);
  const next={...row,values};
  const marginInput={...next,values:{...values}};
  for(const key of ['operatingIncome','freeCashFlow'])if(!samePeriod(values[key],values.revenue))delete marginInput.values[key];
  const computed=withMargins([marginInput])[0].values;
  for(const key of ['operatingMargin','freeCashFlowMargin'])if(computed[key])values[key]={...computed[key],yoy:null};
  groups.set(row.end,next);
 }
 return [...groups.values()].filter(Boolean).sort((a,b)=>a.end.localeCompare(b.end));
}
function previous(rows,row,key){
 const current=row?.values[key];
 return rows.filter(r=>r.end<row.end).map(r=>r.values[key]).filter(p=>comparableBriefPoints(current,p)).sort((a,b)=>Math.abs((Date.parse(current.end)-Date.parse(a.end))/86400000-365)-Math.abs((Date.parse(current.end)-Date.parse(b.end))/86400000-365))[0]||null;
}
function change(rows,row,key){
 const point=row?.values[key]||null,prior=point?previous(rows,row,key):null;
 return {point,previous:prior,...(prior?comparison(point,prior,key):{text:'전년 비교 자료 부족',pct:null}),delta:prior?point.value-prior.value:null};
}
function amount(point){
 if(!point||!Number.isFinite(point.value))return '자료 미확보';
 const n=point.value,u=point.unit;
 if(u==='KRW'&&Math.abs(n)>=1e12)return format(n/1e12)+'조 원';
 if(u==='KRW'&&Math.abs(n)>=1e8)return format(n/1e8)+'억 원';
 if(u!=='%'&&Math.abs(n)>=1e9)return format(n/1e9)+'십억 '+u;
 if(u!=='%'&&Math.abs(n)>=1e6)return format(n/1e6)+'백만 '+u;
 return format(n)+' '+u;
}
function businessSelection(business,market,ticker){
 if(!business||invalidStatus.has(business.status)||business.asset?.ticker&&business.asset.ticker!==ticker||business.asset?.symbol&&business.asset.symbol!==ticker||business.asset?.market&&business.asset.market!==market)return {description:null,dimension:null,dataset:null};
 const candidates=['PRODUCT','BUSINESS_SEGMENT'].flatMap((dimension,priority)=>(business.groups?.[dimension]?.datasets||[]).filter(d=>!d.historical&&d.items?.some(i=>i.metric!=='NON_DISCLOSURE')).map(dataset=>({dimension,dataset,priority})));
 candidates.sort((a,b)=>String(b.dataset.period?.end||'').localeCompare(String(a.dataset.period?.end||''))||a.priority-b.priority||String(b.dataset.publishedAt||'').localeCompare(String(a.dataset.publishedAt||'')));
 const selected=candidates[0],description=business.descriptions?.find(d=>typeof d.quote==='string'&&d.quote.trim()&&fundamentalSafeLink(d.url));
 return {description:description?{...description,url:fundamentalSafeLink(description.url)}:null,dimension:selected?.dimension||null,dataset:selected?.dataset||null};
}
function addSource(sources,{title,url,date:published=null,period=null,kind}){
 const safe=fundamentalSafeLink(url);if(!safe||sources.some(s=>s.url===safe&&s.period===period))return;
 sources.push({title,url:safe,date:published,period,kind});
}

// Deterministic presentation model over collector-normalized facts. This module
// does not fetch, read storage, use the clock, generate targets or rate a stock.
export function buildFundamentalBrief({market,ticker,financial=null,business=null,reports=[],quote=null,feed=null}={}){
 const version=fundamentalBriefVersion,limitations=[];
 const identityMismatch=financial?.profile?.ticker&&financial.profile.ticker!==ticker||financial?.identity?.market&&financial.identity.market!==market||financial?.identity?.ticker&&financial.identity.ticker!==ticker;
 const blocked=identityMismatch||invalidStatus.has(financial?.status)||financial?.identity&&financial.identity.status!=='verified'||financial?.identityStatus==='unverified';
 const annual=blocked?[]:normalRows(financial?.annual,'annual'),quarterly=blocked?[]:normalRows(financial?.quarterly,'quarter');
 const type=annual.length?'annual':'quarter',rows=annual.length?annual:quarterly,last=rows.at(-1)||null;
 const values=last?.values||{},changes=Object.fromEntries(['revenue','operatingIncome','operatingMargin','operatingCashFlow','capex','freeCashFlow','freeCashFlowMargin','eps'].map(k=>[k,change(rows,last,k)]));
 const currencies=[...new Set(required.map(k=>values[k]?.unit).filter(Boolean))];
 const currency=currencies.length===1?currencies[0]:null;
 const reference=values.revenue||values.freeCashFlow||values.operatingIncome;
 const financialSector=/financial|banks?|insurance|capital markets|credit services|금융|은행|보험|증권|투자은행/i.test([financial?.profile?.sector,financial?.profile?.industry,quote?.sector,quote?.industry].filter(Boolean).join(' '));
 const coreCompatible=required.every(k=>values[k])&&values.revenue.value>0&&required.every(k=>samePeriod(values[k],values.revenue));
 let state=last?(coreCompatible?'ready':'partial'):'empty';
 if(blocked)state=financial?.status==='restricted'?'restricted':'unavailable';
 if(financial?.status==='error'||financial?.status==='unavailable')state=last?'partial':'unavailable';
 if(financialSector&&last)state='partial';
 const period=last?{label:last.label||last.end,end:last.end,type,currency:currency||reference?.unit||financial?.currency||null,source:financial?.source||reference?.source||null,updatedAt:last.cacheRetrievedAt||financial?.cacheProvenance?.[type==='annual'?'annual':'quarterly']?.cacheRetrievedAt||financial?.updatedAt||null,basisLabel:financial?.basisLabel||(reference?.basis==='CFS'?'연결 재무제표':reference?.basis==='OFS'?'별도 재무제표':reference?.basis||'재무 기준 미확인')}:null;
 const support=[],risks=[];
 const fcf=changes.freeCashFlow,margin=changes.operatingMargin,revenue=changes.revenue,capex=changes.capex;
 const pairText=(label,c)=>`${label} ${amount(c.previous)} → ${amount(c.point)}${c.point?.unit==='%'&&c.delta!==null?' ('+signed(c.delta,'%p')+')':c.pct!==null?' ('+signed(c.pct)+')':''}`;
 if(fcf.previous){(fcf.delta>0?support:fcf.delta<0?risks:support).push(pairText('FCF',fcf));}
 else if(fcf.point)(fcf.point.value<0?risks:support).push('FCF '+amount(fcf.point)+' · 전년 비교 자료 부족');
 if(margin.previous)(margin.delta>=0?support:risks).push(pairText('영업이익률',margin));
 else if(margin.point)support.push('영업이익률 '+amount(margin.point)+' · 전년 비교 자료 부족');
 if(revenue.pct!==null)(revenue.pct>=0?support:risks).push('매출 전년 대비 '+signed(revenue.pct));
 if(capex.pct!==null&&capex.pct>0&&revenue.pct!==null&&capex.pct>revenue.pct&&coreCompatible)risks.push('설비투자 '+signed(capex.pct)+' · 매출 '+signed(revenue.pct)+'보다 빠른 증가');
 if(!coreCompatible&&last)risks.push('같은 기간·기준의 매출·영업이익·FCF가 모두 확보되지 않았습니다.');
 let title='확인된 재무 수치를 함께 살펴보세요',body='관측된 수치의 변화입니다. 매출과 이익이 현금흐름으로 이어지는지 함께 확인합니다.',badge='재무 요약';
 if(!last){title='분석할 자료가 아직 부족합니다';body=blocked?'기업 식별 또는 자료 표시 권한을 확인해야 합니다.':'저장된 재무 자료가 확보되면 같은 회계기간의 수치를 보여드립니다.';badge='자료 확인 필요';}
 else if(coreCompatible&&!financialSector){
  if(fcf.previous&&fcf.point.value<0&&fcf.previous.value>=0){title='FCF가 음수로 전환됐습니다';body='영업현금흐름과 설비투자 지출을 구분해 변화 원인을 확인할 필요가 있습니다.';}
  else if(fcf.pct!==null&&fcf.pct<0&&revenue.pct>0){title='매출은 늘었지만 FCF는 감소했습니다';body='매출 성장과 현금창출의 방향이 다릅니다. 설비투자와 운전자본 관련 공시를 함께 확인합니다.';}
  else if(fcf.previous&&fcf.delta>0&&margin.previous&&margin.delta>0){title='FCF와 영업이익률이 함께 높아졌습니다';body='같은 회계기간의 전년 수치와 비교한 변화입니다. 일회성 항목과 투자 지출이 지속될지도 확인합니다.';}
  else if(fcf.previous&&fcf.delta<0&&margin.previous&&margin.delta<0){title='FCF와 영업이익률이 함께 낮아졌습니다';body='현재 확인된 수치에서 현금흐름과 수익성이 모두 약해졌습니다. 사업별 실적과 투자 지출을 함께 확인합니다.';}
 }
 if(financialSector){title='업종별 재무 기준으로 확인해야 합니다';body='금융업은 일반 기업의 FCF·영업이익률 기준으로 자동 해석하지 않습니다. 아래는 확보된 원자료 수치입니다.';badge='업종 기준 확인';}
 if(financial?.status==='error'){badge='갱신 오류';limitations.push('재무 연결 오류로 마지막 저장 자료를 표시합니다.');}
 if(financial?.stale||financial?.freshness==='stored_older')limitations.push('마지막 저장 자료입니다. 회계기간 종료일과 자료 수집 시각을 구분해 확인하세요.');
 if(identityMismatch)limitations.push('요청 종목과 재무 자료의 기업 식별자가 다릅니다.');
 if(financial?.identityStatus==='provider_ticker')limitations.push('미국 재무는 Finviz 티커 기준이며 공시 접수번호·발표일은 제공되지 않습니다.');
 const metrics=[['freeCashFlow','잉여현금흐름 · FCF'],['freeCashFlowMargin','FCF 마진'],['operatingMargin','영업이익률'],['revenueGrowth','매출 성장률']].map(([key,label])=>{
  const c=changes[key==='revenueGrowth'?'revenue':key];
  return {key,label,value:key==='revenueGrowth'?c.pct:c.point?.value??null,unit:key==='revenueGrowth'?'%':c.point?.unit||null,changeText:c.text,changePct:c.pct,point:c.point,previous:c.previous};
 });
 const selectedBusiness=businessSelection(business,market,ticker),sources=[];
 for(const key of ['freeCashFlow','revenue','operatingIncome'])if(values[key])addSource(sources,{title:values[key].sourceUrlLabel||values[key].source||financial?.source||'재무 원자료',url:values[key].url,date:values[key].filedAt,period:period?.label,kind:'financial'});
 if(selectedBusiness.dataset)addSource(sources,{title:selectedBusiness.dataset.sourceTitle||'사업·매출 근거',url:selectedBusiness.dataset.sourceUrl,date:selectedBusiness.dataset.publishedAt,period:selectedBusiness.dataset.period?.label,kind:'business'});
 if(selectedBusiness.description)addSource(sources,{title:selectedBusiness.description.sourceTitle||selectedBusiness.description.title||'사업 설명 근거',url:selectedBusiness.description.url,date:selectedBusiness.description.publishedAt||null,kind:'business'});
 for(const report of reports||[]){if(report.ticker&&report.ticker!==ticker||report.market&&report.market!==market)continue;const reportUrl=[report.reportPath,report.href,report.url,report.id?'/reports?report='+encodeURIComponent(report.id):null,report.attachment?.url].find(fundamentalSafeLink);addSource(sources,{title:report.title||'종목 리포트',url:reportUrl,date:report.date||report.publishedAt||null,kind:'report'});if(sources.length>=10)break;}
 const ratios=blocked?[]:(financial?.ratios||[]).filter(r=>Number.isFinite(r.value)&&r.label&&r.basis&&r.formula&&fundamentalSafeLink(r.sourceUrl)).map(r=>({...r,sourceUrl:fundamentalSafeLink(r.sourceUrl)}));
 const snapshotMetrics=blocked?[]:(financial?.finvizSnapshot?.metrics||[]).filter(m=>Number.isFinite(m.value)&&m.field!=='Profit Margin').map(m=>({...m}));
 const annualSeries=selectPeriods(annual,'5').slice(-5).map(row=>({...row,values:Object.fromEntries(Object.entries(row.values).filter(([key,p])=>{const anchor=annual.at(-1)?.values[key];return anchor&&p.unit===anchor.unit&&p.basis===anchor.basis&&scope(p)===scope(anchor)&&p.tag===anchor.tag;}))}));
 const positive=[],negative=[],check=[];
 if(!financialSector&&coreCompatible){
  positive.push('다음 같은 회계기간에도 현재 FCF('+amount(values.freeCashFlow)+')와 영업이익률('+amount(values.operatingMargin)+')이 유지·개선되는지 확인합니다.');
  negative.push('매출이 증가해도 FCF가 감소하거나 영업이익률이 하락하면 현금창출과 수익성을 따로 점검합니다.');
  check.push('영업현금흐름·설비투자와 FCF의 변화', '사업별 매출과 영업이익률의 변화');
 }else check.push(financialSector?'업종별 건전성 지표가 포함된 공식 재무자료':'같은 회계기간·재무 기준의 매출·영업이익·FCF');
 if(selectedBusiness.dataset)check.push('사업·제품 매출 구성의 새 공시');
 limitations.push(...(financial?.limitations||[]), '경쟁력 점수·자체 목표주가·5년 평균 배수는 검증된 평가 자료가 없어 산정하지 않습니다.');
 return {version,state,period,fcfDefinition:financial?.fcfDefinition||values.freeCashFlow?.formula||'영업현금흐름 − 공급원에 정의된 설비투자',summary:{badge,title,body,support:support.slice(0,3),risks:risks.slice(0,3)},metrics,annualSeries,business:selectedBusiness,scenarios:{positive,negative,check},valuation:{ratios,snapshotMetrics,updatedAt:financial?.finvizSnapshot?.updatedAt||period?.updatedAt||null},sources,limitations:[...new Set(limitations.filter(Boolean))]};
}
