import config from '../config/news-inline.json' with {type:'json'};
import {hash} from './catalyst/core.mjs';
import {normalize,safeLink,specific,comparableRevenue} from './news-companies-model.mjs';
export {config as inlinePolicy};
export const inlineEnabled=env=>env.NEWS_INLINE_V2_ENABLED==='true';
export const inlineScope='public:news:admin';
export const inlineMessages={waiting:'관련 기업 근거 확인을 준비하고 있습니다.',verifying:'기사와 공급 근거를 확인하고 있습니다.',partial:'확인된 연결부터 표시합니다. 추가 근거 확인 중입니다.',complete:'근거 확인 완료',insufficient:'현재 확보한 자료만으로 관련 기업을 판단하기 어렵습니다.',unavailable:'원문 또는 분석 서비스에 접근하지 못했습니다.',deferred:'자동 분석량 제한으로 추가 확인이 보류되었습니다.',invalidated:'정정·근거 변경으로 이전 연결을 철회했습니다.'};
export const inlineState=(status,extra={})=>({format:'inline-v2',status,message:inlineMessages[status],candidates:[],...extra});
export function canonicalNewsUrl(value){const v=safeLink(value);if(!v)return null;const u=new URL(v);u.hash='';for(const k of [...u.searchParams.keys()])if(/^(utm_|fbclid$|gclid$)/i.test(k))u.searchParams.delete(k);u.searchParams.sort();return u.href;}
const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
export const stableVersion=value=>hash(JSON.stringify(sorted(value)));
export async function inlineRequest(article,{scope=inlineScope,constraints={},horizon=null,cutoff=null}={}){
 const url=canonicalNewsUrl(article.url),eventKey=await stableVersion([scope,url]);
 // Naver's search excerpt varies with the query; it is not an article revision.
 const queryExcerpt=article.provider==='Naver News'||/^https:\/\/n\.news\.naver\.com\//.test(url||'');
 const contentVersion=await stableVersion([normalize(article.title),queryExcerpt?null:normalize(article.feedExcerpt),article.publishedAt||null]);
 const context={algorithmVersion:config.algorithmVersion,promptVersion:config.promptVersion,language:config.language,scope,eventKey,contentVersion,markets:['KR'],constraints,horizon,cutoff};
 return {...context,requestKey:await stableVersion(context),articleId:article.id,trigger:'news_ingested'};
}
export function scoreInterval(values){let lower=0,upper=0,known=0;for(const [k,w]of Object.entries(config.weights)){const v=values[k];if(Number.isFinite(v)&&v>=0&&v<=1){lower+=w*v;upper+=w*v;known+=w;}else upper+=w;}return {lower,upper,coverage:known/100,interpretation:'evidence_interval_not_probability'};}
export function triGate(value){return value===true?'pass':value===false?'fail':'unknown';}
export function gatePath(c,l,d,event,{conditions={},horizon=null}={}){
 const rebutted=c.counterEvidence?.some(r=>['REFUTES','CONFLICT'].includes(r.effect)&&(!r.product||r.product===l.product));
 const hard=(c.tests||[]).map(t=>t.status);
 const financialUnknown=conditions.minUS!=null&&!comparableRevenue(c.usRevenue);
 const gates={G1:triGate(!!c.asset?.id),G2:triGate(specific(l.sourceTerm)&&specific(d.sourceTerm)&&l.semanticVerified===true),G3:triGate(d.semanticVerified===true&&['necessary','conditional','optional'].includes(d.necessity)&&!!d.spender&&!!d.changedActivity),G4:triGate(!!l.evidence&&!l.evidence.userProvided),G5:financialUnknown||hard.includes('UNKNOWN')?'unknown':hard.includes('UNMET')?'fail':'pass',G6:horizon?(d.timing?.year==null?'unknown':triGate(d.timing.year>=horizon.start&&d.timing.year<=horizon.end)):'pass',G7:rebutted||event.corrective===true?'fail':'pass'};
 const result=Object.values(gates).includes('fail')?'excluded':Object.values(gates).includes('unknown')?'needs_research':c.projectSupply?'event_link_verified':'conditional';
 return {gates,result,direction:d.direction||'unknown',relationship:c.projectSupply?'event_delivery':'economic_inference',score:scoreInterval({necessity:d.necessity==='necessary'?1:null,adoption:c.projectSupply?1:null,materiality:comparableRevenue(c.businessRevenue)?c.businessRevenue.percent/100:null,capability:gates.G4==='pass'?1:null,timing:d.timing?.year!=null?1:null})};
}
export function numbersSupported(text,quotes){const numbers=String(text).match(/\d+(?:[.,]\d+)*/g)||[];return numbers.every(n=>quotes.some(q=>String(q).includes(n)));}
export function safeNarrative(text,quotes){return typeof text==='string'&&text.length<=600&&numbersSupported(text,quotes)&&!/(매수\s*추천|목표주가|상승\s*확률|수혜\s*확정|반드시\s*상승|독점\s*공급)/.test(text);}
export function candidateSpans(sources,terms=null){
 const spans=sources.flatMap((s,i)=>{const body=normalize(s.body),spans=[];for(let at=0;at<body.length;at+=350)spans.push({spanId:`s${i}:${at}`,sourceId:s.id,assetId:s.assetId,quote:body.slice(at,at+500),offset:at});return spans;});
 if(!terms)return spans;
 const score=s=>terms.filter(t=>s.quote.toLowerCase().includes(t.toLowerCase())).length,groups=new Map();
 for(const s of spans){const key=s.assetId||'event',list=groups.get(key)||[];list.push(s);groups.set(key,list);}
 return [...groups.values()].flatMap(list=>list.sort((a,b)=>score(b)-score(a)||a.offset-b.offset).slice(0,list[0].assetId?3:6));
}
export function auditSourceContext(sources,propositions){
 const refs=[];const collect=x=>{if(!x||typeof x!=='object')return;if(x.sourceId&&x.quote)refs.push(x);else for(const v of Object.values(x))collect(v);};collect(propositions);
 return sources.map(s=>{const body=normalize(s.body),ranges=refs.filter(r=>r.sourceId===s.id).map(r=>{const quote=normalize(r.quote),at=body.indexOf(quote);return at<0?null:[Math.max(0,at-160),Math.min(body.length,at+quote.length+160)];}).filter(Boolean).sort((a,b)=>a[0]-b[0]),merged=[];
  for(const range of ranges){const last=merged.at(-1);if(last&&range[0]<=last[1])last[1]=Math.max(last[1],range[1]);else merged.push(range);}
  return {...s,body:merged.map(([a,b])=>body.slice(a,b)).join('\n[다른 원문 구간]\n')};
 }).filter(s=>s.body);
}
export function retrievalFit(candidate,demands){
 const terms=demands.flatMap(d=>[d.product,d.sourceTerm,...(d.aliases||[])]).map(t=>normalize(t).toLowerCase());
 let product=0,description=0;for(const m of candidate.matches||[]){const label=normalize(m.label).toLowerCase();if(m.dimension==='PRODUCT')product=Math.max(product,terms.some(t=>label.includes(t))?4:2);if(m.dimension==='DESCRIPTION'&&/당사|우리 회사|our company|we manufacture/i.test(m.quote||''))description=1;}
 return product+description; // Retrieval priority only, never economic-impact score.
}
export function resolveCandidateSpans(extracted,spans){
 const resolve=r=>{if(!r||!('spanId' in r))return r;const s=spans.find(s=>s.spanId===r.spanId);if(!s)throw Error('UNKNOWN_EVIDENCE_SPAN');return {...r,sourceId:s.sourceId,quote:s.quote};};
 return {...extracted,candidates:extracted.candidates.map(c=>({...c,links:c.links.map(l=>({...l,evidence:resolve(l.evidence)})),projectSupply:resolve(c.projectSupply),counterEvidence:c.counterEvidence.map(r=>resolve(r))}))};
}
export function resolveEventSpans(event,spans){
 const resolve=r=>{if(!r||!('spanId' in r))return r;const s=spans.find(s=>s.spanId===r.spanId);if(!s)throw Error('UNKNOWN_EVIDENCE_SPAN');return {...r,sourceId:s.sourceId,quote:s.quote};};
 return {...event,evidence:resolve(event.evidence),summaryEvidence:(event.summaryEvidence||[]).slice(0,3).map(resolve),demands:event.demands.map(d=>({...d,evidence:resolve(d.evidence),timing:d.timing?{...d.timing,evidence:resolve(d.timing.evidence)}:null}))};
}
