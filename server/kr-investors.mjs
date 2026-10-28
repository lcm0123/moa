// Cache-only provider: a web request must never start Python or contact KRX.
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, max-age=60','X-Content-Type-Options':'nosniff'}});
const messages={MISSING_KRX_LOGIN:'KRX 로그인 설정 후 배치 수집이 필요합니다.',LOW_MEMORY:'메모리 부족으로 수집을 건너뛰었습니다.',EMPTY_RESPONSE:'공급처에서 유효한 자료를 받지 못했습니다.',INCOMPLETE_RANKING_COVERAGE:'투자자별 종목 범위가 달라 순위를 갱신하지 못했습니다.',STOCK_VALIDATION_MISMATCH:'종목별 자료와 순위 자료가 일치하지 않습니다.'};
const dateKst=now=>new Date(now+9*3600000).toISOString().slice(0,10);
export async function krInvestorsApi(request,env,{now=Date.now()}={}){
 if(request.method!=='GET')return json({status:'error',message:'GET 요청만 지원합니다.'},405);
 const q=new URL(request.url).searchParams,scope=q.get('scope')||'KOSPI',investor=q.get('investor')||'individual';
 if(!/^(KOSPI|KOSDAQ|[0-9][0-9A-Z]{5})$/.test(scope)||!['individual','foreign','institution'].includes(investor))return json({status:'error',message:'시장·종목·투자자 조건을 확인해 주세요.'},400);
 const base={status:'empty',scope,investor,source:'KRX 정보데이터시스템 · pykrx',sourceUrl:'https://data.krx.co.kr/',unit:'KRW',timeZone:'Asia/Seoul',basis:'장마감 집계 · 당일 자료 제외',items:[],ranking:[],rankingDate:null,baseDate:null,collectedAt:null};
 if(!env.LOCAL_PREVIEW&&env.KR_INVESTORS_PUBLIC_DISPLAY!=='true')return json({...base,status:'restricted',message:'투자자 매매동향 공개 표시 설정이 필요합니다.'});
 if(!env.DB)return json({...base,message:'투자자 매매동향 저장소가 연결되지 않았습니다.'});
 try{
  const today=dateKst(now),rows=(await env.DB.prepare('SELECT payload FROM kr_investor_daily WHERE scope=? AND trade_date<? ORDER BY trade_date DESC LIMIT 60').bind(scope,today).all()).results;
  const items=rows.map(r=>JSON.parse(r.payload)).reverse(),latest=items.at(-1);
  let ranking=[],rankingDate=null,rankingCollectedAt=null;
  if(['KOSPI','KOSDAQ'].includes(scope)){
   const cached=(await env.DB.prepare('SELECT payload,collected_at FROM kr_investor_rankings WHERE market=? AND trade_date<? ORDER BY trade_date DESC LIMIT 1').bind(scope,today).all()).results[0];
   if(cached){const data=JSON.parse(cached.payload);rankingDate=data.tradeDate;rankingCollectedAt=cached.collected_at;
    ranking=data.items.filter(r=>Number.isSafeInteger(r.values?.[investor])&&r.values[investor]>0).sort((a,b)=>b.values[investor]-a.values[investor]||a.scope.localeCompare(b.scope)).slice(0,20).map((r,i)=>({rank:i+1,ticker:r.scope,name:r.name,netValue:r.values[investor],tradeDate:r.tradeDate,collectedAt:r.collectedAt}));}
  }
  const jobs=(await env.DB.prepare('SELECT * FROM kr_investor_jobs WHERE scope IN (?,?,?) ORDER BY attempted_at DESC').bind('global',scope,'ranking:'+scope).all()).results;
  const failed=jobs.find(j=>j.status==='error'&&(!latest||j.attempted_at>=latest.collectedAt));
  const old=latest&&now-Date.parse(latest.collectedAt)>48*3600000;
  const stale=!!latest&&(!!failed||!!old);
  return json({...base,status:latest?'ready':failed?'error':'empty',items,ranking,rankingDate,rankingCollectedAt,baseDate:latest?.tradeDate||null,collectedAt:latest?.collectedAt||null,stale,
   message:failed?(messages[failed.error_code]||'최근 수집에 실패했습니다. 저장된 자료가 있으면 유지합니다.'):old?'갱신 지연 · 마지막 저장 자료입니다.':latest?null:'아직 검증·수집된 자료가 없습니다.',
   attemptedAt:jobs[0]?.attempted_at||null,errorCode:failed?.error_code||null});
 }catch{return json({...base,status:'error',message:'투자자 매매동향 캐시를 읽지 못했습니다.'});}
}
