import rules from '../config/competitor-rules.json' with {type:'json'};
export {rules};
export const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[‐‑–—]/g,'-').replace(/\s+/g,' ').trim();
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export const has=(text,alias)=>new RegExp((/^[a-z0-9]/i.test(alias)?'(?<![a-z0-9])':'')+escape(normalize(alias))+(/[a-z0-9]$/i.test(alias)?'(?![a-z0-9])':''),'i').test(normalize(text));
const match=(text,aliases)=>aliases.some(a=>has(text,a));
const unique=a=>[...new Set(a)];
const bad=/시장 조사|조사기관|가트너|Gartner|시장 전망|market research|we do not|no longer|discontinued|사업.*철수|생산.*중단/i;
function owns(text,product){
 // Require a product as the object of an issuer's selling/manufacturing claim.
 // "our DRAM used in smartphones" cannot turn Micron into a phone seller.
 return product.aliases.some(alias=>{
  const a=escape(normalize(alias)),t=normalize(text);
  return new RegExp('(?:we|micron|the company) (?:also )?(?:manufacture|sell|offer|deliver|provide|design|develop)[sd]?(?: a| our)?[^.!?]{0,130}(?<![a-z0-9])'+a+'(?![a-z0-9])','i').test(t)
   ||new RegExp('our (?:product portfolio[^.!?]{0,160}|products include[^.!?]{0,100})'+a,'i').test(t)
   ||new RegExp('(?:당사|주력 생산제품|주요 제품)[^.]{0,160}'+a+'[^.]{0,100}(?:생산|제조|판매|공급|제품입니다|제품이며)','i').test(t)
   ||new RegExp('주력 생산제품[^.]{0,100}'+a,'i').test(t);
 });
}
// Profiles contain independent citations for ownership/role, use and market.
// Product mentions in a competitor/risk/market-research paragraph are NOT ownership.
export function buildProfile(meta,blocks,{revenue=[]}={}){
 const clean=blocks.filter(b=>b.text?.length>25&&b.text.length<8000&&!bad.test(b.text)),products=[];
 for(const product of rules.products){
  const evidence=clean.filter(b=>match(b.text,product.aliases));
  const owned=evidence.filter(b=>owns(b.text,product)&&!/(?:our customers|고객사).{0,50}(?:manufacture|생산)/i.test(b.text));
  if(!owned.length)continue;
  // The role must be explicitly connected to this product, not just another
  // paragraph somewhere in a conglomerate's annual report.
  const roles=Object.entries(rules.roles).filter(([id,r])=>owned.some(b=>r.patterns.some(p=>new RegExp(p,'i').test(b.text))&&(id!=='manufacture'||/we (?:also )?manufacture|our manufacturing|당사[^.]{0,140}(?:생산|제조)|주력 생산제품/i.test(b.text))&&(id!=='design'||/we (?:also )?design|our (?:own|internally) designed|당사[^.]{0,100}설계/i.test(b.text)))).map(([id])=>id);
  const uses=evidence.filter(b=>match(b.text,product.uses));
  const marketEvidence=evidence.filter(b=>!bad.test(b.text)&&(/customers|sales|products|supply|ship|고객|공급|판매|생산|당사/i.test(b.text)));
  const markets=Object.keys(rules.markets).filter(id=>marketEvidence.some(b=>match(b.text,rules.markets[id].aliases)));
  const customers=Object.keys(rules.customers).filter(id=>marketEvidence.some(b=>match(b.text,rules.customers[id].aliases)));
  const share=revenue.find(r=>r.product===product.id&&r.scope==='product'&&Number.isFinite(r.value)&&r.value>=0&&r.value<=100);
  const major=owned.some(b=>/주력|주요 제품|principal products|primary products|core business/i.test(b.text));
  products.push({id:product.id,name:product.name,family:product.family,roles,uses:uses.length?[product.id]:[],useTerms:unique(product.uses.filter(a=>uses.some(b=>has(b.text,a)))),markets,customers,revenueShare:share?.value??null,revenueScope:share?'product':null,importance:share?share.value/100:major?0.5:null,
   evidence:{ownership:owned.slice(0,2),use:uses.slice(0,1),market:marketEvidence.filter(b=>match(b.text,[...Object.values(rules.markets),...Object.values(rules.customers)].flatMap(x=>x.aliases))).slice(0,3),revenue:share?.evidence||null}});
 }
 return {...meta,version:rules.version,products,coverage:products.length?'extracted':'insufficient',descriptionSource:'공시 근거만 경쟁 판정에 사용 · Finviz 산업은 후보 탐색용'};
}
function fresh(p,now){return p?.identityVerified===true&&p.latestVerified===true&&p.version===rules.version&&Date.parse(p.sourceDate)<=now&&now-Date.parse(p.sourceDate)<rules.maxFilingAgeDays*86400000&&now-Date.parse(p.checkedAt)<rules.maxVerificationAgeDays*86400000;}
const intersection=(a=[],b=[])=>a.filter(x=>b.includes(x));
export function compareProfiles(us,kr,{now=Date.now(),weights=rules.weights}={}){
 const base={usTicker:us.ticker,krTicker:kr.ticker,usProfile:us.id,krProfile:kr.id,version:rules.version,checkedAt:new Date(now).toISOString(),classification:'insufficient',score:null,matches:[],supply:[],reason:'제품·역할·고객 시장 근거 확인 필요',reactions:{status:'insufficient',count:0,reason:'개별 기업 경쟁 관계의 시점별 검증 이력 축적 전'}};
 if(!fresh(us,now)||!fresh(kr,now))return {...base,reason:'최신 공시·기업 식별·근거 갱신 여부 확인 필요'};
 for(const a of us.products){for(const b of kr.products){
  if(a.id!==b.id){if(rules.supplyProducts.some(pair=>pair.includes(a.id)&&pair.includes(b.id)))base.supply.push({usProduct:a.id,krProduct:b.id,kind:'potential_chain',reason:'제품 용도상 공급망 영역 · 두 회사의 실제 거래·고객 계약은 미확인'});continue;}
  const roles=intersection(a.roles,b.roles),markets=intersection(a.markets,b.markets),customers=intersection(a.customers,b.customers),use=intersection(a.uses,b.uses);
  if(!roles.length||!markets.length||!customers.length||!use.length)continue;
  // A distributor and manufacturer sharing a keyword never pass the role gate.
  if((a.roles.includes('distribution')&&!b.roles.includes('distribution'))||(b.roles.includes('distribution')&&!a.roles.includes('distribution')))continue;
  const known=Number.isFinite(a.revenueShare)&&Number.isFinite(b.revenueShare),important=known&&Math.min(a.revenueShare,b.revenueShare)>=rules.minDirectShare;
  const parts={product:1,role:1,market:Math.min(1,(markets.length+customers.length)/3),importance:known?Math.min(a.revenueShare,b.revenueShare)/100:0,freshness:Math.max(0,1-Math.max(now-Date.parse(us.sourceDate),now-Date.parse(kr.sourceDate))/(rules.maxFilingAgeDays*86400000))};
  const sum=Object.values(weights).reduce((n,v)=>n+Math.max(0,v),0);const score=Math.round(Object.entries(parts).reduce((n,[k,v])=>n+v*Math.max(0,weights[k]||0),0)/sum*100);
  base.matches.push({product:a.id,name:a.name,roles,markets,customers,score,parts,important,us:a,kr:b,confidence:known?'매출 비중 확인':'매출 비중 미공개·미추출 · 신뢰도 제한',explanation:`${a.name}의 ${roles.map(r=>rules.roles[r].name).join('·')} 역할과 ${markets.map(m=>rules.markets[m].name).join('·')} 시장, ${customers.map(c=>rules.customers[c].name).join('·')} 고객 유형이 공시에 함께 확인됩니다.`});
 }}
 if(base.matches.length){base.classification=base.matches.some(m=>m.important)?'direct':'partial';base.score=Math.max(...base.matches.map(m=>m.score));base.reason=base.matches[0].explanation;}
 else if(base.supply.length){base.classification='supply_chain';base.reason='현재 추출된 제품은 공급망 용도로 연결 · 전체 사업의 경쟁 여부와 실제 공급 계약은 미확인';}
 else if(us.industry&&us.industry===kr.industry||us.products.some(a=>kr.products.some(b=>a.family===b.family))){base.classification='same_industry';base.reason='같은 산업 또는 제품군이나 동일 제품·역할·고객 시장 조건을 통과하지 못함';}
 return base;
}
export function selectRisers(snapshot,settings={}){
 const cap=Number(settings.minMarketCap??rules.minMarketCap),dollar=Number(settings.minDollarVolume??rules.minDollarVolume);
 return snapshot.industries.flatMap(i=>i.stocks.map(s=>({...s,industry:i.name,sector:i.sector}))).filter(s=>s.changePct>0&&s.marketCap>=cap&&s.price*s.volume>=dollar).sort((a,b)=>b.changePct-a.changePct);
}
