import {secFetch} from '../server/sec-client.mjs';
import {clean} from '../server/catalyst/core.mjs';
export async function americanProfileReports(env,asset){
 const response=await secFetch(env,'https://data.sec.gov/submissions/CIK'+String(asset.issuerId).padStart(10,'0')+'.json'),d=await response.json();if(Number(d.cik)!==Number(asset.issuerId))throw Error('ISSUER_MISMATCH');
 const map=r=>(r.form||[]).flatMap((form,i)=>/^(10-Q|10-K|20-F|6-K|40-F)(\/A)?$/.test(form)&&/^\d{10}-\d{2}-\d{6}$/.test(r.accessionNumber?.[i]||'')&&/^[A-Za-z0-9_.-]+$/.test(r.primaryDocument?.[i]||'')?[{key:r.accessionNumber[i],title:form,publishedAt:r.filingDate[i],reportDate:r.reportDate[i],url:`https://www.sec.gov/Archives/edgar/data/${Number(asset.issuerId)}/${r.accessionNumber[i].replaceAll('-','')}/${r.primaryDocument[i]}`}]:[]);
 const reports=map(d.filings?.recent||{});
 // A single historical submissions chunk is sufficient for each bounded pass.
 if(reports.filter(r=>/^10-[QK]/.test(r.title)).length<8){const file=(d.filings?.files||[]).find(f=>new RegExp('^CIK'+String(asset.issuerId).padStart(10,'0')+'-submissions-\\d{3}\\.json$').test(f.name));if(file){const past=await secFetch(env,'https://data.sec.gov/submissions/'+file.name);reports.push(...map(await past.json()));}}
 return [...new Map(reports.map(r=>[r.key,r])).values()].sort((a,b)=>String(b.publishedAt).localeCompare(String(a.publishedAt)));
}
export function filingSummaryReports(xml,base){
 if(xml.length>1500000||/<!DOCTYPE|<!ENTITY/i.test(xml))return [];
 const reports=[];
 for(const m of xml.matchAll(/<Report\b[^>]*>([\s\S]*?)<\/Report>/gi)){
  const title=clean(/<ShortName>([\s\S]*?)<\/ShortName>/i.exec(m[1])?.[1]||''),file=clean(/<HtmlFileName>([\s\S]*?)<\/HtmlFileName>/i.exec(m[1])?.[1]||'');
  if(!/segment|disaggregat|geograph|revenue.*(?:product|service)|product.*revenue/i.test(title)||!/^[A-Za-z0-9_-]+\.htm[l]?$/.test(file))continue;
  const url=new URL(file,base).href;if(!url.startsWith(base))continue;reports.push({title,url});
 }return reports.slice(0,2);
}
export async function americanProfileSources(env,tools,asset,report){
 const base=report.url.slice(0,report.url.lastIndexOf('/')+1),roots={assetId:asset.id,roots:['https://www.sec.gov'],verificationSource:report.url};let pieces=[];
 try{
  const r=await secFetch(env,base+'FilingSummary.xml','application/xml');pieces=filingSummaryReports(await r.text(),base);
 }catch(e){if(/SEC_ACCESS|SECURITY_BLOCK|BLOCKED_HASH/.test(e.message))throw e;}
 const out=[];
 for(const item of pieces){const s=await tools.read({...item,title:report.title+' · '+item.title},{asset,roots,purpose:'BUSINESS_REVENUE',filingDate:report.publishedAt});if(s.status==='read')out.push({...s,heading:item.title,periodEnd:report.reportDate,profileDocumentKind:'SEC_FINANCIAL_TABLE'});}
 if(out.length)return out;
 const s=await tools.read(report,{asset,roots,purpose:'BUSINESS_REVENUE',filingDate:report.publishedAt});if(s.status!=='read')throw Error((s.code||'FETCH_FAILED').toUpperCase());return [{...s,periodEnd:report.reportDate,profileDocumentKind:'SEC_REPORT'}];
}
