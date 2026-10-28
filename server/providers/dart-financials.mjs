import {standaloneQuarters,latestPoints} from '../quarter-normalization.mjs';
import {cachedResearch} from '../research-cache.mjs';
import {financialYoY} from '../financial-model.mjs';
const tags={revenue:['ifrs-full_Revenue'],operatingIncome:['dart_OperatingIncomeLoss'],netIncome:['ifrs-full_ProfitLoss'],eps:['ifrs-full_DilutedEarningsLossPerShare'],operatingCashFlow:['ifrs-full_CashFlowsFromUsedInOperatingActivities'],capex:['ifrs-full_PurchaseOfPropertyPlantAndEquipment','ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities']};
const basisLabel=basis=>basis==='OFS'?'별도':'연결';
const statementRows=(rows,key)=>{const cash=['operatingCashFlow','capex'].includes(key);const selected=rows.filter(r=>r.sj_div===(cash?'CF':'IS'));return selected.length||cash?selected:rows.filter(r=>r.sj_div==='CIS');};
const num=v=>typeof v==='string'&&/^-?[\d,]+(?:\.\d+)?$/.test(v.trim())?Number(v.replaceAll(',','')):null;
const dates=s=>[...String(s||'').matchAll(/(\d{4})\.(\d{2})\.(\d{2})/g)].map(m=>m.slice(1).join('-'));
let queue=Promise.resolve();
export async function dartRequest(env,endpoint,params={},binary=false){
 const task=queue.catch(()=>{}).then(async()=>{await new Promise(resolve=>setTimeout(resolve,250));const u=new URL('https://opendart.fss.or.kr/api/'+endpoint);u.searchParams.set('crtfc_key',env.OPENDART_API_KEY||env.DART_API_KEY);for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);const r=await fetch(u,{signal:AbortSignal.timeout(25000)});if(!r.ok)throw new Error('OpenDART unavailable');if(binary)return r.arrayBuffer();const d=await r.json();if(!['000','013'].includes(d.status))throw new Error('OpenDART response '+d.status);return d;});queue=task;return task;
}
export async function dartZipXml(buffer){
 const a=new Uint8Array(buffer),view=new DataView(buffer);let end=-1;for(let i=a.length-22;i>=Math.max(0,a.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break;}if(end<0)throw new Error('Invalid DART ZIP');
 let at=view.getUint32(end+16,true);for(let i=0;i<view.getUint16(end+10,true);i++){
  if(view.getUint32(at,true)!==0x02014b50)throw new Error('Invalid directory');const method=view.getUint16(at+10,true),size=view.getUint32(at+20,true),unpacked=view.getUint32(at+24,true),n=view.getUint16(at+28,true),x=view.getUint16(at+30,true),c=view.getUint16(at+32,true),name=new TextDecoder().decode(a.slice(at+46,at+46+n)),offset=view.getUint32(at+42,true);at+=46+n+x+c;
  if(name!=='CORPCODE.xml')continue;if(unpacked>60000000||size>15000000)throw new Error('DART ZIP limit');const start=offset+30+view.getUint16(offset+26,true)+view.getUint16(offset+28,true),bytes=a.slice(start,start+size);if(method===0)return new TextDecoder().decode(bytes);if(method!==8)throw new Error('Unsupported ZIP');return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
 }throw new Error('DART company registry missing');
}
export function dartCompanyMap(xml){if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('Invalid XML');return [...xml.matchAll(/<list>([\s\S]*?)<\/list>/g)].map(m=>{const value=tag=>m[1].match(new RegExp('<'+tag+'>([^<]*)</'+tag+'>'))?.[1]?.trim();return {ticker:value('stock_code'),corpCode:value('corp_code'),name:value('corp_name')};}).filter(r=>/^[0-9A-Z]{6}$/.test(r.ticker||'')&&/^\d{8}$/.test(r.corpCode||''));}
export function parseDartAnnual(packets,corpCode,ticker,now=Date.now()){
 const points=new Map(),today=new Date(now).toISOString().slice(0,10);
 for(const {all,period,basis='CFS'} of packets){if(all.status!=='000'||period.status!=='000')continue;
  const anchors=period.list.filter(r=>r.corp_code===corpCode&&r.stock_code===ticker&&r.fs_div===basis&&['IS','CIS'].includes(r.sj_div)&&r.reprt_code==='11011');
  for(const [field,dateField] of [['thstrm_amount','thstrm_dt'],['frmtrm_amount','frmtrm_dt'],['bfefrmtrm_amount','bfefrmtrm_dt']]){
   const spans=[...new Set(anchors.map(r=>JSON.stringify(dates(r[dateField]))))];if(spans.length!==1)continue;const [start,end]=JSON.parse(spans[0]),duration=(Date.parse(end)-Date.parse(start))/86400000+1;if(!start||!end||duration<330||duration>380||end>today)continue;
   for(const [key,ids] of Object.entries(tags)){const rows=statementRows((all.list||[]).filter(r=>r.corp_code===corpCode&&r.reprt_code==='11011'&&ids.includes(r.account_id)&&r.account_detail==='-'&&r.currency==='KRW'&&num(r[field])!==null&&anchors.some(a=>a.rcept_no===r.rcept_no)),key);if(rows.length!==1)continue;const r=rows[0],filedAt=r.rcept_no.slice(0,4)+'-'+r.rcept_no.slice(4,6)+'-'+r.rcept_no.slice(6,8);if(filedAt>today)continue;const id=key+':'+end,old=points.get(id),p={value:num(r[field]),start,end,fy:Number(end.slice(0,4)),unit:key==='eps'?'KRW/shares':'KRW',tag:r.account_id,filedAt,accession:r.rcept_no,basis,form:'사업보고서 · '+basisLabel(basis),url:'https://dart.fss.or.kr/dsaf001/main.do?rcpNo='+r.rcept_no,source:'OpenDART',reportedField:field};if(!old||p.accession>old.accession)points.set(id,p);}
  }
 }
 const ends=[...new Set([...points.values()].map(p=>p.end))].sort();
 const annual=ends.map(end=>{const values={};for(const key of Object.keys(tags)){const p=points.get(key+':'+end);if(!p)continue;const prev=[...points].filter(([id,a])=>id.startsWith(key+':')&&a.fy===p.fy-1).map(([,a])=>a)[0];values[key]={...p,yoy:financialYoY(p,prev)};}
  const cf=values.operatingCashFlow,cap=values.capex;if(cf&&cap&&cf.accession===cap.accession)values.freeCashFlow={...cf,value:cf.value-cap.value,yoy:null,tag:'calculated:OCF-capex',formula:'영업현금흐름 − 유형자산 취득 현금지출',inputs:[{tag:cf.tag,value:cf.value},{tag:cap.tag,value:cap.value}]};
  return {end,fy:Number(end.slice(0,4)),label:'FY '+end.slice(0,4),values};});
 for(let i=1;i<annual.length;i++)if(annual[i].values.freeCashFlow)annual[i].values.freeCashFlow.yoy=financialYoY(annual[i].values.freeCashFlow,annual[i-1].values.freeCashFlow);
 return annual;
}
export function parseDartQuarters(packets,corpCode,ticker){
 const quarters=[],cumulative={};
 for(const {all,period,basis='CFS'} of packets){
  if(all.status!=='000'||period.status!=='000')continue;const anchor=period.list?.find(r=>r.corp_code===corpCode&&r.stock_code===ticker&&r.fs_div===basis&&['IS','CIS'].includes(r.sj_div));if(!anchor)continue;
  const [start,end]=dates(anchor.thstrm_dt);if(!start||!end||!start.endsWith('-01-01'))continue;
  for(const [key,ids] of Object.entries(tags)){if(key==='eps')continue;const rows=statementRows((all.list||[]).filter(r=>r.corp_code===corpCode&&r.rcept_no===anchor.rcept_no&&ids.includes(r.account_id)&&r.account_detail==='-'&&r.currency==='KRW'),key);if(rows.length!==1)continue;const r=rows[0],field=['operatingCashFlow','capex'].includes(key)||anchor.reprt_code==='11011'||anchor.reprt_code==='11013'?'thstrm_amount':'thstrm_add_amount',value=num(r[field]);if(value===null)continue;
   (cumulative[key]??=[]).push({value,start,end,basis,tag:r.account_id,unit:'KRW',fy:Number(anchor.bsns_year),accession:r.rcept_no,filedAt:r.rcept_no.slice(0,4)+'-'+r.rcept_no.slice(4,6)+'-'+r.rcept_no.slice(6,8),url:'https://dart.fss.or.kr/dsaf001/main.do?rcpNo='+r.rcept_no,source:'OpenDART',form:'정기보고서 · '+basisLabel(basis),reportedField:field});
  }
 }
 for(const {all,period,basis='CFS'} of packets){if(all.status!=='000'||period.status!=='000')continue;const rows=all.list||[],anchor=period.list.find(r=>r.corp_code===corpCode&&r.stock_code===ticker&&r.fs_div===basis&&['IS','CIS'].includes(r.sj_div));if(!anchor)continue;
  const [yearStart,end]=dates(anchor.thstrm_dt);if(!end)continue;const quarter={11013:1,11012:2,11014:3}[anchor.reprt_code];if(!quarter)continue;
  // Income-statement thstrm_amount is the standalone quarter; CF thstrm_amount is YTD.
  const finish=new Date(end+'T00:00:00Z'),start=new Date(Date.UTC(finish.getUTCFullYear(),finish.getUTCMonth()-2,1)).toISOString().slice(0,10),values={};
  for(const [key,ids] of Object.entries(tags)){const matches=statementRows(rows.filter(r=>r.corp_code===corpCode&&r.rcept_no===anchor.rcept_no&&ids.includes(r.account_id)&&r.account_detail==='-'&&r.currency==='KRW'&&num(r.thstrm_amount)!==null),key);if(matches.length!==1)continue;const r=matches[0];if(['operatingCashFlow','capex'].includes(key)&&quarter!==1)continue;
   if((Date.parse(end)-Date.parse(start))/86400000>100||quarter===1&&yearStart!==start)continue;values[key]={value:num(r.thstrm_amount),start,end,unit:key==='eps'?'KRW/shares':'KRW',tag:r.account_id,fy:Number(r.bsns_year),filedAt:r.rcept_no.slice(0,4)+'-'+r.rcept_no.slice(4,6)+'-'+r.rcept_no.slice(6,8),accession:r.rcept_no,url:'https://dart.fss.or.kr/dsaf001/main.do?rcpNo='+r.rcept_no,source:'OpenDART',basis,form:'분기·반기보고서 · '+basisLabel(basis),yoy:null};
  }const cf=values.operatingCashFlow,cap=values.capex;if(cf&&cap&&cf.accession===cap.accession)values.freeCashFlow={...cf,value:cf.value-cap.value,tag:'calculated:OCF-capex',formula:'영업현금흐름 − 유형자산 취득 현금지출',inputs:[{tag:cf.tag,value:cf.value},{tag:cap.tag,value:cap.value}]};if(Object.keys(values).length)quarters.push({end,fy:Number(anchor.bsns_year),label:'FY '+anchor.bsns_year+' Q'+quarter,values});
 }
 // Resolve revised direct quarters before attaching cumulative cash. Never let
 // packet arrival order select an older receipt or mix CFS/OFS within a quarter.
 const groups=new Map();for(const q of quarters){const basis=Object.values(q.values)[0]?.basis,id=q.end+':'+basis;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(q);}
 quarters.length=0;
 for(const group of groups.values()){const q={...group[0],values:{}};for(const k of new Set(group.flatMap(r=>Object.keys(r.values)))){const candidates=group.map(r=>r.values[k]).filter(Boolean);q.values[k]=latestPoints(candidates).sort((a,b)=>b.filedAt.localeCompare(a.filedAt)||b.accession.localeCompare(a.accession))[0];}quarters.push(q);}
 const consolidatedEnds=new Set(quarters.filter(q=>Object.values(q.values)[0]?.basis==='CFS').map(q=>q.end));for(let i=quarters.length-1;i>=0;i--)if(consolidatedEnds.has(quarters[i].end)&&Object.values(quarters[i].values)[0]?.basis!=='CFS')quarters.splice(i,1);
 for(const [key,points] of Object.entries(cumulative))for(const p of standaloneQuarters(points)){let q=quarters.find(r=>r.end===p.end);if(q&&Object.values(q.values)[0]?.basis!==p.basis)continue;if(!q){q={end:p.end,fy:p.fy,label:'FY '+p.fy+' Q'+Math.ceil(Number(p.end.slice(5,7))/3),values:{}};quarters.push(q);}if(!q.values[key])q.values[key]=p;}
 for(const q of quarters){const cf=q.values.operatingCashFlow,cap=q.values.capex;if(cf&&cap&&cf.basis===cap.basis&&cf.start===cap.start&&cf.end===cap.end&&cf.accession===cap.accession)q.values.freeCashFlow={...cf,value:cf.value-cap.value,tag:'calculated:OCF-capex',formula:'영업현금흐름 − 유형자산 취득 현금지출',inputs:[cf,cap]};}
 quarters.sort((a,b)=>a.end.localeCompare(b.end));for(const q of quarters)for(const [key,p] of Object.entries(q.values)){const prev=quarters.find(old=>old.fy===q.fy-1&&old.label.slice(-2)===q.label.slice(-2));p.yoy=financialYoY(p,prev?.values[key]);}return quarters;
}

export function dartBalanceRatios(packets,last){
 const net=last?.values.netIncome;if(!net||net.reportedField!=='thstrm_amount')return [];
 const packet=packets.find(p=>p.all.list?.some(r=>r.rcept_no===net.accession));if(!packet)return [];
 const account=tag=>{const a=packet.all.list.filter(r=>r.rcept_no===net.accession&&r.sj_div==='BS'&&r.account_id===tag&&r.account_detail==='-'&&r.currency==='KRW');return a.length===1?a[0]:null;};
 const eq=account('ifrs-full_Equity'),debt=account('ifrs-full_Liabilities'),equity=num(eq?.thstrm_amount),prior=num(eq?.frmtrm_amount),liabilities=num(debt?.thstrm_amount),ratios=[];
 if(equity>0&&Number.isFinite(liabilities))ratios.push({label:'총부채 / 자본',value:liabilities/equity*100,unit:'%',basis:last.label+' '+basisLabel(net.basis),formula:'공시 총부채 ÷ 자본 × 100',sourceUrl:net.url});
 if(equity>0&&prior>0)ratios.push({label:'ROE · '+basisLabel(net.basis)+' 전체 자본',value:net.value/((equity+prior)/2)*100,unit:'%',basis:last.label,formula:basisLabel(net.basis)+' 전체 순이익 ÷ 기초·기말 전체 평균 자본 × 100',sourceUrl:net.url});return ratios;
}
// Only an explicit no-data (013) permits OFS fallback. Auth/network failures must
// retain the last cached response, not silently change the accounting basis.
export async function loadDartFinancialPacket(env,params,request=dartRequest){
 let basis='CFS',all=await request(env,'fnlttSinglAcntAll.json',{...params,fs_div:basis});
 if(all.status==='013'){basis='OFS';all=await request(env,'fnlttSinglAcntAll.json',{...params,fs_div:basis});}
 if(all.status==='013')return null;
 if(all.status!=='000')throw new Error('OpenDART financial response unavailable');
 const period=await request(env,'fnlttSinglAcnt.json',params);
 return {all,period,basis};
}
export async function dartFinancials(env,ticker,interval='annual'){
 if(!env.OPENDART_API_KEY&&!env.DART_API_KEY)return {status:'disconnected',message:'OpenDART API 키 연결 필요',annual:[],quarterly:[]};
 const registry=await cachedResearch(env,'dart:companies',86400000,async()=>({items:dartCompanyMap(await dartZipXml(await dartRequest(env,'corpCode.xml',{},true)))}));const matches=registry.items.filter(r=>r.ticker===ticker);if(matches.length!==1)throw new Error('DART 종목 고유번호 미확인');const corpCode=matches[0].corpCode;
 const company=await cachedResearch(env,'dart:company:'+corpCode,86400000,()=>dartRequest(env,'company.json',{corp_code:corpCode}));if(company.corp_code!==corpCode||company.stock_code!==ticker)throw new Error('DART identity mismatch');if(env.DB)await env.DB.prepare('INSERT INTO issuer_links(market,ticker,issuer_id,name,source,verified_at) VALUES(?,?,?,?,?,?) ON CONFLICT(market,ticker) DO UPDATE SET issuer_id=excluded.issuer_id,name=excluded.name,source=excluded.source,verified_at=excluded.verified_at').bind('KR',ticker,corpCode,company.corp_name,'OpenDART company',company.cacheUpdatedAt).run();
 const today=new Date(),year=today.getUTCFullYear(),data=await cachedResearch(env,'dart:financials:v7:'+corpCode+':'+interval,21600000,async()=>{
  const packets=[];for(const y of Array.from({length:interval==='quarter'?5:6},(_,i)=>year-i))for(const reprt of interval==='quarter'?['11013','11012','11014','11011']:['11011']){const params={corp_code:corpCode,bsns_year:String(y),reprt_code:reprt};const packetResult=await cachedResearch(env,'dart:packet:v1:'+corpCode+':'+y+':'+reprt,21600000,async()=>({packet:await loadDartFinancialPacket(env,params)}));if(packetResult.stale)throw new Error('DART packet refresh failed');const packet=packetResult.packet;if(packet)packets.push(packet);}
  const annual=interval==='annual'?parseDartAnnual(packets,corpCode,ticker):[],quarterly=interval==='quarter'&&company.acc_mt==='12'?parseDartQuarters(packets,corpCode,ticker):[];
  const bases=[...new Set(packets.map(p=>p.basis))].map(basisLabel).join('·')||'공시',last=annual.at(-1),ratios=[];if(last?.values.revenue?.value>0&&last.values.revenue.accession===last.values.operatingIncome?.accession)ratios.push({label:'영업이익률',value:last.values.operatingIncome.value/last.values.revenue.value*100,unit:'%',basis:last.label,formula:'영업이익 ÷ 매출액 × 100',sourceUrl:last.values.revenue.url});ratios.push(...dartBalanceRatios(packets,last));return {status:annual.length||quarterly.length?'ready':'empty',annual,quarterly,ratios,source:'OpenDART · '+bases+' K-IFRS',currency:'KRW',limitations:['연결 우선, 미제공 시 별도 재무제표 · 회계기간과 접수번호 교차 확인 · 연결/별도 기준이 다르면 전년 대비 비교 제외','현금흐름과 4분기는 동일 기준 누적액 차감 시에만 표시 · 4분기 EPS 차감 금지','표준 계정으로 확인되지 않은 항목은 표시하지 않음']};
 });return {...data,identityStatus:'verified',identitySource:'https://dart.fss.or.kr/dsae001/main.do',profile:{name:company.corp_name,industryCode:company.induty_code,ticker,corpCode,currency:'KRW',country:'대한민국',exchange:company.corp_cls==='Y'?'코스피':company.corp_cls==='K'?'코스닥':null},updatedAt:data.cacheUpdatedAt};
}
