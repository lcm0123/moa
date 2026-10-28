// Optional deterministic presentation of already-read rows. This is not a
// discovery/ranking path and never fetches data, calculates shares or invokes AI.
export function withMissingCompanyData(answer,coverage=[]){
 if(!coverage.length||coverage.some(c=>c.refs?.length))return answer;
 const names={business:'사업·매출 구성',financials:'재무',reports:'리포트'},states={not_available:'조회 가능한 저장 자료 부족',read_failed:'조회 오류',evidence_limit:'이번 질문의 조회 한도 도달',unavailable:'출처 재확인 필요'};
 if(!coverage.every(c=>names[c.dataset]&&states[c.status]))return answer;
 return {...answer,blocks:[{kind:'unknown',text:coverage.map(c=>`${c.name} · ${names[c.dataset]}: ${states[c.status]}`).join('\n')+'\n\n현재 확보한 자료로는 기업 분석이나 매출 비중 계산을 할 수 없습니다. 자료가 부족하다는 뜻이며, 해당 사업이 없거나 비중이 0이라는 뜻은 아닙니다.',refs:[]}],followups:[],withheld:[]};
}
export function withRequestedTable(answer,question,evidence,assets=[],market='ALL',{companyContext=false}={}){
 const requested=/표로|표\s*형식|표를|표에|표만|비교표|\btable\b/i.test(question)||(companyContext&&/매출.{0,12}(?:비중|구성|구조)|사업별\s*매출|revenue\s*(?:mix|share|composition)/i.test(question));
 if(!requested||/표.{0,5}(?:말고|없이|빼|제외)|(?:no|without)\s+(?:a\s+)?table/i.test(question))return answer;
 if(answer.blocks.some(b=>/\|[^\n]+\|\s*\n\s*\|?\s*:?-{3,}/.test(b.text)))return answer;
 const cell=s=>String(s??'미확인').replace(/[\r\n|]/g,' ').trim(),rows=[],refs=[];
 for(const e of evidence){
  const d=e.data,a=assets.find(a=>a.id===d?.asset);
  if(e.kind!=='business'||!d?.label||d.amount===null||d.amount===undefined)continue;
  if(a&&market!=='ALL'&&a.kind!==(market==='CRYPTO'?'CRYPTO':market+'_STOCK'))continue;
  const share=d.shareCalculation!=='BLOCKED'&&Number.isFinite(d.percent)?Number(d.percent.toFixed(2))+'%':'계산 보류';
  const origin=d.shareOrigin==='DERIVED'?'비중 계산값':d.shareOrigin==='DISCLOSED'?'비중 공시값':'비중 미확인';
  const amountOrigin=d.amountOrigin==='DERIVED'?'매출 계산값':d.amountOrigin==='DISCLOSED'?'매출 공시값':'매출 원문 기준';
  const period=[d.period?.label,d.period?.start&&d.period?.end?d.period.start+' ~ '+d.period.end:null].filter(Boolean).join(' · ');
  rows.push([a?.name||e.title,d.label,d.amount+' '+d.unit,share,period,amountOrigin+' / '+origin].map(cell));refs.push(e.id);
 }
 if(!rows.length)return answer;
 const text='조회한 자료의 사업부 매출과 비중입니다.\n\n| 기업 | 사업부 | 매출액 | 비중 | 회계기간 | 값의 구분 |\n| --- | --- | --- | --- | --- | --- |\n'+rows.slice(0,12).map(r=>'| '+r.join(' | ')+' |').join('\n');
 return {...answer,blocks:[...answer.blocks,{kind:'fact',text,refs:refs.slice(0,12),generatedBy:'stored_rows_formatter'}]};
}
