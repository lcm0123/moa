// Shared, bounded filter schema. Column IDs/headers were verified against the Elite CSV.
export const screenerGroups={basic:'기본 조건',fundamental:'재무',technical:'가격·기술'};
export const screenMetrics=[
 {key:'marketCap',label:'시가총액',unit:'십억 USD',scale:1e9,group:'basic',floor:0},
 {key:'price',label:'현재가',unit:'USD',group:'basic',floor:0},
 {key:'volume',label:'거래량',unit:'백만 주',scale:1e6,group:'basic',floor:0},
 {key:'pe',label:'PER',unit:'배',group:'fundamental',floor:0},
 {key:'forwardPe',label:'예상 PER',unit:'배',group:'fundamental',floor:0},
 {key:'pb',label:'PBR',unit:'배',group:'fundamental',floor:0},
 {key:'ps',label:'PSR',unit:'배',group:'fundamental',floor:0},
 {key:'dividendYield',label:'배당수익률',unit:'%',group:'fundamental',floor:0},
 {key:'roe',label:'ROE',unit:'%',group:'fundamental'},
 {key:'profitMargin',label:'순이익률',unit:'%',group:'fundamental'},
 {key:'epsGrowth',label:'EPS 증가율 · 전년 동기',unit:'%',group:'fundamental'},
 {key:'salesGrowth',label:'매출 증가율 · 전년 동기',unit:'%',group:'fundamental'},
 {key:'changePct',label:'당일 등락률',unit:'%',group:'technical'},
 {key:'perfWeek',label:'1주 등락률',unit:'%',group:'technical'},
 {key:'perfMonth',label:'1개월 등락률',unit:'%',group:'technical'},
 {key:'perfYear',label:'1년 등락률',unit:'%',group:'technical'},
 {key:'relativeVolume',label:'상대거래량',unit:'배',group:'technical',floor:0},
 {key:'rsi',label:'RSI (14)',unit:'',group:'technical',floor:0,ceiling:100},
 {key:'sma20',label:'20일선 대비',unit:'%',group:'technical'},
 {key:'sma50',label:'50일선 대비',unit:'%',group:'technical'},
 {key:'sma200',label:'200일선 대비',unit:'%',group:'technical'},
 {key:'high52',label:'52주 최고가 대비',unit:'%',group:'technical'}
];
export const screenerSorts={marketCap:'시가총액',price:'현재가',changePct:'당일 등락률',volume:'거래량',relativeVolume:'상대거래량',pe:'PER',dividendYield:'배당수익률',rsi:'RSI',perfMonth:'1개월 등락률',perfYear:'1년 등락률',name:'종목명'};
export const screenerIndices={SP500:'S&P 500',NASDAQ100:'나스닥100',DOW30:'다우30'};
export const screenerSectors={'Basic Materials':'소재','Communication Services':'커뮤니케이션','Consumer Cyclical':'경기소비재','Consumer Defensive':'필수소비재','Energy':'에너지','Financial':'금융','Healthcare':'헬스케어','Industrials':'산업재','Real Estate':'부동산','Technology':'기술','Utilities':'유틸리티'};
export const screenerPresets=[
 {label:'대형 기술주',filters:{sector:'Technology',marketCapMin:'10'},description:'기술 섹터 · 시가총액 100억 USD 이상'},
 {label:'거래량 급증',filters:{relativeVolumeMin:'2',volumeMin:'1'},description:'상대거래량 2배 이상 · 거래량 100만 주 이상'},
 {label:'배당 3% 이상',filters:{dividendYieldMin:'3',marketCapMin:'2'},description:'배당수익률 3% 이상 · 시가총액 20억 USD 이상'},
 {label:'장기 추세 위',filters:{sma200Min:'0',perfMonthMin:'0'},description:'200일선 이상 · 1개월 등락률 0% 이상'},
 {label:'RSI 30 이하',filters:{rsiMax:'30'},description:'RSI (14) 30 이하'}
];
