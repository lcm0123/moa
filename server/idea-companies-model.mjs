import settings from '../config/idea-companies.json' with {type:'json'};
import businessTerms from '../config/news-business-match.json' with {type:'json'};
import {productMention} from './news-business-match.mjs';
import {normalize,comparableRevenue,safeLink,specific} from './news-companies-model.mjs';
import {decimal} from './catalyst/profile-calculations.mjs';
import {parseIdeaScenario} from './idea-scenarios.mjs';

export const ideaPolicy=settings;
const aliases=[...businessTerms.aliases,...settings.additionalAliases];
export const ideaProductVocabulary=aliases.map(g=>({term:g[0],aliases:[...g]}));
const n=s=>normalize(s).toLowerCase();
const genericProducts=new Set((settings.genericProductTerms||[]).map(n));
export const specificIdeaProduct=term=>specific(term)&&!genericProducts.has(n(term));
// Only curated exact aliases may bridge languages. AI-proposed terms are
// retrieval hypotheses; they cannot invent equivalences or product evidence.
export function expandIdeaProduct(product){
 const group=aliases.find(g=>g.some(t=>n(t)===n(product.term)));
 // Korean filings attach 업/사업 directly to service names (항공운송업).
 // These grammatical forms must not match 항공운송지원 or product equipment.
 const serviceForms=/[가-힣]$/.test(product.term)&&(settings.serviceBusinessSuffixes||[]).some(s=>n(product.term).endsWith(n(s)))?[product.term+'업',product.term+'사업']:[];
 return {...product,aliases:[...new Set([...(product.aliases||[]),...(group||[]),...serviceForms])]};
}
const obj=v=>{try{return typeof v==='string'?JSON.parse(v):v||{};}catch{return {};}};
const flat=v=>({...obj(v?.payload),...v});
const list=v=>{const x=obj(v);return Array.isArray(x)?x:[];};
const stamp=v=>{const x=Date.parse(v||'');return Number.isFinite(x)?x:null;};
const knownProducts=text=>aliases.filter(g=>g.some(t=>productMention(text,t))).map(g=>({term:g[0],aliases:[...g],role:null,use:null,requestedTerm:g.filter(t=>productMention(text,t)).sort((a,b)=>b.length-a.length)[0]})).sort((a,b)=>n(text).indexOf(n(a.requestedTerm))-n(text).indexOf(n(b.requestedTerm)));
export function needsIdeaInterpretation(input,products=input.products||[]){
 if(!products.length)return true;
 // A recognized first business must not hide a second business in the same
 // question. Mandatory/financial clauses remain code-owned, not new products.
 const clauses=String(input.text||'').split(/\s*(?:그리고|또는|및|와\s+|과\s+)\s*/).filter(Boolean);
 return clauses.length>1&&clauses.some(s=>!knownProducts(s).length&&!products.some(p=>productMention(s,p.term))&&!/미국|비중|매출|필수|반드시|만$|이상|이하|우선|제외|납품|공급/.test(s));
}
const economicRules=[['CAPEX_INCREASE',/투자|증설|설비 확대|capex|invest|expansion/i],['SUPPLY_SHORTAGE',/부족|품귀|쇼티지|shortage/i],['DEMAND_INCREASE',/수요.*(?:증가|확대|늘)|demand.*(?:grow|increas)/i],['PRICE_INCREASE',/가격.*(?:상승|인상|오르)|price.*(?:ris|increas)/i],['COST_DECREASE',/비용.*(?:감소|하락|절감)|금리.*(?:내리|내려|하락)|cost.*(?:fall|decreas)/i],['SUBSTITUTION',/대체|전환|substitut/i],['COMPETITION_CHANGE',/경쟁|점유율|경쟁사|competition/i]];

// Product aliases expand retrieval only. They never prove technical equivalence.
export function parseIdeaInput(body,{now=Date.now()}={}){
 if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.text!=='string')throw Error('INVALID_IDEA_INPUT');
 const text=body.text.trim(),normalizedInput=normalize(text);
 if(text.length<settings.minInputCharacters||text.length>settings.maxInputCharacters)throw Error('INVALID_IDEA_INPUT');
 const at=now instanceof Date?now.getTime():typeof now==='string'?Date.parse(now):now;
 if(!Number.isFinite(at))throw Error('INVALID_IDEA_DATE');
 let cutoff=at;
 if(body.asOf!==undefined&&body.asOf!==null&&body.asOf!==''){
  if(typeof body.asOf!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(body.asOf))throw Error('INVALID_IDEA_DATE');
  const date=Date.parse(body.asOf+'T00:00:00Z');if(!Number.isFinite(date)||new Date(date).toISOString().slice(0,10)!==body.asOf)throw Error('INVALID_IDEA_DATE');
  const today=new Date(at+9*3600000).toISOString().slice(0,10);if(body.asOf>today)throw Error('INVALID_IDEA_DATE');
  cutoff=Math.min(at,Date.parse(body.asOf+'T23:59:59.999+09:00'));
 }
 const markets=body.markets===undefined?[...settings.defaultMarkets]:body.markets;
 if(!Array.isArray(markets)||!markets.length||markets.some(m=>!['KR','US'].includes(m)))throw Error('INVALID_IDEA_MARKET');
 const required=[],preferences=[],unresolved=[],assumptions=[text];
 const add=(rows,kind,label,value)=>{if(!rows.some(r=>r.kind===kind))rows.push({kind,label,...value===undefined?{}:{value}});};
 const parts=normalizedInput.split(/[\n,;。]|그리고|다만/).filter(Boolean);
 for(const part of parts){
  const strict=/(?:만(?:\s|[.?!]|$)|필수|반드시|확인된\s*기업|only|must)\b/i.test(part)||/(?:만(?:\s|[.?!]|$)|필수|반드시|확인된\s*기업)/.test(part);
  const prefer=/우선|선호|많은|큰 기업|높은 기업|prefer|priorit/i.test(part);
  const usMin=part.match(/미국\s*(?:매출|비중)[^\d]{0,15}(\d+(?:\.\d+)?)\s*%\s*(?:이상|초과|넘)/);
  const businessMin=part.match(/(?:제품|사업|관련)\s*(?:매출|비중)[^\d]{0,15}(\d+(?:\.\d+)?)\s*%\s*(?:이상|초과|넘)/);
  let handled=false;
  for(const [match,kind,label]of [[usMin,'US_REVENUE_MIN','미국 매출 비중'],[businessMin,'PRODUCT_REVENUE_MIN','관련 제품 매출 비중']])if(match){const value=Number(match[1]);if(value>100)throw Error('INVALID_IDEA_CONDITION');add(required,kind,`${label} ${value}% 이상`,value);handled=true;}
  if(strict&&/미국/.test(part)&&/납품|공급|판매/.test(part)){add(required,'US_SUPPLY','미국 고객 납품·공급 확인');handled=true;}
  if(strict&&/이번|프로젝트|해당 사업/.test(part)&&/납품|공급|선정/.test(part)){add(required,'PROJECT_SUPPLY','이번 프로젝트 실제 공급 확인');handled=true;}
  if(strict&&/현재|지금|최신/.test(part)&&/납품|공급/.test(part)){add(required,'CURRENT_SUPPLY','현재 공급관계 확인');handled=true;}
  if(strict&&/실제 판매|판매 실적|상용화|상업화/.test(part)){add(required,'COMMERCIAL_SALES','실제 판매 실적 확인');handled=true;}
  if(strict&&/(?:국내|한국)\s*(?:상장\s*)?(?:기업|종목|업체)만/.test(part)&&!/미국|수출|매출|납품|공급|배당|이익|흑자|적자|부채|보유|특허|인증|이상|이하|수익|대주주/.test(part)){add(required,'MARKET','국내 상장기업','KR');handled=true;}
  if(!strict&&prefer&&/미국/.test(part)&&/매출|비중/.test(part)){add(preferences,'US_REVENUE','비교 가능한 미국 매출 비중 우선');handled=true;}
  if(!strict&&prefer&&/사업|제품/.test(part)&&/매출|비중|주력/.test(part)){add(preferences,'PRODUCT_REVENUE','비교 가능한 제품 매출 비중 우선');handled=true;}
  const unsupportedPredicate=strict&&/배당|부채|대주주|특허|인증|영업이익|순이익|현금흐름|흑자|적자|ESG|등급|밸류에이션|PER|PBR/i.test(part);
  if(strict&&(!handled||unsupportedPredicate)){add(required,'UNSUPPORTED',part.slice(0,160));unresolved.push(`필수 조건 해석 필요: ${part.slice(0,160)}`);}
 }
 const products=knownProducts(normalizedInput);
 for(const path of settings.discoveryPaths)if(path.terms.some(t=>n(normalizedInput).includes(n(t)))){
  assumptions.push(path.assumption);
  for(const term of path.products)if(!products.some(p=>p.term===term)){const group=aliases.find(g=>g.includes(term))||[term];products.push({term,aliases:[...group],role:null,use:null,discoveryOnly:true});}
 }
 if(products.length>settings.maxProducts)unresolved.push('제품 범위가 넓어 일부 제품만 확인합니다.');
 if(!products.length)unresolved.push('구체적인 제품·서비스를 현재 용어 색인으로 해석하지 못했습니다.');
 const economicChanges=economicRules.filter(([,rx])=>rx.test(normalizedInput)).map(([type])=>({type,status:'HYPOTHESIS',description:text.slice(0,240)}));
 const scenario=parseIdeaScenario(text);
 return {inputType:'IDEA',questionKind:scenario?'ECONOMIC_SCENARIO':'COMPANY_DISCOVERY',scenario,text,title:text.slice(0,100),normalizedInput,asOf:new Date(cutoff).toISOString(),historical:new Date(cutoff+9*3600000).toISOString().slice(0,10)!==new Date(at+9*3600000).toISOString().slice(0,10),markets:[...new Set(markets)].sort(),assumptions,facts:[],economicChanges,products:products.slice(0,settings.maxProducts),required,preferences,unresolved,interpretationStatus:products.length&&!required.some(r=>r.kind==='UNSUPPORTED')?'READY':'NEEDS_INTERPRETATION',ruleVersion:settings.version};
}

const privateHost=h=>h==='localhost'||h.endsWith('.localhost')||h.endsWith('.local')||/^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|0\.|\[|::)/.test(h);
const sourceUrl=v=>{try{const u=new URL(v);return !!safeLink(v)&&!privateHost(u.hostname);}catch{return false;}};
const expectedIssuer=a=>(a.kind==='US_STOCK'?'US:':'KR:')+(a.issuerId||a.issuer_id||'');
const datesWithin=(period,cutoff)=>!period?.end||stamp(period.end)!==null&&stamp(period.end)<=cutoff&&(!period.start||stamp(period.start)!==null&&stamp(period.start)<=stamp(period.end));
const escapeRx=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const productPattern=terms=>terms.map(t=>escapeRx(normalize(t))).sort((a,b)=>b.length-a.length).join('|');
// A product occurrence can describe the CUSTOMER'S product. "PCB processing
// tools" and "PCB test equipment" are not sales of PCB. Only a complete sold
// product/list item is accepted here; unsupported wording stays unconfirmed.
const directProductLabel=(label,terms)=>{
 const p=productPattern(terms);if(!p)return false;
 const prefix=terms.some(t=>/^PCB$/i.test(t))?'(?:(?:Module|HDI|Rigid|Package)\\s+)?':'';
 return normalize(label).split(/[,·;、/]|\s+(?:및|and)\s+/i).some(item=>new RegExp('^'+prefix+'(?:'+p+')(?:\\s*\\((?:'+p+')\\))?\\s*(?:등|외)?$','i').test(item.trim()));
};
const directProductStatement=(text,terms)=>{
 const p=productPattern(terms);if(!p)return false;
 const target='(?:'+p+')(?:\\s*\\((?:'+p+')\\))?(?:\\s+제품)?';
 const object='(?:\\s*(?:등)?[을를]\\s*|\\s*(?:[,·/]|및|와|과)\\s*[^.!?;]{1,80}?[을를]\\s*)';
 const recipient='(?:(?:한국과\\s+)?(?:미국|국내외|국내|해외|한국)(?:의)?\\s*)?(?:고객사|고객|기업|업체)(?:에게|에)\\s*';
 const process='(?:(?:연구개발|제조생산|제조|생산|개발|마케팅)\\s*(?:및|하여|해|하고|해서|ㆍ|ᆞ|·)\\s*){0,4}';
 const action=process+'(?:판매|공급|납품)(?:하고(?:\\s+있(?:습니다|다))?|하였|했|합니다|한다|\\s*완료|까지\\s*직접\\s*담당하고\\s*있(?:습니다|다))';
 // Do not cross from the object into another purpose/process noun phrase.
 const ko=new RegExp('(?<![\\p{L}\\p{N}])'+target+object+'(?:'+recipient+')?(?:직접\\s*)?'+action,'iu');
 const en=new RegExp('\\b(?:sell|sells|sold|selling|supply|supplies|supplied|deliver|delivered|provide|provides)\\s+(?:(?:a|an|the)\\s+)?'+target+'(?=$|[,.!;]|\\s+(?:and|to|for|in|with)\\b)','i');
 // Filings also state "X 제조 및 판매를 주력사업으로 하고 있습니다".
 // X must end at a sales-list boundary, never "X용 장비" or "X의 소재".
 const listTail='(?:\\s*[,·]\\s*(?:(?!이를|고객|위한|제조용|생산용|장비|공정|가공)[^,.!?;]){1,60})?';
 const businessAction='\\s+(?:제조|생산)\\s*(?:및|·|ㆍ|ᆞ)\\s*판매(?:업)?(?:을|를)\\s*(?:(?:주력|주요)\\s*)?사업으로\\s*(?:하고\\s*있(?:습니다|다)|영위하고\\s*있(?:습니다|다))';
 const nominal=new RegExp('(?<![\\p{L}\\p{N}])'+target+listTail+businessAction,'iu');
 return ko.test(text)||en.test(text)||nominal.test(text);
};
const directServiceStatement=(text,terms)=>{
 const p=productPattern(terms);if(!p)return false;
 const target='(?:'+p+')';
 const serviceTerms=productPattern(terms.filter(t=>(settings.serviceBusinessSuffixes||[]).some(s=>n(t).endsWith(n(s)))));
 const serviceTarget='(?:'+target+'\\s*서비스'+(serviceTerms?'|(?:'+serviceTerms+')(?:\\s*서비스)?':'')+')';
 const offered=new RegExp('(?<![\\p{L}\\p{N}])'+serviceTarget+'[을를]\\s*(?:직접\\s*)?(?:제공|운영|수행)(?:하고\\s*있(?:습니다|다)|합니다|한다)','iu');
 const business=serviceTerms&&new RegExp('(?<![\\p{L}\\p{N}])(?:'+serviceTerms+')(?:\\s*(?:서비스|사업|업))[을를]\\s*(?:영위|운영)(?:하고\\s*있(?:습니다|다)|합니다|한다)','iu');
 const englishServiceTerms=productPattern(terms.filter(t=>(settings.englishServiceSuffixes||[]).some(s=>n(t).endsWith(n(s)))));
 const englishTarget='(?:(?:'+p+')\\s+services?'+(englishServiceTerms?'|(?:'+englishServiceTerms+')':'')+')';
 const english=new RegExp('\\b(?:provide|provides|operate|operates)\\s+'+englishTarget+'(?=$|[,.!;]|\\s+(?:to|for|in|and)\\b)','i');
 return offered.test(text)||!!business&&business.test(text)||english.test(text);
};

// A product table may be stored separately from the issuer's holding-company
// declaration. Rejoining the SAME filing prevents a subsidiary table being
// promoted to the listed parent's own product sales. This is a scope hold,
// never a claim that the parent has zero economic exposure.
export function ideaIssuerScope({asset,source,input}={}){
 const a=flat(asset),s=flat(source),cutoff=stamp(input?.asOf),published=stamp(s.publishedAt||s.published_at),observed=stamp(s.firstObservedAt||s.observedAt||s.observed_at);
 if(!a.id||(s.assetId||s.asset_id)!==a.id||!s.documentHash||s.securityVersion!=='security-1'||s.access&&s.access!=='READ'||s.withdrawn||s.revoked||s.superseded||['WITHDRAWN','REVOKED'].includes(s.status)||!sourceUrl(s.url)||published===null||published>cutoff||input?.historical&&(observed===null||observed>cutoff))return null;
 const body=normalize(s.body);
 // Filing sections may state the issuer's legal name instead of "we". Match
 // only the canonical name followed by a subject particle: a parent named
 // 효성 must not inherit a statement whose subject is 효성중공업.
 const issuerName=normalize(a.name||'').replace(/^(?:㈜|\(주\)|주식회사)\s*/,'').replace(/\s*(?:㈜|\(주\)|주식회사)$/,'').trim();
 const namedHolding=issuerName?new RegExp('(?<![\\p{L}\\p{N}])(?:㈜|\\(주\\)|주식회사)?\\s*'+escapeRx(issuerName)+'(?:\\s*(?:㈜|\\(주\\)|주식회사))?(?:은|는|이|가)\\s*[^.。!\\n]{0,180}?지주회사(?:로서|로\\s|입니다|이다|이며|이고|에\\s*해당)','iu'):null;
 const match=body.match(/(?:당사는|회사는|당사(?:의)?(?:\s*현황)?)[^.。!\n]{0,180}?지주회사(?:로서|로\s|입니다|이다|이며|이고|에\s*해당)|(?:we are|our company is)[^.。!\n]{0,180}?\bholding company\b/i)||namedHolding&&body.match(namedHolding);
 return match?{reason:'HOLDING_COMPANY_SUBSIDIARY_SCOPE',sourceId:s.id,quote:match[0],url:s.url,documentHash:s.documentHash,publishedAt:s.publishedAt,locator:s.locator}:null;
}

// This gate rechecks issuer, exact evidence and the proposition separately.
// Permission/security-ledger checks remain mandatory in the caller.
export function validateIdeaClaim({asset,source,claim,observation=null,product,input,now=Date.now()}={}){
 const a=flat(asset),s=flat(source),c=flat(claim),o=flat(observation),p=typeof product==='string'?{term:product,aliases:[]}:product||{},quote=normalize(o.quote||c.quote),cutoff=stamp(input?.asOf)??now;
 const result={status:'INSUFFICIENT',temporalStatus:'UNKNOWN',reason:'EVIDENCE_INCOMPLETE',kind:'PRODUCT_CAPABILITY',quote,sourceId:s.id||null,claimId:c.id||o.claimId||null,product:p.term||null,locator:o.locator||c.locator||s.locator||null};
 const fail=(reason,status='INSUFFICIENT',extra={})=>({...result,status,reason,...extra});
 const identity=a.identityStatus||a.identity_status,issuer=a.issuerId||a.issuer_id,symbol=a.symbol||a.ticker;
 if(!a.id||identity!=='verified'||a.active===false||a.active===0||!['KR_STOCK','US_STOCK'].includes(a.kind)||!a.exchange||!issuer||!symbol)return fail('IDENTITY_UNVERIFIED');
 if(a.kind==='KR_STOCK'&&(!/^\d{8}$/.test(issuer)||! /^[0-9A-Z]{6}$/.test(symbol))||a.kind==='US_STOCK'&&(!/^\d{1,10}$/.test(issuer)||! /^[A-Z0-9.^/-]{1,24}$/.test(symbol)))return fail('IDENTITY_UNVERIFIED');
 if(stamp(a.validFrom)>cutoff||stamp(a.listedAt)>cutoff||stamp(a.validTo)!==null&&stamp(a.validTo)<=cutoff)return fail('IDENTITY_OUTSIDE_PERIOD');
 if(input?.markets&&!input.markets.includes(a.kind==='KR_STOCK'?'KR':'US'))return fail('MARKET_EXCLUDED');
 if((s.assetId||s.asset_id)!==a.id||(c.subject||c.subject_id)!==a.id||o.assetId&&o.assetId!==a.id||o.company_id&&o.company_id!==a.id||o.entityScope&&!['ISSUER',a.id,expectedIssuer(a)].includes(o.entityScope))return fail('ISSUER_MISMATCH');
 if(!sourceUrl(s.url)||s.userProvided||s.access&&s.access!=='READ'||s.parsingStatus&&s.parsingStatus!=='PARSED')return fail('SOURCE_UNAVAILABLE');
 if(s.securityVersion!=='security-1')return fail('SOURCE_SECURITY_UNVERIFIED');
 if(!['regulatory','official','business'].includes(s.sourceType||s.source_type))return fail('PRIMARY_BUSINESS_SOURCE_REQUIRED');
 if(!s.documentHash||!(o.documentHash||c.documentHash||c.tableEvidence?.documentHash)||(o.documentHash||c.documentHash||c.tableEvidence?.documentHash)!==s.documentHash)return fail('DOCUMENT_HASH_MISMATCH');
 if(!s.id||!list(c.sourceIds||c.source_ids).includes(s.id)||o.sourceId&&o.sourceId!==s.id)return fail('SOURCE_BINDING_MISMATCH');
 // A complete table row can be short (e.g. "수배전반 120"). Its amount,
 // product, unit, period and provenance still pass the full table gate below.
 const revenueRow=o.dimension==='PRODUCT'&&['REVENUE','REVENUE_COMPOSITION'].includes(o.metric)&&o.claimId===c.id&&o.sourceId===s.id;
 if(!quote||(!revenueRow&&quote.length<10)||!normalize(s.body).includes(quote)||normalize(c.quote)!==quote)return fail('QUOTE_NOT_IN_SOURCE');
 if(['REVOKED','WITHDRAWN','CANCELLED','REFUTED'].includes(c.status)||s.withdrawn||s.revoked||['WITHDRAWN','REVOKED'].includes(s.status))return fail('WITHDRAWN_EVIDENCE','REFUTED');
 if(c.status==='CONFLICT'||c.status==='CONTRADICTED'||o.conflict)return fail('CONFLICTING_EVIDENCE','CONFLICT');
 if(!['VERIFIED','SUPPORTED','UNVERIFIED','PENDING'].includes(c.status)||o.verification_status&&!['VERIFIED','SUPPORTED','UNVERIFIED','PENDING'].includes(o.verification_status)||o.verificationStatus&&!['VERIFIED','SUPPORTED','UNVERIFIED','PENDING'].includes(o.verificationStatus))return fail('CLAIM_NOT_VERIFIED');
 if(o.lifecycle_status&&o.lifecycle_status!=='ACTIVE'||o.lifecycleStatus&&o.lifecycleStatus!=='ACTIVE'||s.superseded||o.superseded||c.superseded)return fail('SUPERSEDED_EVIDENCE');
 const published=stamp(s.publishedAt||s.published_at),observed=stamp(s.firstObservedAt||s.observedAt||s.observed_at),period=o.period||c.period;
 if(published===null||published>cutoff||!datesWithin(period,cutoff))return fail(published>cutoff?'FUTURE_EVIDENCE':'PERIOD_UNKNOWN');
 if(input?.historical&&(observed===null||observed>cutoff))return fail('NOT_KNOWN_AT_CUTOFF');
 const age=(cutoff-published)/86400000,maxAge=settings.maxEvidenceAgeDays[s.sourceType||s.source_type]||550;
 result.temporalStatus=age>maxAge?'HISTORICAL':'CURRENT';
 const terms=[p.term,...p.aliases||[]].filter(Boolean),specificTerms=terms.filter(t=>productMention(quote,t));
 if(!specificTerms.length)return fail('PRODUCT_PROPOSITION_UNSUPPORTED');
 const specificRequest=p.requestedTerm||p.term;
 if(specificRequest&&/배전변압기|배전용 변압기|초고압|high.voltage|distribution transformer|\b(?:HDI|Module|Package)\s+PCB/i.test(specificRequest)&&!productMention(quote,specificRequest))return fail('PRODUCT_SPECIFICATION_MISMATCH');
 if(p.use&&!productMention(quote,p.use)||p.role&&!n(quote).includes(n(p.role)))return fail('PRODUCT_PURPOSE_UNCONFIRMED');
 const rating=String(p.term||'').match(/\d+(?:\.\d+)?\s*(?:kV|V|GHz|MHz|nm)/gi)||[];
 if(rating.some(v=>!n(quote).includes(n(v))))return fail('PRODUCT_SPECIFICATION_MISMATCH');
 if(/자회사|종속회사|계열회사|subsidiar|affiliate|parent company/i.test(quote)&&!o.directIssuerBusiness)return fail('SUBSIDIARY_SCOPE_UNCONFIRMED');
 const beforeQuote=normalize(s.body).slice(0,Math.max(0,normalize(s.body).indexOf(quote))),context=beforeQuote.slice(-1500);
 const scopeHeaders=[...beforeQuote.matchAll(/\[[^\]]{0,30}(?:종속회사|자회사|지배회사|당사)[^\]]{0,150}\]|(?:\(\d+\)|\d+\.)\s*(?:주요\s*)?(?:종속회사|자회사|지배회사|당사)[^.。\[\]]{0,100}/g)],lastScope=scopeHeaders.at(-1)?.[0];
 const subsidiaryContext=lastScope?/종속회사|자회사/.test(lastScope):/(?:주요\s*)?(?:종속회사|자회사)의?\s*(?:제품|서비스|품목|매출|내용)|종속회사\s*\(주\)|subsidiar(?:ies|y).{0,30}(?:revenue|sales)/i.test(context);
 if(!o.directIssuerBusiness&&(subsidiaryContext||o.dimension==='PRODUCT'&&(/당사는.{0,80}지주회사/i.test(context)||/(?:\(주\)|주식회사|Co\.,?\s*Ltd|LLC)/i.test(quote)&&!quote.includes(a.name))))return fail('SUBSIDIARY_SCOPE_UNCONFIRMED');
 const own=q=>q.startsWith(a.name)||/^(?:당사는|당사가|당사\s|회사는|our company|we\b)/i.test(q);
 const negativePattern=/영위하지|생산하지|판매하지|중단|철수|폐업|not (?:manufacture|sell|produce)|no longer|discontinued|divested/i;
 const sentences=quote.split(/(?<=[.!?。;])\s+|;\s*/).filter(q=>terms.some(t=>productMention(q,t)));
 if(negativePattern.test(quote))return sentences.some(q=>own(q)&&negativePattern.test(q)&&!/(?:고객사|경쟁사|다른 회사|타사)(?:는|가|의)/.test(q))?fail('BUSINESS_NEGATED','REFUTED'):fail('NEGATIVE_SUBJECT_UNCONFIRMED');
 if(/계획|예정|검토|추진 중|개발 중|계약 전|plan(?:s|ned)?|intend|expect|will|propos/i.test(quote))return fail('PLAN_NOT_SALES','INSUFFICIENT',{kind:'PLAN'});
 if(o.comparabilityReview||o.revisionGroup?.startsWith('SCOPE_REVIEW'))return fail('SCOPE_REVIEW_REQUIRED');
 const rawValue=decimal(o.amountExact??o.amount??o.value),value=Number(rawValue),periodKnown=period?.start&&period?.end&&['ANNUAL','YTD','SINGLE_QUARTER'].includes(period.type);
 const numericTokens=(quote.match(/[+-]?\d[\d,]*(?:\.\d+)?/g)||[]).map(decimal),numberMatches=rawValue!==null&&numericTokens.includes(rawValue);
 const table=o.dimension==='PRODUCT'&&['REVENUE','REVENUE_COMPOSITION'].includes(o.metric)&&o.claimId===c.id&&o.sourceId===s.id&&Number.isFinite(value)&&value>0&&numberMatches&&periodKnown&&!!o.unit&&directProductLabel(o.label,terms);
 const sales=sentences.some(q=>own(q)&&directProductStatement(q,terms)&&!/(?:고객사|경쟁사|다른 회사|타사)(?:는|가|의)/.test(q)&&/(?:제조.{0,20}판매|생산.{0,20}판매|판매하고|판매하는|판매하였|판매했습니다|판매까지\s*직접\s*담당하고|공급하고|공급하는|매출.{0,12}발생|\b(?:sell|sells|sold|selling|provides|supply|supplies|supplied)\b)/i.test(q));
 const supply=sentences.some(q=>own(q)&&directProductStatement(q,terms)&&/(?:납품.{0,12}(?:완료|하였|했습니다)|공급.{0,12}(?:완료|하였|했습니다)|\bdelivered\b)/i.test(q)&&!/(?:미확인|확인되지|unconfirmed|not confirmed)/i.test(q));
 const oldSupply=/과거|이전에|historically/i.test(quote)||[...quote.matchAll(/\b(20\d{2})(?:년|\b)/g)].some(m=>Number(m[1])<new Date(cutoff).getUTCFullYear()-1);
 if(supply)return {...result,status:'SUPPORTED',kind:'SUPPLY',temporalStatus:age>settings.currentSupplyAgeDays||oldSupply?'HISTORICAL':result.temporalStatus,geography:/미국|United States|\bUSA\b/i.test(quote)&&!/북미|미주|North America/i.test(quote)?'US':null,reason:'EXACT_SUPPLY_STATEMENT'};
 const service=sentences.some(q=>own(q)&&directServiceStatement(q,terms)&&!/(?:고객사|경쟁사|다른 회사|타사)(?:는|가|의)/.test(q));
 if(service&&!table)return {...result,status:'SUPPORTED',kind:'SERVICE_OPERATION',reason:'EXACT_ISSUER_SERVICE_STATEMENT'};
 if(table||sales)return {...result,status:'SUPPORTED',kind:'PRODUCT_SALES',reason:table?'POSITIVE_DISCLOSED_PRODUCT_SALES':'EXACT_ISSUER_SALES_STATEMENT'};
 if((o.dimension==='PRODUCT'||sentences.some(q=>own(q)&&/판매|공급|납품|\b(?:sell|sold|supply|supplied|delivered)\b/i.test(q)))&&!directProductLabel(o.label,terms)&&!sentences.some(q=>directProductStatement(q,terms)))return fail('PRODUCT_APPLICATION_NOT_SOLD_PRODUCT');
 return fail('CAPABILITY_WITHOUT_SALES','INSUFFICIENT',{kind:'PRODUCT_CAPABILITY'});
}

const revenueKey=r=>comparableRevenue(r)?JSON.stringify([r.period.start,r.period.end,r.period.type,r.scope,r.currency,r.unit,r.denominatorKind,r.geographyBasis||r.geographicBasis||'UNKNOWN']):null;
const usRevenue=r=>comparableRevenue(r)&&/^(미국|미합중국|united states(?: of america)?|u\.?s\.?a?\.?)$/i.test(normalize(r.label))?r:null;
const productRevenue=c=>comparableRevenue(c.businessRevenue)&&(c.links||[]).some(l=>n(l.sourceTerm)===n(c.businessRevenue.label))?c.businessRevenue:null;
const actualClaims=c=>[...(c.claims||[]),...(c.links||[]).map(l=>l.claim).filter(Boolean)];
const supported=r=>r?.status==='SUPPORTED';
const fresh=r=>supported(r)&&r.temporalStatus==='CURRENT';
function conditionStatus(requirement,c){
 const claims=actualClaims(c),supply=c.projectSupply,verifiedSupply=supply&&fresh(supply.claim||supply)&&supply.projectExact===true;
 switch(requirement.kind){
 case 'MARKET':return c.asset.market===requirement.value?'MET':'UNMET';
 case 'US_REVENUE_MIN':{const r=usRevenue(c.usRevenue);return r?r.percent>=requirement.value?'MET':'UNMET':'UNKNOWN';}
 case 'PRODUCT_REVENUE_MIN':{const r=productRevenue(c);return r?r.percent>=requirement.value?'MET':'UNMET':'UNKNOWN';}
 case 'COMMERCIAL_SALES':return claims.some(r=>fresh(r)&&['PRODUCT_SALES','SUPPLY'].includes(r.kind))?'MET':'UNKNOWN';
 case 'CURRENT_SUPPLY':return claims.some(r=>fresh(r)&&r.kind==='SUPPLY')?'MET':'UNKNOWN';
 case 'PROJECT_SUPPLY':return verifiedSupply?'MET':'UNKNOWN';
 case 'US_SUPPLY':return claims.some(r=>fresh(r)&&r.kind==='SUPPLY'&&r.geography==='US'&&/미국|United States|\bUSA\b/i.test(r.quote))?'MET':'UNKNOWN';
 default:return 'UNKNOWN';
 }
}

// Classifications, strict gates and stable ordering use code, never model scores.
export function evaluateIdeaCandidates(candidates,input){
 const main=[],conditional=[],excluded=[],decisions=[];
 for(const c of candidates){
  const claims=actualClaims(c),tests=(input.required||[]).map(r=>({...r,status:conditionStatus(r,c)})),strict=tests.some(r=>r.status==='UNMET')?'UNMET':tests.some(r=>r.status==='UNKNOWN')?'UNKNOWN':'MET';
  const rebuttals=(c.counterEvidence||[]).filter(r=>['SUPPORTED','REFUTED','CONFLICT'].includes((r.claim||r)?.status)),refuted=claims.some(r=>r.status==='REFUTED')||rebuttals.some(r=>r.effect==='REFUTES'),conflict=claims.some(r=>r.status==='CONFLICT')||rebuttals.some(r=>r.effect==='CONFLICT');
  const good=claims.filter(fresh),historical=claims.some(r=>supported(r)&&r.temporalStatus==='HISTORICAL');
  const evidenceStatus=refuted?'REFUTED':conflict?'CONFLICT':good.some(r=>['PRODUCT_SALES','SUPPLY','SERVICE_OPERATION'].includes(r.kind))?'SUPPORTED':'INSUFFICIENT';
  const relationship=c.relationship||((c.links||[]).some(l=>l.relationship==='INDIRECT')?'INDIRECT_PRODUCT':(c.links||[]).length?'DIRECT_PRODUCT':'HYPOTHETICAL');
  const stage=good.map(r=>r.kind).sort((a,b)=>(settings.stageOrder[a]??9)-(settings.stageOrder[b]??9))[0]||claims[0]?.kind||'PRODUCT_CAPABILITY';
  const reason=strict==='UNMET'?'필수 조건 불충족':strict==='UNKNOWN'?'필수 조건 미확인':refuted?'반대 근거로 연결 제외':conflict?'자료 상충':evidenceStatus==='SUPPORTED'?'제품 판매 근거 확인 · 아이디어 전달은 조건부':historical?'과거 사업 근거만 확인 · 현재성 미확인':'제품 판매·용도 근거 추가 확인 필요';
  const next={...c,claims,tests,gate:strict,relationship,evidenceStatus,temporalStatus:good.length?'CURRENT':historical?'HISTORICAL':'UNKNOWN',commercialStage:stage,placementReason:reason,unknowns:[...new Set([...(c.unknowns||[]),...(strict==='UNKNOWN'?tests.filter(r=>r.status==='UNKNOWN').map(r=>r.label+' 미확인'):[]),...(historical&&!good.length?['현재 사업·공급 여부 미확인']:[])])],sortReasons:settings.ordering};
  // A strict requirement cannot be bypassed by putting the company in a watchlist.
  const placement=strict!=='MET'||refuted?'excluded':evidenceStatus==='SUPPORTED'?'candidates':'conditional';
  (placement==='candidates'?main:placement==='conditional'?conditional:excluded).push(next);
  decisions.push({assetId:c.asset.id,placement,reason,tests,evidenceStatus,relationship});
 }
 const preference=(input.preferences||[]).find(p=>['US_REVENUE','PRODUCT_REVENUE'].includes(p.kind)),key=preference?.kind==='US_REVENUE'?'usRevenue':'businessRevenue';
 const eligible=c=>key==='usRevenue'?usRevenue(c[key]):productRevenue(c),comparable=main.map(c=>revenueKey(eligible(c))).filter(Boolean),cohorts=new Set(comparable);
 const compare=(a,b)=>(settings.evidenceOrder[a.evidenceStatus]??9)-(settings.evidenceOrder[b.evidenceStatus]??9)||(settings.relationshipOrder[a.relationship]??9)-(settings.relationshipOrder[b.relationship]??9)||(settings.stageOrder[a.commercialStage]??9)-(settings.stageOrder[b.commercialStage]??9)||(preference&&cohorts.size===1?(eligible(b)?.percent??-1)-(eligible(a)?.percent??-1):0)||a.asset.id.localeCompare(b.asset.id);
 main.sort(compare);conditional.sort(compare);excluded.sort((a,b)=>a.asset.id.localeCompare(b.asset.id));
 return {candidates:main,conditional,excluded,sortNotice:preference&&cohorts.size>1?'매출 기간·통화·연결 기준이 달라 비중 순위는 적용하지 않았습니다.':'필수 조건 → 근거 → 연결 유형 → 판매 단계 → 비교 가능한 선호 조건 → 기업 ID 순서입니다.',decisions};
}
