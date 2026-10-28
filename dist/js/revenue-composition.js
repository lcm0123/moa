import {escapeHtml as esc} from './components.js';

const colors=['#4c88ee','#7a67d9','#42ae9c','#eda94f','#dc758e','#7894aa','#a392c4','#b2aa72'];
const known=v=>v!==null&&v!==undefined&&v!==''&&!['UNKNOWN','UNSPECIFIED'].includes(v);
const shown=n=>n.toLocaleString('ko-KR',{maximumFractionDigits:2});
const negativeAmount=r=>typeof r.amountExact==='string'?/^-0*[1-9]|^-0*\.0*[1-9]/.test(r.amountExact):Number.isFinite(r.amount)&&r.amount<0;
const periodKey=p=>[p?.start,p?.end,p?.type].join('|');
function exactDecimal(value){
 if(typeof value==='number'&&(!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER))return null;
 const text=String(value??'');if(text.length>100||!(/^[+-]?\d+(?:\.\d{1,20})?$/).test(text))return null;
 const [whole,fraction='']=text.split('.');return {value:BigInt(whole+fraction),scale:10n**BigInt(fraction.length)};
}
const sameDecimal=(a,b)=>a&&b&&a.value*b.scale===b.value*a.scale;
function signedTableVerified(rows,dataset,dimension){
 const first=rows[0],p=dataset.period,total=exactDecimal(first?.totalRevenueExact),amounts=rows.map(r=>exactDecimal(r.amountExact));
 if(rows.length<2||rows.length>40||!p?.start||!p.end||!known(p.type)||!['UNSPECIFIED','CONSOLIDATED','SEPARATE'].includes(dataset.scope)||!total||total.value<=0n||amounts.some(n=>!n)||!amounts.some(n=>n.value<0n))return false;
 const fields=['sourceId','tableKey','issuer','entityScope','unit','currency','denominatorLabel'];if(!fields.every(k=>known(first[k]))||dataset.key!==first.tableKey)return false;
 const scale=amounts.reduce((s,n)=>n.scale>s?n.scale:s,total.scale),signed=amounts.map(n=>n.value*(scale/n.scale)),sum=signed.reduce((n,v)=>n+v,0n),gross=signed.filter(n=>n>=0n).reduce((n,v)=>n+v,0n),adjustment=signed.filter(n=>n<0n).reduce((n,v)=>n+v,0n),difference=sum-total.value*(scale/total.scale),absDifference=difference<0n?-difference:difference;
 if(absDifference*2n>BigInt(rows.length)||rows.some(r=>!Number.isFinite(r.percent)))return false;
 const reportedSum=rows.reduce((s,r)=>s+r.percent,0),denominator=Number(first.totalRevenueExact);
 let toleranceSum=0;
 const valid=rows.every((r,i)=>{
  const h=r.headerEvidence,a=amounts[i],negative=a.value<0n,decimals=h?.percentDecimals;
  if(r.verificationStatus!=='VERIFIED'||r.dimension!==dimension||r.scope!==dataset.scope||periodKey(r.period)!==periodKey(p)||!fields.every(k=>r[k]===first[k])||r.denominatorKind!=='DISCLOSED_TABLE_TOTAL'||r.revenueDefinition!=='SEGMENT_WITH_INTERSEGMENT'||r.shareOrigin!=='DISCLOSED'||r.valueOrigin!=='DISCLOSED'||r.basis==='RESEARCH_ESTIMATE'||r.reportedShare!==r.percent||!sameDecimal(exactDecimal(r.totalRevenueExact),total))return false;
  if(h?.closedTable!==true||h.signedTable!==true||h.netReconciled!==true||r.isAdjustment!==negative||negative&&r.adjustmentType!=='INTERSEGMENT_ELIMINATION'||negative&&r.percent>0||!negative&&r.percent<0)return false;
  if(!sameDecimal(exactDecimal(h.tableTotal),total)||!sameDecimal(exactDecimal(h.sumOfRows),{value:sum,scale})||!sameDecimal(exactDecimal(h.grossRevenue),{value:gross,scale})||!sameDecimal(exactDecimal(h.adjustmentAmount),{value:adjustment,scale})||!sameDecimal(exactDecimal(h.roundingDifference),{value:difference,scale}))return false;
  if(!Number.isInteger(decimals)||decimals<0||decimals>6||!Number.isFinite(h.percentTolerance)||h.percentTolerance<0||!Number.isFinite(denominator)||denominator<=0)return false;
  const allowed=.5*10**(-decimals)+100/denominator;if(h.percentTolerance>allowed+1e-8)return false;
  const ratio=Number(a.value*total.scale*100000000n/(total.value*a.scale))/1000000;toleranceSum+=h.percentTolerance;
  return Math.abs(r.percent-ratio)<=h.percentTolerance+1e-6&&h.reportedShareTotal===100&&Math.abs(h.sumReportedShares-reportedSum)<1e-8&&Math.abs(h.shareRoundingDifference-(reportedSum-100))<1e-8;
 });
 return valid&&Math.abs(reportedSum-100)<=toleranceSum+1e-6;
}
function disclosedInlinePrecision(row,amount){
 // This exception only supports an explicit amount(share%) pair in the saved
 // verified source row. An unrelated historical percent is not evidence.
 const matches=[...String(row.quote||'').matchAll(/(?<![+\-−△▲\d,.])([\d,]+(?:\.\d+)?)\s*\(\s*(\d+(?:\.\d+)?)\s*%\s*\)/g)].filter(m=>sameDecimal(exactDecimal(m[1].replaceAll(',','')),amount)&&Number(m[2])===row.reportedShare);
 if(!matches.length)return null;
 const decimals=Math.max(...matches.map(m=>m[2].split('.')[1]?.length||0));return decimals<=6?decimals:null;
}
function closedOperatingTable(rows,dataset){
 if(dataset.scope!=='UNSPECIFIED'||rows.length<2||rows.length>40)return false;
 const first=rows[0],total=exactDecimal(first.totalRevenueExact),amounts=rows.map(r=>exactDecimal(r.amountExact));
 const fields=['sourceId','sourceUrl','tableKey','issuer','unit','currency','entityScope','denominatorLabel'];
 if(!total||total.value<=0n||amounts.some(n=>!n||n.value<0n)||!fields.every(k=>known(first[k]))||first.tableKey!==dataset.key||!['DERIVED','DISCLOSED'].includes(first.shareOrigin))return false;
 const scale=amounts.reduce((s,n)=>n.scale>s?n.scale:s,total.scale),sum=amounts.reduce((s,n)=>s+n.value*(scale/n.scale),0n),difference=sum-total.value*(scale/total.scale),magnitude=difference<0n?-difference:difference;
 // Retain the parser's declared rounding discrepancy; never rescale shares.
 if(magnitude*2n>BigInt(rows.length))return false;
 let totalTolerance=0;const valid=rows.every((r,i)=>{
  const h=r.headerEvidence,a=amounts[i],denominator=exactDecimal(r.totalRevenueExact);
  if(r.denominatorKind!=='DISCLOSED_TABLE_TOTAL'||r.revenueDefinition!=='DISCLOSED_OPERATING_TABLE'||r.shareOrigin!==first.shareOrigin||r.valueOrigin!=='DISCLOSED'||h?.closedTable!==true||!fields.every(k=>r[k]===first[k])||!sameDecimal(denominator,total)||a.value*total.scale>total.value*a.scale)return false;
  if(!sameDecimal(exactDecimal(h.tableTotal),total)||!sameDecimal(exactDecimal(h.sumOfRows),{value:sum,scale})||!sameDecimal(exactDecimal(h.roundingDifference),{value:difference,scale}))return false;
  const expected=Number(a.value*total.scale*100000000n/(total.value*a.scale))/1000000;
  if(first.shareOrigin==='DISCLOSED'){
   if(!Number.isFinite(r.percent)||r.percent!==r.reportedShare||r.calculatedShare!==null&&r.calculatedShare!==undefined)return false;
   const decimals=disclosedInlinePrecision(r,a),numericTotal=Number(first.totalRevenueExact);if(decimals===null||!Number.isFinite(numericTotal)||numericTotal<=0)return false;
   const tolerance=.5*10**(-decimals)+50/(Number(a.scale)*numericTotal);totalTolerance+=tolerance;
   return Math.abs(r.percent-expected)<=tolerance+1e-6;
  }
  return Number.isFinite(r.percent)&&Number.isFinite(r.calculatedShare)&&Math.abs(r.percent-expected)<=1e-6&&Math.abs(r.calculatedShare-expected)<=1e-6;
 });
 return valid&&(first.shareOrigin==='DERIVED'||Math.abs(rows.reduce((s,r)=>s+r.percent,0)-100)<=totalTolerance+1e-6);
}

// A donut is a share of one disclosed denominator, never a normalized ranking.
// Original values remain available even when composition cannot be established.
export function revenueCompositionModel(dataset,dimension){
 const rows=(dataset?.items||[]).filter(r=>r.metric!=='NON_DISCLOSURE').map((r,index)=>({...r,color:r.isAdjustment?'#8c9dad':colors[index%colors.length]}));
 const adjustments=rows.filter(r=>Number.isFinite(r.percent)&&r.percent<0||negativeAmount(r)),main=rows.filter(r=>!adjustments.includes(r));
 const portions=main.filter(r=>Number.isFinite(r.percent)&&r.percent>=0&&r.percent<=100),result={rows:main,adjustments,portions:[],total:null,gap:null,drawable:false,reason:null};
 if(adjustments.length||rows.some(r=>r.headerEvidence?.signedTable)){
  if(signedTableVerified(rows,dataset,dimension))return {...result,drawable:true,chartType:'signedBar',barRows:rows,tableOnly:true,tableScope:dataset.scope,total:rows.reduce((n,r)=>n+r.percent,0),scopeNotes:[...new Set(rows.flatMap(r=>Array.isArray(r.scopeNotes)?r.scopeNotes:[]).filter(n=>typeof n==='string'))]};
  result.reason='음수·조정 항목이 포함되어 도넛 합산을 보류합니다.';return result;
 }
 if(!portions.length){result.reason='확인된 비중이 없어 도넛을 표시하지 않습니다.';return result;}
 const first=portions[0],scope=dataset.scope,p=dataset.period,tableOnly=closedOperatingTable(main,dataset);
 if(!p?.start||!p.end||!known(p.type)||!['CONSOLIDATED','SEPARATE'].includes(scope)&&!tableOnly){result.reason='기간과 연결 범위가 확인되면 도넛을 표시합니다.';return result;}
 const sameBasis=main.every(r=>r.verificationStatus==='VERIFIED'&&r.dimension===dimension&&r.scope===scope&&periodKey(r.period)===periodKey(p)&&(!r.comparabilityReview||tableOnly)&&r.basis!=='RESEARCH_ESTIMATE'&&r.valueOrigin!=='ESTIMATED'&&['issuer','currency','unit','denominatorKind','revenueDefinition'].every(k=>known(r[k])&&r[k]===first[k])&&(r.denominatorLabel||null)===(first.denominatorLabel||null)&&String(r.totalRevenueExact??r.totalRevenue??'')===String(first.totalRevenueExact??first.totalRevenue??''));
 const labels=new Set(portions.map(r=>r.label)),overlap=portions.some(r=>r.parent&&r.parent!==r.label&&labels.has(r.parent))||new Set(portions.map(r=>r.businessItemId||r.label)).size!==portions.length;
 if(!sameBasis||overlap){result.reason='항목의 기간·매출 범위가 달라 도넛 합산을 보류합니다.';return result;}
 if(main.some(r=>Number.isFinite(r.percent)&&(r.percent<0||r.percent>100))){result.reason='비중 범위를 확인해야 해 도넛 합산을 보류합니다.';return result;}
 const total=portions.reduce((n,r)=>n+r.percent,0);
 if(total>100+1e-8){result.reason=tableOnly?`공시 금액의 반올림 차이로 비중 합계가 ${shown(total)}%입니다. 원문 값은 그대로 표시합니다.`:'공개 비중 합계가 100%를 넘어 원래 값만 표시합니다.';return result;}
 if(!(total>0)){result.reason='양수 비중이 없어 도넛을 표시하지 않습니다.';return result;}
 return {...result,drawable:true,portions,total,gap:Math.max(0,100-total),tableOnly,tableScope:scope,tableShareOrigin:tableOnly?first.shareOrigin:null,scopeNotes:tableOnly?[...new Set(main.flatMap(r=>Array.isArray(r.scopeNotes)?r.scopeNotes:[]).filter(n=>typeof n==='string'))]:[]};
}

function legendRow(r,{formatAmount,unitLabel}){
 const amount=formatAmount(r.amountExact??r.amount),share=Number.isFinite(r.percent)?shown(r.percent)+'%':'비중 미확인';
 return `<li class="rc-row"><span class="rc-dot" style="background:${r.color}" aria-hidden="true"></span><div class="rc-row-name"><strong>${esc(r.label)}</strong>${amount!==null?`<small>${esc(amount)} ${esc(unitLabel(r.unit))}</small>`:'<small>금액 미확인</small>'}${r.parent&&r.parent!==r.label?`<small>${esc(r.parent)}</small>`:''}</div><strong class="rc-share">${esc(share)}</strong><button type="button" data-bp-evidence-id="${esc(r.id||r.label)}" aria-label="${esc(r.label)} 근거 보기">근거</button></li>`;
}

function signedBarMarkup(model){
 const rows=model.barRows,min=Math.floor(Math.min(0,...rows.map(r=>r.percent))/10)*10,max=Math.ceil(Math.max(0,...rows.map(r=>r.percent))/10)*10,width=360,height=rows.length*36+48,left=108,right=305,top=16,x=n=>left+(n-min)/(max-min||1)*(right-left),zero=x(0),bottom=top+rows.length*36;
 const desc='공시 매출표 비중. '+rows.map(r=>r.label+' '+shown(r.percent)+'%').join(', ');
 return `<svg class="rc-signed-bars" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(desc)}"><title>${esc(desc)}</title><line x1="${zero}" y1="6" x2="${zero}" y2="${bottom}" stroke="var(--secondary,#8596a8)" stroke-width="1"/>${rows.map((r,i)=>{const y=top+i*36,valueX=x(r.percent),short=r.label.length>8?r.label.slice(0,8)+'…':r.label;return `<g><title>${esc(r.label)} ${esc(shown(r.percent))}%</title><text x="2" y="${y+13}" class="rc-bar-label">${esc(short)}</text><rect x="${Math.min(zero,valueX)}" y="${y}" width="${Math.abs(valueX-zero)}" height="20" rx="3" fill="${r.color}"/><text x="354" y="${y+14}" text-anchor="end" class="rc-bar-value">${esc(shown(r.percent))}%</text></g>`;}).join('')}${[min,0,max].map(v=>`<text x="${x(v)}" y="${bottom+17}" text-anchor="middle" class="rc-bar-axis">${v}%</text>`).join('')}</svg><p class="rc-bar-note">공시 비중 합계 ${esc(shown(model.total))}% · 원문 반올림값 유지</p>`;
}

export function revenueCompositionMarkup(dataset,dimension,{formatAmount=n=>Number.isFinite(n)?shown(n):null,unitLabel=u=>u||'단위 미확인'}={}){
 const model=revenueCompositionModel(dataset,dimension),row=r=>legendRow(r,{formatAmount,unitLabel});let offset=0;
 const arcs=model.portions.filter(r=>r.percent>0).map(r=>{const arc=`<circle cx="110" cy="110" r="80" pathLength="100" fill="none" stroke="${r.color}" stroke-width="25" stroke-dasharray="${r.percent} ${100-r.percent}" stroke-dashoffset="${-offset}" transform="rotate(-90 110 110)"/>`;offset+=r.percent;return arc;}).join('');
 const tableScope=model.tableScope==='UNSPECIFIED'?'연결·별도 미확인':model.tableScope==='CONSOLIDATED'?'연결 기준':'별도 기준',signed=model.chartType==='signedBar',disclosed=signed||model.tableShareOrigin==='DISCLOSED';
 const accessible=model.drawable?(model.tableOnly?'공시 매출표 구성, '+tableScope+'. ':'')+model.portions.map(r=>`${r.label} ${shown(r.percent)}%`).join(', ')+(model.gap>.001?`, 미확인 구간 ${shown(model.gap)}%`:''):model.reason;
 return `${model.tableOnly?`<div class="rc-table-basis"><strong>공시 매출표 기준 · ${tableScope} · ${disclosed?'공시 비중':'계산 비중'}</strong><details><summary>기준·공시 주석</summary><p>${model.tableScope==='UNSPECIFIED'?'회사 전체 연결 매출 비중이나 기간 간 비교로 해석하지 않습니다. ':''}${signed?'내부거래 제거를 포함한 원래 비중을 0 기준 막대로 표시합니다. 양수 항목을 100%로 재조정하지 않습니다.':disclosed?'같은 표의 금액과 합계에 대조한 공시 비중입니다. 원문 반올림값을 그대로 표시합니다.':'같은 표의 금액과 합계로 계산한 비중입니다.'}</p>${model.scopeNotes.map(note=>`<p>${esc(note)}</p>`).join('')}</details></div>`:''}<div class="rc-layout ${model.drawable?'':'rc-no-chart'}"><div class="rc-chart-area">${signed?signedBarMarkup(model):model.drawable?`<svg class="rc-donut" viewBox="0 0 220 220" role="img" aria-label="${esc(accessible)}"><title>${esc(accessible)}</title><circle cx="110" cy="110" r="80" fill="none" stroke="var(--line,#e5ebf1)" stroke-width="25"/>${arcs}<text x="110" y="103" text-anchor="middle" class="rc-center-label">${model.tableOnly?'공시표 비중':'확인된 비중'}</text><text x="110" y="128" text-anchor="middle" class="rc-center-value">${esc(shown(model.total))}%</text></svg>${model.gap>.001?`<p class="rc-gap"><span aria-hidden="true"></span>미확인 구간 ${esc(shown(model.gap))}%</p>`:''}`:`<div class="rc-unavailable"><span aria-hidden="true">◌</span><p>${esc(model.reason)}</p></div>`}</div><div class="rc-list-area"><ul class="rc-rows">${model.rows.slice(0,6).map(row).join('')}</ul>${model.rows.length>6?`<details class="rc-more"><summary>나머지 ${model.rows.length-6}개 항목</summary><ul class="rc-rows">${model.rows.slice(6).map(row).join('')}</ul></details>`:''}${model.adjustments.length?`<div class="rc-adjustments"><h4>음수·조정 항목</h4><ul class="rc-rows">${model.adjustments.map(row).join('')}</ul></div>`:''}${!model.rows.length&&!model.adjustments.length?'<p class="bp-empty">해당 비중 미공개 · 원문에서 확인할 수 있습니다.</p>':''}</div></div>`;
}
