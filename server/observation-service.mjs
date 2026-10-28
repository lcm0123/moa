import {query,decode} from './competitor-service.mjs';
import {relatedPolicy} from './us-kr-service.mjs';
import {historyPolicy} from './sector-history.mjs';
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
function publicRun(r){if(!r)return null;return {...r,sources:(r.sources||[]).map(({text,...d})=>d),discoverySources:(r.discoverySources||[]).map(({text,...d})=>d)};}
export async function observationApi(request,env){
 if(!relatedPolicy(env))return json({status:'restricted',message:'기존 시세 표시 설정 확인 필요',items:[]});
 if(!env.DB)return json({status:'empty',message:'관찰 근거 저장소 연결 필요',items:[]});
 const db=env.DB,u=new URL(request.url);
 try{
  if(request.method==='POST'){
   if(!historyPolicy(env).store||env.OBSERVATION_ENABLED==='false')return json({message:'관찰 분석 저장 설정 확인 필요'},403);
   if(env.LOCAL_PREVIEW!==true&&request.headers.get('origin')!==env.MOA_PUBLIC_ORIGIN)return json({message:'요청 출처 확인 필요'},403);
   const {ticker}=await request.json(),t=String(ticker||'').trim().toUpperCase();if(!/^[A-Z0-9.-]{1,16}$/.test(t))return json({message:'미국 티커를 입력해 주세요.'},400);
   const active=(await query(db,"SELECT payload FROM observation_runs WHERE ticker=? AND state IN ('queued','running') ORDER BY created_at DESC LIMIT 1",t))[0];if(active)return json({status:'queued',selected:publicRun(decode(active.payload))});
   const recent=(await query(db,"SELECT payload FROM observation_runs WHERE ticker=? AND state='ready' AND created_at>? ORDER BY created_at DESC LIMIT 1",t,new Date(Date.now()-6*3600000).toISOString()))[0];if(recent)return json({status:'cached',selected:publicRun(decode(recent.payload))});
   const daily=(await query(db,'SELECT count(*) AS n FROM observation_runs WHERE created_at>?',new Date(Date.now()-86400000).toISOString()))[0].n;
   const limit=Math.max(1,Math.min(100,Number(env.OBSERVATION_DAILY_RUN_LIMIT)||10));if(daily>=limit)return json({message:`일일 분석 한도 ${limit}건에 도달했습니다.`},429);
   const pending=(await query(db,"SELECT count(*) AS n FROM observation_runs WHERE state IN ('queued','running')"))[0].n;if(pending>=3)return json({message:'작업 대기열이 가득 찼습니다. 잠시 후 다시 시도해 주세요.'},429);
   const now=new Date().toISOString(),r={id:crypto.randomUUID(),ticker:t,state:'queued',stage:'quote',createdAt:now,updatedAt:now,counts:{quote:0,search:0,read:0,event:0,kr:0,passed:0},candidates:[],diagnostics:[],message:'시세 수집 대기 · 작업자가 순서대로 처리합니다.'};
   await db.prepare('INSERT INTO observation_runs VALUES(?,?,?,?,?,?,?)').bind(r.id,t,r.state,r.stage,JSON.stringify(r),now,now).run();return json({status:'queued',selected:r},202);
  }
  if(request.method!=='GET')return json({message:'Method not allowed'},405);
  if(u.searchParams.has('q')){const q=(u.searchParams.get('q')||'').trim().slice(0,60);return json({items:q?await query(db,'SELECT ticker,name FROM competitor_universe WHERE instr(lower(ticker),lower(?))>0 OR instr(lower(name),lower(?))>0 ORDER BY CASE WHEN ticker=? THEN 0 ELSE 1 END,ticker LIMIT 12',q,q,q.toUpperCase()):[]});}
  const t=u.searchParams.get('ticker')?.toUpperCase(),rows=await query(db,'SELECT payload FROM observation_runs '+(t?'WHERE ticker=? ':'')+'ORDER BY created_at DESC LIMIT 20',...(t?[t]:[]));
  const selected=publicRun(decode(rows[0]?.payload));
  if(selected?.candidates?.length){const quotes=decode((await query(db,"SELECT payload FROM competitor_cache WHERE id='kr-quotes'"))[0]?.payload)||{};selected.candidates=selected.candidates.map(c=>({...c,quote:quotes[c.kr_ticker]||null}));}
  return json({status:'ready',selected,items:[],configured:!!env.OPENAI_API_KEY,automaticBatch:false,message:selected?null:'미국 티커 1개를 입력하여 시세 → 원문 → 국내 사업 근거를 확인하세요.'});
 }catch{return json({status:'error',message:'분석 저장소 조회 실패 · 마이그레이션 확인 필요',items:[]},500);}
}
