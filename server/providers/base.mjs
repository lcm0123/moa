export const deniedPolicy=Object.freeze({display:false,chart:false,ranking:false,treemap:false});
export function getPolicy(env,key){try{const input=JSON.parse(env[`${key}_POLICY`]||'{}');return Object.fromEntries(Object.keys(deniedPolicy).map(k=>[k,input[k]===true]));}catch{return {...deniedPolicy};}}
export function unavailable(message='데이터 연결 필요',status='disconnected',policy=deniedPolicy){return {status,message,items:[],asOf:null,mode:null,source:null,policy};}
export async function fetchProvider(env,key,params={},feature='display'){
 const policy=getPolicy(env,key),endpoint=env[`${key}_URL`];
 if(!endpoint)return unavailable('데이터 연결 필요','disconnected',policy);
 if(!policy.display||!policy[feature])return unavailable('이 기능의 데이터 이용 권한이 설정되지 않았습니다.','restricted',policy);
 try{const url=new URL(endpoint);if(url.protocol!=='https:')throw new Error('HTTPS endpoint required');Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,String(v)));
 const response=await fetch(url,{headers:{Accept:'application/json',...(env[`${key}_KEY`]?{Authorization:`Bearer ${env[`${key}_KEY`]}`}:{})},signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw new Error('Provider unavailable');const data=await response.json();
 if(!Array.isArray(data.items)||!['realtime','delayed','previous_close'].includes(data.mode)||!Number.isFinite(Date.parse(data.asOf))||typeof data.source!=='string'||!data.source.trim())throw new Error('Invalid provider metadata');
 if(!['open','closed','pre','post'].includes(data.session))throw new Error('Market session required');
 const items=data.items.map(item=>{const next={...item};if(!policy.chart){delete next.history;delete next.chart;}return next;});
 return {status:items.length?'ready':'empty',items,asOf:data.asOf,mode:data.mode,session:data.session,source:data.source,delayMinutes:data.delayMinutes??null,policy,indexId:data.indexId,version:data.version,effectiveAt:data.effectiveAt,verified:data.verified,changes:data.changes};
 }catch{return unavailable('데이터를 불러오지 못했습니다. 다시 시도해 주세요.','error',policy);}
}
export function validNumber(n){return typeof n==='number'&&Number.isFinite(n);}
