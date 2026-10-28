// Decimal strings preserve disclosed precision, including integers above 2^53.
export const calculationVersion='profile-calc-1';
export function decimal(value){
 if(typeof value==='number'&&(!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER))return null;
 const s=String(value??'').replaceAll(',','').trim();if(!/^[+-]?\d+(?:\.\d+)?$/.test(s))return null;
 let [a,b='']=s.replace(/^[+-]/,'').split('.');a=a.replace(/^0+(?=\d)/,'');b=b.replace(/0+$/,'');
 return (s.startsWith('-')&&(a!=='0'||b)?'-':'')+a+(b?'.'+b:'');
}
function parts(v){const s=decimal(v);if(s===null)throw Error('INVALID_DECIMAL');const [a,b='']=s.split('.');return {n:BigInt(a+b),scale:b.length};}
function format(n,s){let x=(n<0n?-n:n).toString().padStart(s+1,'0');return decimal((n<0n?'-':'')+(s?x.slice(0,-s)+'.'+x.slice(-s):x));}
export function add(a,b,subtract=false){const x=parts(a),y=parts(b),s=Math.max(x.scale,y.scale);return format(x.n*10n**BigInt(s-x.scale)+(subtract?-1n:1n)*y.n*10n**BigInt(s-y.scale),s);}
export function ratio(a,b){try{const x=parts(a),y=parts(b);if(y.n<=0n||x.n<0n)return null;return Number(format(x.n*10n**BigInt(y.scale+6)*100n/(y.n*10n**BigInt(x.scale)),6));}catch{return null;}}
const scopeKeys=['issuer','businessItemId','dimension','scope','entityScope','currency','unit','revenueDefinition','classificationVersion'];
export function sameScope(a,b){return scopeKeys.every(k=>a[k]!==null&&a[k]!==undefined&&!['UNKNOWN','UNSPECIFIED',''].includes(a[k])&&a[k]===b[k]);}
const pkey=r=>[r.businessItemId,r.period.start,r.period.end,r.period.type,r.scope,r.entityScope,r.currency,r.unit,r.revenueDefinition,r.classificationVersion].join('|');
export function selectObservations(records,{asOf=null}={}){
 const map=new Map(),conflicts=[];
 for(const r of records.filter(r=>!asOf||r.publishedAt&&r.publishedAt<=asOf).sort((a,b)=>String(b.publishedAt||'').localeCompare(String(a.publishedAt||'')))){
  const key=pkey(r),old=map.get(key);if(!old){map.set(key,r);continue;}
  // A later retrieval alone is not authority to replace a prior publication.
  if(['amountExact','totalRevenueExact','percent'].some(k=>old[k]!==r[k])&&old.publishedAt===r.publishedAt&&!old.correction&&!r.correction){conflicts.push(key);map.delete(key);}
 }
 return {selected:[...map.entries()].filter(([k])=>!conflicts.includes(k)).map(([,v])=>v),conflicts};
}
const isoNext=d=>new Date(Date.parse(d)+86400000).toISOString().slice(0,10);
function derive(base,inputs,amount,total,period,formula){return {...base,id:calculationVersion+':'+inputs.map(i=>i.id).join(':'),amountExact:amount,amount:null,totalRevenueExact:total,totalRevenue:null,percent:total===null?null:ratio(amount,total),reportedShare:null,calculatedShare:total===null?null:ratio(amount,total),basis:'DERIVED',valueOrigin:'DERIVED',period,calculationVersion,formula,inputIds:inputs.map(i=>i.id),inputClaimIds:inputs.map(i=>i.claimId).filter(Boolean),inputPeriods:inputs.map(i=>i.period),inputs:inputs.map(i=>({id:i.id,claimId:i.claimId,period:i.period,amountExact:i.amountExact,totalRevenueExact:i.totalRevenueExact,sourceUrl:i.sourceUrl,quote:i.quote})),publishedAt:inputs.map(i=>i.publishedAt).sort().at(-1)};}
export function calculateProfile(records,{asOf=null}={}){
 const {selected,conflicts}=selectObservations(records,{asOf}),quarters=[],issues=conflicts.map(k=>({state:'CONFLICTED',key:k}));
 for(const r of selected){
  const p=r.period||{},fy=p.fiscalYear,q=p.fiscalQuarter;if(r.valueOrigin==='ESTIMATED'||r.basis==='ESTIMATED'||!fy||!q||!p.start||!p.end||decimal(r.amountExact)===null)continue;
  if(p.type==='SINGLE_QUARTER'){quarters.push(r);continue;}
  if(!['YTD','HALF_YEAR','ANNUAL'].includes(p.type))continue;
  const direct=selected.find(x=>x.period.type==='SINGLE_QUARTER'&&x.period.fiscalYear===fy&&x.period.fiscalQuarter===q&&sameScope(r,x));if(direct)continue;
  const prev=q===1?null:selected.find(x=>['YTD','HALF_YEAR'].includes(x.period.type)&&x.period.fiscalYear===fy&&x.period.fiscalQuarter===q-1&&x.period.start===p.start&&x.period.end<p.end&&sameScope(r,x));
  if(q>1&&!prev){issues.push({id:r.id,state:'NOT_COMPARABLE',reason:'직전 누적값 또는 비교 가능한 범위 없음'});continue;}
  if(!sameScope(r,r)||q>1&&r.revisionGroup!==prev.revisionGroup){issues.push({id:r.id,state:'NOT_COMPARABLE',reason:'범위·정정 기준 불일치'});continue;}
  const amount=prev?add(r.amountExact,prev.amountExact,true):r.amountExact;
  if(amount.startsWith('-')){issues.push({id:r.id,state:'NOT_COMPARABLE',reason:'누적 차감 결과 음수',amountExact:amount});continue;}
  const total=decimal(r.totalRevenueExact)!==null&&(!prev||decimal(prev.totalRevenueExact)!==null)?prev?add(r.totalRevenueExact,prev.totalRevenueExact,true):r.totalRevenueExact:null;
  const period={...p,start:prev?isoNext(prev.period.end):p.start,type:'SINGLE_QUARTER',label:`FY ${fy} Q${q}`};
  const days=(Date.parse(period.end)-Date.parse(period.start))/86400000;if(days<70||days>105){issues.push({id:r.id,state:'NOT_COMPARABLE',reason:'분기 기간 불일치'});continue;}
  quarters.push(derive(r,prev?[r,prev]:[r],amount,total,period,prev?'currentYTD - previousYTD':'Q1 YTD'));
 }
 const sorted=quarters.sort((a,b)=>a.period.end.localeCompare(b.period.end)),ttm=[],changes=[];
 for(const r of sorted){
  const series=sorted.filter(x=>sameScope(x,r)&&x.period.end<=r.period.end),four=series.slice(-4);
  if(four.length===4&&four.every((x,i)=>!i||isoNext(four[i-1].period.end)===x.period.start)&&four.every(x=>decimal(x.totalRevenueExact)!==null)&&four.every(x=>x.revisionGroup===r.revisionGroup)){
   const amount=four.reduce((a,x)=>add(a,x.amountExact),'0'),total=four.reduce((a,x)=>add(a,x.totalRevenueExact),'0');
   ttm.push(derive(r,four,amount,total,{...r.period,start:four[0].period.start,type:'TTM',label:r.period.end+' 기준 최근 12개월'},'sum(4 quarter amounts) / sum(4 quarter total revenues)'));
  }
  for(const kind of ['QoQ','YoY']){const old=series.find(x=>kind==='YoY'?x.period.fiscalYear===r.period.fiscalYear-1&&x.period.fiscalQuarter===r.period.fiscalQuarter:isoNext(x.period.end)===r.period.start);if(!old||old.revisionGroup!==r.revisionGroup)continue;
   const percent=Number(old.amountExact)>0?ratio(r.amountExact,old.amountExact):null;
   changes.push({itemId:r.businessItemId,label:r.label,parent:r.parent,dimension:r.dimension,kind,inputIds:[old.id,r.id],period:r.period,amountGrowthPct:percent===null?null:percent-100,shareChangePp:Number.isFinite(old.percent)&&Number.isFinite(r.percent)?r.percent-old.percent:null,calculationVersion});
  }
 }
 return {quarters:sorted,ttm,changes,issues,version:calculationVersion};
}
