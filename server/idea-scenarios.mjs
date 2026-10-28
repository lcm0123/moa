// Conditional economic mechanisms, not an event detector or stock ranking.
// The same rules apply across industries. Company exposure is never inferred
// from a sector label, export percentage or product-sales evidence alone.
export const scenarioVersion='economic-scenarios-1';
const references={
 rates:{id:'rates',title:'Bank of England · 금리가 소비·차입·저축에 미치는 경로',url:'https://www.bankofengland.co.uk/explainers/what-are-interest-rates',kind:'GENERAL_PRINCIPLE'},
 fx:{id:'fx',title:'한국은행 · 환율과 외환시장에 대한 이해',url:'https://www.bok.or.kr/portal/bbs/B0000217/view.do?menuNo=200144&nttId=10087668',kind:'GENERAL_PRINCIPLE'}
};
const mentions=/원\s*\/?\s*달러\s*환율|달러\s*\/?\s*원\s*환율|원화\s*가치|원화|환율|금리|원자재\s*(?:가격|값)|원재료\s*(?:가격|값)|유가|소비\s*수요|제품\s*수요|수요/gu;
const up=/상승|인상|오르|오른|오르면|올라|올랐|올리|올려|높아|높은|높이|높여|늘어|늘리|증가|확대|강세|강해/;
const down=/하락|인하|내리|내려|떨어|낮아|낮은|낮추|낮춰|줄어|줄이|감소|위축|약세|약해/;
const negated=/(?:않|아니|못하|제외|반대)|(?:상승|하락|인상|인하|약세|강세)\s*없/;
const labelOf={RATE_UP:'금리 상승',RATE_DOWN:'금리 하락',KRW_WEAK:'원화 약세',KRW_STRONG:'원화 강세',INPUT_UP:'투입 비용 상승',INPUT_DOWN:'투입 비용 하락',DEMAND_UP:'수요 증가',DEMAND_DOWN:'수요 감소'};

export function parseIdeaScenario(text){
 const input=String(text||''),found=[...input.matchAll(mentions)],drivers=[],unresolved=[];
 for(let i=0;i<found.length;i++){
  const m=found[i],variable=m[0],tail=input.slice(m.index+m[0].length,Math.min(found[i+1]?.index??input.length,m.index+m[0].length+60)).split(/[.!?\n,;]|하지만|반면/)[0];
  const family=/금리/.test(variable)?'RATE':/원화|환율/.test(variable)?'FX':/수요/.test(variable)?'DEMAND':'INPUT';
  if(negated.test(tail)){unresolved.push(`${variable}: 부정·제외 조건이 있어 방향을 확정하지 않았습니다.`);continue;}
  const higher=up.test(tail),lower=down.test(tail);
  if(higher===lower){unresolved.push(`${variable}: 상승·하락 방향을 구체적으로 적어 주세요.`);continue;}
  let type;
  if(family==='FX'){
   if(variable==='환율'){unresolved.push('환율은 통화쌍과 표시 방향이 필요합니다. 원화 약세·강세처럼 적어 주세요.');continue;}
   const quoted=/달러/.test(variable);
   type=(quoted?higher:lower)?'KRW_WEAK':'KRW_STRONG';
  }else type=family+'_'+(higher?'UP':'DOWN');
  drivers.push({type,family,label:labelOf[type],premise:variable+tail,status:'USER_ASSUMPTION'});
 }
 // Opposite directions in one question are alternatives, not simultaneous facts.
 const conflicts=new Set(['RATE','FX','INPUT','DEMAND'].filter(f=>new Set(drivers.filter(d=>d.family===f).map(d=>d.type)).size>1));
 for(const family of conflicts)unresolved.push(`${{RATE:'금리',FX:'원화 가치',INPUT:'투입 비용',DEMAND:'수요'}[family]}의 반대 방향이 함께 있습니다. 비교할 시나리오를 하나씩 입력해 주세요.`);
 const unique=[...new Map(drivers.filter(d=>!conflicts.has(d.family)).map(d=>[d.type,d])).values()];
 const impactQuestion=/어떻게|영향|달라|좋아|나빠|실적|손익|수익|왜|아이디어|시나리오|어떨/.test(input);
 const active=found.some(m=>/금리|원화|환율/.test(m[0]))||impactQuestion&&found.length>0;
 if(!active)return null;
 if(unique.some(d=>d.family==='RATE')&&!/한국|국내\s*금리|미국|유럽|일본|기준금리|차입금리|대출금리/.test(input))unresolved.push('어느 나라의 어떤 금리인지 미지정입니다. 해당 금리에 연동된 차입·예금·고객 수요에 한해 적용합니다.');
 if(unique.some(d=>d.family==='FX'))unresolved.push('매출·비용·차입금의 실제 통화와 환헤지 비율은 기업 자료로 확인해야 합니다.');
 return {version:scenarioVersion,kind:'ECONOMIC_SCENARIO',drivers:unique,unresolved:[...new Set(unresolved)],status:unique.length?'CONDITIONAL':'NEEDS_CLARIFICATION'};
}

const channel=(id,driver,title,direction,summary,condition,checks,statement,timing,referenceIds=[])=>({id,driver,title,direction,summary,condition,checks,statement,timing,referenceIds,kind:'CONDITIONAL_INFERENCE'});
function channelsFor(d){
 const type=d.type,rise=type.endsWith('_UP'),weak=type==='KRW_WEAK';
 if(d.family==='RATE')return [
  channel(type+'-debt',type,'차입 비용',rise?'ADVERSE':'FAVORABLE',rise?'변동금리 차입이나 만기 도래 후 재차입의 이자 부담이 커질 수 있습니다.':'변동금리 차입이나 재차입의 이자 부담이 줄어들 수 있습니다.','해당 금리에 연동된 차입이 있어야 합니다. 고정금리·장기 만기라면 영향이 늦을 수 있습니다.',['변동·고정금리 비중','만기 일정과 차입 통화','순차입금·현금'], '이자 비용 · 일반 기업은 영업외손익','금리 재설정·차환 시',['rates']),
  channel(type+'-demand',type,'고객의 소비·투자',rise?'ADVERSE':'FAVORABLE',rise?'고객의 대출 부담과 저축 유인이 커져 구매량·투자가 약해질 수 있습니다.':'고객의 금융 부담이 완화되어 구매·투자가 늘어날 여지가 있습니다.','고객 국가, 제품 가격대, 필수 소비 여부와 경기 상황에 따라 다릅니다.',['고객 시장·가격대','판매량과 재주문','가격 인상·할인 정책'],'판매량 → 매출·영업이익','소비·발주 변화가 나타날 때',['rates']),
  channel(type+'-cash',type,'보유 현금의 이자',rise?'FAVORABLE':'ADVERSE',rise?'이자 수익이 생기는 예금·단기 금융자산의 수익이 늘어날 수 있습니다.':'예금·단기 금융자산의 이자 수익이 줄어들 수 있습니다.','보유 현금 전체가 아니라 해당 금리로 재가격되는 자산에 한정합니다.',['이자 발생 금융자산','적용 금리·만기','차입 비용과의 순효과'],'이자 수익 · 영업외손익','예금 금리 재설정 시',['rates'])
 ];
 if(d.family==='FX')return [
  channel(type+'-revenue',type,'외화 매출의 원화 환산',weak?'FAVORABLE':'ADVERSE',weak?'같은 외화 금액을 벌어도 원화로 환산한 매출은 늘어날 수 있습니다.':'같은 외화 금액의 원화 환산 매출은 줄어들 수 있습니다.','원화에 비해 강해진 통화로 매출이 발생하고 외화 판매가격·판매량이 유지되는 경우입니다.',['판매·결제 통화','수출과 현지 판매 구분','통화별 매출·환헤지'],'환산 매출 · 판매량 증가와 구별','매출 인식·결제 시',['fx']),
  channel(type+'-cost',type,'수입 원료·상품 비용',weak?'ADVERSE':'FAVORABLE',weak?'외화로 결제하는 원료·부품·상품의 원화 조달 비용이 늘어날 수 있습니다.':'외화로 결제하는 원료·부품·상품의 원화 조달 비용이 낮아질 수 있습니다.','해당 외화로 매입하는 비용이 있어야 합니다. 재고와 고정가격 계약은 반영 시점을 늦춥니다.',['매입 통화와 수입 원가','재고·매입 계약','판매가격 전가·환헤지'],'매출원가 → 영업이익률','재고 소진·매입 계약 갱신 시',['fx']),
  channel(type+'-net',type,'현지 생산·외화 부채', 'MIXED',weak?'해외 매출과 현지 비용은 함께 커질 수 있고, 외화 부채의 원화 부담도 증가할 수 있습니다.':'해외 매출과 현지 비용은 함께 줄어들 수 있고, 외화 부채의 원화 부담은 줄어들 수 있습니다.','같은 통화의 매출·비용은 일부 상쇄됩니다. 해외 매출 비중만으로 순이익 효과를 계산할 수 없습니다.',['생산지·현지 비용','외화 자산과 부채','헤지 계약·민감도 주석'],'영업손익·외환손익 · 환산차이는 별도','손익 인식·결제·평가 시',['fx'])
 ];
 if(d.family==='INPUT')return [channel(type+'-cost',type,'투입 가격과 판매가격의 차이',rise?'ADVERSE':'FAVORABLE',rise?'해당 원료를 사는 기업은 판매가격에 전가하지 못한 만큼 마진이 줄어들 수 있습니다.':'원가 하락이 판매가격 하락보다 빠르면 구매 기업의 마진이 개선될 수 있습니다.','원료 생산자는 구매 기업과 영향이 다를 수 있습니다. 재고·계약·가격 전가를 함께 봅니다.',['실제 원재료 구성','매입·판매가격 연동','재고 평가·원가 반영 시차'],'매출원가 → 영업이익률','재고 소진·계약 갱신 시')];
 if(d.family==='DEMAND')return [channel(type+'-sales',type,'판매량과 생산 여력',rise?'FAVORABLE':'ADVERSE',rise?'해당 제품의 주문이 실제 매출로 이어지면 판매량이 늘고 고정비 부담이 완화될 수 있습니다.':'해당 제품의 판매량과 가동률이 낮아지면 고정비 부담이 커질 수 있습니다.','제품·고객 시장이 일치해야 합니다. 수주·취소·재고·생산 여력·가격 변화에 따라 달라집니다.',['제품별 매출·고객 시장','주문·재고·가동률','판매가격·변동비'],'매출 → 영업이익','납품·매출 인식 시')];
 return [];
}

export function buildIdeaScenario(input,inline){
 const parsed=parseIdeaScenario(input.text);if(!parsed||['invalidated','cancelled'].includes(inline?.status))return null;
 const channels=parsed.drivers.flatMap(channelsFor),types=new Set(parsed.drivers.map(d=>d.type));
 // A central bank named as the actor is not the business being analysed.
 const financialSector=/(?:은행|보험사|보험업|증권사|증권업|금융회사|금융기업)/.test(input.text.replace(/한국은행|중앙은행|미국\s*연방준비은행/g,''));
 const directions=new Set(channels.map(c=>c.direction)),mixed=directions.has('MIXED')||directions.has('FAVORABLE')&&directions.has('ADVERSE');
 const summary=!channels.length?'변화 방향을 먼저 구체화하면 영향을 나눠 살펴볼 수 있습니다.':financialSector?'금융업은 이자 수익·비용이 핵심 영업입니다. 아래 일반 기업 경로만으로 손익을 판단할 수 없습니다.':types.has('RATE_UP')&&types.has('KRW_WEAK')?'외화 매출의 환산 효과와 수입 원가·차입 비용·소비 부담이 엇갈릴 수 있습니다. 순효과는 기업의 수출입·부채 구조에 따라 달라집니다.':mixed?'유리한 경로와 불리한 경로가 함께 있습니다. 매출·비용·차입 구조를 나눠 봐야 순효과를 판단할 수 있습니다.':'입력한 변화가 실제 사업에 적용되는 조건부터 확인합니다. 판매량·가격·비용이 함께 달라질 수 있어 영향 규모는 아직 계산하지 않습니다.';
 const products=[...new Map((inline?.interpretation?.products||input.products||[]).filter(p=>!p.discoveryOnly).map(p=>[p.term,p])).values()],subject=products.slice(0,2).map(p=>p.term).join('·')||'기업';
 const hypotheses=[];
 if(parsed.drivers.some(d=>d.family==='FX'))hypotheses.push(
  {title:'외화 매출·원화 비용이 큰 사업',question:'매출 환산 효과가 원가 변화보다 클까?',condition:'결제 통화, 국내 생산 비중, 외화 원가와 헤지를 함께 확인'},
  {title:'수입 원료·상품 의존 사업',question:'판매가격을 바꿔 원가 변화를 흡수할 수 있을까?',condition:'수입 원가 비중, 재고 소진 시점, 판매가격 결정력 확인'},
  {title:'해외 현지 생산·판매 사업',question:'현지 매출과 비용이 얼마나 상쇄될까?',condition:'해외 매출을 전부 국내 수출로 간주하지 않음'});
 if(parsed.drivers.some(d=>d.family==='RATE'))hypotheses.push({title:'차입과 현금 보유 구조가 다른 사업',question:'이자 비용과 이자 수익 중 어느 쪽 변화가 클까?',condition:'변동금리 차입·만기·이자 발생 자산을 동일 통화와 기간으로 비교'});
 const followups=[];
 if(parsed.drivers.some(d=>d.family==='FX'))followups.push(`${subject}에서 원화 약세가 매출과 수입 원가에 미치는 영향을 비교해줘`);
 if(parsed.drivers.some(d=>d.family==='RATE'))followups.push(`${subject}에서 ${types.has('RATE_UP')?'금리 하락':'금리 상승'}이 실적에 어떤 영향을 줄까?`);
 if(products.length)followups.push(`${products[0].term} 관련 사업을 실제로 하는 기업과 제품 매출 근거를 찾아줘`);
 // Do not claim product sales prove exposure to a macro shock. Financial facts
 // remain in the existing, independently validated financial view.
 const companies=[...(inline?.candidates||[]),...(inline?.conditional||[])];
 const evidence=companies.slice(0,6).map(c=>({asset:c.asset,product:c.product,source:c.businessEvidence,origin:c.evidenceOrigin,exposure:'UNVERIFIED'}));
 const referenceIds=[...new Set(channels.flatMap(c=>c.referenceIds))];
 return {...parsed,summary,channels,hypotheses,followups,financialSector,exposureStatus:'UNVERIFIED',evidence,
  checks:[...new Set(channels.flatMap(c=>c.checks))],references:referenceIds.map(id=>references[id]),
  basis:'일반 경제 원리에 따른 조건부 설명입니다. 질문의 금리·환율 변화가 실제 발생했다는 검증 결과나 특정 기업의 실적 전망이 아닙니다.',
  evidenceStatus:inline?.states?.data||'INSUFFICIENT',externalStatus:inline?.states?.external||'NOT_REQUESTED',
  missing:financialSector?['은행·보험·증권업의 순이자마진·조달·평가손익은 별도 분석 필요']:['기업별 수출입 통화·원가·부채·헤지 노출 미확인','정량 손익과 최종 영향 방향은 미산출'],asOf:input.asOf};
}
