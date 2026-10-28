// Official Nasdaq metadata, separate from Finviz prices. Some ETNs have ETF=Y;
// explicit provider types and the legal ETN designation take precedence.
export const securityTypeSources={
 nasdaq:'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt',
 other:'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt'
};
const day=86400000,requests=new WeakMap(),memoryKey={};
export function parseSymbolDirectory(text){
 const lines=text.trim().split(/\r?\n/),headers=lines.shift().split('|'),rows=[],footer=lines.at(-1);
 if(!headers.includes('ETF')||!headers.includes('Security Name')||!headers.includes('Test Issue')||!/^File Creation Time:/.test(footer||''))throw Error('DIRECTORY_SCHEMA');
 for(const line of lines.slice(0,-1)){
  const cells=line.split('|');if(cells.length!==headers.length)throw Error('DIRECTORY_INCOMPLETE');
  const r=Object.fromEntries(headers.map((h,i)=>[h,cells[i].trim()]));if(r['Test Issue']!=='N')continue;
  if(!['Y','N'].includes(r.ETF))throw Error('UNKNOWN_ETF_FLAG');
  const symbols=[...new Set([r.Symbol,r['ACT Symbol'],r['CQS Symbol'],r['NASDAQ Symbol']].filter(Boolean))];
  // The official legal security description can explicitly identify notes even
  // when the directory's ETF flag is Y. Never inspect the Finviz company name
  // for "ETF", nor maintain ticker exceptions.
  const etn=/\bETNs?\b|\bExchange[ -]Traded Notes?\b/i.test(r['Security Name']);
  const exchange=r.Exchange?({A:'NYSE AMERICAN',N:'NYSE',P:'NYSE ARCA',Z:'CBOE BZX',V:'IEX'}[r.Exchange]||null):headers.includes('Market Category')?'NASDAQ':null;
  rows.push({symbols,flag:r.ETF,etn,evidence:etn?r['Security Name']:null,name:r['Security Name'],exchange});
 }
 if(!rows.length)throw Error('DIRECTORY_EMPTY');return {rows,version:footer.split('|')[0]};
}
// Called for a selected asset only. Directory parsing is shared with the existing
// ETF provider; no global Catalyst asset enrichment or CIK-based venue inference.
export async function usListingIdentity(ticker,{fetcher=fetch}={}){
 const matches=[];
 for(const url of Object.values(securityTypeSources)){
  const d=parseSymbolDirectory(await fetchText(url,fetcher));
  for(const r of d.rows.filter(r=>r.symbols.includes(ticker)&&r.exchange))matches.push({symbol:ticker,name:r.name,exchange:r.exchange,source:url,observedAt:new Date().toISOString()});
 }
 return matches.length===1?matches[0]:null;
}
export function combineSecurityTypes(directories){
 const items={};
 for(const directory of directories)for(const row of directory.rows)for(const ticker of row.symbols){
  const type=row.etn?'ETN':row.flag==='Y'?'ETF':'other';
  const item={type,isEtf:type==='ETF',basis:row.etn?'Nasdaq Security Name · ETN designation':'Nasdaq Symbol Directory · ETF flag',evidence:row.evidence||row.flag};
  if(items[ticker]&&items[ticker].type!==item.type)throw Error('CONFLICTING_SYMBOL');items[ticker]=item;
 }
 return items;
}
async function fetchText(url,fetcher){
 const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('METADATA_HTTP');
 const reader=response.body.getReader(),decoder=new TextDecoder();let text='',size=0;
 while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>3000000){await reader.cancel();throw Error('METADATA_SIZE');}text+=decoder.decode(part.value,{stream:true});}
 return text+decoder.decode();
}
export async function usSecurityTypes(env,{fetcher=fetch,now=Date.now()}={}){
 const key=env.DB||memoryKey,previous=requests.get(key);if(previous&&previous.until>now)return previous.promise;
 const entry={until:now+day};
 entry.promise=(async()=>{
  const row=env.DB?(await env.DB.prepare("SELECT payload,next_attempt FROM ranking_security_types WHERE id='US'").all()).results[0]:null;
  const saved=row?.payload?JSON.parse(row.payload):null;
  if(saved&&row.next_attempt>now){entry.until=row.next_attempt;return saved;}
  try{
   const [nasdaq,other]=await Promise.all(Object.values(securityTypeSources).map(url=>fetchText(url,fetcher)));
   const directories=[parseSymbolDirectory(nasdaq),parseSymbolDirectory(other)];
   if(directories.some(d=>d.rows.length<1000))throw Error('INCOMPLETE_METADATA');
   const result={items:combineSecurityTypes(directories),source:'Nasdaq Symbol Directory · ETF flag / legal ETN designation',sourceUrls:Object.values(securityTypeSources),versions:directories.map(d=>d.version),receivedAt:new Date(now).toISOString(),stale:false};
   if(env.DB)await env.DB.prepare("INSERT INTO ranking_security_types(id,payload,next_attempt) VALUES('US',?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,next_attempt=excluded.next_attempt").bind(JSON.stringify(result),entry.until).run();
   return result;
  }catch{
   entry.until=now+15*60000;
   if(saved){const result={...saved,stale:true};if(env.DB)await env.DB.prepare("UPDATE ranking_security_types SET payload=?,next_attempt=? WHERE id='US'").bind(JSON.stringify(result),entry.until).run();return result;}
   throw Error('ETF 분류 데이터를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
 })();requests.set(key,entry);return entry.promise;
}
