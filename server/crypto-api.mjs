import {BinanceCryptoService as CryptoService} from './crypto/binance-service.mjs';
import {demoCrypto,demoChart} from './crypto/demo.mjs';
import {sectorResults} from './crypto/model.mjs';
const services=new WeakMap();
export function cryptoService(env){if(env.CRYPTO_SERVICE)return env.CRYPTO_SERVICE;if(!services.has(env.DB))services.set(env.DB,new CryptoService(env));return services.get(env.DB);}
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function cryptoApi(request,env){
 const url=new URL(request.url);if(request.method!=='GET')return json({message:'Method not allowed'},405);
 const demo=url.searchParams.get('demo')==='1';if(demo&&env.LOCAL_PREVIEW!==true)return json({message:'샘플은 로컬 개발 환경에서만 사용할 수 있습니다.'},403);
 if(!demo&&env.LOCAL_PREVIEW!==true&&env.CRYPTO_PUBLIC_DISPLAY!=='true')return json({status:'restricted',items:[],categories:[],message:'가상자산 공개 표시 설정 확인 필요'},403);
 try{
  const service=cryptoService(env);
  if(url.pathname==='/api/crypto/events')return demo?json({message:'샘플은 스트림을 사용하지 않습니다.'},400):service.stream(url.searchParams.get('coin'));
  if(url.pathname==='/api/crypto/chart')return json(demo?demoChart(url.searchParams.get('id')):await service.chart(url.searchParams.get('id'),Number(url.searchParams.get('days')??365)));
  if(url.pathname!=='/api/crypto')return json({message:'Not found'},404);
  const data=demo?demoCrypto():await service.snapshot(url.searchParams),period=url.searchParams.get('period')||'day',method=url.searchParams.get('method')==='cap'?'cap':'equal';
  return json({...data,period,method,sectors:demo?sectorResults(data.items||[],data.categories||[],period,method):data.sectors});
 }catch(error){return json({status:'error',items:[],categories:[],message:cryptoService(env).safe(error.message)},400);}
}
