import {FinvizError} from './providers/finviz-client.mjs';
import {searchManagers,searchManagerStocks,managerDetail,managerPeriodDetail,stockManagers} from './providers/managers.mjs';
import {exploreManagers} from './manager-explore.mjs';
import {addManagerPrices} from './manager-prices.mjs';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function managersApi(request,env){
 if(request.method!=='GET')return json({message:'Method not allowed'},405);
 const u=new URL(request.url);try{
  if(u.pathname==='/api/managers/explore')return json(await exploreManagers(env,u.searchParams));
  if(u.pathname==='/api/managers'){const q=(u.searchParams.get('q')||'').trim(),page=Number(u.searchParams.get('page')||1);if(q.length>100||!Number.isInteger(page)||page<1||page>1000)return json({message:'검색 조건을 확인해 주세요.'},400);return json(await searchManagers(env,q,page));}
  if(u.pathname==='/api/managers/stocks'){const q=(u.searchParams.get('q')||'').trim();if(!q||q.length>100)return json({status:'empty',items:[]});return json(await searchManagerStocks(env,q));}
  if(u.pathname==='/api/managers/stock'){const ticker=u.searchParams.get('ticker')||'';if(!/^[A-Z0-9.^-]{1,20}$/.test(ticker))return json({message:'티커를 확인해 주세요.'},400);return json(await stockManagers(env,ticker));}
  const match=u.pathname.match(/^\/api\/managers\/(\d{1,10})$/);if(match){const quarters=Number(u.searchParams.get('quarters')||4),period=u.searchParams.get('period');if(![1,4].includes(quarters)||period&&!/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period))return json({message:'조회 분기를 확인해 주세요.'},400);
   let data=period?await managerPeriodDetail(env,match[1],period):await managerDetail(env,match[1],{quarters});
   data.availablePeriods=env.DB?(await env.DB.prepare('SELECT period FROM manager_snapshots WHERE cik=? ORDER BY period DESC').bind(String(Number(match[1]))).all()).results.map(r=>r.period):[];
   if(quarters===4||period)data=await addManagerPrices(env,data);return json(data);
  }
  return json({message:'Not found'},404);
 }catch(error){return json({status:error.status||'error',items:[],message:error instanceof FinvizError?error.message:'운용사 정보를 불러오지 못했습니다.'},error.status==='restricted'?403:503);}
}
