import config from '../config/news-financial.json' with {type:'json'};
const finite=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e15;
const fraction=v=>finite(v)&&v<=1;
const nullable=(v,predicate=finite)=>v===null||predicate(v);
const scenarioNames={conservative:'보수',base:'기준',expansion:'확대',delay:'지연',cancellation:'취소'};
export function validateHorizon(value){
 if(value==null)return null;
 if(typeof value!=='object'||!Number.isInteger(value.start)||!Number.isInteger(value.end)||value.start<2000||value.end>2100||value.end<value.start||value.end-value.start>=config.maxHorizonYears)throw Error('INVALID_HORIZON');
 return {start:value.start,end:value.end};
}
const equipmentFields=['contractRecognized','newOrders','recurringService','baselineRevenue'];
const materialFields=['nominalThroughput','utilization','customerYield','consumptionPerUnit','supplierShare','unitPrice','supplierCapacity','supplierYield','inventoryReduction','baselineRevenue'];
// Only an authenticated owner's explicit assumptions enter this contract. The caller
// cannot label its values as verified contracts, company guidance or analyst forecasts.
export function validateScenarioInput(input,candidates){
 if(!input||!candidates.some(c=>c.asset.id===input.assetId)||!['equipment','materials'].includes(input.model))throw Error('INVALID_SCENARIO');
 const horizon=validateHorizon(input.horizon);if(!horizon||!['KRW','USD','EUR','JPY'].includes(input.currency)||![1,1000,1000000,100000000].includes(input.scale))throw Error('INVALID_SCENARIO');
 if(!Array.isArray(input.rows)||input.rows.length>config.maxHorizonYears*5)throw Error('INVALID_SCENARIO');
 const keys=new Set(),fields=input.model==='equipment'?equipmentFields:materialFields;
 const rows=input.rows.map(r=>{
  if(!config.scenarioKinds.includes(r.kind)||!Number.isInteger(r.year)||r.year<horizon.start||r.year>horizon.end||keys.has(r.kind+':'+r.year))throw Error('INVALID_SCENARIO');keys.add(r.kind+':'+r.year);
  if(r.incrementBasis!=='NO_ADDITIONAL_EVENT'||r.componentsExclusive!==true)throw Error('INVALID_SCENARIO_BASELINE');
  const values={};for(const k of fields){values[k]=r[k]??null;if(!nullable(values[k],['utilization','customerYield','supplierShare','supplierYield'].includes(k)?fraction:finite))throw Error('INVALID_SCENARIO');}
  if(input.model==='materials'&&(!['INPUT','GOOD_OUTPUT'].includes(r.throughputBasis)||!['panel','m2','hole','coated_m2','unit','tonne'].includes(r.processUnit)||!['kg','litre','unit','tonne'].includes(r.materialUnit)||!nullable(r.qualified,v=>typeof v==='boolean')))throw Error('INVALID_SCENARIO_UNITS');
  // Do not coerce an omitted boolean to false: unknown customer qualification is material.
  return {kind:r.kind,year:r.year,...values,incrementBasis:r.incrementBasis,componentsExclusive:true,
   ...(input.model==='materials'?{throughputBasis:r.throughputBasis,processUnit:r.processUnit,materialUnit:r.materialUnit,qualified:r.qualified}:{}),
   valueKind:'scenario_assumption'};
 });
 return {assetId:input.assetId,model:input.model,horizon,currency:input.currency,scale:input.scale,rows,version:config.version};
}
export function calculateScenarioRow(row,model){
 const fields=model==='equipment'?equipmentFields:materialFields,missing=fields.filter(k=>!finite(row[k]));
 if(row.incrementBasis!=='NO_ADDITIONAL_EVENT'||row.componentsExclusive!==true)return {revenue:null,incrementalRevenue:null,missing:['추가 변화가 없는 기준과 중복 없는 구성 확인 필요']};
 let revenue=null,formulaId=null,capBinding=null;
 if(model==='equipment'){
  if(!missing.some(k=>k!=='baselineRevenue'))revenue=row.contractRecognized+row.newOrders+row.recurringService;
  formulaId='annual_recognition + separate_new_orders + recurring_service';
 }else{
  // Supplier and process units are explicit. No implicit panel-to-area conversion.
  if(!['INPUT','GOOD_OUTPUT'].includes(row.throughputBasis)||!row.processUnit||!row.materialUnit)missing.push('공정·소재 단위');
  if(!['utilization','customerYield','supplierShare','supplierYield'].every(k=>fraction(row[k])))missing.push('가동률·수율·점유율');
  if(typeof row.qualified!=='boolean')missing.push('고객 승인');
  if(row.throughputBasis==='INPUT'){
   const i=missing.indexOf('customerYield');if(i>=0)missing.splice(i,1);
   const bad=missing.indexOf('가동률·수율·점유율');if(bad>=0&&['utilization','supplierShare','supplierYield'].every(k=>fraction(row[k])))missing.splice(bad,1);
  }else if(row.customerYield===0)missing.push('양품→투입 환산 수율이 0');
  if(!missing.some(k=>k!=='baselineRevenue')){
   const input=row.nominalThroughput*row.utilization/(row.throughputBasis==='GOOD_OUTPUT'?row.customerYield:1);
   const demand=Math.max(0,input*row.consumptionPerUnit*row.supplierShare-row.inventoryReduction);
   const capacity=row.supplierCapacity*row.supplierYield,delivered=row.qualified?Math.min(demand,capacity):0;
   revenue=delivered*row.unitPrice;capBinding=row.qualified&&capacity<demand;
  }
  formulaId='min(max(process_input * consumption * share - inventory_reduction, 0), supplier_capacity * supplier_yield) * unit_price';
 }
 if(revenue!==null&&!finite(revenue))missing.push('계산 범위 초과');
 if(!finite(revenue))revenue=null;
 const incrementalRevenue=revenue!==null&&finite(row.baselineRevenue)?revenue-row.baselineRevenue:null;
 return {revenue,incrementalRevenue,missing:[...new Set(missing)],formulaId,capBinding,operatingProfit:null,cashFlow:null};
}
export function sensitivity(row,model){
 const base=calculateScenarioRow(row,model),drivers=model==='equipment'?['contractRecognized','newOrders','recurringService']:['utilization','supplierShare','unitPrice','supplierCapacity'];
 // One input unit, explicitly labelled, is a local sensitivity, not a forecast range.
 return drivers.map(k=>{
  const delta=['utilization','supplierShare'].includes(k)?.01:1,next={...row,[k]:finite(row[k])?row[k]+delta:null};
  const possible=finite(row[k])&&(!['utilization','supplierShare'].includes(k)||next[k]<=1),calc=possible?calculateScenarioRow(next,model):null;
  return {input:k,delta,unit:delta===.01?'1%p':'입력 단위 1',revenueDelta:base.revenue!==null&&calc?.revenue!=null?calc.revenue-base.revenue:null,formulaId:'one_input_step_holding_other_assumptions_fixed'};
 });
}
export function buildFinancialImpact({demand,event,horizon,assumptions=null}){
 horizon=validateHorizon(assumptions?.horizon||horizon);
 const timing=demand.timing?.year,years=horizon?Array.from({length:horizon.end-horizon.start+1},(_,i)=>horizon.start+i):Number.isInteger(timing)?[timing]:[];
 const basis=horizon?'REQUESTED_HORIZON':years.length?'EVENT_MILESTONE_ONLY':'TIMING_UNKNOWN';
 const paths=years.map(year=>({year,revenue:null,incrementalRevenue:null,operatingProfit:null,cashFlow:null,
  explanation:timing===year?'기사에 제시된 사업 일정입니다. 공급사 매출 인식 시점은 별도 확인이 필요합니다.':'발주·납품·검수·매출 인식 일정을 확인해야 합니다.',evidenceId:demand.timing?.evidence?.sourceId||null}));
 const texts={conservative:'기존 설비 재사용·조달 축소 시 신규 주문 제한',base:'추가 지출과 공급사 선정·납품이 성립할 때 매출 연결',expansion:'별도 후속 발주와 공급 여력이 확인될 때 확대',delay:'계약·고객 승인·검수 지연 시 매출 반영 이연',cancellation:'사건 취소 시 신규 물량 연결 철회 · 기존 매출·위약금은 별도 확인'};
 const saved=assumptions?.rows||[],scenarios=config.scenarioKinds.map(kind=>({kind,label:scenarioNames[kind],valueKind:'scenario_assumption',description:texts[kind],
  rows:years.map(year=>{
   const input=saved.find(r=>r.kind===kind&&r.year===year),prefix=assumptions?`${config.version}:${assumptions.assetId}:${kind}:${year}`:null;
   const calculated=input?calculateScenarioRow(input,assumptions.model):{revenue:null,incrementalRevenue:null,missing:['연도별 인식액·물량·단가·기준 시나리오 미확인'],operatingProfit:null,cashFlow:null};
   return {year,...calculated,assumptionIds:input?Object.keys(input).filter(k=>finite(input[k])&&k!=='year').map(k=>prefix+':'+k):[],inputs:input||null,sensitivity:input?sensitivity(input,assumptions.model):[]};
  })}));
 return {version:config.version,horizon,basis,paths,scenarios,currency:assumptions?.currency||null,scale:assumptions?.scale||null,model:assumptions?.model||null,
  status:saved.length?'USER_SCENARIO':'QUALITATIVE',probability:null,expectedRevenue:null,
  missing:years.length?['연도별 회사 매출 인식액','추가 변화가 없는 기준 매출']:['매출 반영 연도','연도별 인식액·물량·단가','추가 변화가 없는 기준 매출'],
  caution:'가동일은 공급사 매출일이 아닙니다. 투자액·계약 총액을 매출에 더하지 않으며 매출을 이익·현금흐름으로 간주하지 않습니다.',
  eventCancelled:!!event.corrective};
}
