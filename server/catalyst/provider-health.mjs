export function verifiedSecFallback(source,asset,securityVersion='security-1'){
 const p=source?.filingIdentity;
 return !!(asset&&source?.assetId===asset.id&&source.securityVersion===securityVersion&&source.body&&source.authority?.verified&&p?.verified&&
  /^\d+$/.test(String(p.cik))&&Number(p.cik)===Number(asset.issuerId)&&p.ticker===asset.symbol&&/^\d{4}-\d{2}-\d{2}$/.test(p.documentPeriod||'')&&
  source.documentHash&&source.authority.documentHash===source.documentHash&&source.authority.documentUrl===source.url);
}
export function secProviderHealth({httpStatus=null,asset,fallback=[],securityVersion='security-1',reason=null}){
 if(httpStatus===200)return {provider:'SEC',status:'READY',assetId:asset?.id||null,evidenceCoverage:'OFFICIAL_ENDPOINT_AVAILABLE',reason:null};
 const verified=fallback.filter(s=>verifiedSecFallback(s,asset,securityVersion));
 return {provider:'SEC',status:verified.length?'DEGRADED':'UNAVAILABLE',assetId:asset?.id||null,
  evidenceCoverage:verified.length?'REDUCED_OFFICIAL_FALLBACK':'NO_VERIFIED_SEC_EVIDENCE',fallbackCount:verified.length,reason:reason||'SEC_ACCESS_UNAVAILABLE'};
}
export function securityReadiness(checks){
 const required=['dart','invalidDocumentRejected','markdown','pdf','noNewRawHtml','noBlockedRefetch','noPublicExposure','noNewDefenderObserved','tests'];
 const missing=required.filter(k=>checks[k]!==true);
 if(!(checks.secStatus==='READY'||checks.secStatus==='DEGRADED'&&checks.verifiedFallback===true))missing.push('secOrVerifiedFallback');
 return {status:missing.length?'NOT_READY':'READY_FOR_LIMITED_REACTIVATION',missing,activationAuthorized:false};
}
