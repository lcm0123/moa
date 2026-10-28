// SEC 13F amounts and security identity, independent of current stock quotes.
const decode=s=>s.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi,m=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[m]??String.fromCodePoint(m.startsWith('&#x')?parseInt(m.slice(3,-1),16):Number(m.slice(2,-1)))));
function xmlCheck(xml){if(typeof xml!=='string'||/<!DOCTYPE|<!ENTITY/i.test(xml)||xml.length>32000000)throw new Error('Invalid SEC XML');}
export function xmlValue(xml,tag){const m=xml.match(new RegExp('<(?:[\\w-]+:)?'+tag+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?'+tag+'>','i'));return m?decode(m[1].trim()):null;}
export function xmlBlocks(xml,tag){return [...xml.matchAll(new RegExp('<(?:[\\w-]+:)?'+tag+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?'+tag+'>','gi'))].map(m=>m[1]);}
function number(xml,tag){const s=xmlValue(xml,tag);if(s===null||!/^\d+(?:\.\d+)?$/.test(s))throw new Error('Missing SEC '+tag);const n=Number(s);if(!Number.isSafeInteger(n))throw new Error('Invalid SEC amount');return n;}
export function parseCover(xml,filing){
 xmlCheck(xml);if(!xmlValue(xml,'submissionType')?.startsWith('13F-HR'))throw new Error('Not 13F holdings');
 if(filing.cik&&Number(xmlValue(xml,'cik'))!==Number(filing.cik))throw new Error('SEC CIK mismatch');
 const period=xmlValue(xml,'reportCalendarOrQuarter');const p=period?.match(/^(\d\d)-(\d\d)-(\d{4})$/);if(!p||`${p[3]}-${p[1]}-${p[2]}`!==filing.period)throw new Error('SEC period mismatch');
 const amended=filing.form==='13F-HR/A',amendmentType=(xmlValue(xml,'amendmentType')||'').toUpperCase();
 if(amended&&!['RESTATEMENT','NEW HOLDINGS'].includes(amendmentType))throw new Error('Unknown amendment type');
 const multiplier=filing.filedAt<'2023-01-03'?1000:1;
 return {...filing,amended,amendmentType,name:xmlValue(xmlBlocks(xml,'filingManager')[0]||'','name'),entryCount:number(xml,'tableEntryTotal'),totalValue:number(xml,'tableValueTotal')*multiplier,confidential:xmlValue(xml,'isConfidentialOmitted')==='true',multiplier};
}
export function parseInformationTable(xml,multiplier=1){
 xmlCheck(xml);if(!/<(?:[\w-]+:)?informationTable[\s>]/i.test(xml))throw new Error('Not SEC information table');
 return xmlBlocks(xml,'infoTable').map(block=>{
  const cusip=xmlValue(block,'cusip')?.toUpperCase(),name=xmlValue(block,'nameOfIssuer'),titleOfClass=xmlValue(block,'titleOfClass')?.toUpperCase(),unit=xmlValue(block,'sshPrnamtType')?.toUpperCase(),option=xmlValue(block,'putCall')?.toUpperCase()||null;
  if(!cusip||!name||!titleOfClass||!['SH','PRN'].includes(unit)||option&&!['PUT','CALL'].includes(option))throw new Error('SEC security identity missing');
  const kind=option?.toLowerCase()||(unit==='SH'?'share':'principal');
  return {id:[cusip,unit,kind].join('|'),cusip,name,titleOfClass,unit,kind,shares:number(block,'sshPrnamt'),valueUsd:number(block,'value')*multiplier};
 });
}
export function aggregatePositions(rows){const groups=new Map();for(const row of rows){const previous=groups.get(row.id);if(previous){previous.shares+=row.shares;previous.valueUsd+=row.valueUsd;}else groups.set(row.id,{...row});}return [...groups.values()];}
export function resolveFilings(filings){
 let rows=null,confidential=false;const applied=[];
 for(const filing of [...filings].sort((a,b)=>a.filedAt.localeCompare(b.filedAt)||a.accession.localeCompare(b.accession))){
  if(filing.rows.length!==filing.entryCount||Math.abs(filing.rows.reduce((s,r)=>s+r.valueUsd,0)-filing.totalValue)>1)throw new Error('SEC information table incomplete');
  if(!filing.amended||filing.amendmentType==='RESTATEMENT'){rows=filing.rows;applied.length=0;confidential=filing.confidential;}
  else if(filing.amendmentType==='NEW HOLDINGS'&&rows){rows=[...rows,...filing.rows];confidential ||= filing.confidential;}
  else throw new Error('Amendment without complete base');
  applied.push({accession:filing.accession,filedAt:filing.filedAt,form:filing.form,amendmentType:filing.amendmentType,url:filing.url});
 }
 if(!rows)throw new Error('No complete SEC filing');
 return {items:aggregatePositions(rows).filter(r=>r.shares>0),filings:applied,filedAt:applied.at(-1).filedAt,amended:applied.some(f=>f.form==='13F-HR/A'),confidential,totalValue:rows.reduce((s,r)=>s+r.valueUsd,0),entryCount:rows.length};
}
export function previousQuarter(period){const d=new Date(period+'T00:00:00Z');return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-2,0)).toISOString().slice(0,10);}
export function comparePositions(current,previous){
 const comparable=previous&&previous.period===previousQuarter(current.period)&&!previous.confidential&&!current.confidential;
 const old=new Map((previous?.items||[]).map(r=>[r.id,r]));const ids=new Set(current.items.map(r=>r.id));
 const compare=(row,before)=>{if(!comparable||row.unit!=='SH')return {...row,previousShares:null,shareChange:null,shareChangePct:null,changeType:'unknown'};
  const n=before?.shares||0,delta=row.shares-n;return {...row,previousShares:n,shareChange:delta,shareChangePct:n?delta/n*100:null,changeType:n===0?'new':delta>0?'increased':delta<0?'reduced':'unchanged'};};
 return {comparable:!!comparable,items:current.items.map(row=>compare(row,old.get(row.id))),disposed:comparable?previous.items.filter(r=>!ids.has(r.id)&&r.unit==='SH').map(r=>({...r,previousShares:r.shares,shares:0,valueUsd:0,previousValueUsd:r.valueUsd,shareChange:-r.shares,shareChangePct:-100,changeType:'disposed'})):[]};
}
const normalizedName=s=>String(s).toUpperCase().replace(/[^A-Z0-9]/g,'');
// Match unique filing totals AND issuer identity, never infer a ticker by name alone.
export function enrichPositions(items,exportRows){
 const key=r=>JSON.stringify([r.kind,r.shares,r.valueUsd,normalizedName(r.name)]),index=new Map();
 for(const row of exportRows){const k=key(row);index.set(k,index.has(k)?null:row);}
 return items.map(item=>{const row=index.get(key(item));
  return {...item,ticker:row?.ticker||null,sector:row?.sector||'분류 미제공',industry:row?.industry||null,mappingStatus:row?'matched_filing_totals':'unmapped'};});
}
export function sectorAllocation(snapshot,kind='share'){
 const rows=snapshot.items.filter(r=>r.kind===kind),total=rows.reduce((s,r)=>s+r.valueUsd,0),sectors=new Map();for(const r of rows)sectors.set(r.sector||'분류 미제공',(sectors.get(r.sector||'분류 미제공')||0)+r.valueUsd);
 return {period:snapshot.period,totalValue:total,sectors:[...sectors].map(([name,value])=>({name,value,weight:total?value/total*100:0})).sort((a,b)=>b.value-a.value)};
}
