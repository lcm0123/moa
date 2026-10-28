import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';
import {secFetch} from '../server/sec-client.mjs';
import {cachedResearch} from '../server/research-cache.mjs';
import {finvizCsv,parseCsv,digest} from '../server/providers/finviz-client.mjs';
import {request as dartRequest,documentXml,boundedBytes,extractBusinessEvidence} from '../server/us-kr-evidence.mjs';
import {dartCompanyMap,dartZipXml} from '../server/providers/dart-financials.mjs';
import mirrors from '../config/competitor-ir-sources.json' with {type:'json'};
import {buildProfile,has,rules} from '../server/competitor-model.mjs';
import {extractTableEvidence} from '../server/catalyst/table-evidence.mjs';
const clean=s=>s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
export function businessBlocks(text,market){
 if(market==='KR'){
  const start=/<TITLE[^>]*>[^<]*사업의\s*내용/i.exec(text),end=/<TITLE[^>]*>[^<]*재무에\s*관한/i.exec(text.slice(start?.index||0));
  const section=text.slice(start?.index||0,end?(start?.index||0)+end.index:undefined);
  return [...section.matchAll(/<P\b[^>]*>([\s\S]*?)<\/P>/gi)].map((m,i)=>({locator:'사업의 내용 · 문단 '+(i+1),text:clean(m[1])}));
 }
 const flattened=text.replace(/<\/(?:p|div|tr)>/gi,'\n').split('\n').map(clean).filter(Boolean).join('\n');
 const starts=[...flattened.matchAll(/ITEM\s*1[.\s]+BUSINESS/gi)],ranges=starts.map(m=>{const rest=flattened.slice(m.index+ m[0].length),end=/ITEM\s*1A[.\s]+RISK/i.exec(rest);return rest.slice(0,end?.index||120000);}).sort((a,b)=>b.length-a.length);
 if(!ranges.length)return [];
 return ranges[0].split('\n').filter(t=>t.length>25).map((text,i)=>({locator:'Item 1 Business · 문단 '+(i+1),text}));
}
function iso(s){const m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);return m?`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`:s;}
export async function annualMetadata(env,ticker,cik){
 let failed=null;
 try{
  const d=await cachedResearch(env,'sec:submissions:'+cik,86400000,async()=>await(await secFetch(env,`https://data.sec.gov/submissions/CIK${cik.padStart(10,'0')}.json`)).json());
  if(d.stale||Number(d.cik)!==Number(cik)||!d.tickers?.includes(ticker))throw Error('SEC_IDENTITY_OR_FRESHNESS');
  const r=d.filings.recent,i=r.form.findIndex(f=>/^(10-K|20-F|40-F)(\/A)?$/.test(f));if(i<0)throw Error('SEC_ANNUAL_NOT_IN_RECENT');
  return {form:r.form[i],receipt:r.accessionNumber[i],sourceDate:r.filingDate[i],reportDate:r.reportDate[i],url:`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${r.accessionNumber[i].replaceAll('-','')}/${r.primaryDocument[i]}`,metadataSource:'SEC submissions'};
 }catch(e){failed=e.message;}
 // Existing Finviz latest-filings export contains filing metadata, never bodies.
 const d=await finvizCsv(env,'/export/latest-filings',{t:ticker},3600000),r=parseCsv(d.text,['Filing Date','Report Date','Form','Filing','Document']).filter(r=>/^(10-K|20-F|40-F)(\/A)?$/.test(r.Form)).sort((a,b)=>iso(b['Filing Date']).localeCompare(iso(a['Filing Date'])))[0];
 if(!r)throw Error('연차 공시 목록 확인 필요');
 const f=new URL(r.Filing),m=/^\/Archives\/edgar\/data\/(\d+)\/(\d{18})\/(\d{10}-\d{2}-\d{6})-index\.html?$/.exec(f.pathname);
 if(f.hostname!=='www.sec.gov'||!m||Number(m[1])!==Number(cik)||m[2]!==m[3].replaceAll('-',''))throw Error('연차 공시 CIK 불일치');
 const u=new URL(r.Document),doc=u.searchParams.get('doc')||u.pathname;if(u.hostname!=='www.sec.gov'||!doc.startsWith(`/Archives/edgar/data/${Number(cik)}/${m[2]}/`)||doc.includes('..'))throw Error('SEC 원문 식별 오류');
 return {form:r.Form,receipt:m[3],sourceDate:iso(r['Filing Date']),reportDate:iso(r['Report Date']),url:'https://www.sec.gov'+doc,metadataSource:'Finviz Latest Filings · SEC CIK 교차 확인',secStatus:failed};
}
async function extractPdf(file,python){return new Promise((resolve,reject)=>{
 const child=spawn(python||'python',['-X','utf8','scripts/competitor-pdf.py',file],{windowsHide:true,stdio:['ignore','pipe','pipe']}),chunks=[];let size=0;
 const timer=setTimeout(()=>{child.kill();reject(Error('PDF 분석 시간 제한'));},60000);
 child.stdout.on('data',b=>{size+=b.length;if(size>2500000){child.kill();reject(Error('PDF 텍스트 크기 제한'));}else chunks.push(b);});child.stderr.resume();child.on('error',()=>{clearTimeout(timer);reject(Error('PDF 분석기 실행 필요'));});child.on('close',code=>{clearTimeout(timer);if(code)return reject(Error('PDF 분석 실패'));try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(Error('PDF 응답 오류'));}});
 });}
export async function loadUsProfile(env,company,{tableSubject=null}={}){
 const {ticker,cik}=company,meta=await annualMetadata(env,ticker,cik);let blocks=[],source='SEC EDGAR',sourceUrl=meta.url,bodyHash,tables=[];
 try{const r=await secFetch(env,meta.url,'text/html');const bytes=await boundedBytes(r.body,12000000),html=new TextDecoder().decode(bytes);if(!html.includes(cik.padStart(10,'0'))&&!html.includes(`>${Number(cik)}<`))throw Error('SEC 본문 CIK 미확인');blocks=businessBlocks(html,'US');bodyHash=await digest(html);if(tableSubject)tables=extractTableEvidence(html,{subject:tableSubject,source_location:sourceUrl});}
 catch{
  const mirror=mirrors.find(s=>s.ticker===ticker&&Number(s.cik)===Number(cik)&&s.form===meta.form&&s.reportDate===meta.reportDate);if(!mirror)throw Error('SEC 원문 접근 실패 · 공식 IR 연차자료 연결 필요');
  const r=await fetch(mirror.url,{redirect:'error',signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('공식 IR 문서 연결 실패');const bytes=await boundedBytes(r.body,12000000);if(new TextDecoder().decode(bytes.slice(0,4))!=='%PDF')throw Error('공식 IR PDF 형식 오류');
  const file=path.resolve('.sites-runtime',`competitor-${ticker}.pdf`);fs.writeFileSync(file,bytes);let pages;try{pages=await extractPdf(file,env.MOA_PYTHON);}finally{fs.unlinkSync(file);}
  const cover=pages[0]?.text||'';if(!cover.includes(mirror.name)||!has(cover,ticker)||!cover.includes(mirror.coverDate)||!cover.includes('FORM 10-K'))throw Error('공식 IR 보고서 식별 불일치');
  const start=pages.findIndex(p=>/ITEM\s*1\.\s*BUSINESS/i.test(p.text)&&p.text.length>2000);if(start<0)throw Error('연차 사업 본문 미확인');
  const selected=[];for(const p of pages.slice(start)){if(selected.length&&/ITEM\s*1A\.\s*RISK/i.test(p.text))break;selected.push(p);}
  // Paragraphs keep product/market context within a page. Broad document-wide
  // word co-occurrence is not used for relation verification.
  blocks=selected.flatMap(p=>p.text.split(/\n\s*\n/).map((text,i)=>({locator:p.locator+' · 문단 '+(i+1),text:clean(text)}))).filter(b=>b.text.length<8000);
  bodyHash=await digest(new TextDecoder('latin1').decode(bytes));source=mirror.source;sourceUrl=mirror.url;
 }
 if(!blocks.length)throw Error('연차 사업 본문 추출 범위 확인 필요');
 const checkedAt=new Date().toISOString();return buildProfile({market:'US',ticker,name:company.name,issuer:cik,identityVerified:true,latestVerified:true,source,sourceUrl,...meta,checkedAt,documentHash:bodyHash,industry:company.industry||null,...(tableSubject?{tables,businessParagraphs:blocks.slice(0,300)}:{})},blocks);
}
export async function loadKrProfile(env,stock){
 const directory=await cachedResearch(env,'dart:companies',86400000,async()=>({items:dartCompanyMap(await dartZipXml(await dartRequest(env,'corpCode.xml',{},true)))}));
 const matches=directory.items.filter(c=>c.ticker===stock.ticker);if(matches.length!==1)throw Error('DART 보통주 식별 미확인');const corp=matches[0].corpCode;
 const company=await cachedResearch(env,'dart:company:'+corp,86400000,()=>dartRequest(env,'company.json',{corp_code:corp}));if(company.stock_code!==stock.ticker||company.corp_code!==corp)throw Error('DART 회사 불일치');
 const today=new Date(),from=new Date(today);from.setUTCFullYear(from.getUTCFullYear()-2);
 const list=await dartRequest(env,'list.json',{corp_code:corp,bgn_de:from.toISOString().slice(0,10).replaceAll('-',''),end_de:today.toISOString().slice(0,10).replaceAll('-',''),pblntf_ty:'A',last_reprt_at:'Y',sort:'date',sort_mth:'desc',page_count:'100'});
 const f=list.list?.find(f=>/^(?:\[.*?\])?(사업|반기|분기)보고서/.test(f.report_nm)&&f.stock_code===stock.ticker&&f.corp_code===corp);if(!f)throw Error('DART 최신 정기 공시 없음');
 const xml=await documentXml(await dartRequest(env,'document.xml',{rcept_no:f.rcept_no},true)),checkedAt=new Date().toISOString(),identity={ticker:stock.ticker,name:company.corp_name,marketName:stock.name};
 const table=extractBusinessEvidence(xml,identity,f,checkedAt).filter(e=>!e.reason.includes('상표의 회사와'));
 const allowed=rules.products.filter(p=>table.some(e=>p.aliases.some(a=>has(e.products||'',a)))).map(p=>p.id);
 const profile=buildProfile({market:'KR',...identity,issuer:corp,isin:stock.isin,identityVerified:true,latestVerified:true,source:'OpenDART '+f.report_nm,sourceUrl:'https://dart.fss.or.kr/dsaf001/main.do?rcpNo='+f.rcept_no,receipt:f.rcept_no,sourceDate:f.rcept_dt.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),checkedAt,documentHash:await digest(xml),sector:stock.sector,quote:stock.quote},businessBlocks(xml,'KR'));
 profile.products=profile.products.filter(p=>allowed.includes(p.id));
 // A memory segment's 100% is not DRAM's or NAND's individual revenue share.
 profile.revenueNotes=table.map(e=>({products:e.products,share:e.segmentShare,scope:'복수 제품 사업부 · 개별 제품 비중 아님',evidence:e.evidence}));
 profile.coverage=profile.products.length?'extracted':'insufficient';return profile;
}
