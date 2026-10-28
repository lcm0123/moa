const BASE='https://elite.finviz.com';
const paths=new Set(['/export/screener','/export/stock','/export/latest-filings','/export/calendar/economic','/export/calendar/earnings','/export/futures/performance']);
const cache=new Map();
export class FinvizError extends Error {constructor(message,status='error'){super(message);this.status=status;}}
export function finvizPolicy(env,feed='STOCKS'){
 const keys=['display','chart','ranking','treemap','calendar'];
 // This boolean is injected by the loopback server, never from client input or string env values.
 if(env.LOCAL_PREVIEW===true)return Object.fromEntries(keys.map(k=>[k,true]));
 try{const p=JSON.parse(env['FINVIZ_'+feed+'_POLICY']||'{}');return Object.fromEntries(keys.map(k=>[k,p[k]===true]));}catch{return Object.fromEntries(keys.map(k=>[k,false]));}
}
export function requireFinviz(env,feature='display',feed='STOCKS'){
 if(!env.FINVIZ_API_KEY?.trim())throw new FinvizError('Finviz API 키 설정 필요','disconnected');
 const p=finvizPolicy(env,feed);
 if(!p.display||!p[feature])throw new FinvizError('Finviz 공개 표시 이용 권한 설정 필요','restricted');
 return p;
}
export function parseCsv(text,required=[]){
 if(typeof text!=='string'||/^\s*</.test(text))throw new FinvizError('Finviz CSV 응답 형식을 확인해 주세요.');
 const rows=[];let row=[],cell='',quoted=false;
 const input=text.replace(/^\uFEFF/,'');
 for(let i=0;i<input.length;i++){
  const c=input[i];
  if(c==='"'){if(quoted&&input[i+1]==='"'){cell+='"';i++;}else if(quoted||cell==='')quoted=!quoted;else throw new FinvizError('Finviz CSV 따옴표 형식 오류');}
  else if(c===','&&!quoted){row.push(cell);cell='';}
  else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&input[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x!==''))rows.push(row);row=[];cell='';}
  else cell+=c;
 }
 if(quoted)throw new FinvizError('Finviz CSV가 완전하지 않습니다.');
 if(cell||row.length){row.push(cell);rows.push(row);}
 const headers=rows.shift()?.map(x=>x.trim())||[];
 if(new Set(headers).size!==headers.length||required.some(k=>!headers.includes(k)))throw new FinvizError('Finviz CSV 필수 열이 없습니다.');
 return rows.map(values=>{if(values.length!==headers.length)throw new FinvizError('Finviz CSV 열 수가 일치하지 않습니다.');return Object.fromEntries(headers.map((h,i)=>[h,values[i]]));});
}
export function csvNumber(value,multiplier=1){
 const text=String(value??'').trim();if(!text||text==='-'||text==='N/A')return null;
 const match=text.replaceAll(',','').replace(/%$/,'').match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))([KMBT])?$/i);
 if(!match)return null;const n=Number(match[1])*(match[2]?({K:1e3,M:1e6,B:1e9,T:1e12}[match[2].toUpperCase()]):multiplier);return Number.isFinite(n)?n:null;
}
export async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function finvizCsv(env,path,params={},ttl=120000){
 if(!paths.has(path)&&!/^\/export\/managers\/[a-z0-9-]{1,180}\/holdings$/.test(path))throw new FinvizError('지원하지 않는 Finviz 경로입니다.');
 const key=env.FINVIZ_API_KEY?.trim();if(!key)throw new FinvizError('Finviz API 키 설정 필요','disconnected');
 const query=new URLSearchParams(params).toString(),cacheId=(await digest(key))+path+'?'+query,current=Date.now(),previous=cache.get(cacheId);
 if(previous&&previous.until>current)return previous.promise;
 const promise=(async()=>{
  try{
   const url=new URL(path,BASE);Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,String(v)));url.searchParams.set('auth',key);
   const response=await fetch(url,{headers:{Accept:'text/csv'},redirect:'error',signal:AbortSignal.timeout(12000)});
   if(response.status===401||response.status===403)throw new FinvizError('Finviz 키 또는 구독 권한을 확인해 주세요.');
   if(response.status===429){const error=new FinvizError('Finviz 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.');const retry=response.headers.get('retry-after'),seconds=Number(retry);error.httpStatus=429;error.retryAfterMs=retry?(Number.isFinite(seconds)?Math.max(1000,seconds*1000):Math.max(1000,Date.parse(retry)-Date.now())||60000):60000;throw error;}
   if(!response.ok)throw new FinvizError('Finviz 데이터를 불러오지 못했습니다.');
   if(!/csv|octet-stream|text\/plain/i.test(response.headers.get('content-type')||''))throw new FinvizError('Finviz CSV 응답 형식을 확인해 주세요.');
   if(Number(response.headers.get('content-length')||0)>6000000)throw new FinvizError('Finviz 응답 크기를 확인해 주세요.');
   const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0,text='';
   while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>6000000){await reader.cancel();throw new FinvizError('Finviz 응답 크기를 확인해 주세요.');}text+=decoder.decode(part.value,{stream:true});}
   text+=decoder.decode();return {text,receivedAt:new Date().toISOString()};
  }catch(error){if(error instanceof FinvizError)throw error;throw new FinvizError('Finviz 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.');}
 })();
 cache.set(cacheId,{until:current+ttl,promise});
 if(cache.size>80){for(const [id,item]of cache){if(item.until<=current)cache.delete(id);}if(cache.size>80)cache.delete(cache.keys().next().value);}
 promise.catch(()=>{const item=cache.get(cacheId);if(item?.promise===promise)item.until=Date.now()+15000;});
 return promise;
}
