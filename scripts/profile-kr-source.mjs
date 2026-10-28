import {request as dartRequest} from '../server/us-kr-evidence.mjs';
export async function koreanProfileReports(env,asset){
 const end=new Date(),start=new Date(end);start.setUTCFullYear(start.getUTCFullYear()-3);const fmt=d=>d.toISOString().slice(0,10).replaceAll('-',''),reports=[];
 for(let page=1;page<=2;page++){
  let d;try{d=await dartRequest({...env,DART_API_KEY:env.OPENDART_API_KEY||env.DART_API_KEY},'list.json',{corp_code:asset.issuerId,bgn_de:fmt(start),end_de:fmt(end),pblntf_ty:'A',page_count:'100',page_no:String(page),sort:'date',sort_mth:'desc'});}catch(e){throw Error(/DART 상태 (\d{3})/.test(e.message)?'DART_API_'+e.message.match(/\d{3}/)[0]:/HTTP (\d{3})/.test(e.message)?'DART_HTTP_'+e.message.match(/\d{3}/)[0]:'DART_CONNECTION_FAILED');}
  reports.push(...(d.list||[]).filter(r=>r.corp_code===asset.issuerId&&/사업보고서|반기보고서|분기보고서/.test(r.report_nm)).map(r=>({...r,key:r.rcept_no})));if(page>=Number(d.total_page||1))break;
 }
 return reports;
}
export async function koreanProfileSources(tools,asset,report){
 const tables=await tools.profileSections(asset,report,'BENEFICIARY_MATERIALITY'),business=await tools.profileSections(asset,report,'BENEFICIARY_BUSINESS');
 return [...new Map([...tables,...business].map(s=>[s.locator,s])).values()].slice(0,12);
}
