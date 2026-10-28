import {rows,one} from './store.mjs';
import {hash,norm} from './core.mjs';
// Search is a projection of verified claims, not a business classification engine.
export async function indexBusinessProfile(store,asset,profile){
 const before=JSON.stringify(await rows(store.db,'SELECT item_id,source_id,payload FROM business_profile_index WHERE issuer=? ORDER BY item_id,source_id',profile.issuer));
 const statements=[store.db.prepare('DELETE FROM business_profile_index WHERE issuer=?').bind(profile.issuer)];
 for(const d of profile.descriptions){const source=await one(store.db,'SELECT id FROM catalyst_sources WHERE id=?',d.sourceId);if(!source)continue;
  statements.push(store.db.prepare('INSERT OR REPLACE INTO business_profile_index VALUES(?,?,?,?,?,?,?,?,?,?)').bind(profile.issuer,await hash(d.quote),asset.id,'DESCRIPTION',d.quote.slice(0,240),null,norm(d.quote).toLowerCase(),source.id,null,JSON.stringify({quote:d.quote,url:d.url,claimId:d.claimId,documentHash:d.documentHash})));
 }
 const indexed=new Set();
 for(const [dimension,group] of Object.entries(profile.groups))for(const ds of group.datasets.filter(d=>!d.historical).sort((a,b)=>String(b.period.end).localeCompare(String(a.period.end))||String(b.publishedAt||'').localeCompare(String(a.publishedAt||''))||(b.period.type==='SINGLE_QUARTER')-(a.period.type==='SINGLE_QUARTER')))for(const r of ds.items){if(r.metric==='NON_DISCLOSURE'||indexed.has(r.businessItemId||r.id))continue;indexed.add(r.businessItemId||r.id);
  statements.push(store.db.prepare('INSERT OR REPLACE INTO business_profile_index VALUES(?,?,?,?,?,?,?,?,?,?)').bind(profile.issuer,r.businessItemId||r.id,asset.id,dimension,r.label,r.normalizedConceptId||null,norm([r.label,r.parent,r.normalizedConceptId].filter(Boolean).join(' ')).toLowerCase(),r.sourceId,r.id,JSON.stringify({...r,url:r.sourceUrl})));
 }
 await store.db.batch(statements);
 // Reuse the existing queue for affected private idea results. Legacy news and
 // paid research jobs retain their own refresh policies.
 const {invalidateIdeaResults}=await import('../idea-companies-store.mjs');
 const after=JSON.stringify(await rows(store.db,'SELECT item_id,source_id,payload FROM business_profile_index WHERE issuer=? ORDER BY item_id,source_id',profile.issuer));
 if(before!==after)await invalidateIdeaResults(store.db,asset.id);
}
async function currentEvidence(store,row,source){
 const p=JSON.parse(row.payload);
 if(!p.documentHash||p.documentHash!==source.documentHash||!p.claimId)return false;
 const claim=await one(store.db,"SELECT status FROM catalyst_claims WHERE id=?",p.claimId);if(!['VERIFIED','SUPPORTED'].includes(claim?.status))return false;
 if(row.observation_id){const fact=await one(store.db,"SELECT verification_status,lifecycle_status FROM company_metadata_facts WHERE id=?",row.observation_id);if(fact?.verification_status!=='VERIFIED'||fact.lifecycle_status!=='ACTIVE')return false;}
 return true;
}
export async function searchBusinessProfiles(store,query,{market=null,minShare=null,dimension=null,limit=20,offset=0,sourceAllowed=()=>false}={}){
 const terms=norm(query).toLowerCase().split(/\s+/).filter(Boolean).slice(0,5);if(!terms.length)return [];
 const args=[],where=terms.map(t=>{args.push(t);return 'instr(i.text,?)>0';});
 if(market&&['KR','US'].includes(market)){where.push('a.kind=?');args.push(market+'_STOCK');}
 if(dimension){where.push('i.dimension=?');args.push(dimension);}
 // Share filters match the exact disclosed item, never a descriptive-text hit.
 if(minShare!==null){where.push("i.observation_id IS NOT NULL AND CAST(json_extract(i.payload,'$.percent') AS REAL)>=?");args.push(minShare);}
 const found=await rows(store.db,`SELECT i.*,a.symbol,a.name,a.kind FROM business_profile_index i JOIN catalyst_assets a ON a.id=i.asset_id WHERE ${where.join(' AND ')} ORDER BY i.issuer,i.item_id LIMIT ? OFFSET ?`,...args,Math.min(100,limit*4),offset),out=new Map();
 for(const r of found){if(out.size>=limit&&!out.has(r.issuer))continue;const source=await one(store.db,"SELECT id,url,json_extract(payload,'$.securityVersion') securityVersion,json_extract(payload,'$.documentHash') documentHash FROM catalyst_sources WHERE id=?",r.source_id);if(!source||!await sourceAllowed(source)||!await currentEvidence(store,r,source))continue;
  // Old projections may lack units/scope. Hydrate the exact active observation,
  // rather than rebuilding an index or starting a collection from a search GET.
  const stored=r.observation_id?await one(store.db,'SELECT payload FROM company_metadata_facts WHERE id=?',r.observation_id):null;
  const p={...JSON.parse(r.payload),...stored?JSON.parse(stored.payload):{}},shareComparable=Number.isFinite(p.percent)&&p.percent>=0&&p.percent<=100&&p.period?.start&&p.period?.end&&p.period?.type&&p.period.type!=='UNKNOWN'&&['CONSOLIDATED','SEPARATE'].includes(p.scope)&&p.denominatorKind&&p.denominatorKind!=='UNKNOWN'&&!p.comparabilityReview;
  if(minShare!==null&&(!shareComparable||p.percent<minShare))continue;
  const entry=out.get(r.issuer)||{issuer:r.issuer,issuerId:r.issuer,assetId:r.asset_id,instrumentId:r.asset_id,market:r.kind==='KR_STOCK'?'KR':'US',ticker:r.symbol,id:r.symbol,name:r.name,businessSummary:null,products:[],matches:[],quoteAvailable:false};
  if(r.dimension==='DESCRIPTION')entry.businessSummary=p.quote;
  else if(r.dimension==='PRODUCT')entry.products.push(r.label);
  const importance=shareComparable?'DISCLOSED_ITEM_SHARE':r.dimension==='DESCRIPTION'&&/주력|핵심 사업|principal business|primary business/i.test(p.quote||'')?'QUALITATIVE_CORE':r.dimension==='PRODUCT'?'PRODUCT_EVIDENCE':'CONFIRM_SCOPE';
  entry.matches.push({...p,dimension:r.dimension,label:r.label,observationId:r.observation_id,url:p.sourceUrl||p.url,shareComparable:!!shareComparable,importance});out.set(r.issuer,entry);
 }
 return [...out.values()];
}
export async function businessSearchCoverage(store){
 const r=await one(store.db,'SELECT COUNT(DISTINCT issuer) companies,COUNT(*) items,COUNT(DISTINCT source_id) sources FROM business_profile_index');
 return {...r,scope:'기존 저장 색인에 수록된 기업만 검색합니다. 검색 결과에는 현재 출처 권한을 적용합니다. 미수록 기업은 관련 없음이라는 뜻이 아닙니다.'};
}
export async function stockBusinessSummaries(store,stocks,{sourceAllowed}={}){
 for(const s of stocks){const ids=await rows(store.db,'SELECT id FROM catalyst_assets WHERE kind=? AND symbol=?',s.market+'_STOCK',s.ticker);if(ids.length!==1)continue;
  const hits=await rows(store.db,"SELECT i.*,s.url,json_extract(s.payload,'$.securityVersion') securityVersion,json_extract(s.payload,'$.documentHash') documentHash FROM business_profile_index i JOIN catalyst_sources s ON s.id=i.source_id WHERE i.issuer=(SELECT CASE WHEN kind='KR_STOCK' THEN 'KR:' ELSE 'US:' END||issuer_id FROM catalyst_assets WHERE id=?) ORDER BY CASE WHEN i.dimension='DESCRIPTION' THEN 0 ELSE 1 END LIMIT 8",ids[0].id);
  const valid=[];for(const h of hits)if(await sourceAllowed?.({id:h.source_id,url:h.url,securityVersion:h.securityVersion,documentHash:h.documentHash})&&await currentEvidence(store,h,h))valid.push(h);
  s.businessSummary=valid.find(x=>x.dimension==='DESCRIPTION')?.label||null;s.products=valid.filter(x=>x.dimension==='PRODUCT').map(x=>x.label).slice(0,3);
 }
 return stocks;
}
