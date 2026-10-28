// Candidates are NOT publishable until /fred/series validates their metadata.
// Weights, roles, aliases and operational cadence are maintained in one place.
export const selectionConfig={weights:{relevance:.40,representation:.25,popularity:.15,freshness:.10,usage:.10},minimumUsageVisitors:30,maxCore:6,maxFields:3};
export const topics={economy:'경기·성장',inflation:'물가',employment:'고용',consumption:'소비·소득',rates:'금리·채권',housing:'주택',manufacturing:'기업·제조업',credit:'신용·금융여건',liquidity:'유동성',trade:'무역·달러',energy:'에너지·원자재',fiscal:'재정'};
export const fieldDefinitions={
 economy:{description:'생산·성장의 속도',positive:'성장세 강화',negative:'성장세 약화',sectors:['Industrials','Consumer Cyclical']},
 inflation:{description:'실제 물가와 시장 기대 구분',positive:'물가 압력 확대',negative:'물가 압력 둔화',sectors:['Consumer Defensive','Basic Materials']},
 employment:{description:'고용·구인·실업의 흐름',positive:'고용 여건 강화',negative:'고용 여건 약화',sectors:['Consumer Cyclical']},
 consumption:{description:'명목 소비와 실질 구매력',positive:'소비·소득 증가세 강화',negative:'소비·소득 증가세 약화',sectors:['Consumer Cyclical','Consumer Defensive']},
 rates:{description:'정책금리와 시장금리',positive:'금리 상승',negative:'금리 하락',sectors:['Financial','Real Estate']},
 housing:{description:'착공·허가와 주택 차입 비용',positive:'주택 여건 개선 방향',negative:'주택 여건 약화 방향',sectors:['Real Estate','Consumer Cyclical']},
 manufacturing:{description:'실제 생산과 신규 주문',positive:'생산·주문 증가세 강화',negative:'생산·주문 증가세 약화',sectors:['Industrials','Basic Materials']},
 credit:{description:'금융여건과 스트레스',positive:'금융여건 긴축·스트레스 확대',negative:'금융여건 완화·스트레스 축소',sectors:['Financial']},
 liquidity:{description:'통화량·중앙은행 자산·역레포를 구분',positive:'통화·중앙은행 자산 확대 방향',negative:'통화·중앙은행 자산 축소 방향',sectors:['Financial','Technology']},
 trade:{description:'무역수지와 달러의 서로 다른 신호',sectors:['Industrials','Technology']},
 energy:{description:'WTI 유가. 전체 원자재를 대표하지 않음',positive:'유가 상승',negative:'유가 하락',sectors:['Energy','Basic Materials']},
 fiscal:{description:'연방부채의 GDP 대비 비율',positive:'부채 비율 상승',negative:'부채 비율 하락',sectors:['Financial']}
};
export const roles={current:'현재 상태',underlying:'기조',leading:'선행 신호',expectations:'기대',detail:'세부 항목'};
const rows=[
 ['BAMLH0A0HYM2','미국 하이일드 스프레드','ICE BofA 미국 고수익 회사채의 옵션조정 스프레드. 국채 대비 추가 수익률이며 부도율이 아닙니다.',['credit'],'leading','high-yield-spread','level','D','NSA','Percent',1,10,['하이일드','하이 일드','정크본드','high yield','high-yield','hy spread']],
 ['BAMLC0A0CM','미국 투자등급 회사채 스프레드','ICE BofA 미국 투자등급 회사채의 옵션조정 스프레드',['credit'],'underlying','investment-grade-spread','level','D','NSA','Percent',.95,10,['투자등급','우량 회사채','investment grade','ig spread']],
 ['VIXCLS','VIX 변동성지수','S&P 500 옵션 가격에 내재된 기대 변동성. 실제 주가 등락률과 다릅니다.',['credit'],'expectations','volatility','level','D','NSA','Index',.97,10,['vix','변동성지수','공포지수']],
 ['DFII10','미 국채 10년 실질금리','물가연동 국채의 10년 고정만기 수익률',['rates'],'underlying','real-yield','level','D','NSA','Percent',.93,10,['실질금리','실질 금리','real yield','tips']],
 ['DFF','실효 연방기금금리','실제 익일물 연방기금 거래 금리. 목표금리 상단과 구별합니다.',['rates'],'current','policy-rate','level','D','NSA','Percent',.92,10,['실효금리','실효 연방기금','effective federal']],
 ['DGS2','미 국채 2년 금리','미 국채 2년 고정만기 시장금리',['rates'],'underlying','treasury','level','D','NSA','Percent',.9,10,['국채 2년','2년 금리','2-year']],
 ['T10Y3M','미 국채 10년·3개월 금리차','10년 금리에서 3개월 금리를 뺀 차이',['rates','economy'],'leading','yield-curve','level','D','NSA','Percent',.88,10,['10년 3개월','10년·3개월','10y3m']],
 ['CES0500000003','민간 근로자 시간당 평균임금','민간 비농업 근로자의 시간당 평균임금. 계절조정 자료입니다.',['employment','consumption'],'underlying','wages','yoy','M','SA','Dollars per Hour',.9,65,['평균임금','시간당 임금','시간당임금','average hourly earnings']],
 ['CPIAUCNS','소비자물가 CPI','소비자가 구입하는 재화·서비스의 가격 수준',['inflation'],'current','headline-cpi','yoy','M','NSA','Index',1,65,['cpi','소비자물가']],
 ['CPILFENS','근원 CPI','식품·에너지를 제외한 소비자물가',['inflation'],'underlying','core-cpi','yoy','M','NSA','Index',.95,65,['근원 cpi','core cpi','근원 소비자물가']],
 ['PCEPI','개인소비지출 물가 PCE','개인소비지출 가격지수',['inflation'],'current','headline-pce','yoy','M','SA','Index',.94,80,['pce','개인소비지출 물가']],
 ['PCEPILFE','근원 PCE','식품·에너지를 제외한 개인소비지출 물가',['inflation'],'underlying','core-pce','yoy','M','SA','Index',.96,80,['근원 pce','core pce']],
 ['PPIFID','생산자물가 PPI','생산자가 받는 최종수요 가격. 소비자물가의 원인으로 단정하지 않습니다.',['inflation'],'detail','ppi','yoy','M','NSA','Index',.72,65,['ppi','생산자물가']],
 ['T5YIE','5년 기대 인플레이션','명목·물가연동 국채 수익률 차이. 위험·유동성 프리미엄도 포함한 시장 지표입니다.',['inflation'],'expectations','breakeven','level','D','NSA','Percent',.8,10,['기대 인플레','기대 물가','기대 인플레이션','breakeven']],
 ['UNRATE','실업률','경제활동인구 중 실업자 비율',['employment'],'current','unemployment','level','M','SA','Percent',1,65,['실업률','unemployment']],
 ['PAYEMS','비농업 고용 증감','비농업 취업자 수의 전월 대비 증감. 원자료는 천 명 단위입니다.',['employment'],'underlying','payroll','difference','M','SA','Thousands of Persons',.97,65,['비농업','payroll','고용 인원']],
 ['ICSA','신규 실업수당 청구','주별 신규 실업수당 청구 건수',['employment'],'leading','claims','level','W','SA','Number',.85,18,['실업수당','jobless','claims']],
 ['JTSJOL','구인 건수 JOLTS','비농업 부문의 구인 건수. 천 건 단위입니다.',['employment'],'detail','openings','level','M','SA','Level in Thousands',.8,95,['jolts','구인','채용공고']],
 ['DFEDTARU','연방기금 목표금리 상단','목표 범위의 상단이며 실효금리와 다릅니다.',['rates'],'current','policy-rate','level','D','NSA','Percent',1,10,['기준금리','목표금리','fed funds']],
 ['DGS10','미 국채 10년 금리','미 국채 10년 고정만기 시장금리',['rates'],'underlying','treasury','level','D','NSA','Percent',.94,10,['국채 10년','10년 금리','10-year']],
 ['T10Y2Y','장단기 금리차','10년 금리에서 2년 금리를 뺀 차이',['rates','economy'],'leading','yield-curve','level','D','NSA','Percent',.84,10,['장단기','금리차','yield curve']],
 ['GDPC1','실질 GDP','물가 영향을 제거한 국내총생산. 원자료는 연율 환산 수준입니다.',['economy'],'current','gdp','yoy','Q','SAAR','Billions of Chained',1,180,['gdp','국내총생산']],
 ['INDPRO','산업생산','제조업·광업·유틸리티 실질 생산 지수',['economy','manufacturing'],'underlying','production','yoy','M','SA','Index',.9,65,['산업생산','industrial production']],
 ['RSXFS','소매판매','명목 소매판매. 물가조정 소비량과 다릅니다.',['consumption'],'current','retail','yoy','M','SA','Millions of Dollars',.9,65,['소매판매','retail']],
 ['PCEC96','실질 개인소비지출','물가 영향을 제거한 개인소비지출. 원자료는 연율 환산 수준입니다.',['consumption'],'current','real-consumption','yoy','M','SAAR','Billions of Chained',1,80,['실질소비','실질 개인소비','real consumption']],
 ['DSPIC96','실질 가처분소득','세후 가처분소득의 실질 구매력. 연율 환산 수준입니다.',['consumption'],'underlying','real-income','yoy','M','SAAR','Billions of Chained',.97,80,['실질소득','가처분소득','disposable income']],
 ['HOUST','주택 착공','신규 민간 주택 착공. 천 호, 연율 환산 수준입니다.',['housing'],'current','housing-starts','level','M','SAAR','Thousands of Units',1,65,['주택착공','housing starts']],
 ['PERMIT','주택 건축허가','신규 민간 주택 허가. 착공과 구별하는 선행 자료입니다.',['housing'],'leading','housing-permits','level','M','SAAR','Thousands of Units',.96,65,['건축허가','주택허가','permits']],
 ['MORTGAGE30US','미국 30년 모기지 금리','Freddie Mac 주간 평균. 2022년 11월 조사 방식이 변경되었습니다.',['housing'],'underlying','mortgage','level','W','NSA','Percent',.94,18,['모기지','주택담보대출','mortgage']],
 ['DGORDER','내구재 신규 주문','제조업 내구재 신규 주문. 명목 금액이며 생산량과 다릅니다.',['manufacturing'],'leading','durable-orders','yoy','M','SA','Millions of Dollars',.96,80,['내구재','durable','제조업 주문']],
 ['NFCI','시카고 연은 금융여건지수','0은 역사적 평균. 양수는 평균보다 긴축적, 음수는 완화적 여건입니다.',['credit'],'current','financial-conditions','level','W','NSA','Index',1,18,['금융여건','금융 여건','nfci']],
 ['STLFSI4','세인트루이스 금융스트레스지수','양수는 평균보다 높은 금융 스트레스, 음수는 낮은 스트레스입니다.',['credit'],'underlying','financial-stress','level','W','NSA','Index',.95,18,['금융스트레스','금융 스트레스','stlfsi']],
 ['M2SL','미국 M2 통화량','현금·예금 등을 포함한 광의통화. 원자료는 십억 달러입니다.',['liquidity'],'current','money-supply','yoy','M','SA','Billions of Dollars',1,80,['m2','통화량']],
 ['WALCL','연준 총자산','연준 통합 대차대조표의 수요일 잔액. 백만 달러 단위입니다.',['liquidity'],'underlying','fed-assets','level','W','NSA','Millions of U.S. Dollars',.94,18,['연준자산','연준 대차대조표','fed balance']],
 ['RRPONTSYD','연준 익일물 역레포','역레포 이용 잔액. 감소만으로 시장 유동성 증가를 단정하지 않습니다.',['liquidity'],'detail','reverse-repo','level','D','NSA','Billions of US Dollars',.8,10,['역레포','rrp','reverse repo']],
 ['BOPGSTB','미국 상품·서비스 무역수지','수출에서 수입을 차감한 금액. 적자에 증가율을 적용하지 않습니다.',['trade'],'current','trade-balance','level','M','SA','Millions of Dollars',1,95,['무역수지','무역적자','trade balance']],
 ['DTWEXBGS','광의 달러지수','주요 교역국 통화 대비 무역가중 달러 가치',['trade'],'underlying','broad-dollar','level','D','NSA','Index',.96,10,['달러','달러지수','환율','원달러','환전','dollar']],
 ['DCOILWTICO','WTI 현물유가','쿠싱 WTI 현물유가. 달러/배럴이며 전체 원자재 지수가 아닙니다.',['energy'],'current','oil','level','D','NSA','Dollars per Barrel',1,12,['유가','원유','wti','oil']],
 ['GFDEGDQ188S','GDP 대비 연방 총부채','연방 총부채/GDP. 재정수지나 이자지출과 다른 지표입니다.',['fiscal'],'current','federal-debt-ratio','level','Q','SA','Percent of GDP',1,180,['국가부채','연방부채','재정부채','debt to gdp']]
];
// Direction is indicator-specific, never a blanket investment/causality judgement.
const signalConfig={UNRATE:-1,ICSA:-1,MORTGAGE30US:-1,RRPONTSYD:0,BOPGSTB:0,DTWEXBGS:0,T10Y2Y:0};
const units={BAMLH0A0HYM2:'%p',BAMLC0A0CM:'%p',VIXCLS:'지수',T10Y3M:'%p',HOUST:'천 호 (연율)',PERMIT:'천 호 (연율)',NFCI:'지수',STLFSI4:'지수',WALCL:'백만 달러',RRPONTSYD:'십억 달러',BOPGSTB:'백만 달러',DTWEXBGS:'지수',DCOILWTICO:'달러/배럴',GFDEGDQ188S:'% GDP'};
export const catalog=rows.map(([id,name,description,topic,role,group,transform,frequency,seasonal,unitsPrefix,representation,maxAgeDays,aliases])=>({id,name,description,topics:topic,role,group,transform,frequency,seasonal,unitsPrefix,representation,maxAgeDays,aliases,region:'US',source:'FRED',sourceUrl:`https://fred.stlouisfed.org/series/${id}`,cadence:id==='DFEDTARU'?'일별 (주 7일)':frequency==='D'?'일별 (휴일 제외)':frequency==='W'?'주별':frequency==='Q'?'분기별 (수정치 포함)':'월별 (수정치 포함)'}));
for(const s of catalog){s.signalPolarity=signalConfig[s.id]??1;s.displayUnit=units[s.id];s.changeEpsilon=['ICSA','PAYEMS','JTSJOL','HOUST','PERMIT','WALCL','BOPGSTB'].includes(s.id)?.5:.005;if(['CPIAUCNS','PCEPI'].includes(s.id))s.group='headline-inflation';if(['CPILFENS','PCEPILFE'].includes(s.id))s.group='core-inflation';}
export const byId=Object.fromEntries(catalog.map(s=>[s.id,s]));
byId.T10Y3M.signalPolarity=0;
byId.MORTGAGE30US.contextBreak='2022-11-17';
export const sourceNames={bofaml:'ICE Data Indices, LLC',cboe:'Cboe',bea:'미 경제분석국 BEA',bls:'미 노동통계국 BLS',frb:'연방준비제도 이사회',eta:'미 노동부 고용훈련청',census:'미 인구조사국',hud:'미 주택도시개발부','frb stl':'세인트루이스 연은','frb chi':'시카고 연은','frb ny':'뉴욕 연은','freddie mac':'Freddie Mac',eia:'미 에너지정보청',omb:'미 예산관리국',fms:'미 재무부 재정관리국'};
