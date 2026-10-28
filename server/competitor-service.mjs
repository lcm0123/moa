import {relatedPolicy} from './us-kr-service.mjs';import {rules,selectRisers} from './competitor-model.mjs';import {sessionPair} from './us-kr-model.mjs';
export const query=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
export const decode=s=>{try{return JSON.parse(s);}catch{return null;}};
export async function latestSnapshot(db){return decode((await query(db,'SELECT payload FROM us_kr_industry_snapshots ORDER BY session_date DESC,observed_at DESC LIMIT 1'))[0]?.payload);}
export async function storedProfile(db,market,ticker){const c=(await query(db,'SELECT * FROM competitor_companies WHERE market=? AND ticker=?',market,ticker))[0];const p=c?.active_profile?decode((await query(db,'SELECT payload FROM competitor_profiles WHERE id=?',c.active_profile))[0]?.payload):null;return {company:c,profile:p?{...p,lastVerifiedAt:c.checked_at||p.checkedAt}:null};}
export function profileCurrent(p,c,now=Date.now()){return p?.latestVerified===true&&p?.identityVerified===true&&p.version===rules.version&&!c?.error&&Date.parse(p.sourceDate)<=now&&now-Date.parse(c?.checked_at||p.checkedAt)<rules.maxVerificationAgeDays*86400000&&now-Date.parse(p.sourceDate)<rules.maxFilingAgeDays*86400000;}
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
export async function competitorApi(request,env){
 if(!relatedPolicy(env))return json({status:'restricted',message:'기존 Finviz·국내 시세 데이터 표시 설정 확인 필요',items:[]});
 if(!env.DB)return json({status:'empty',message:'사업 프로필 저장소 연결 필요',items:[]});
 const db=env.DB,u=new URL(request.url),ticker=u.searchParams.get('ticker')?.toUpperCase();
 try{
  if(request.method==='POST'){
   const input=await request.json(),t=String(input.ticker||'').toUpperCase();if(!/^[A-Z0-9.-]{1,24}$/.test(t))return json({message:'티커 확인 필요'},400);
   const known=(await query(db,'SELECT * FROM competitor_universe WHERE ticker=?',t))[0];if(!known)return json({message:'SEC 식별자가 확인된 미국 종목을 선택해 주세요.'},400);
   await db.prepare("INSERT INTO competitor_companies(market,ticker,name,issuer,priority) VALUES('US',?,?,?,1) ON CONFLICT(market,ticker) DO UPDATE SET priority=MIN(priority,1)").bind(t,known.name,known.cik).run();
   return json({status:'queued',message:'저장된 결과를 먼저 표시합니다. 미수집 공시는 다음 소량 배치에서 처리합니다.'});
  }
  if(request.method!=='GET')return json({message:'Method not allowed'},405);
  if(u.searchParams.has('q')){const q=(u.searchParams.get('q')||'').trim().slice(0,60);if(!q)return json({items:[]});return json({items:await query(db,"SELECT ticker,name,cik FROM competitor_universe WHERE instr(lower(ticker),lower(?))>0 OR instr(lower(name),lower(?))>0 ORDER BY CASE WHEN ticker=? THEN 0 ELSE 1 END,ticker LIMIT 15",q,q,q.toUpperCase())});}
  const s=await latestSnapshot(db),now=Date.now(),pair=sessionPair(now),risers=s?selectRisers(s,{minMarketCap:env.COMPETITOR_MIN_MARKET_CAP||rules.minMarketCap,minDollarVolume:env.COMPETITOR_MIN_DOLLAR_VOLUME||rules.minDollarVolume}):[];
  const coverage=await query(db,'SELECT market,COUNT(*) attempted,SUM(CASE WHEN active_profile IS NOT NULL AND error IS NULL THEN 1 ELSE 0 END) available FROM competitor_companies GROUP BY market');
  const base={status:s?'ready':'empty',session:s?{usDate:s.sessionDate,closeAt:s.closeAt,krDate:s.targetDate,observedAt:s.observedAt}:null,stale:!pair||s?.sessionDate!==pair.us.date,items:risers.slice(0,20),coverage,source:'Finviz 정규장 마감 스냅샷 · SEC/OpenDART 사업 공시',version:rules.version,weights:rules.weights,thresholds:{minMarketCap:Number(env.COMPETITOR_MIN_MARKET_CAP||rules.minMarketCap),minDollarVolume:Number(env.COMPETITOR_MIN_DOLLAR_VOLUME||rules.minDollarVolume)},limits:['시세 분석 대상은 기존 미국 3개 지수 합집합 · 직접 검색은 SEC 티커 목록을 사용합니다.','제품 사전에 등록된 용도와 공시에서 추출된 근거만 판정합니다. 누락된 프로필은 경쟁사가 없다는 뜻이 아닙니다.','상승률은 경쟁 강도 점수에 사용하지 않습니다. 사업 관계는 주가 동행이나 상승 원인이 아닙니다.']};
  if(!ticker)return json(base);if(!/^[A-Z0-9.-]{1,24}$/.test(ticker))return json({message:'티커 오류'},400);
  const {company,profile}=await storedProfile(db,'US',ticker);const current=profileCurrent(profile,company,now),stored=profile?(await query(db,'SELECT payload FROM competitor_pairs WHERE us_profile=? AND version=?',profile.id,rules.version)).map(r=>decode(r.payload)).filter(Boolean):[];
  const quotes=decode((await query(db,"SELECT payload FROM competitor_cache WHERE id='kr-quotes'"))[0]?.payload)||{};
  const comparisons=[];for(const p of stored){const kr=await storedProfile(db,'KR',p.krTicker);if(kr.profile?.id!==p.krProfile||!profileCurrent(kr.profile,kr.company,now)||!current)continue;const q=quotes[p.krTicker];comparisons.push({...p,kr:{...kr.profile,quote:q&&q.isin===kr.profile.isin?q:kr.profile.quote}});}
  comparisons.sort((a,b)=>(b.score??-1)-(a.score??-1));
  const observed=s?.industries.flatMap(i=>i.stocks).find(x=>x.ticker===ticker)||null;
  // Existing SEC facts may supply contemporaneous facts, never a causal label.
  const events=profile?(await query(db,"SELECT f.title_ko,f.summary_ko,f.source_url,f.filed_date FROM sec_filings f JOIN sec_filing_issuers i ON i.accession=f.accession WHERE i.cik=? AND i.relation!='unverified' AND f.filed_date=? AND f.summary_ko IS NOT NULL AND f.source_hash IS NOT NULL LIMIT 4",profile.issuer,s?.sessionDate||'')).map(e=>({...e,label:'같은 시기 확인된 기업 공시 · 상승 원인으로 확정하지 않음'})):[];
  return json({...base,selected:{ticker,name:company?.name||observed?.name||ticker,quote:observed,profile,profileStatus:current?'ready':company?.error?'error':profile?'stale':'pending',message:company?.error||(!current?'최신 사업 공시 근거 확인 중':null),competitors:comparisons.filter(p=>['direct','partial'].includes(p.classification)),supply:comparisons.filter(p=>p.classification==='supply_chain'),excluded:comparisons.filter(p=>['same_industry','insufficient'].includes(p.classification)),cause:{status:'unverified',message:'상승 원인 미확인 · 사업상 경쟁 관계와 구분합니다.',events}}});
 }catch{return json({status:'error',items:[],message:'경쟁사 저장 결과 조회 실패 · 배치 및 마이그레이션 상태 확인 필요'});}
}
