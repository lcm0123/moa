// Shared question vocabulary. These are discovery hints, never beneficiary facts.
export const questionScopeVersion='question-scope-2';
export const questionGroups=[
 {id:'industry',label:'산업·기술',examples:['AI 데이터센터 투자가 늘어나면 관련 기업은?','전기차 수요가 회복되면 어떤 기업을 살펴볼까?','로봇 도입이 늘어나면 부품·서비스 기업은?','우주·위성통신 시장과 연결되는 상장사는?']},
 {id:'energy',label:'에너지·인프라',examples:['전력망 투자가 늘어나면 관련 장비 기업은?','원전 건설이 늘어나면 관련 기업은?','해상풍력 설치가 늘어나면 어떤 사업이 연결돼?','물 부족이 심해지면 수처리 기업은?']},
 {id:'economy',label:'금리·환율·원자재',examples:['금리가 내려가면 어떤 기업에 영향이 있을까?','원화가 약세가 되면 수출 기업은 유리할까?','유가가 하락하면 항공·화학 기업에 어떤 영향이 있어?','구리 가격 상승에 노출된 기업은?']},
 {id:'consumer',label:'소비·인구·의료',examples:['고령화가 진행되면 의료·돌봄 관련 기업은?','외국인 관광객이 늘어나면 어떤 기업이 연결돼?','비만 치료제 시장이 커지면 관련 기업은?','소비가 둔화되면 어떤 기업에 부담이 될까?']},
 {id:'policy',label:'정책·무역',examples:['미국 관세가 높아지면 국내 기업에 어떤 영향이 있어?','방위비가 늘어나면 관련 기업은?','탄소 규제가 강화되면 어떤 기업을 살펴볼까?','주택 공급이 늘어나면 관련 기업은?']},
 {id:'business',label:'사업·공급망',examples:['기판 업체들이 증설하면 관련 장비·소재 기업은?','조선 발주가 늘어나면 기자재 기업은?','냉동 물류 수요가 증가하면 관련 기업은?','사이버보안 지출이 늘어나면 어떤 기업이 연결돼?']}
];
// Lexical equivalence only. Never equate a broad industry with a specific product.
export const researchConcepts=[
 ['INTEREST_RATE','금리',/금리|\binterest rates?\b/ig,'ECONOMIC',/차입|대출|부채|조달|이자|예대|보험|\b(?:borrow|debt|loan|financing|interest expense|net interest)/i],
 ['FX','환율',/환율|원화|달러\s*(?:강세|약세)|\b(?:exchange rates?|foreign exchange|currency depreciation|strong dollar|weak won)\b/ig,'ECONOMIC',/수출|수입|외화|환산|환차|헤지|\b(?:export|import|foreign currency|currency translation|hedg)/i],
 ['OIL','원유·유가',/유가|원유|\b(?:crude oil|oil prices?)\b/ig,'ECONOMIC',/연료|원가|정유|정제|생산|매입|항공|fuel|cost|refin|produc|purchas|airline/i],
 ['COPPER','구리',/구리|\bcopper\b/ig,'ECONOMIC',/원가|원재료|생산|채굴|매입|판매|cost|raw material|produc|mining|purchas|sales/i],
 ['TARIFF','관세',/관세|\btariffs?\b/ig,'ECONOMIC',/수출|수입|생산지|관세\s*비용|관세를\s*부담|export|import|manufacturing location|duties/i],
 ['CONSUMPTION','소비',/소비(?:가|의|\s|$)|\b(?:consumer spending|consumption)\b/ig,'ECONOMIC',/소비자|유통|소매|판매|매출|consumer|retail|sales|revenue/i],
 ['INFLATION','물가',/물가|인플레(?:이션)?|\binflation\b/ig,'ECONOMIC',/가격|원가|원재료|임금|비용|price|cost|raw material|wage/i],
 ['RECESSION','경기 둔화',/경기\s*(?:침체|둔화)|\brecession\b|\beconomic slowdown\b/ig,'ECONOMIC',/수요|소비|매출|판매|demand|consumer|sales|revenue/i],
 ['NATURAL_GAS','천연가스',/천연가스|\b(?:natural gas|LNG)\b/ig,'ECONOMIC',/원가|연료|생산|구매|판매|cost|fuel|produc|purchas|sales/i],
 ['HBM','HBM',/\bHBM\b|고대역폭\s*메모리|\bhigh bandwidth memory\b/ig],
 ['AI_AGENT','AI 에이전트',/AI\s*에이전트|\bAI agents?\b/ig],
 ['CPU','CPU',/\bCPUs?\b|중앙처리장치/ig],
 ['SEMICONDUCTOR','반도체',/반도체|\bsemiconductors?\b/ig],
 ['HEALTHCARE','의료',/의료|헬스케어|\b(?:healthcare|medical)\b/ig],
 ['SOFTWARE','소프트웨어',/소프트웨어|\bsoftware\b|\bSaaS\b/ig],
 ['AGRICULTURE','농업',/농업|농산물|\b(?:agriculture|agricultural|farming)\b/ig],
 ['EV','전기차',/전기차|전기자동차|\belectric vehicles?\b/ig],
 ['BATTERY','배터리',/배터리|이차전지|2차\s*전지|\b(?:batteries|battery)\b/ig],
 ['ROBOTICS','로봇',/로봇|\brobot(?:s|ics)?\b/ig],
 ['NUCLEAR','원전',/원전|원자력|\bnuclear (?:power|reactors?)\b/ig],
 ['WIND','풍력',/풍력|\bwind (?:power|turbines?|energy)\b/ig],
 ['SOLAR','태양광',/태양광|\bsolar (?:power|panels?|energy)\b/ig],
 ['WATER','수처리',/수처리|물\s*부족|담수화|\b(?:water treatment|water scarcity|desalination)\b/ig],
 ['AGING','고령화',/고령화|고령자|노인|\b(?:ageing|aging) population\b|\belder(?:ly|care)\b/ig],
 ['TOURISM','관광',/관광|여행|\b(?:tourism|tourists?|travel)\b/ig],
 ['OBESITY','비만 치료제',/비만\s*치료제|\b(?:obesity drugs?|GLP[- ]?1)\b/ig],
 ['DEFENSE','방산',/방위비|방산|국방|\b(?:defen[cs]e spending|defen[cs]e industry)\b/ig],
 ['CARBON','탄소 규제',/탄소\s*(?:규제|배출|중립)|\b(?:carbon regulation|carbon emissions?|decarboni[sz]ation)\b/ig],
 ['HOUSING','주택',/주택|\bhousing\b/ig],
 ['SHIPBUILDING','조선',/조선|선박|\b(?:shipbuilding|ships?)\b/ig],
 ['COLD_CHAIN','냉동 물류',/냉동\s*물류|콜드체인|\bcold chain\b/ig],
 ['CYBERSECURITY','사이버보안',/사이버\s*보안|정보보안|\bcyber\s*security\b/ig],
 ['SATELLITE','위성통신',/위성\s*통신|우주|\b(?:satellite communications?|space industry)\b/ig]
];
export const explicitScenario=/만약|가정|(?:^|\s)되면(?=\s|[?？.,]|$)|(?:[가-힣]{1,12})(?:다면|하면|되면|가면|나면|지면|르면|리면|으면|라면|을\s*경우|는\s*경우)|\b(?:if|assuming|hypothetical|scenario)\b/i;
const move=/왜.{0,15}(?:올랐|상승|하락|움직|급등|떨어)|(?:주가|가격).{0,30}왜|\bwhy\b.{0,60}\b(?:stock|shares|price|rose|rallied|fell|move)/i;
const occurred=/발표했|발표한|수주했|계약했|발생했|승인됐|인수했|한다는데|했다는데|\b(?:announced|reported|signed|acquired|approved)\b/i;
const exploration=/수혜|관련주|테마주|관련.{0,14}(?:기업|상장|종목|사업)|연결되|노출된|영향|유리|불리|부담|살펴볼|에\s*따른|어떤\s*(?:기업|종목|사업)|\b(?:beneficiar|exposure|affected|impact|related companies|which companies)/i;
export function questionMode(query){
 const q=String(query||'').trim();
 if(explicitScenario.test(q))return 'CONDITIONAL_ANALYSIS';
 if(move.test(q))return 'MOVE_ANALYSIS';
 if(occurred.test(q))return 'ACTUAL_EVENT_ANALYSIS';
 if(exploration.test(q))return 'BENEFICIARY_DISCOVERY';
 // Short topic inputs such as "금리 인하" are research subjects, not events.
 const concept=researchConcepts.some(([, ,re])=>{re.lastIndex=0;return re.test(q);});
 const factualInquiry=/뉴스|발표|공시|실제|오늘|어제|얼마|언제|했|됐|현재|최근|\b(?:news|today|yesterday|when|happened|latest)\b/i.test(q);
 return concept&&!factualInquiry?'BENEFICIARY_DISCOVERY':'ACTUAL_EVENT_ANALYSIS';
}
export function questionGuidance(query){
 if(!String(query||'').trim())return '산업·제품, 경제 상황, 정책을 자유롭게 입력하세요. 예시는 지원 범위를 제한하지 않습니다.';
 const mode=questionMode(query);
 return mode==='CONDITIONAL_ANALYSIS'?'입력한 변화가 일어난다는 가정으로 사업 연결과 부담 요인을 조사합니다.':mode==='BENEFICIARY_DISCOVERY'?'주제와 관련된 사업을 조사합니다. 실제 사건이 발생했다고 가정하지 않습니다.':mode==='MOVE_ANALYSIS'?'주가 움직임과 당시 공시·뉴스를 함께 확인하는 사건 분석입니다.':'발표·사건의 사실 여부를 먼저 확인합니다. 가정이라면 “~하면”으로 입력할 수 있습니다.';
}
