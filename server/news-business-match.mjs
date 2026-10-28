import config from '../config/news-business-match.json' with {type:'json'};
import {rows,one} from './catalyst/store.mjs';
import {safeLink} from './news-companies-model.mjs';

// Product exposure only. This path does not assert impact, supply contracts,
// demand growth or product specifications from a shared word.
const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[-‐‑–]/g,' ').replace(/\s+/g,' ').trim();
const generic=/^(?:ai|it|tv|pc|cm|am|cu|ic|국내|해외|내수|수출|나선|전기|태양광|우주항공|로봇|전력기기|반도체(?: 장비| 소재| 공정장비| 제조용 장비)?|메모리|전력|전선|장비|소재|기술|산업|시장|금융|에너지|통신|부품|모터|센서|제품|상품|공사|임대|용역|유지보수|서비스|기타.*|소계|합계|총 합계|단순합계|.*수익|.*조정.*|semiconductors?|memory|chips?|equipment|materials?|technology|software|hardware|fuel|oil|energy|market|services?)$/i;
const usable=s=>s.length>=(/[가-힣]/.test(s)?2:3)&&s.length<=60&&!generic.test(s)&&!/^\d+$/.test(s);
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function productMention(text,term){
 const t=norm(term);if(!usable(t))return false;
 // Token boundaries reject 정도로 → 도로 and 나선다 → 나선, as well as
 // PCB → FPCB. Korean case particles are allowed, arbitrary substrings aren't.
 const suffix='(?=$|[^\\p{L}\\p{N}]|(?:을|를|이|가|은|는|의|와|과|에|로|으로|도|만|부터|까지|용|에서|들은|들이|등)(?=$|[^\\p{L}\\p{N}]))';
 return new RegExp('(?<![\\p{L}\\p{N}])'+escape(t)+( /[가-힣]$/.test(t)?suffix:'(?![a-z0-9])'),'u').test(norm(text));
}
const termsFor=label=>String(label||'').split(/[,·;、()\n]/).map(s=>norm(s).replace(/\s*(?:등|외|外).*$/,'').trim()).filter(usable);
const ownBusiness=q=>/(?:당사|회사는|주력|주요 제품|our|we |principal|manufactur)/i.test(q)&&/(?:생산|제조|판매|공급|서비스|manufactur|sell|produc|provid)/i.test(q)&&!/(?:영위하지|생산하지|판매하지|중단|철수|not manufacture|no longer)/i.test(q);
const businessSentence=(quote,terms)=>String(quote||'').split(/(?<=[.!?。])\s+|\n/).find(s=>s.length<=900&&ownBusiness(s)&&terms.some(t=>productMention(s,t)));
const corporateEvent=/자사주|배당|소송|횡령|경영권|인수합병|ceo|buyback|dividend|lawsuit|acquisition|merger/i;
const change=/수요|발주|수주|투자|증설|공급|가격|판매|매출|생산|부족|demand|order|invest|supply|price|sales|capacity|shortage|production/i;
const projection=`SELECT i.*,a.name,a.symbol,a.kind,a.exchange,a.identity_status,a.issuer_id,json_extract(a.payload,'$.active') active,
 s.url source_url,s.title source_title,s.published_at,s.asset_id source_asset,s.source_type,
 json_extract(s.payload,'$.documentHash') source_hash,json_extract(s.payload,'$.securityVersion') securityVersion,
 c.status claim_status,c.subject_id claim_subject,c.source_ids claim_sources,
 f.verification_status fact_status,f.lifecycle_status fact_lifecycle,f.company_id fact_company,f.source_id fact_source
 FROM business_profile_index i JOIN catalyst_assets a ON a.id=i.asset_id
 JOIN catalyst_sources s ON s.id=i.source_id JOIN catalyst_claims c ON c.id=json_extract(i.payload,'$.claimId')
 LEFT JOIN company_metadata_facts f ON f.id=i.observation_id`;
function validRow(r,at){
 const p=JSON.parse(r.payload),published=Date.parse(r.published_at||p.publishedAt);
 return r.identity_status==='verified'&&r.active!==0&&r.kind==='KR_STOCK'&&/^[0-9A-Z]{6}$/.test(r.symbol)&&/^\d{8}$/.test(r.issuer_id||'')
  &&['VERIFIED','SUPPORTED'].includes(r.claim_status)&&r.claim_subject===r.asset_id&&JSON.parse(r.claim_sources).includes(r.source_id)
  &&r.source_asset===r.asset_id&&['regulatory','official','business'].includes(r.source_type)
  &&p.documentHash&&p.documentHash===r.source_hash&&safeLink(r.source_url)&&p.quote
  &&(r.source_body===undefined||norm(r.source_body).includes(norm(p.quote)))
  &&Number.isFinite(published)&&published<=at&&at-published<=config.maxEvidenceAgeDays*86400000
  &&(!r.observation_id||r.fact_status==='VERIFIED'&&r.fact_lifecycle==='ACTIVE'&&r.fact_company===r.asset_id&&r.fact_source===r.source_id);
}
export function createNewsBusinessMatcher(db,{allowed=()=>false,now=Date.now}={}){
 let cached=null,pending=null;
 async function index(){
  if(cached&&cached.until>now())return cached;if(pending)return pending;
  pending=(async()=>{
   const entries=[],byTerm=new Map();let scanned=0,truncated=false;
   const aliases=config.aliases.map(a=>a.map(norm)),aliasEvidence=[];
   // Reuse only verified, source-checked terminology from the existing registry.
   for(const a of await rows(db,"SELECT p.*,s.url,json_extract(s.payload,'$.documentHash') documentHash,json_extract(s.payload,'$.securityVersion') securityVersion,s.body FROM catalyst_product_aliases p JOIN catalyst_sources s ON s.id=p.source_id WHERE p.status='VERIFIED' LIMIT 1000"))if(usable(norm(a.concept))&&usable(norm(a.alias))&&norm(a.body).includes(norm(a.quote))&&await allowed({id:a.source_id,url:a.url,documentHash:a.documentHash,securityVersion:a.securityVersion})){aliases.push([norm(a.concept),norm(a.alias)]);aliasEvidence.push({concept:a.concept,alias:a.alias,sourceId:a.source_id});}
   // Read bounded pages as the domestic universe grows; do not materialize
   // every observation payload/body in the web process at once.
   for(let offset=0;offset<=config.maxRows;offset+=250){
    const page=await rows(db,projection+" WHERE i.dimension IN ('PRODUCT','DESCRIPTION') AND a.kind='KR_STOCK' ORDER BY i.issuer,i.item_id,i.source_id LIMIT ? OFFSET ?",Math.min(250,config.maxRows+1-offset),offset);
    for(const r of page){
    if(scanned++>=config.maxRows){truncated=true;break;}
    if(!validRow(r,now()))continue;const p=JSON.parse(r.payload),terms=r.dimension==='PRODUCT'?termsFor(r.label):[];
    for(const group of aliases)if(group.some(t=>productMention(r.dimension==='PRODUCT'?r.label:p.quote,t)))terms.push(...group);
    const unique=[...new Set(terms)];if(!unique.length)continue;
    const quote=r.dimension==='DESCRIPTION'?businessSentence(p.quote,unique):p.quote;
    if(!quote)continue;
    const evidenceTerms=Object.fromEntries(unique.map(t=>[t,[t,...aliases.filter(g=>g.includes(t)).flat()]]));
    const i=entries.length;entries.push({issuer:r.issuer,itemId:r.item_id,sourceId:r.source_id,assetId:r.asset_id,terms:unique,evidenceTerms});
    for(const t of unique){const ids=byTerm.get(t)||[];ids.push(i);byTerm.set(t,ids);}
    }
    if(page.length<250||truncated)break;
   }
   cached={entries,byTerm,aliasEvidence,knownTerms:[...new Set([...byTerm.keys(),...aliases.flat()])],companies:new Set(entries.map(r=>r.issuer)).size,truncated,until:now()+config.refreshMs};return cached;
  })();try{return await pending;}finally{pending=null;}
 }
 return async function match(article){
  const started=performance.now(),idx=await index(),fields=[['TITLE',article.title],['FEED_EXCERPT',article.feedExcerpt]].filter(([,s])=>s),text=fields.map(([,s])=>s).join('\n'),hits=new Map(),matchedTerms=[];
  const base={method:'BUSINESS_INDEX',version:config.version,asOf:new Date(now()).toISOString(),scope:'저장된 국내 기업 사업 자료 · 제목·제공 발췌문과 제품 비교',candidates:[]};
  if(!safeLink(article.url)||!await allowed(article)||!await allowed({url:article.originalUrl||article.url}))return {...base,status:'SOURCE_BLOCKED',message:'기사 접근 상태 재확인 필요',autoEligible:false};
  for(const term of idx.knownTerms)if(productMention(text,term)){
   matchedTerms.push(term);for(const id of idx.byTerm.get(term)||[]){const terms=hits.get(id)||[];terms.push(term);hits.set(id,terms);}
  }
  const candidates=new Map();let checked=0;
  for(const [id,terms]of hits){
   const entry=idx.entries[id];
   // Re-read mutable evidence on delivery: the index cache must not retain a
   // revoked claim, superseded observation or a blocked/deleted source.
   const r=await one(db,projection.replace('SELECT i.*','SELECT s.body source_body,i.*')+' WHERE i.issuer=? AND i.item_id=? AND i.source_id=?',entry.issuer,entry.itemId,entry.sourceId);checked++;
   if(!r||!validRow(r,now())||!await allowed({id:r.source_id,url:r.source_url,documentHash:r.source_hash,securityVersion:r.securityVersion}))continue;
   const p=JSON.parse(r.payload),term=terms.sort((a,b)=>b.length-a.length)[0],equivalents=entry.evidenceTerms[term],quote=r.dimension==='DESCRIPTION'?businessSentence(p.quote,equivalents):p.quote;
   const sourceTerm=equivalents.find(t=>productMention(quote,t));if(!quote||!sourceTerm)continue;
   if(term!==sourceTerm&&!config.aliases.some(g=>g.map(norm).includes(term)&&g.map(norm).includes(sourceTerm))){
    const alias=idx.aliasEvidence.find(a=>[norm(a.concept),norm(a.alias)].includes(term)&&[norm(a.concept),norm(a.alias)].includes(sourceTerm));if(!alias)continue;
    const current=await one(db,"SELECT p.status,p.quote,s.url,s.body,json_extract(s.payload,'$.documentHash') documentHash,json_extract(s.payload,'$.securityVersion') securityVersion FROM catalyst_product_aliases p JOIN catalyst_sources s ON s.id=p.source_id WHERE p.concept=? AND p.alias=? AND p.source_id=?",alias.concept,alias.alias,alias.sourceId);
    if(!current||current.status!=='VERIFIED'||!norm(current.body).includes(norm(current.quote))||!await allowed({id:alias.sourceId,...current}))continue;
   }
   const field=fields.find(([,s])=>productMention(s,term));
   const candidate={asset:{id:r.asset_id,ticker:r.symbol,name:r.name,market:'KR',exchange:r.exchange},product:term,business:sourceTerm,relationship:'PRODUCT_EXPOSURE',nature:'EXPOSURE_ONLY',mentionedInArticle:(article.stocks||[]).some(s=>(s.assetId||s.id)===r.asset_id),confirmedSupply:false,asOf:base.asOf,
    reason:r.dimension==='PRODUCT'?`기사의 ‘${term}’ 관련 제품을 공시 매출표에서 확인했습니다.`:`기사의 ‘${term}’가 이 기업의 사업 설명에도 나옵니다.`,
    eventEvidence:{url:article.originalUrl||article.url,quote:String(field[1]).slice(0,900),title:article.title,publisher:article.publisher,publishedAt:article.publishedAt,scope:field[0],locator:field[0]==='TITLE'?'기사 제목':'뉴스 제공 발췌문'},
    businessEvidence:{url:r.source_url,quote:String(quote).slice(0,900),title:r.source_title,publishedAt:r.published_at,locator:p.locator,sourceId:r.source_id,documentHash:r.source_hash},conditions:[],weakening:[],sourceDimension:r.dimension};
   const prev=candidates.get(r.asset_id);if(!prev||r.dimension==='PRODUCT'&&prev.sourceDimension!=='PRODUCT'||r.dimension===prev.sourceDimension&&String(r.published_at)>String(prev.businessEvidence.publishedAt))candidates.set(r.asset_id,candidate);
  }
  const found=[...candidates.values()].sort((a,b)=>Number(a.mentionedInArticle)-Number(b.mentionedInArticle)||Number(b.sourceDimension==='PRODUCT')-Number(a.sourceDimension==='PRODUCT')||String(b.businessEvidence.publishedAt).localeCompare(String(a.businessEvidence.publishedAt))||a.asset.ticker.localeCompare(b.asset.ticker));
  return {...base,status:found.length?'MATCHED':'NO_LOCAL_MATCH',message:found.length?'저장된 공시에서 제품 사업 확인':'저장된 사업 자료에서 연결 근거를 찾지 못했습니다',candidates:found.slice(0,config.maxCandidates),autoEligible:matchedTerms.length>0&&change.test(text)&&!corporateEvent.test(text),
   diagnostics:{indexedCompanies:idx.companies,indexTruncated:idx.truncated,productTerms:matchedTerms,matchedCompanies:found.length,evidenceChecked:checked,externalRequests:0,aiCalls:0,elapsedMs:Math.round(performance.now()-started)}};
 };
}
