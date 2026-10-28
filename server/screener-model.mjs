import {parseCsv,csvNumber,FinvizError} from './providers/finviz-client.mjs';
import {parseScreener} from './providers/finviz-stocks.mjs';
import {screenMetrics,screenerSorts,screenerIndices} from '../dist/js/screener-config.js';
export const screenColumns={pe:[7,'P/E'],forwardPe:[8,'Forward P/E'],ps:[10,'P/S'],pb:[11,'P/B'],dividendYield:[14,'Dividend Yield'],epsGrowth:[22,'EPS Growth Quarter Over Quarter'],salesGrowth:[23,'Sales Growth Quarter Over Quarter'],roe:[33,'Return on Equity'],profitMargin:[41,'Profit Margin'],perfWeek:[42,'Performance (Week)'],perfMonth:[43,'Performance (Month)'],perfYear:[46,'Performance (Year)'],sma20:[52,'20-Day Simple Moving Average'],sma50:[53,'50-Day Simple Moving Average'],sma200:[54,'200-Day Simple Moving Average'],high52:[57,'52-Week High'],rsi:[59,'Relative Strength Index (14)'],relativeVolume:[64,'Relative Volume']};
export const screenerColumnIds=[1,2,3,4,5,6,...Object.values(screenColumns).map(x=>x[0]),65,66,67,79,81].join(',');
const indexNames={SP500:'S&P 500',NASDAQ100:'NDX',DOW30:'DJIA'};
const bad=message=>Object.assign(new Error(message),{status:400});
export function parseScreen(text){
 const records=parseCsv(text,['Index','Prev Close',...Object.values(screenColumns).map(x=>x[1])]),base=parseScreener(text),seen=new Set();
 return base.map((s,i)=>{if(seen.has(s.id))throw new FinvizError('스크리너 중복 종목 응답입니다.');seen.add(s.id);const r=records[i],members=String(r.Index||'').split(',').map(s=>s.trim());
  return {...s,...Object.fromEntries(Object.entries(screenColumns).map(([key,[,header]])=>[key,csvNumber(r[header])])),indices:Object.keys(indexNames).filter(id=>members.includes(indexNames[id]))};
 });
}
export function screenQuery(params){
 const get=k=>String((typeof params.get==='function'?params.get(k):Object.hasOwn(params,k)?params[k]:null)??'').trim(),q=get('q');if(q.length>100)throw bad('검색어는 100자 이내로 입력해 주세요.');
 const sort=get('sort')||'marketCap',dir=get('dir')||'desc',index=get('index'),type=get('type')||'all';
 if(!Object.hasOwn(screenerSorts,sort)||!['asc','desc'].includes(dir)||index&&!Object.hasOwn(screenerIndices,index)||!['all','excludeEtf','etf'].includes(type))throw bad('필터 또는 정렬 조건을 확인해 주세요.');
 const page=Number(get('page')||1),pageSize=Number(get('pageSize')||50);if(!Number.isInteger(page)||page<1||page>100000||![25,50,100].includes(pageSize))throw bad('페이지 조건을 확인해 주세요.');
 const result={q,sort,dir,index,type,page,pageSize,ranges:[]};
 for(const key of ['sector','industry','country']){result[key]=get(key);if(result[key].length>150)throw bad('필터 값을 확인해 주세요.');}
 for(const d of screenMetrics){const minText=get(d.key+'Min'),maxText=get(d.key+'Max'),min=minText===''?null:Number(minText),max=maxText===''?null:Number(maxText);
  for(const n of [min,max])if(n!==null&&(!Number.isFinite(n)||d.floor!==undefined&&n<d.floor||d.ceiling!==undefined&&n>d.ceiling||Math.abs(n)>1e12))throw bad(d.label+' 범위를 확인해 주세요.');
  if(min!==null&&max!==null&&min>max)throw bad(d.label+' 최솟값은 최댓값보다 클 수 없습니다.');
  if(min!==null||max!==null)result.ranges.push({key:d.key,min:min===null?null:min*(d.scale||1),max:max===null?null:max*(d.scale||1)});
 }
 return result;
}
export function screenRows(rows,filter){
 const q=filter.q.toLocaleLowerCase(),eligible=rows.filter(s=>{
  if(q&&!s.ticker.toLowerCase().includes(q)&&!s.name.toLowerCase().includes(q))return false;
  if(['sector','industry','country'].some(k=>filter[k]&&s[k]!==filter[k]))return false;
  if(filter.index&&!s.indices.includes(filter.index))return false;
  if(filter.type==='excludeEtf'&&s.isEtf!==false||filter.type==='etf'&&s.isEtf!==true)return false;
  return filter.ranges.every(r=>Number.isFinite(s[r.key])&&(r.min===null||s[r.key]>=r.min)&&(r.max===null||s[r.key]<=r.max));
 });
 const direction=filter.dir==='asc'?1:-1;
 eligible.sort((a,b)=>{const x=a[filter.sort],y=b[filter.sort];if(filter.sort==='name')return x.localeCompare(y)*direction||a.ticker.localeCompare(b.ticker);if(!Number.isFinite(x))return !Number.isFinite(y)?a.ticker.localeCompare(b.ticker):1;if(!Number.isFinite(y))return -1;return (x-y)*direction||a.ticker.localeCompare(b.ticker);});
 const total=eligible.length,pages=Math.max(1,Math.ceil(total/filter.pageSize)),page=Math.min(filter.page,pages),start=(page-1)*filter.pageSize;
 return {items:eligible.slice(start,start+filter.pageSize).map((s,i)=>({...s,rank:start+i+1})),total,pages,page,pageSize:filter.pageSize};
}
export function screenFacets(rows){
 const values=key=>[...new Set(rows.map(s=>s[key]).filter(Boolean))].sort();
 return {sectors:values('sector'),countries:values('country'),industries:values('industry').map(name=>({name,sector:rows.find(s=>s.industry===name).sector})),indices:screenerIndices};
}
