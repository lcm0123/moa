import registry from '../config/security-aliases.json' with {type:'json'};
export function securityKey(market,ticker,date=null){
 if(!['KR','US'].includes(market)||typeof ticker!=='string')return null;
 ticker=ticker.trim().toUpperCase();if(!/^[A-Z0-9.^_/-]{1,30}$/.test(ticker)||market==='KR'&&!/^[0-9][0-9A-Z]{5}$/.test(ticker))return null;
 const aliases=registry.aliases.filter(a=>a.market===market&&a.ticker===ticker&&a.verifiedSource&&date&&date>=a.from&&date<=a.to);
 if(aliases.length>1)return null;return market+':'+(aliases[0]?.canonicalTicker||ticker);
}
export function parseSecurities(value){const keys=[...new Set(String(value||'').split(',').filter(Boolean))];if(keys.length>600)throw new Error('Too many securities');return keys.map(key=>{const [market,ticker,...rest]=key.split(':');if(rest.length||securityKey(market,ticker)!==key)throw new Error('Invalid security');return {key,market,ticker};});}
export function verifiedReportKey(row){const p=row.parsed,f=p?.fields||{};if(f.ticker?.status!=='extracted'||f.ticker.value!==row.ticker||p.market!==row.market||p.ticker!==row.ticker)return null;return securityKey(row.market,row.ticker,f.issuedDate?.value||row.posted_at?.slice(0,10));}
export function reportIssuerMatches(row,issuer){
 if(!issuer||issuer.market!==row.market||issuer.ticker!==row.ticker)return false;
 const p=row.parsed;if(p.issuerId)return p.issuerId===issuer.issuer_id;
 const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/주식회사|\(주\)|\b(incorporated|inc|corporation|corp|limited|ltd|llc)\b/gi,'').replace(/[^\p{L}\p{N}]/gu,'');
 const stock=p.fields?.stockName;if(stock?.status!=='extracted')return false;
 const name=normalize(stock.value);return name.length>=2&&name===normalize(issuer.name);
}
export const commonShare=p=>p.kind==='share'&&p.unit==='SH'&&p.mappingStatus==='matched_filing_totals'&&p.cusip&&!/NOTE|BOND|DEB|WARRANT|\bWTS\b|PFD|PREF|CONVERT|SDBCV/i.test(p.titleOfClass||'');
