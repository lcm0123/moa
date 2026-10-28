import policy from '../config/news-companies.json' with {type:'json'};
export {policy};
export const normalize=v=>String(v??'').normalize('NFKC').replace(/\s+/g,' ').trim();
export const safeLink=v=>{try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&![...u.searchParams.keys()].some(k=>/^(api[_-]?key|access[_-]?token|token|secret|password|authorization)$/i.test(k))?u.href:null;}catch{return null;}};
const plain=v=>typeof v==='string'&&v.length<=600;
const date=v=>v===null||typeof v==='string'&&/^\d{4}-\d\d-\d\d(?:T.*)?$/.test(v)&&Number.isFinite(Date.parse(v));
const generic=/^(ai|반도체|장비|소재|산업|기술|통신|전력|semiconductors?|equipment|technology|market)$/i;
export const specific=v=>normalize(v).length>=2&&!generic.test(normalize(v));
// Retrieval broadening only; it never changes the product/voltage verification contract.
export function productSearchTerms(d){
 const aliases=[d.product,d.sourceTerm,...(d.aliases||[])].filter(Boolean);
 const clean=a=>normalize(a.replace(/\b\d+(?:\.\d+)?\s*(?:kV|V|GHz|MHz|nm)\b/gi,'').replace(/\b(?:class|extra|high-voltage)\b/gi,''));
 // Index rows often contain only the product noun. This broadens discovery,
 // never verifies a voltage/generation match or project-supply relationship.
 return [...new Set([...aliases.map(clean),...aliases.map(a=>clean(a).split(/\s+/).at(-1))])].filter(specific).slice(0,12);
}
export function demandTermSupported(term,quote){
 const tokens=s=>normalize(s).toLowerCase().replace(/(\d)([a-z])/g,'$1 $2').split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(t=>/^[a-z]{5,}s$/.test(t)?t.slice(0,-1):t);
 const have=new Set(tokens(quote)),need=tokens(term).filter(t=>!['the','a','an','of','and','class'].includes(t));
 return need.length>0&&need.every(t=>have.has(t)||/[가-힣]/.test(t)&&['을','를','이','가','은','는','의','와','과','에','에서','으로','로','도'].some(p=>have.has(t+p)));
}
export function parseConditions(text='',override){
 if(override){if(typeof override!=='object'||Array.isArray(override)||Object.keys(override).some(k=>!['usPriority','businessPriority','projectOnly','includeIndirect','minUS','mainBusiness'].includes(k)))throw Error('INVALID_CONDITIONS');
  for(const k of ['usPriority','businessPriority','projectOnly','includeIndirect','mainBusiness'])if(k in override&&typeof override[k]!=='boolean')throw Error('INVALID_CONDITIONS');
  if(override.minUS!==null&&override.minUS!==undefined&&(!Number.isFinite(override.minUS)||override.minUS<0||override.minUS>100))throw Error('INVALID_CONDITIONS');}
 const q=normalize(text),m=q.match(/미국\s*매출[^\d]{0,12}(\d+(?:\.\d+)?)\s*%\s*(?:이상|넘|초과)/),parts=q.split(/[,\n]|그리고/).filter(Boolean);
 const conditions={usPriority:/미국.*매출|미국.*비중/.test(q),businessPriority:/사업.*비중|관련.*사업|주력/.test(q),projectOnly:/이번\s*(?:사업|사건|프로젝트).*납품.*(?:확인|만)|실제\s*납품.*만/.test(q),includeIndirect:/간접.*포함/.test(q),minUS:m?Number(m[1]):null,mainBusiness:/주력.*기업|사업.*주력/.test(q),...override};
 if(conditions.minUS!==null&&(conditions.minUS<0||conditions.minUS>100))throw Error('INVALID_CONDITIONS');
 const unknown=parts.filter(p=>!/(국내|한국).*상장|미국.*매출|미국.*비중|사업.*비중|관련.*사업|주력|이번.*납품|실제\s*납품.*만|간접.*포함/.test(p));
 return {conditions,unknown,labels:['국내 상장기업',...(conditions.usPriority?['미국 매출 우선 · 공개된 동일 기준']:[]),...(conditions.businessPriority?['관련 제품 비중 우선']:[]),...(conditions.minUS!==null?[`미국 매출 ${conditions.minUS}% 이상 · 필수`]:[]),...(conditions.projectOnly?['이번 사건의 납품 확인 · 필수']:[]),...(conditions.mainBusiness?[`관련 제품 비중 ${policy.coreBusinessShare}% 이상 · 필수 (수정 가능)`]:[]),...(conditions.includeIndirect?['간접 공급 포함']:[])]};
}
export function validateInput(v){
 if(!v||typeof v!=='object')throw Error('INVALID_INPUT');
 const text=String(v.text||'').trim(),url=v.url?safeLink(v.url):null;
 if(v.url&&!url||(!url&&text.length<80)||text.length>policy.maxInputCharacters||String(v.conditionsText||'').length>500||String(v.hypothesis||'').length>1000)throw Error('INVALID_INPUT');
 return {url,text,title:String(v.title||'기사에서 관련 기업 찾기').slice(0,180),hypothesis:String(v.hypothesis||'').slice(0,1000),conditionsText:String(v.conditionsText||''),...parseConditions(v.conditionsText,v.conditions),ruleVersion:policy.version};
}
// Exact source spans are mandatory; a paraphrase is never accepted as a quote.
export function evidence(ref,sources,{assetId=null,terms=[]}={}){
 if(!ref||!plain(ref.sourceId)||!plain(ref.quote)||normalize(ref.quote).length<12)throw Error('INVALID_EVIDENCE');
 const s=sources.find(x=>x.id===ref.sourceId);if(!s||s.access!=='READ'||!normalize(s.body).includes(normalize(ref.quote)))throw Error('UNSUPPORTED_QUOTE');
 if(assetId&&s.assetId!==assetId)throw Error('ISSUER_EVIDENCE_MISMATCH');
 if(terms.some(t=>!normalize(ref.quote).toLowerCase().includes(normalize(t).toLowerCase())))throw Error('UNSUPPORTED_PROPOSITION');
 const at=normalize(s.body).indexOf(normalize(ref.quote));
 return {...ref,quote:normalize(ref.quote),locator:`${s.locator||'확보한 본문'} · 문자 ${at+1}–${at+normalize(ref.quote).length}`,url:s.url||null,nature:s.userProvided?'USER_HYPOTHESIS':ref.nature||'FACT',status:s.userProvided?'PARTIAL':'ACQUIRED',userProvided:!!s.userProvided,independenceKey:s.independenceKey||s.id};
}
const stages=['REVIEW','PLAN','CONTRACT','APPROVAL','ORDER','DELIVERY','UNKNOWN'];
const stagePatterns={REVIEW:/검토|review|consider/i,PLAN:/계획|예정|추진|전망|will|plan|expect|intend|propos/i,CONTRACT:/계약|합의|협약|contract|agreement|signed/i,APPROVAL:/승인|인가|approved|approval/i,ORDER:/발주|수주|order/i,DELIVERY:/납품.*완료|인도.*완료|delivered|completed delivery/i};
export function validateEvent(value,sources){
 if(!value||!plain(value.title)||!plain(value.actor)||!stages.includes(value.stage)||!Array.isArray(value.demands)||value.demands.length>4)throw Error('EVENT_SCHEMA_INVALID');
 // An unparseable optional date is unknown, not a reason to invent a date or discard the article.
 value={...value,publishedAt:date(value.publishedAt)?value.publishedAt:null,eventDate:date(value.eventDate)?value.eventDate:null};
 const ev=evidence(value.evidence,sources),stage=value.stage==='UNKNOWN'||stagePatterns[value.stage].test(ev.quote)?value.stage:'UNKNOWN';
 const rejectedDemands=[],actor=normalize(ev.quote).toLowerCase().includes(normalize(value.actor).toLowerCase())?value.actor:'';
 const demands=value.demands.filter(d=>specific(d.product)).flatMap(d=>{try{
  if(!plain(d.product)||!plain(d.spender)||!['NEW_PURCHASE','REUSE','RENT','OUTSOURCE','SHARING','UNKNOWN'].includes(d.mode)||!Array.isArray(d.conditions)||!Array.isArray(d.weakening))throw Error('DEMAND_SCHEMA_INVALID');
  const r=evidence(d.evidence,sources);if(!specific(d.sourceTerm))throw Error('BROAD_PRODUCT');
  // A technical noun and its rating can occur separately in the same exact
  // quote ("transformers ... 765 kV class units"). Require every term/number,
  // then require the independent semantic check; never change the quote.
  if(!demandTermSupported(d.sourceTerm,r.quote))throw Error('UNSUPPORTED_PROPOSITION');
  return [{...d,evidence:r,nature:'INFERENCE',status:'PARTIAL',conditions:d.conditions.filter(plain).slice(0,4),weakening:d.weakening.filter(plain).slice(0,4),aliases:[...new Set([d.product,d.sourceTerm,...(d.aliases||[]).filter(specific)])].slice(0,6)}];
 }catch(e){rejectedDemands.push({product:String(d.product).slice(0,100),reason:e.message});return [];}
 });
 const source=sources.find(s=>s.id===ev.sourceId);
 // Dates are not replaced with collection time. Model dates must occur in source text.
 const disclosed=v=>{if(!v)return null;const iso=v.slice(0,10);if(source.publishedAt?.slice(0,10)===iso||normalize(source.body).includes(iso))return v;
  const ds=[...source.body.matchAll(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+20\d{2}\b/g)].map(m=>Date.parse(m[0]+' UTC')).filter(Number.isFinite);return ds.some(n=>new Date(n).toISOString().slice(0,10)===iso)?v:null;};
 return {...value,actor,title:ev.quote.slice(0,180),stage,publishedAt:disclosed(value.publishedAt),eventDate:disclosed(value.eventDate),evidence:{...ev,nature:stage==='PLAN'?'PLAN':ev.nature},demands,rejectedDemands};
}
export function verifiedCandidate(value,assets,sources,event){
 const asset=assets.find(a=>a.id===value.assetId);if(!asset||asset.kind!=='KR_STOCK'||asset.identityStatus!=='verified'||asset.active===false)throw Error('INVALID_IDENTITY');
 if(!Array.isArray(value.links)||value.links.length>4)throw Error('CANDIDATE_SCHEMA_INVALID');
 const links=value.links.map(l=>{
  const d=event.demands.find(x=>x.product===l.product);if(!d||!['DIRECT','INDIRECT'].includes(l.relationship)||!plain(l.sourceTerm)||!specific(l.sourceTerm))throw Error('PRODUCT_MISMATCH');
  const ref=evidence(l.evidence,sources,{assetId:asset.id,terms:[l.sourceTerm]});
  if(l.reason!==undefined&&(!plain(l.reason)||l.reason.length>180))throw Error('INVALID_RELATION_REASON');
  return {...l,evidence:ref,reason:l.reason||`${d.product} 수요가 실제 발주로 이어질 경우 ${l.sourceTerm} 사업과 연결됩니다. 실제 납품은 미확인입니다.`,nature:'INFERENCE'};
 });
 const risks=(value.counterEvidence||[]).map(r=>evidence(r,sources));
 // Explicit this-project delivery, issuer name, event actor and delivered state
 // must coexist in one span. Intermediate supplier chains never satisfy this.
 let supply=null;try{if(value.projectSupply&&event.actor){const r=evidence(value.projectSupply,sources,{terms:[event.actor,asset.name]});if(!sources.find(s=>s.id===r.sourceId)?.userProvided&&/납품|공급|deliver|suppl/i.test(r.quote)&&!/계획|예정|기대|will|plan|expect|may/i.test(r.quote))supply=r;}}catch{}
 return {asset:{id:asset.id,name:asset.name,ticker:asset.symbol,market:'KR',exchange:asset.exchange},links,counterEvidence:risks,projectSupply:supply,businessRevenue:null,usRevenue:null,unknowns:['이번 사건의 실제 신규 구매 여부','규격·시점 일치 여부'],classification:'WATCHLIST'};
}
export function comparableRevenue(r){return !!r&&Number.isFinite(r.percent)&&r.percent>=0&&r.percent<=100&&r.period?.start&&r.period?.end&&r.period?.type&&r.period.type!=='UNKNOWN'&&['CONSOLIDATED','SEPARATE'].includes(r.scope)&&r.denominatorKind==='COMPANY_TOTAL_REVENUE'&&!r.comparabilityReview;}
export function pickRevenue(profile,candidate){
 const rows=Object.entries(profile?.groups||{}).flatMap(([dimension,g])=>(g.datasets||[]).filter(d=>!d.historical).flatMap(d=>d.items.map(r=>({...r,dimension,period:r.period||d.period,scope:r.scope||d.scope}))));
 const business=rows.filter(r=>r.dimension==='PRODUCT'&&candidate.links.some(l=>normalize(l.sourceTerm).toLowerCase()===normalize(r.label).toLowerCase())&&comparableRevenue(r));
 const us=rows.filter(r=>r.dimension==='GEOGRAPHY'&&/^(미국|미합중국|united states(?: of america)?|u\.?s\.?a?\.?)$/i.test(normalize(r.label))&&comparableRevenue(r));
 const latest=rs=>rs.sort((a,b)=>String(b.period.end).localeCompare(String(a.period.end)))[0]||null;
 return {businessRevenue:latest(business),usRevenue:latest(us)};
}
 const revKey=r=>comparableRevenue(r)?JSON.stringify([r.period.start,r.period.end,r.period.type,r.scope,r.currency,r.unit,r.denominatorKind,r.geographyBasis||r.geographicBasis||r.regionBasis||'UNKNOWN']):null;
export function applyConditions(raw,conditions){
 const evaluated=raw.map(c=>{
  const b=comparableRevenue(c.businessRevenue)?c.businessRevenue:null,u=comparableRevenue(c.usRevenue)?c.usRevenue:null;
  const tests=[];if(conditions.minUS!==null)tests.push({label:`미국 매출 ${conditions.minUS}% 이상`,status:u?(u.percent>=conditions.minUS?'MET':'UNMET'):'UNKNOWN'});
  if(conditions.projectOnly)tests.push({label:'이번 사건의 실제 납품',status:c.projectSupply?'MET':'UNKNOWN'});
  if(conditions.mainBusiness)tests.push({label:`관련 제품 비중 ${policy.coreBusinessShare}% 이상`,status:b?(b.percent>=policy.coreBusinessShare?'MET':'UNMET'):'UNKNOWN'});
  const active=c.links.filter(l=>conditions.includeIndirect||l.relationship==='DIRECT'),rebutted=c.counterEvidence.some(r=>r.effect==='REFUTES'),conflict=c.counterEvidence.some(r=>r.effect==='CONFLICT');
  const gate=tests.some(t=>t.status==='UNMET')?'UNMET':tests.some(t=>t.status==='UNKNOWN')?'UNKNOWN':'MET';
  const classification=rebutted||conflict||!active.length||gate!=='MET'||active.every(l=>l.evidence.userProvided)?'WATCHLIST':b&&b.percent>=policy.coreBusinessShare&&active.some(l=>l.relationship==='DIRECT')?'CORE':b||c.projectSupply?'SECONDARY':'WATCHLIST';
  const unknowns=[...c.unknowns,...(!b?['해당 제품의 회사 전체 매출 비중 미확인']:[]),...(!u?['미국 매출 미확인 · 북미·미주·수출과 구분']:[]),...(!c.projectSupply?['이번 사건 납품 미확인']:[]),...tests.filter(t=>t.status==='UNKNOWN').map(t=>t.label+' 판단 불가')];
  return {...c,classification,tests,gate,excluded:rebutted||gate==='UNMET'||!active.length,unknowns:[...new Set(unknowns)],placementReason:rebutted?'연결을 반박하는 근거가 있습니다.':conflict?'자료가 서로 충돌합니다.':classification==='CORE'?'제품 사업과 중요도, 적용 조건의 근거가 있습니다.':classification==='SECONDARY'?'일부 사업 또는 공급 관계만 확인했습니다.':'중요한 연결이나 매출 근거를 더 확인해야 합니다.'};
 });
 const priority=conditions.usPriority?'usRevenue':conditions.businessPriority?'businessRevenue':null;
 // Only one shared cohort can be numerically sorted. No non-transitive pairwise comparator.
 const keys=priority?[...new Set(evaluated.map(c=>revKey(c[priority])).filter(Boolean))]:[];
 const rank={CORE:0,SECONDARY:1,WATCHLIST:2};
 evaluated.sort((a,b)=>rank[a.classification]-rank[b.classification]||(priority&&keys.length===1?(b[priority]?.percent??-1)-(a[priority]?.percent??-1):0)||Number(!!b.projectSupply)-Number(!!a.projectSupply)||a.asset.id.localeCompare(b.asset.id));
 return {candidates:evaluated.filter(c=>!c.excluded&&c.gate==='MET'),pending:evaluated.filter(c=>!c.excluded&&c.gate==='UNKNOWN'),excluded:evaluated.filter(c=>c.excluded),sortNotice:keys.length>1?'매출의 기간·통화·범위가 달라 비중의 숫자 순위를 적용하지 않았습니다.':priority?'같은 기준의 공개 매출만 우선 정렬합니다.':'제품·사업 근거, 공급 관계 순으로 배치합니다.'};
}
export function changes(previous,next){
 const all=x=>[...(x?.candidates||[]),...(x?.pending||[]),...(x?.excluded||[])],before=new Map(all(previous).map(c=>[c.asset.id,c]));
 return all(next).map(c=>{const old=before.get(c.asset.id);before.delete(c.asset.id);return !old?`${c.asset.name}: 새 후보 · ${c.placementReason}`:old.classification!==c.classification||old.excluded!==c.excluded||old.gate!==c.gate?`${c.asset.name}: 분류·조건 판정 변경 · ${c.placementReason}`:null;}).filter(Boolean).concat([...before.values()].map(c=>`${c.asset.name}: 이번 근거에서 연결이 재확인되지 않아 제외`));
}
