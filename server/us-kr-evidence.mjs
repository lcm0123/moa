import {rules,version} from './us-kr-model.mjs';
import {dartCompanyMap,dartZipXml} from './providers/dart-financials.mjs';
import {cachedResearch} from './research-cache.mjs';
import {digest} from './providers/finviz-client.mjs';
const clean=s=>String(s).replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
const norm=s=>s.replace(/\s/g,'').toLowerCase();
export function extractBusinessEvidence(xml,identity,filing,checkedAt){
 const title=/<TITLE\b[^>]*>[^<]*주요\s*제품[^<]*<\/TITLE>/i.exec(xml);
 const section=title?xml.slice(title.index,xml.indexOf('</SECTION-2>',title.index)>title.index?xml.indexOf('</SECTION-2>',title.index):title.index+150000):'';
 const result=[],seen=new Set();let tableNo=0;
 for(const match of section.matchAll(/<TABLE\b[^>]*>[\s\S]*?<\/TABLE>/gi)){
  tableNo++;const rows=[...match[0].matchAll(/<TR\b[^>]*>([\s\S]*?)<\/TR>/gi)].map(m=>[...m[1].matchAll(/<(?:TD|TH|TE)\b[^>]*>([\s\S]*?)<\/(?:TD|TH|TE)>/gi)].map(c=>clean(c[1])));
  const head=rows.find(r=>r.some(c=>/주요\s*제품|^품목$/.test(c))&&r.some(c=>/비중|매출액\s*\(비율\)/.test(c))&&r.some(c=>/매출/.test(c)));if(!head)continue;
  const productIndex=head.findIndex(c=>/주요\s*제품|^품목$/.test(c)),shareIndex=head.findIndex(c=>/비중|매출액\s*\(비율\)/.test(c)),brandIndex=head.findIndex(c=>/주요\s*상표/.test(c));
  for(const [rowNo,row] of rows.entries()){
   if(row.length!==head.length)continue;const products=row[productIndex],shareText=row[shareIndex],share=/^(\d+(?:\.\d+)?)\s*%$/.exec(shareText)||(/매출액\s*\(비율\)/.test(head[shareIndex])?/^[\d,]+\s*\((\d+(?:\.\d+)?)\s*%\)$/.exec(shareText):null),pct=share?Number(share[1]):null;
   const matched=rules.topics.filter(t=>t.products.some(p=>{const needle=norm(p),hay=norm(products);return /^[a-z]{1,3}$/.test(needle)?new RegExp('(^|[^a-z])'+needle+'([^a-z]|$)','i').test(products):hay.includes(needle);}));
   for(const topic of matched){
    if(seen.has(topic.id))continue;seen.add(topic.id);
    // A holding company's report may repeat a subsidiary's entire product table.
    // Never describe that subsidiary's 100% as the listed parent's revenue share.
    const issuerName=s=>norm(String(s||'').replace(/주식회사|\(주\)|㈜/g,'').replace(/에스케이/g,'SK'));
    const brand=brandIndex>=0?issuerName(row[brandIndex]):'',ownBrand=brandIndex<0||brand&&[identity.name,identity.marketName].some(n=>issuerName(n)===brand);
    const verified=matched.length===1&&pct>0&&pct<=100&&ownBrand;
    result.push({...identity,topic:topic.id,topicName:topic.name,industries:topic.industries,receipt:filing.rcept_no,reportName:filing.report_nm,publishedDate:filing.rcept_dt.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),availableAt:checkedAt,checkedAt,version,
     status:verified?'verified':'pending',revenueShare:verified?pct:null,segmentShare:pct,products,evidence:row.join(' | '),locator:'주요 제품 및 서비스 · 표 '+tableNo+' · 행 '+(rowNo+1),sourceUrl:'https://dart.fss.or.kr/dsaf001/main.do?rcpNo='+filing.rcept_no,reason:verified?'제품·매출 비중이 같은 표에서 확인됨':!ownBrand?'상표의 회사와 보고 회사가 다름 · 자회사 매출 비중 혼입 방지':'복합 사업부 매출 또는 비중 미확인 · 개별 사업 비중으로 사용하지 않음'});
   }
  }
 }
 return result;
}
export async function boundedBytes(stream,limit){
 const reader=stream.getReader(),chunks=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit){await reader.cancel();throw Error('DART 문서 크기 제한');}chunks.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}
export async function request(env,endpoint,params,binary=false){
 const url=new URL('https://opendart.fss.or.kr/api/'+endpoint);url.searchParams.set('crtfc_key',env.DART_API_KEY);for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
 let response;try{response=await fetch(url,{signal:AbortSignal.timeout(25000)});}catch{throw Error('DART 연결 실패');}
 if(!response.ok)throw Error('DART HTTP '+response.status);
 if(Number(response.headers.get('content-length'))>15000000){await response.body?.cancel();throw Error('DART 문서 크기 제한');}
 const buffer=(await boundedBytes(response.body,15000000)).buffer;
 if(binary)return buffer;let d;try{d=JSON.parse(new TextDecoder().decode(buffer));}catch{throw Error('DART 응답 형식 오류');}
 if(!['000','013'].includes(d.status))throw Error('DART 상태 '+String(d.status).slice(0,3));return d;
}
export async function documentXml(buffer){
 const a=new Uint8Array(buffer),v=new DataView(buffer);let end=-1;
 for(let i=a.length-22;i>=Math.max(0,a.length-65557);i--)if(v.getUint32(i,true)===0x06054b50){end=i;break;}
 if(end<0)throw Error('DART ZIP 형식 오류');let at=v.getUint32(end+16,true),entry=null;
 for(let i=0;i<v.getUint16(end+10,true);i++){
  if(v.getUint32(at,true)!==0x02014b50)throw Error('DART ZIP 오류');
  const method=v.getUint16(at+10,true),size=v.getUint32(at+20,true),unpacked=v.getUint32(at+24,true),n=v.getUint16(at+28,true),x=v.getUint16(at+30,true),c=v.getUint16(at+32,true),name=new TextDecoder().decode(a.slice(at+46,at+46+n)),offset=v.getUint32(at+42,true);at+=46+n+x+c;
  if(/\.xml$/i.test(name)&&(!entry||unpacked>entry.unpacked))entry={method,size,unpacked,offset};
 }
 if(!entry||entry.unpacked>12000000)throw Error('DART 원문 크기/형식 제한');
 const {offset,method,size}=entry,start=offset+30+v.getUint16(offset+26,true)+v.getUint16(offset+28,true),bytes=a.slice(start,start+size);
 const raw=method===0?bytes:method===8?await boundedBytes(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')),12000000):null;
 if(!raw||raw.length>12000000)throw Error('DART 원문 제한');
 const prefix=new TextDecoder().decode(raw.slice(0,150)),encoding=/encoding=["'](?:euc-kr|ks_c_5601-1987)/i.test(prefix)?'euc-kr':'utf-8';return new TextDecoder(encoding).decode(raw);
}
export async function collectCompanyEvidence(env,stock){
 if(!env.DART_API_KEY)throw Error('OpenDART 키 연결 필요');
 const directory=await cachedResearch(env,'dart:companies',86400000,async()=>({items:dartCompanyMap(await dartZipXml(await request(env,'corpCode.xml',{},true)))}));
 const companies=directory.items.filter(c=>c.ticker===stock.ticker);if(companies.length!==1)throw Error('DART 종목 고유번호 미확인');const corpCode=companies[0].corpCode;
 const company=await cachedResearch(env,'dart:company:'+corpCode,86400000,()=>request(env,'company.json',{corp_code:corpCode}));if(company.stock_code!==stock.ticker||company.corp_code!==corpCode)throw Error('DART 종목 불일치');
 const now=new Date(),from=new Date(now);from.setUTCFullYear(from.getUTCFullYear()-2);
 const list=await request(env,'list.json',{corp_code:corpCode,bgn_de:from.toISOString().slice(0,10).replaceAll('-',''),end_de:now.toISOString().slice(0,10).replaceAll('-',''),pblntf_ty:'A',last_reprt_at:'Y',sort:'date',sort_mth:'desc',page_count:'100'});
 const filing=list.list?.find(f=>/^(?:\[.*?\])?(?:사업|반기|분기)보고서/.test(f.report_nm)&&f.stock_code===stock.ticker&&f.corp_code===corpCode);if(!filing)throw Error('정기 사업 공시 없음');
 const prior=(await env.DB.prepare('SELECT latest_receipt FROM us_kr_business_jobs WHERE ticker=?').bind(stock.ticker).all()).results[0];
 const currentVersion=(await env.DB.prepare('SELECT id FROM us_kr_evidence WHERE ticker=? AND receipt=? AND version=? LIMIT 1').bind(stock.ticker,filing.rcept_no,version).all()).results.length;
 const checkedAt=new Date().toISOString();if(prior?.latest_receipt===filing.rcept_no&&currentVersion){await env.DB.prepare('UPDATE us_kr_business_jobs SET checked_at=?,next_check=?,error=NULL WHERE ticker=?').bind(checkedAt,Date.now()+7*86400000,stock.ticker).run();return {ticker:stock.ticker,unchanged:true};}
 const xml=await documentXml(await request(env,'document.xml',{rcept_no:filing.rcept_no},true)),hash=await digest(xml);
 const identity={ticker:stock.ticker,corpCode,name:company.corp_name,marketName:stock.name,exchange:stock.exchange,sector:stock.sector,isin:stock.isin},found=extractBusinessEvidence(xml,identity,filing,checkedAt);
 if(!found.length)found.push({...identity,topic:'unclassified',topicName:'연관성 확인 중',industries:[],receipt:filing.rcept_no,publishedDate:filing.rcept_dt.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),availableAt:checkedAt,checkedAt,version,status:'pending',reason:'제품·매출 비중을 같은 표에서 확인하지 못함',sourceUrl:'https://dart.fss.or.kr/dsaf001/main.do?rcpNo='+filing.rcept_no});
 for(const e of found){e.documentHash=hash;const id=[e.ticker,e.topic,e.receipt,version].join(':');await env.DB.prepare('INSERT INTO us_kr_evidence(id,ticker,corp_code,topic,receipt,published_date,available_at,checked_at,version,status,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,e.ticker,corpCode,e.topic,e.receipt,e.publishedDate,e.availableAt,e.checkedAt,version,e.status,JSON.stringify(e)).run();}
 await env.DB.prepare('INSERT INTO us_kr_business_jobs(ticker,corp_code,name,next_check,checked_at,latest_receipt,error) VALUES(?,?,?,?,?,?,NULL) ON CONFLICT(ticker) DO UPDATE SET corp_code=excluded.corp_code,name=excluded.name,next_check=excluded.next_check,checked_at=excluded.checked_at,latest_receipt=excluded.latest_receipt,error=NULL').bind(stock.ticker,corpCode,company.corp_name,Date.now()+7*86400000,checkedAt,filing.rcept_no).run();
 return {ticker:stock.ticker,receipt:filing.rcept_no,verified:found.filter(e=>e.status==='verified').length,pending:found.filter(e=>e.status==='pending').length};
}
