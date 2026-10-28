import {searchManagers} from './providers/managers.mjs';
import {comparePositions} from './manager-model.mjs';
import {requireFinviz} from './providers/finviz-client.mjs';
import {managerMatch,managerProfile,featuredOrder} from './manager-search.mjs';
export const aggressionFormula='13F 공개 포지션 기준 공격성 = 상위 5포지션 집중도(%) × 40% + 포지션 변화율(0~100) × 35% + 변동성 점수(0~100) × 25%. 변화율 = Σ|주식 수 변화|×직전 분기 주당 평가액 ÷ 직전 분기 공개 보유액 × 100 (신규는 당기 주당 평가액). 변동성 = 최근 63거래일 일별 로그수익률 표본표준편차 × √252, 공시 주식 비중 가중 평균; 연율 60%를 100점으로 환산·상한 적용. 실제 위험·레버리지 측정치 아님.';
export function aggressionScore({concentration,positionChange,volatility,verifiedAdjustedPrices=false}){
 if(!verifiedAdjustedPrices||![concentration,positionChange,volatility].every(Number.isFinite))return null;
 return Math.min(100,concentration)*.4+Math.min(100,positionChange)*.35+Math.min(100,volatility/.6*100)*.25;
}
export function managerMetrics(current,previous){
 if(!current?.items?.length||current.schemaVersion!==2)return null;
 const rows=current.items.filter(r=>r.valueUsd>=0),total=current.totalValue,ordered=[...rows].sort((a,b)=>b.valueUsd-a.valueUsd),comparison=comparePositions(current,previous),sectors={};
 for(const r of rows){const key=r.sector||'분류 미제공';sectors[key]=(sectors[key]||0)+(total>0?r.valueUsd/total*100:0);}
 let positionChange=null;
 if(comparison.comparable&&previous.totalValue>0&&rows.every(r=>r.kind==='share')&&previous.items.every(r=>r.kind==='share')){
  const prior=new Map(previous.items.map(r=>[r.id,r]));let amount=0;
  for(const r of [...comparison.items,...comparison.disposed]){const old=prior.get(r.id),unit=old?.shares>0?old.valueUsd/old.shares:r.shares>0?r.valueUsd/r.shares:0;amount+=Math.abs(r.shareChange)*unit;}
  positionChange=amount/previous.totalValue*100;
 }
 return {totalValue:total,holdingCount:rows.length,filedAt:current.filedAt,concentration:total>0?ordered.slice(0,5).reduce((n,r)=>n+r.valueUsd,0)/total*100:null,sectors,top3:ordered.slice(0,3).map(r=>({ticker:r.ticker,name:r.name,kind:r.kind})),mainSector:Object.entries(sectors).filter(([s])=>s!=='분류 미제공').sort((a,b)=>b[1]-a[1])[0]?.[0]||null,newCount:comparison.comparable?comparison.items.filter(r=>r.kind==='share'&&r.changeType==='new').length:null,positionChange,aggression:null,receivedAt:current.checkedAt||current.receivedAt,period:current.period};
}
export function filterManagers(items,p){
 const numeric=[['countMin','holdingCount',1],['countMax','holdingCount',-1],['valueMin','totalValue',1],['valueMax','totalValue',-1],['top5Min','concentration',1],['newMin','newCount',1]];
 let rows=items.filter(r=>(!p.get('period')||r.period===p.get('period'))&&numeric.every(([param,key,direction])=>!p.has(param)||p.get(param)===''||Number.isFinite(r[key])&&(direction>0?r[key]>=Number(p.get(param)):r[key]<=Number(p.get(param))))&&(!p.get('sector')||Number.isFinite(r.sectors?.[p.get('sector')])&&r.sectors[p.get('sector')]>=Number(p.get('sectorMin')||0)));
 const quick=p.get('quick');if(quick==='recommended')rows=rows.filter(r=>r.recommended);if(quick==='focused')rows=rows.filter(r=>r.concentration>=50);if(quick==='active')rows=rows.filter(r=>r.positionChange>=30);if(quick==='technology')rows=rows.filter(r=>(r.sectors?.Technology??-1)>=40);if(quick==='new')rows=rows.filter(r=>r.newCount>=5);
 const sort=p.get('sort')||'filed',key={filed:'filedAt',value:'totalValue',count:'holdingCount',aggression:'aggression'}[sort]||'filedAt';
 return rows.sort((a,b)=>{const relevance=(a.searchMatch?.tier??0)-(b.searchMatch?.tier??0)||(a.searchMatch?.distance??0)-(b.searchMatch?.distance??0);if(relevance)return relevance;if(sort==='famous'&&featuredOrder(a)!==featuredOrder(b))return featuredOrder(a)-featuredOrder(b);const av=a[key],bv=b[key];if(av==null)return bv==null?a.name.localeCompare(b.name):1;if(bv==null)return -1;return typeof av==='string'?bv.localeCompare(av):bv-av||a.name.localeCompare(b.name);});
}
export async function exploreManagers(env,p){
 requireFinviz(env,'display','MANAGERS');if(!env.DB)return {status:'error',items:[],message:'공시 저장소 연결 필요'};
 const q=(p.get('q')||'').trim(),page=Number(p.get('page')||1);let warning=null,remote=[];
 if(q.length>100||!Number.isInteger(page)||page<1||page>1000)throw new Error('Invalid query');
 for(const key of ['countMin','countMax','valueMin','valueMax','top5Min','newMin','sectorMin'])if(p.has(key)&&p.get(key)!==''&&(!Number.isFinite(Number(p.get(key)))||Number(p.get(key))<0))throw new Error('Invalid filter');
 let directory=(await env.DB.prepare('SELECT * FROM manager_directory').bind().all()).results;
 const localMatch=q&&directory.some(m=>managerMatch({...m,people:JSON.parse(m.people)},q));
 if(!directory.length||q&&!localMatch){try{remote=(await searchManagers(env,q,1)).items;}catch{warning='공급처 검색 갱신 실패 · 저장된 운용사에서 검색합니다.';}}
 directory=(await env.DB.prepare('SELECT * FROM manager_directory').bind().all()).results;
 const snapshots=(await env.DB.prepare('SELECT cik,payload FROM manager_snapshots ORDER BY period DESC').bind().all()).results;
 const history=new Map();for(const row of snapshots){if(!history.has(row.cik))history.set(row.cik,[]);history.get(row.cik).push(JSON.parse(row.payload));}
 const all=directory.map(m=>{const h=history.get(m.cik)||[],metrics=managerMetrics(h[0],h[1]),fallback=remote.find(r=>r.cik===m.cik);return {cik:m.cik,name:m.name,people:JSON.parse(m.people),period:m.period,...(fallback||{}),...(metrics||{}),recommended:Number.isFinite(featuredOrder(m)),relatedPeople:managerProfile(m.cik)?.people.map(p=>p.name)||[],receivedAt:metrics?.receivedAt||m.updated_at,detailsAvailable:!!metrics,missingReason:metrics?null:'상세 공시 확인 전'};});
 const matched=q?all.map(r=>({...r,searchMatch:managerMatch(r,q)})).filter(r=>r.searchMatch):all;
 const sorted=filterManagers(matched,p),start=(page-1)*20;
 return {status:sorted.length?'ready':'empty',items:sorted.slice(start,start+20),total:sorted.length,page,nextPage:sorted.length>start+20?page+1:null,coverage:{directory:all.length,verified:all.filter(r=>r.detailsAvailable).length},warning,periods:[...new Set(all.map(r=>r.period).filter(Boolean))].sort().reverse(),sectors:[...new Set(all.flatMap(r=>Object.keys(r.sectors||{})))].sort(),availability:{popularity:{enabled:true,mode:'editorial',reason:'관리자 대표 운용사 순서 기준 · 나머지는 최근 공시순. 사이트 관심도는 아직 반영하지 않습니다.'},aggression:{enabled:false,reason:'분할 조정을 검증한 63거래일 가격 이력과 전체 포지션 자료가 필요합니다.',formula:aggressionFormula},returns:{enabled:false,reason:'공시 공개 다음 거래일 매수·리밸런싱에 필요한 당시 가격과 배당·분할 조정 이력이 검증되지 않았습니다.'}},receivedAt:new Date().toISOString()};
}
