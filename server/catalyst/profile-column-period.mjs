// Calendar revenue periods must be closed when the source was published.
// A report's collection date cannot turn a future/forecast year into actuals.
const dateOnly=value=>/^\d{4}-\d{2}-\d{2}/.exec(String(value||''))?.[0]||null;
export function periodAvailableAtSource(period,source,{now=Date.now()}={}){
 if(!period?.end)return true;
 const end=dateOnly(period.end),start=dateOnly(period.start);
 if(!end||end!==period.end||!Number.isFinite(Date.parse(end))||start&&start>end)return false;
 const today=new Date(now).toISOString().slice(0,10),published=dateOnly(source?.publishedAt),observed=dateOnly(source?.observedAt);
 return end<=today&&end<=(published||observed||today);
}

export function disclosedColumnPeriod(label,source={}){
 const text=String(label||''),year=/(?<!\d)(20\d{2})(?!\d)/.exec(text)?.[1];
 if(!year||/예상|추정|전망|forecast|estimate/i.test(text))return null;
 const report=/(반기|분기|사업)보고서\s*\((20\d{2})\.(03|06|09|12)\)/.exec(source.title||'');
 const range=/([0-9]{1,2})\s*[~～–-]\s*([0-9]{1,2})\s*월/.exec(text);
 let month=null,confidence='EXPLICIT_COLUMN_LABEL';
 if(range){if(+range[1]!==1||![3,6,9,12].includes(+range[2]))return null;month=+range[2];}
 else if(/반기|상반기/.test(text))month=6;
 else if(/9개월|3분기\s*누적/.test(text))month=9;
 else if(/1분기|3개월/.test(text))month=3;
 else if(/연간|온기|1년|annual/i.test(text))month=12;
 else if(/분기|누적/.test(text))return null;
 else if(report?.[2]===year){month=+report[3];confidence='REPORT_TITLE_CURRENT_YEAR';}
 // Without a matching report or an explicit annual/month label, a bare year
 // does not establish whether a table is annual or year-to-date.
 if(!month)return null;
 const period={start:year+'-01-01',end:`${year}-${String(month).padStart(2,'0')}-${new Date(Date.UTC(+year,month,0)).getUTCDate()}`,type:month===12?'ANNUAL':'YTD',fiscalYear:+year,fiscalQuarter:month/3,label:year+'년 '+(month===12?'연간':month===6?'반기':month+'월 누적'),dateConfidence:confidence};
 if(!periodAvailableAtSource(period,source))return null;
 if(confidence==='REPORT_TITLE_CURRENT_YEAR')Object.assign(period,{reportTitle:source.title,originalColumnLabel:text});
 return period;
}
