// Display labels only: keep the provider's title intact for storage and release classification.
const labels = new Map();
const define = (names, title, description) => names.split('|').forEach(name => labels.set(name.toLowerCase(), {title, description}));

define('CPI|Consumer Price Index', '소비자물가지수(CPI)', '가계가 구매하는 상품·서비스의 가격 수준');
define('Inflation Rate', '소비자물가 상승률(CPI)', '가계가 구매하는 상품·서비스의 가격 변화');
define('Core CPI|Core Inflation Rate', '근원 소비자물가', '식품·에너지를 제외한 소비자물가');
define('PCE|PCE Price Index|PCE Prices', '개인소비지출 물가(PCE)', '개인 소비지출에 포함된 상품·서비스의 가격');
define('Core PCE Price Index|Core PCE Prices', '근원 PCE 물가', '식품·에너지를 제외한 개인소비지출 물가');
define('PPI', '생산자물가지수(PPI)', '생산자가 판매하는 상품·서비스의 가격');
define('Core PPI', '근원 생산자물가', '식품·에너지를 제외한 생산자물가');
define('PPI Ex Food, Energy and Trade', '생산자물가 · 식품·에너지·유통 제외', '식품·에너지·유통서비스를 제외한 생산자물가');
define('Import Prices', '수입물가', '수입 상품·서비스의 가격 변화');
define('Export Prices', '수출물가', '수출 상품·서비스의 가격 변화');
define('Non Farm Payrolls|Nonfarm Payrolls|Non-Farm Payrolls|Employment Situation|Employment Report', '비농업 고용', '농업을 제외한 사업체의 고용 인원 변화');
define('Nonfarm Payrolls Private', '민간 비농업 고용', '정부·농업을 제외한 민간 고용 인원 변화');
define('Government Payrolls', '정부 부문 고용', '정부 부문의 고용 인원 변화');
define('Manufacturing Payrolls', '제조업 고용', '제조업 부문의 고용 인원 변화');
define('Unemployment Rate', '실업률', '경제활동인구 중 실업자의 비율');
define('U-6 Unemployment Rate', '광의 실업률(U-6)', '불완전 취업자 등을 포함한 넓은 범위의 실업 지표');
define('Participation Rate', '경제활동참가율', '일하거나 구직 중인 인구의 비율');
define('Average Hourly Earnings', '시간당 평균 임금', '민간 비농업 근로자의 시간당 임금 변화');
define('Average Weekly Hours', '주당 평균 근로시간', '민간 비농업 근로자의 평균 주간 근로시간');
define('ADP Employment Change', 'ADP 민간 고용', 'ADP 자료로 집계한 민간 고용 인원 변화');
define('ADP Employment Change Weekly', 'ADP 주간 민간 고용', 'ADP의 주간 민간 고용 변화 지표');
define('Initial Jobless Claims', '신규 실업수당 청구', '처음 실업수당을 신청한 건수');
define('Continuing Jobless Claims', '계속 실업수당 청구', '실업수당을 계속 신청한 건수');
define('Jobless Claims 4-week Average', '실업수당 청구 · 4주 평균', '신규 실업수당 청구 건수의 4주 평균');
define('JOLTs Job Openings', '구인 건수(JOLTS)', '기업이 채용을 위해 열어 둔 일자리 수');
define('JOLTs Job Quits', '자발적 퇴직(JOLTS)', '근로자가 스스로 그만둔 일자리 수');
define('Challenger Job Cuts', '챌린저 감원 계획', '기업이 발표한 감원 계획 규모');
define('Employment Cost Index', '고용비용지수', '임금과 복리후생을 포함한 노동비용 변화');
define('Employment Cost - Wages', '고용비용 · 임금', '근로자 임금 비용의 변화');
define('Employment Cost - Benefits', '고용비용 · 복리후생', '근로자 복리후생 비용의 변화');
define('Nonfarm Productivity', '비농업 노동생산성', '비농업 부문의 근로시간당 생산량');
define('Unit Labour Costs', '단위 노동비용', '생산 한 단위당 투입되는 노동비용');
define('GDP|Gross Domestic Product', '국내총생산(GDP)', '국내에서 생산한 최종 재화·서비스의 가치');
define('GDP Growth Rate', 'GDP 성장률', '국내에서 생산한 재화·서비스의 실질 성장률');
define('GDP Price Index', 'GDP 물가지수', '국내 생산 재화·서비스의 전반적인 가격');
define('GDP Sales', '국내 최종판매', 'GDP에서 재고 변동을 제외한 최종판매');
define('Corporate Profits', '기업 이익', '기업 이익의 변화');
define('Retail Sales', '소매판매', '소매업체의 상품 판매액 변화');
define('Retail Sales Ex Autos', '소매판매 · 자동차 제외', '자동차를 제외한 소매 판매액 변화');
define('Retail Sales Ex Gas/Autos', '소매판매 · 자동차·휘발유 제외', '자동차와 휘발유를 제외한 소매 판매액 변화');
define('Retail Sales Control Group', '소매판매 핵심 항목', '자동차·휘발유·건축자재·외식 등을 제외한 판매');
define('Personal Income', '개인소득', '가계가 받은 소득의 변화');
define('Personal Spending', '개인소비지출', '개인의 상품·서비스 지출 변화');
define('Real Personal Spending|Real Consumer Spending', '실질 개인소비지출', '물가 영향을 제외한 개인소비지출 변화');
define('Consumer Credit Change', '소비자 신용', '주택담보대출을 제외한 소비자 신용 잔액 변화');
define('ISM Manufacturing PMI', 'ISM 제조업 지수', '제조업 구매관리자 설문으로 본 업황');
define('ISM Services PMI|ISM Non-Manufacturing PMI', 'ISM 서비스업 지수', '서비스업 구매관리자 설문으로 본 업황');
for (const [field, korean, meaning] of [['Employment','고용','고용 상황'],['New Orders','신규주문','신규 주문 동향'],['Prices','가격','구매 가격 동향'],['Business Activity','사업활동','사업활동 수준']]) {
 for (const [sector, name] of [['Manufacturing','제조업'],['Services','서비스업']]) define('ISM '+sector+' '+field, 'ISM '+name+' '+korean, name+' 설문의 '+meaning);
}
define('Fed Interest Rate Decision|FOMC Interest Rate Decision|Federal Funds Rate', '연준 기준금리 결정', '연방공개시장위원회(FOMC)의 정책금리 결정');
define('FOMC Economic Projections', 'FOMC 경제전망', '연준 위원들의 성장·물가·실업률·금리 전망');
define('FOMC Minutes', 'FOMC 회의록', '연준 통화정책회의의 논의 기록');
define('Fed Press Conference|FOMC Press Conference', '연준 기자회견', '통화정책 결정 관련 기자회견');
define('Fed Beige Book', '연준 베이지북', '연방준비은행 관할 지역의 경기 동향 보고서');
define('Fed Balance Sheet', '연준 대차대조표', '연준이 보유한 자산과 부채 현황');
for (const [period, name] of [['Current','올해'],['1st Yr','내년'],['2nd Yr','2년 후'],['3rd Yr','3년 후'],['Longer','장기']]) define('Interest Rate Projection - '+period, '연준 금리 전망 · '+name, '연준 위원들의 정책금리 전망');
define('CB Consumer Confidence', '소비자신뢰지수(CB)', '소비자의 현재 경기와 향후 경제에 대한 평가');
define('CB Leading Index', '경기선행지수(CB)', '향후 경기 흐름을 살피는 선행지표 종합');
define('Michigan Consumer Sentiment', '미시간대 소비자심리지수', '소비자가 느끼는 경기와 가계 재정 상황');
define('Michigan Consumer Expectations', '미시간대 소비자 기대', '소비자의 향후 경제·재정 상황에 대한 기대');
define('Michigan Current Conditions', '미시간대 현재 경기 평가', '소비자의 현재 경제·재정 상황 평가');
define('Michigan Inflation Expectations', '미시간대 1년 기대인플레이션', '소비자가 예상하는 향후 1년 물가 상승률');
define('Michigan 5 Year Inflation Expectations', '미시간대 장기 기대인플레이션', '소비자가 예상하는 장기 물가 상승률');
define('Consumer Inflation Expectations', '소비자 기대인플레이션', '소비자가 예상하는 물가 상승률');
define('NFIB Business Optimism Index', 'NFIB 소기업 낙관지수', '소기업 경영자의 경기 전망');
define('RCM/TIPP Economic Optimism Index', 'RCM/TIPP 경제낙관지수', '소비자의 경제 전망과 신뢰 수준');
define('Building Permits', '건축허가', '신규 주택 건설을 위한 허가 건수');
define('Housing Starts', '주택착공', '새로 건설을 시작한 주택 수');
define('Existing Home Sales', '기존주택 판매', '이미 지어진 주택의 판매 건수');
define('New Home Sales', '신규주택 판매', '새로 지은 주택의 판매 건수');
define('Pending Home Sales', '잠정주택 판매', '계약은 체결됐지만 거래가 완료되지 않은 주택');
define('House Price Index', '주택가격지수', '주택 가격의 움직임');
define('S&P/Case-Shiller Home Price', '케이스실러 주택가격', '반복 매매 자료로 측정한 주택 가격 변화');
define('NAHB Housing Market Index', 'NAHB 주택시장지수', '주택 건설업체가 평가한 주택시장 상황');
define('MBA Mortgage Applications', 'MBA 주택담보대출 신청', '주택담보대출 신청 규모의 변화');
define('MBA Mortgage Market Index', 'MBA 주택담보대출 지수', '주택 구입·재융자 대출 신청 동향');
define('MBA Mortgage Refinance Index', 'MBA 재융자 지수', '주택담보대출 갈아타기 신청 동향');
define('MBA Purchase Index', 'MBA 주택구입 대출 지수', '주택 구입 목적의 대출 신청 동향');
define('Construction Spending', '건설지출', '건설 공사에 지출한 금액 변화');
define('Industrial Production', '산업생산', '제조업·광업·공익사업의 생산량 변화');
define('Manufacturing Production', '제조업 생산', '제조업 생산량의 변화');
define('Capacity Utilization', '설비가동률', '생산능력 대비 실제 생산 수준');
define('Durable Goods Orders', '내구재 주문', '장기간 사용하는 제품에 대한 신규 주문');
define('Durable Goods Orders Ex Transp', '내구재 주문 · 운송장비 제외', '운송장비를 제외한 내구재 신규 주문');
define('Durable Goods Orders ex Defense', '내구재 주문 · 국방 제외', '국방 관련 주문을 제외한 내구재 주문');
define('Non Defense Goods Orders Ex Air', '핵심 자본재 주문', '국방·항공기를 제외한 자본재 신규 주문');
define('Factory Orders', '공장 주문', '제조업체의 신규 주문액 변화');
define('Factory Orders ex Transportation', '공장 주문 · 운송장비 제외', '운송장비를 제외한 제조업 신규 주문');
define('Business Inventories', '기업 재고', '제조·도매·소매업체의 재고 변화');
define('Wholesale Inventories', '도매 재고', '도매업체가 보유한 재고 변화');
define('Retail Inventories Ex Autos', '소매 재고 · 자동차 제외', '자동차를 제외한 소매업체 재고 변화');
define('Balance of Trade', '무역수지', '수출액에서 수입액을 뺀 차액');
define('Goods Trade Balance', '상품 무역수지', '상품 수출액에서 상품 수입액을 뺀 차액');
define('Exports', '수출', '해외에 판매한 상품·서비스 금액');
define('Imports', '수입', '해외에서 구매한 상품·서비스 금액');
define('Current Account', '경상수지', '상품·서비스·소득 등 대외 거래의 수지');
define('Monthly Budget Statement', '월간 재정수지', '미국 연방정부의 월간 수입과 지출 차이');
define('Money Supply', '통화량', '경제 내 통화 공급 규모');
define('Foreign Bond Investment', '외국인 채권 투자', '외국인의 채권 투자 흐름');
define('Net Long-term TIC Flows', '장기 자본 순유입(TIC)', '국제 장기 증권투자의 순유입 규모');
define('Overall Net Capital Flows', '전체 자본 순유입', '국제 자본의 전체 순유입 규모');
define('Chicago Fed National Activity Index', '시카고 연은 전국활동지수', '생산·고용·소비 등으로 본 미국 경제활동');
define('Chicago PMI', '시카고 구매관리자지수', '시카고 지역 구매관리자의 업황 평가');
define('NY Empire State Manufacturing Index', '뉴욕 연은 제조업지수', '뉴욕주 제조업체의 업황 평가');
define('NY Fed Services Activity Index', '뉴욕 연은 서비스업지수', '뉴욕 지역 서비스업체의 활동 동향');
define('Dallas Fed Manufacturing Index', '댈러스 연은 제조업지수', '텍사스 제조업체의 업황 평가');
define('Dallas Fed Services Index', '댈러스 연은 서비스업지수', '텍사스 서비스업체의 업황 평가');
define('Dallas Fed Services Revenues Index', '댈러스 연은 서비스업 매출', '텍사스 서비스업체의 매출 동향');
define('Kansas Fed Composite Index', '캔자스시티 연은 종합지수', '관할 지역 제조업의 종합적인 활동 동향');
define('Kansas Fed Manufacturing Index', '캔자스시티 연은 제조업지수', '관할 지역 제조업체의 활동 동향');
define('Philadelphia Fed Manufacturing Index', '필라델피아 연은 제조업지수', '관할 지역 제조업체의 업황 평가');
for (const [field, name] of [['Business Conditions','경기 전망'],['CAPEX Index','설비투자'],['Employment','고용'],['New Orders','신규주문'],['Prices Paid','구매가격']]) define('Philly Fed '+field, '필라델피아 연은 '+name, '지역 제조업 설문의 '+name+' 지표');
define('Richmond Fed Manufacturing Index', '리치먼드 연은 제조업지수', '관할 지역 제조업체의 활동 동향');
define('Richmond Fed Manufacturing Shipments Index', '리치먼드 연은 제조업 출하', '관할 지역 제조업체의 출하 동향');
define('Richmond Fed Services Revenues Index', '리치먼드 연은 서비스업 매출', '관할 지역 서비스업체의 매출 동향');
define('LMI Logistics Managers Index', '물류관리자지수(LMI)', '물류·운송·창고 활동에 대한 설문 지표');
define('Redbook', '레드북 소매판매', '주요 소매업체의 동일점포 판매 동향');
define('Total Vehicle Sales', '자동차 판매', '자동차 판매 규모');
define('Used Car Prices', '중고차 가격', '중고차 가격의 변화');
define('API Crude Oil Stock Change', 'API 원유 재고', '미국석유협회가 집계한 원유 재고 변화');
for (const [field, name] of [['Crude Oil Imports','원유 수입'],['Crude Oil Stocks','원유 재고'],['Cushing Crude Oil Stocks','쿠싱 원유 재고'],['Distillate Fuel Production','증류유 생산'],['Distillate Stocks','증류유 재고'],['Gasoline Production','휘발유 생산'],['Gasoline Stocks','휘발유 재고'],['Heating Oil Stocks','난방유 재고'],['Natural Gas Stocks','천연가스 재고'],['Refinery Crude Runs','정유시설 원유 투입']]) define('EIA '+field+' Change', 'EIA '+name, '미국 에너지정보청 집계 '+name+' 변화');
define('Baker Hughes Oil Rig Count', '베이커휴즈 원유 시추기 수', '가동 중인 원유 시추기 수');
define('Baker Hughes Total Rigs Count', '베이커휴즈 전체 시추기 수', '가동 중인 원유·가스 등 전체 시추기 수');
define('WASDE Report', '세계 농산물 수급 보고서', '미 농무부의 주요 농산물 수급 전망');
define('NOPA Crush Report', 'NOPA 대두 가공 보고서', '미국 유지종자 가공업체의 대두 가공 실적');
for (const [field, name] of [['Corn','옥수수'],['Soy','대두'],['Wheat','밀']]) define('Quarterly Grain Stocks - '+field, '분기 곡물 재고 · '+name, name+'의 분기 재고 규모');
define('Labor Day', '미국 노동절', '미국 공휴일');
define('Columbus Day', '미국 콜럼버스의 날', '미국 연방 공휴일');
define('UN General Assembly', '유엔 총회', '유엔 회원국의 총회 일정');
define('President Trump and President Xi Summit', '미·중 정상회담', '미국·중국 정상 간 회담 일정');

const modifiers = new Map([['MoM','전월 대비'],['YoY','전년 대비'],['QoQ','전분기 대비'],['Adv','속보치'],['Prel','잠정치'],['Final','확정치'],['s.a','계절조정']]);
export function economicLabel(event) {
 const originalTitle = String(typeof event === 'string' ? event : event?.title ?? '').trim();
 let base = originalTitle, suffix = [];
 // Only terminal provider qualifiers are expanded; unknown names are never guessed.
 let match;
 while ((match = base.match(/\s+(MoM|YoY|QoQ|Adv|Prel|Final|s\.a)$/))) {
  suffix.unshift(modifiers.get(match[1]));base = base.slice(0, match.index);
 }
 let label = labels.get(base.toLowerCase());
 if (!label && (match = base.match(/^(\d+)-(Week|Month|Year) (Bill|Note|Bond|TIPS|FRN) Auction$/i))) {
  const term = match[1]+({week:'주',month:'개월',year:'년'}[match[2].toLowerCase()]);
  const type = {bill:'단기 국채',note:'국채',bond:'국채',tips:'물가연동국채',frn:'변동금리국채'}[match[3].toLowerCase()];
  label = {title:term+'물 '+type+' 입찰',description:'미국 재무부의 '+type+' 발행 입찰'};
 }
 if (!label && (match = base.match(/^(MBA )?(\d+)-Year Mortgage Rate$/))) label = {title:(match[1]?'MBA ':'')+match[2]+'년 주택담보대출 금리',description:match[2]+'년 만기 주택담보대출의 평균 금리'};
 if (!label && (match = base.match(/^Fed ([A-Za-z-]+) Speech$/))) {
  const names={Barkin:'바킨',Barr:'바',Bowman:'보먼',Goolsbee:'굴스비',Hammack:'해맥',Jefferson:'제퍼슨',Paulson:'폴슨',Powell:'파월',Schmid:'슈미드',Waller:'월러',Williams:'윌리엄스'};
  label = {title:'연준 '+(names[match[1]]||match[1])+' 연설',description:'연준 인사의 공개 발언 일정'};
 }
 if (!label && (match = base.match(/^NY Fed Bill Purchases (\d+) to (\d+) months$/))) label = {title:'뉴욕 연은 국채 매입 · '+match[1]+'~'+match[2]+'개월',description:'뉴욕 연방준비은행의 단기 국채 매입 일정'};
 return label ? {title:label.title+(suffix.length?' · '+suffix.join(' · '):''),description:label.description,originalTitle} : {title:originalTitle,description:'',originalTitle};
}

export function economicPeriod(value) {
 const text = String(value ?? '').trim(), months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
 const match = text.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:\s+(\d{4}))?$/);
 if (match) return (match[2]?match[2]+'년 ':'')+(months.indexOf(match[1])+1)+'월';
 return text.replace(/^Q([1-4])(?:\s+(\d{4}))?$/, (_, quarter, year) => (year?year+'년 ':'')+quarter+'분기');
}
