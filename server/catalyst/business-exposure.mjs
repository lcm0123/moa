import {admissible,pathQuality} from './evidence-policy.mjs';
import {canonicalIdentity} from './identity.mjs';
import {resolveDocumentScope,scopeTerms} from './document-scope.mjs';
import {productText} from './product-aliases.mjs';
import {validUserCondition} from './query-policy.mjs';
const verbs=new Set(['PRODUCES','SELLS','SUPPLIES','DEVELOPS','REPORTS_PRODUCTS','manufactures','produces','sells','supplies','develops']);
const key=(s,aliases)=>productText(s,aliases).replace(/\s*\([^)]*\)/g,'').replace(/[™®]/g,'').trim();
export function verifiedListedAsset(asset,now=Date.now()){
 if(!asset||asset.identityStatus!=='verified'||asset.active===false||!canonicalIdentity(asset).complete||!asset.name||!asset.symbol||!asset.exchange)return false;
 if(asset.active===true)return true;
 // Legacy US records omit active. A recent exact Nasdaq directory identity
 // match is listing evidence; missing active alone is never assumed to be true.
 try{const age=now-Date.parse(asset.identityCheckedAt);return asset.kind==='US_STOCK'&&new URL(asset.identitySource).hostname==='www.nasdaqtrader.com'&&Number.isFinite(age)&&age>=0&&age<86400000;}catch{return false;}
}
export function businessExposure({condition,asset,business,technical,aliases=[],claims=[]}){
 const reasons=[],canonical=verifiedListedAsset(asset);
 if(!validUserCondition(condition))reasons.push('EXPLICIT_CONDITION_REQUIRED');
 if(!canonical)reasons.push('VERIFIED_CANONICAL_ASSET_REQUIRED');
 const b=business?.normalizedProposition,t=technical?.normalizedProposition;
 const businessValid=admissible(business)&&business.type==='business'&&business.subject===asset?.id&&verbs.has(b?.predicate);
 if(!businessValid)reasons.push('BUSINESS_BELOW_SUPPORTED');if(!admissible(technical))reasons.push('TECHNICAL_BELOW_SUPPORTED');
 const forward=/^(?:USES|REQUIRES|CAN_USE|CONSUMES)(?:_|$)/.test(t?.predicate||''),product=forward?t?.object:t?.subject;
 const matches=!!b&&!!product&&key(b.product||b.object,aliases)===key(product,aliases);
 let target=condition?.targetProduct;
 // A broad question may explore an explicitly documented sub-application. The
 // original user condition is not rewritten to that subtype.
 const application=scopeTerms(technical?.quote)[0];
 if(condition?.targetScope==='SUBSTRATE'&&application)target=application.terms[0];
 const scope=resolveDocumentScope({document:{body:technical?.quote},targetProduct:target});
 const ownScope=resolveDocumentScope({document:{body:business?.quote},targetProduct:target});
 const direct=businessValid&&admissible(technical)&&matches&&scope.status==='EXACT'&&(ownScope.status==='EXACT'||technical.applicationAssetId===asset?.id);
 const adjacent=businessValid&&!!scopeTerms(business.quote).length&&!direct;
 const level=direct?'DIRECT_BUSINESS_EXPOSURE':adjacent?'ADJACENT_BUSINESS_EXPOSURE':businessValid?'THEMATIC_EXPOSURE':'INSUFFICIENT_EXPOSURE';
 if(!direct)reasons.push(matches?'TARGET_APPLICATION_NOT_VERIFIED':'PRODUCT_TECHNICAL_LINK_MISSING');
 const evidenceLevel=direct?(business.status==='VERIFIED'&&technical.status==='VERIFIED'?'VERIFIED':'SUPPORTED'):'UNVERIFIED';
 const quality=direct?(evidenceLevel==='VERIFIED'?'DIRECT_EXPOSURE_PATH':'SUPPORTED_EXPOSURE_PATH'):adjacent?'ADJACENT_EXPOSURE_PATH':businessValid?'THEMATIC_ONLY':'INSUFFICIENT';
 const sources=[...new Set([...(business?.sourceIds||[]),...(technical?.sourceIds||[])])];
 const own=claims.filter(c=>c.subject===asset?.id&&admissible(c));
 const related=c=>key(c.normalizedProposition?.product||c.normalizedProposition?.object||'',aliases)===key(product||'',aliases);
 const revenue=own.find(c=>related(c)&&c.type==='revenue_share'&&['PRODUCT_REVENUE','SEGMENT_REVENUE'].includes(c.exposureType)&&c.typedValue?.some(v=>v.unit==='percent'&&Number.isFinite(Number(v.normalizedValue))&&Number(v.normalizedValue)>=0&&Number(v.normalizedValue)<=100));
 const percentage=revenue?.typedValue.find(v=>v.unit==='percent');
 const revenueExposure=percentage?{share:Number(percentage.normalizedValue)/100,period:revenue.period,sourceId:revenue.sourceIds[0],claimId:revenue.id,basis:revenue.exposureType}:'UNKNOWN';
 const details=type=>{const found=own.filter(c=>related(c)&&(type==='customer'?c.type==='customer':c.normalizedProposition?.predicate===type));return found.length?found.map(c=>({claimId:c.id,value:c.value,sourceIds:c.sourceIds,period:c.period})):'UNKNOWN';};
 return {passed:!reasons.length,reasons,businessExposureLevel:level,pathQuality:quality,evidencePathQuality:pathQuality([business?.status,technical?.status]),evidenceLevel,condition,application:scope.target,applicationScope:scope,companyApplicationScope:ownScope,product:product||null,businessClaimId:business?.id,technicalClaimId:technical?.id,sourceIds:sources,sourceCount:sources.length,independentSourceCount:new Set([business,technical].flatMap(c=>c?.corroboration?.sourceFamilies||[c?.independenceKey]).filter(Boolean)).size,officialSourceCount:new Set([business,technical].filter(c=>c?.status==='VERIFIED').flatMap(c=>c.sourceIds)).size,actualCatalyst:'UNKNOWN',exposureStrength:{productDirectness:matches?'HIGH':'UNKNOWN',applicationDirectness:direct?'HIGH':adjacent?'LOW':'UNKNOWN',revenueExposure,customerExposure:details('customer'),orderExposure:details('REPORTED_ORDERS'),capacityExposure:details('REPORTED_CAPACITY')},revenueExposure,missing:['revenueExposure','customerExposure','orderExposure','capacityExposure'].filter(k=>({revenueExposure,customerExposure:details('customer'),orderExposure:details('REPORTED_ORDERS'),capacityExposure:details('REPORTED_CAPACITY')})[k]==='UNKNOWN'),summary:direct?'해당 조건에서 구조적 연관성이 확인된 사업입니다.':'대상 적용처의 직접 근거가 부족합니다.'};
}
export function catalystEnrichment(candidate,events,{searched=false}={}){
 const relevant=events.filter(c=>c.type==='event'&&admissible(c)&&c.subject===candidate.asset.id&&candidate.gate?.product&&key(c.normalizedProposition?.product||'')===key(candidate.gate.product)&&c.asOf&&Date.now()-Date.parse(c.asOf)<=180*86400000&&Date.parse(c.asOf)<=Date.now());
 return {...candidate,actualCatalyst:relevant.length?'YES':searched?'NO':'UNKNOWN',catalystStatus:relevant.length?'RECENT_CATALYST_PRESENT':searched?'NO_VERIFIED_CATALYST_FOUND':'NOT_CHECKED',catalystClaimIds:relevant.map(c=>c.id)};
}
