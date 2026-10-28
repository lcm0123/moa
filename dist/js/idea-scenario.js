import {escapeHtml as esc} from './components.js';
import {financialMarkup} from './news-financial.js';
const safe=v=>{try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const direction={FAVORABLE:'유리할 수 있는 경로',ADVERSE:'부담이 될 수 있는 경로',MIXED:'상쇄·혼재 가능'};
const list=items=>`<ul>${items.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`;
export function ideaScenarioMarkup(r,{limitationText=x=>x,stateLabels={}}={}){
 const s=r.scenario;if(!s||r.status==='cancelled'||r.status==='invalidated'&&(!s.principlesOnly||r.candidates?.length||r.conditional?.length||s.evidence?.length))return '';
 const companies=[...(r.candidates||[]),...(r.conditional||[])];
 const evidence=companies.map(c=>{
  const a=c.asset,e=c.businessEvidence||{},url=safe(e.url),href=`/stock/${encodeURIComponent(a.market)}/${encodeURIComponent(a.ticker)}?tab=company`;
  return `<article class="nc-phenomenon-evidence"><h4><a data-nav href="${href}">${esc(a.name)} · ${esc(a.ticker)}</a></h4><p>확인한 사업: ${esc(c.product)} · ${c.evidenceOrigin==='EXTERNAL_VERIFIED'?'외부 원문 확인 후 저장':'저장 자료 재사용'}</p><blockquote>${esc(e.quote||'')}</blockquote><p class="nc-inline-citation">${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(e.title||'사업 근거 원문')} ↗</a>`:'원문 링크 미확인'} · ${esc(e.publishedAt?.slice(0,10)||'자료일 미확인')}</p><p>금리·환율의 실제 손익 영향은 미확인입니다.</p>${c.financial?financialMarkup({...c.financial,notice:'공시된 사업 매출 구성입니다. 수출 결제 통화·순외화 노출이나 가정의 추가 이익을 의미하지 않습니다.'},null):''}</article>`;
 }).join('');
 const referenceLink=ref=>safe(ref.url)?`<a href="${esc(safe(ref.url))}" target="_blank" rel="noopener noreferrer">${esc(ref.title)} ↗</a>`:esc(ref.title);
 return `<section class="nc-inline nc-phenomenon" aria-label="현상과 사업 영향" data-inline-version="${esc(r.resultVersion||'pending')}">
  <p class="nc-phenomenon-kicker">현상에서 아이디어 찾기 · 조건부 설명</p>
  <div class="nc-phenomenon-premises">${s.drivers.map(d=>`<span>${esc(d.label)} 가정</span>`).join('')}</div>
  <h3>${esc(s.summary)}</h3><p class="nc-muted">${esc(s.basis)}</p>
  ${s.financialSector?'<p role="status">금융업은 아래 일반 기업 경로와 구분해 봐야 합니다.</p>':''}
  <div class="nc-phenomenon-channels">${s.channels.map(c=>`<article><span class="nc-phenomenon-direction">${esc(direction[c.direction])}</span><h4>${esc(c.title)}</h4><p>${esc(c.summary)}</p><details><summary>적용 조건·확인할 자료</summary><p>${esc(c.condition)}</p><p>${esc(c.statement)} · ${esc(c.timing)}</p>${list(c.checks)}</details></article>`).join('')}</div>
  ${s.hypotheses.length?`<details class="nc-phenomenon-profiles"><summary>어떤 사업 구조를 비교하면 좋을까?</summary><p>특정 기업을 분류한 결과가 아니라, 확인해 볼 비교 가설입니다.</p>${s.hypotheses.map(h=>`<article><h4>${esc(h.title)}</h4><p>${esc(h.question)}</p><p class="nc-muted">${esc(h.condition)}</p></article>`).join('')}</details>`:''}
  ${s.followups.length?`<div class="nc-phenomenon-followups"><h4>이어서 살펴볼 질문</h4><p class="nc-muted">선택하면 입력창에 채워집니다. 실행은 직접 선택하세요.</p>${s.followups.map(q=>`<button type="button" data-idea-followup="${esc(q)}">${esc(q)}</button>`).join('')}</div>`:''}
  ${s.evidenceNotice?`<p class="nc-warning" role="status">영향 경로 설명은 유지합니다. ${esc(s.evidenceNotice)}</p>`:''}
  <details class="nc-phenomenon-sources"><summary>기업 자료와 확인 범위${companies.length?' · 사업 근거 '+companies.length+'개':''}</summary><p>사업을 영위한다는 사실과 금리·환율에 유리하다는 판단은 별개입니다.</p>${evidence||'<p>기업별 노출을 판단할 자료는 아직 확보하지 못했습니다. 위 조건부 경로를 특정 기업의 결론으로 사용하지 않습니다.</p>'}<p>사업 자료: ${esc(stateLabels[s.evidenceStatus]||'추가 확인 필요')} · 외부 보완: ${esc(stateLabels[s.externalStatus]||'상태 확인 필요')}</p>${list([...s.missing,...new Set((r.limitations||[]).map(limitationText))])}</details>
  ${s.unresolved.length?`<details class="nc-phenomenon-assumptions" ${!s.channels.length?'open':''}><summary>구체화할 전제 · ${s.unresolved.length}개</summary>${list(s.unresolved)}</details>`:''}
  ${s.references.length?`<div class="nc-phenomenon-references"><p>일반 원리 참고자료 · 이번 질문의 실제 시장 변화나 기업 노출을 확인한 자료는 아닙니다.</p>${s.references.map(referenceLink).join(' · ')}</div>`:''}
 </section>`;
}
