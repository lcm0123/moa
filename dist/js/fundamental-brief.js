import {escapeHtml as esc,icon} from './components.js';
import {updated} from './research-view.js';
import {safeWorkbenchLink} from './stock-workbench.js';
import {revenueCompositionMarkup} from './revenue-composition.js';
import {buildFundamentalBrief} from './fundamental-brief-model.js';

const finite=Number.isFinite;
const number=(n,digits=2)=>finite(n)?n.toLocaleString('ko-KR',{maximumFractionDigits:digits}):'자료 미확보';
const scope=s=>({CFS:'연결',OFS:'별도',CONSOLIDATED:'연결',SEPARATE:'별도',UNSPECIFIED:'연결·별도 미확인'}[s]||s||'재무 기준 미확인');
const link=(url,title)=>{const safe=safeWorkbenchLink(url,{local:true});return safe?`<a href="${esc(safe)}" ${safe.startsWith('/')?'data-nav':'target="_blank" rel="noopener noreferrer"'}>${esc(title)} ↗</a>`:'';};
export function briefAmount(value,unit){
 if(!finite(value))return '자료 미확보';
 if(unit==='%')return number(value)+'%';
 if(!unit)return number(value)+' · 단위 미확인';
 const abs=Math.abs(value),kr=unit==='KRW',div=kr&&abs>=1e12?1e12:kr&&abs>=1e8?1e8:abs>=1e9?1e9:abs>=1e6?1e6:1;
 return number(value/div)+' '+(div===1e12?'조 원':kr&&div===1e8?'억 원':(div===1e9?'십억 ':div===1e6?'백만 ':'')+(unit==='KRW'?'원':unit));
}
function metricsMarkup(model){return `<div class="fb-metrics">${model.metrics.map(m=>`<article><span>${esc(m.label)}</span><strong title="${esc(finite(m.value)?number(m.value,12)+' '+(m.unit||''): '자료 미확보')}">${esc(m.key==='revenueGrowth'&&finite(m.value)?(m.value>0?'+':'')+number(m.value)+'%':briefAmount(m.value,m.unit))}</strong><small class="${finite(m.changePct)?m.changePct>0?'fb-up':m.changePct<0?'fb-down':'':''}">${esc(m.key==='revenueGrowth'&&finite(m.value)?'전년 동일 회계기간 대비':m.changeText?'전년 대비 '+m.changeText:'비교 자료 없음')}</small>${m.point?.formula?`<small>${esc(m.point.formula)}</small>`:''}</article>`).join('')}</div>`;}

// Geometry only: all amounts and period comparability come from the model.
export function briefCashChart(rows,currency){
 if(!rows?.length)return '<p class="fb-empty">비교 가능한 연간 현금흐름이 아직 없습니다.</p>';
 const keys=['freeCashFlow','operatingIncome'],anchor=rows.at(-1).values?.freeCashFlow||rows.at(-1).values?.operatingIncome;
 const point=(row,key)=>{const p=row.values?.[key];return p&&anchor&&p.unit===anchor.unit&&p.basis===anchor.basis&&(p.scope||p.basis)===(anchor.scope||anchor.basis)?p:null;};
 currency=anchor?.unit||currency;
 const points=rows.flatMap(r=>keys.map(k=>point(r,k)?.value)).filter(finite);
 if(!points.length)return '<p class="fb-empty">FCF·영업이익 값이 없는 기간입니다.</p>';
 const max=Math.max(0,...points),min=Math.min(0,...points),range=max-min||1,left=120,right=480,top=20,bottom=170,x=i=>left+(right-left)*i/Math.max(1,rows.length-1),y=v=>top+(max-v)/range*(bottom-top);
 const paths=keys.map(key=>{let drawing=false;return rows.map((r,i)=>{const v=point(r,key)?.value;if(!finite(v)){drawing=false;return '';}if(i&&(Date.parse(r.end)-Date.parse(rows[i-1].end))/86400000>400)drawing=false;const segment=(drawing?'L':'M')+x(i)+' '+y(v);drawing=true;return segment;}).join(' ');});
 const ticks=[...new Set([min,0,max])],labels={freeCashFlow:'FCF',operatingIncome:'영업이익'};
 return `<div class="fb-legend"><span><i></i>FCF</span><span><i class="fb-gray"></i>영업이익</span></div><svg class="fb-chart" viewBox="0 0 510 205" role="img" aria-label="확인된 연간 FCF와 영업이익 추이"><title>${esc(rows.map(r=>(r.label||r.end)+' · '+keys.map(k=>labels[k]+' '+briefAmount(point(r,k)?.value,point(r,k)?.unit||currency)).join(', ')).join(' / '))}</title>${ticks.map(v=>`<line x1="${left}" x2="${right+10}" y1="${y(v)}" y2="${y(v)}"/><text x="${left-8}" y="${y(v)+4}" text-anchor="end">${esc(briefAmount(v,currency))}</text>`).join('')}${keys.map((key,k)=>`<path d="${paths[k]}" class="fb-line-${k}"/>${rows.map((r,i)=>{const p=point(r,key);return finite(p?.value)?`<circle cx="${x(i)}" cy="${y(p.value)}" r="3" class="fb-dot-${k}"><title>${esc((r.label||r.end)+' · '+labels[key]+' '+briefAmount(p.value,p.unit))}</title></circle>`:'';}).join('')}`).join('')}${rows.map((r,i)=>`<text x="${x(i)}" y="195" text-anchor="middle">${esc(r.label||r.end)}</text>`).join('')}</svg><p class="fb-meta">${rows.length}개 연간 기간 · 누락·서로 다른 기준은 연결하지 않습니다. ${esc(currency||'통화 미확인')}</p>`;
}
function businessMarkup(model){
 const b=model.business||{},d=b.dataset,description=b.description;
 const businessLabels=(d?.items||[]).filter(r=>r.metric!=='NON_DISCLOSURE'&&r.label&&!r.isAdjustment).slice(0,3).map(r=>r.label.slice(0,90));
 return `<section class="fb-panel"><div class="fb-panel-title"><h3>어떻게 돈을 버나요?</h3><button data-fb-action="business">전체 구성 ${icon('chevron')}</button></div>${description?.quote?`<blockquote class="fb-description">${esc(description.quote.length>300?description.quote.slice(0,300)+'…':description.quote)}</blockquote>${link(description.url,'사업 설명 출처')}`:businessLabels.length?`<p class="fb-description">공개자료의 주요 매출 항목은 <strong>${esc(businessLabels.join(', '))}</strong>입니다.</p>`:'<p class="fb-empty">저장된 사업 설명을 아직 확인하지 못했습니다.</p>'}${d?`<p class="fb-meta">${esc(d.period?.label||d.period?.end||'기간 미확인')} · ${esc(scope(d.scope))}${d.correction?' · 정정 공시':''}</p>${revenueCompositionMarkup(d,b.dimension,{formatAmount:n=>typeof n==='string'?n:finite(n)?number(n):null,unitLabel:u=>u||'단위 미확인'})}<div class="fb-source">${link(d.sourceUrl,d.sourceTitle||'사업·매출 근거')}<span>자료 기준 ${esc(d.period?.end||'미확인')} · 공시 ${esc(d.publishedAt||'미확인')}</span></div>`:'<p class="fb-empty">사업·제품별 매출 비중 미확인 · 0%가 아닙니다.</p>'}</section>`;
}
function cashMarkup(model){
 return `<section class="fb-panel"><div class="fb-panel-title"><h3>이익이 현금으로 이어지나요?</h3><button data-fb-action="financial">재무 상세 ${icon('chevron')}</button></div>${briefCashChart(model.annualSeries,model.period?.currency)}<p class="fb-formula">${esc(model.fcfDefinition||'영업현금흐름 − 공급원에 정의된 설비투자')}</p><p class="fb-meta">투자 후 남는 현금입니다. 같은 회계기준·단위의 확보된 연간 자료만 표시합니다.</p></section>`;
}
function financialTable(model){
 const rows=model.annualSeries||[],keys=[['revenue','매출'],['operatingIncome','영업이익'],['operatingMargin','영업이익률'],['freeCashFlow','FCF'],['freeCashFlowMargin','FCF 마진'],['eps','희석 EPS']];
 return rows.length?`<div class="fb-table-wrap" tabindex="0" role="region" aria-label="확인된 연간 실적 비교"><table><thead><tr><th scope="col">지표</th>${rows.map(r=>`<th scope="col">${esc(r.label||r.end)}<small>${esc(r.end)}</small></th>`).join('')}</tr></thead><tbody>${keys.map(([k,label])=>`<tr><th scope="row">${label}</th>${rows.map(r=>`<td>${esc(briefAmount(r.values?.[k]?.value,r.values?.[k]?.unit))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<p class="fb-empty">저장된 연간 비교 자료가 없습니다.</p>';
}
function valuationMarkup(model){
 const v=model.valuation||{},ratios=v.ratios||[],snapshot=v.snapshotMetrics||[];
 return `${ratios.length?`<dl class="fb-ratios">${ratios.map(r=>`<div><dt>${esc(r.label||r.key||'재무 비율')}</dt><dd>${esc(r.display||briefAmount(r.value,r.unit))}</dd><small>${esc(r.basis||'기준 미확인')} · ${esc(r.formula||'공급원 값')}${r.sourceUrl?' · '+link(r.sourceUrl,'근거'):''}</small></div>`).join('')}</dl>`:'<p class="fb-empty">비교 가능한 가치평가·건전성 비율이 저장되어 있지 않습니다.</p>'}${snapshot.length?`<h4>별도 기준의 현재 스냅샷</h4><p class="fb-meta">조회 ${esc(updated(v.updatedAt))} · 위 연간 실적과 회계기간이 다를 수 있습니다.</p><dl class="fb-ratios">${snapshot.map(m=>`<div><dt>${esc(m.label)}</dt><dd>${esc(briefAmount(m.value,m.unit))}</dd></div>`).join('')}</dl>`:''}<p class="fb-meta">5년 평균 배수·비교기업·FCF 수익률은 기준과 원자료가 확보되기 전까지 산정하지 않습니다. 현금·총차입금은 동일 기준일의 잔액 확인이 필요합니다.</p>`;
}
function scenarioMarkup(model){
 const s=model.scenarios||{};
 return `<section class="fb-panel fb-scenario-panel"><div class="fb-panel-title"><h3>좋아질 조건, 달라질 조건</h3><span class="fb-tag">조건부 점검</span></div><div class="fb-scenarios"><article><h4>긍정 조건</h4>${(s.positive?.length?s.positive:['비교 가능한 재무가 확보되면 개선 조건을 표시합니다.']).map(x=>`<p>${esc(x)}</p>`).join('')}</article><article><h4>주의·반증 조건</h4>${(s.negative?.length?s.negative:['비교 가능한 재무가 확보되면 악화 조건을 표시합니다.']).map(x=>`<p>${esc(x)}</p>`).join('')}</article></div>${s.check?.length?`<p class="fb-check"><strong>다음 확인</strong> ${esc(s.check.join(' · '))}</p>`:''}<p class="fb-meta">현재 수치로 점검할 조건입니다. 자체 매수·매도 의견이나 목표주가를 생성하지 않습니다.</p></section>`;
}
export function evidenceStatusMarkup(packet){
 if(!packet)return '';
 const c=packet.collection||{},running=['RUNNING','QUEUED','CHECKING'].includes(c.state)||packet.client?.loading===true,needs=packet.needs||{};
 const labels={financial:'재무·현금흐름',business:'사업·매출 근거'};
 const states={AVAILABLE:'확인 가능',STORED:'저장자료 있음',COMPLETE:'외부 자료 확인 완료',PARTIAL:'일부 항목만 확인',RUNNING:'외부 확인 중',BUSY:'다른 수집 작업 대기',FAILED:'확인 실패',BLOCKED:'확인 보류',PAUSED:'수집 일시 중지',PROVIDER_WAIT:'제공사 상태 확인 대기',COOLDOWN:'재확인 대기',INTERRUPTED:'자료 확인 중단'};
 const codes={CONFIG_REQUIRED:'API 설정 필요',ACCESS_DENIED:'접근 권한 확인 필요',SECURITY_BLOCKED:'원문 안전 확인 실패',RATE_LIMITED:'제공사 요청 제한',TIMEOUT:'응답 시간 초과',FETCH_FAILED:'연결 또는 응답 확인 실패',NO_DATA:'제공 자료 없음',PROFILE_FETCH_FAILED:'공시·IR 원문 확인 실패',INCOMPLETE_METRICS:'일부 재무 지표 미확보',STALE_CACHE_RETAINED:'갱신 실패 · 이전 자료 유지',WORKER_BUSY:'다른 수집 작업 대기',PROVIDER_WAIT:'제공사 상태 확인 대기',SEC_ACCESS_UNAVAILABLE:'SEC 접근 제한 · 재확인 대기',SEC_ACCESS_COOLDOWN:'SEC 요청 제한 · 재확인 대기',DART_API_020:'DART 호출 한도 도달',DART_HTTP_429:'DART 요청 제한 · 재확인 대기',DART_API_800:'DART 시스템 점검',DART_CONNECTION_FAILED:'DART 연결 오류 · 이전 자료 유지'};
 const stateText=item=>codes[item.code]||(/^(?:DART_API_(?:010|011|012)|DART_HTTP_(?:401|403))$/.test(item.code||'')?'DART 인증·접근 설정 확인 필요':/^DART_HTTP_5\d\d$/.test(item.code||'')?'DART 연결 오류 · 이전 자료 유지':states[item.state]||'확인 필요');
 const progress=Object.entries(labels).filter(([key])=>c[key]).map(([key,label])=>label+': '+stateText(c[key])).join(' · ');
 return `<aside class="fb-status fb-external" aria-label="외부 자료 보완"><div role="status"><strong>외부 자료 보완</strong><p>${esc(packet.client?.message||c.message||'저장자료와 외부 보완 가능 여부를 확인합니다.')}</p>${progress?`<small>${esc(progress)}</small>`:''}${c.completedAt?`<small>마지막 확인 ${esc(updated(c.completedAt))}</small>`:''}${c.retryAfter&&!running?`<small>다음 요청 가능 ${esc(updated(c.retryAfter))}</small>`:''}</div>${packet.canCollect===true&&(needs.financial||needs.business)?`<button data-fb-action="collect" ${running?'disabled':''}>${icon('refresh')} ${running?'확인 중':'부족한 자료 보완'}</button>`:''}${running?`<small class="fb-external-scope">${esc(Object.keys(labels).filter(k=>needs[k]).map(k=>labels[k]).join(' · '))} · 기존 자료는 유지하며, 확인된 원문과 기준일을 함께 표시합니다.</small>`:''}</aside>`;
}
export function fundamentalBriefMarkup(model,{loading=false,errors=[],enrichment=null}={}){
 const p=model.period||{},hasMetrics=model.metrics?.some(m=>finite(m.value));
 const waiting=loading&&!hasMetrics,s=waiting?{badge:'확인 중',title:'저장된 재무 자료를 확인하고 있습니다',body:'확인된 사업정보와 근거부터 표시합니다.',support:[],risks:[]}:model.summary||{};
 return `<div class="fb-heading"><div><span class="fb-eyebrow">MOA FUNDAMENTAL NOTE</span><h2>기업 분석</h2></div><button data-fb-action="retry" ${loading?'disabled':''}>${icon('refresh')} ${loading?'확인 중':'자료 다시 확인'}</button></div>${loading?'<p class="fb-status" role="status">저장 자료를 확인하고 있습니다. 이미 표시된 자료는 유지합니다.</p>':''}${errors.length?`<div class="fb-status fb-error" role="status">${esc(errors.join(' · '))} · 다시 확인을 눌러 재시도할 수 있습니다. 이전 자료가 있으면 그 기준일과 함께 표시합니다.</div>`:''}${evidenceStatusMarkup(enrichment)}<section class="fb-hero"><div class="fb-hero-top"><span class="fb-badge">${esc(s.badge||'자료 확인')}</span><span class="fb-tag">저장 자료 · 규칙 기반 요약</span></div><h3>${esc(s.title||'분석할 자료를 확인하고 있습니다')}</h3><p>${esc(s.body||'확인된 수치와 사업 근거만 연결합니다.')}</p><div class="fb-balance"><div><span>확인된 변화</span>${s.support?.length?s.support.map(x=>`<strong>${esc(x)}</strong>`).join(''):'<strong>비교 자료 부족</strong>'}</div><div><span>주의·확인할 점</span>${s.risks?.length?s.risks.map(x=>`<strong>${esc(x)}</strong>`).join(''):'<strong>사업별 현금흐름·투자 계획 추가 확인</strong>'}</div></div><p class="fb-meta">${esc([p.label,p.end?'대상기간 종료 '+p.end:null,p.basisLabel,p.source].filter(Boolean).join(' · ')||'재무 기준 미확인')}<br>자료 조회 ${esc(updated(p.updatedAt))} · ${esc(model.version||'')}</p></section>${hasMetrics?metricsMarkup(model):waiting?'<p class="fb-empty">저장된 수치를 확인 중입니다.</p>':'<p class="fb-empty">재무 수치가 부족해 요약 지표를 표시할 수 없습니다. 사업·공시 자료는 별도로 확인할 수 있습니다.</p>'}<div class="fb-grid">${businessMarkup(model)}${cashMarkup(model)}</div>${scenarioMarkup(model)}<section class="fb-panel fb-more"><h3>분석 더 살펴보기</h3><details data-fb-detail="financial"><summary>수익성·재무 체력</summary>${financialTable(model)}<p class="fb-meta">매출총이익률은 원가 자료가 확보되지 않아 표시하지 않습니다.</p><button data-fb-action="financial">분기 실적·계산 근거 보기 ${icon('arrow')}</button></details><details data-fb-detail="valuation"><summary>가치평가·재무비율</summary>${valuationMarkup(model)}<button data-fb-action="reports">증권사 의견·목표주가 확인 ${icon('arrow')}</button></details><details data-fb-detail="quality"><summary>경쟁력·경영진</summary><div class="fb-scenarios"><article><h4>경쟁력</h4><p>사업 구성은 위 공개자료에서 확인할 수 있습니다. 가격 결정력·전환 비용·네트워크 효과는 별도 검증 근거가 필요합니다.</p></article><article><h4>자본 배분·보상</h4><p>FCF와 설비투자는 재무에서 확인합니다. 내부자 지분·보상 구조·자사주 매입의 적정성은 공시를 추가 확인해야 합니다.</p></article></div><p class="fb-meta">확인되지 않은 경쟁력 점수나 경영진 등급을 만들지 않습니다.</p><button data-fb-action="filings">공시 원문 확인 ${icon('arrow')}</button></details></section><section class="fb-panel fb-evidence"><div class="fb-panel-title"><h3>근거와 확인 범위</h3><button data-fb-action="reports">리포트 ${icon('chevron')}</button></div>${model.sources?.length?`<ul>${model.sources.map((item,i)=>`<li><span class="fb-source-id">${i+1}</span><div>${link(item.url,item.title)||`<strong>${esc(item.title)}</strong>`}<small>${esc([item.period,item.date?'공개 '+item.date:'공개일 미확인',({financial:'재무 자료',business:'사업 자료',report:'리포트'}[item.kind]||'자료')].filter(Boolean).join(' · '))}</small></div></li>`).join('')}</ul>`:'<p class="fb-empty">이 요약에 연결할 수 있는 원문 링크를 아직 확인하지 못했습니다.</p>'}${model.limitations?.length?`<details data-fb-detail="limitations"><summary>자료의 범위와 한계</summary><ul class="fb-limitations">${model.limitations.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details>`:''}<p class="fb-meta">원문 수치와 비교 규칙으로 작성한 요약입니다. 공시·리포트의 의견은 각 작성자의 분석과 기준일을 따릅니다.</p></section>`;
}

// Consume already-loaded stock-detail data. This component has no fetch or AI calls.
export function mountFundamentalBrief(root,{market,ticker,onRetry,onCollect,onOpenBusiness,onOpenFinancial,onOpenReports,onOpenFilings}){
 const abort=new AbortController();let dead=false,enrichment=null;
 const input={market,ticker,financial:null,business:null,reports:[],quote:null,feed:null},pending={financial:true,business:true},errors={};
 function render(){
  if(dead)return;
  const open=[...root.querySelectorAll('details[open][data-fb-detail]')].map(e=>e.dataset.fbDetail);
  const focus=root.contains(document.activeElement)?document.activeElement?.dataset?.fbAction:null;
  root.innerHTML=fundamentalBriefMarkup(buildFundamentalBrief(input),{loading:Object.values(pending).some(Boolean),errors:Object.values(errors).filter(Boolean),enrichment});
  root.querySelectorAll('details[data-fb-detail]').forEach(el=>{el.open=open.includes(el.dataset.fbDetail);});
  if(focus)root.querySelector(`[data-fb-action="${focus}"]`)?.focus({preventScroll:true});
 }
 root.addEventListener('click',event=>{
  const evidence=event.target.closest('[data-bp-evidence-id]');
  if(evidence){onOpenBusiness?.({id:evidence.dataset.bpEvidenceId,dimension:buildFundamentalBrief(input).business?.dimension});return;}
  const action=event.target.closest('[data-fb-action]')?.dataset.fbAction;
  ({retry:onRetry,collect:onCollect,business:onOpenBusiness,financial:onOpenFinancial,reports:onOpenReports,filings:onOpenFilings})[action]?.();
 },{signal:abort.signal});
 render();
 return {
  setFinancial(data,{loading=false,error=false}={}){if(dead)return;if(data)input.financial=data;pending.financial=loading;errors.financial=error?'재무 연결 오류':null;render();},
  setBusiness(data,{loading=false,error=false}={}){if(dead)return;if(data)input.business=data;pending.business=loading;errors.business=error?'사업정보 연결 오류':null;render();},
  setReports(reports){if(dead)return;input.reports=reports||[];render();},
  setQuote(quote,feed){if(dead)return;input.quote=quote;input.feed=feed;render();},
  setEnrichment(next){if(dead)return;enrichment=next;render();},
  destroy(){dead=true;abort.abort();},
 };
}
