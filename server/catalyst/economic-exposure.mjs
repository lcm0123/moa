import policy from '../../config/catalyst-beneficiary.json' with {type:'json'};
const numeric=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1;
export function fixedExposureScore(dimensions){
 if(Object.values(policy.weights).reduce((a,b)=>a+b,0)!==100)throw Error('ECONOMIC_WEIGHTS_MUST_TOTAL_100');
 let earned=0,observed=0;const breakdown={};
 for(const [key,weight]of Object.entries(policy.weights)){const value=dimensions[key],known=numeric(value);breakdown[key]={weight,value:known?value:null,known,contribution:known?value*weight:0};if(known){earned+=value*weight;observed+=weight;}}
 return {score:Math.round(earned*100)/100,coverage:observed/100,knownWeight:observed,totalWeight:100,breakdown,method:'FIXED_DENOMINATOR',meaning:'EXPOSURE_NOT_RETURN_PROBABILITY',version:policy.economicVersion};
}
export function revenueMateriality(facts,products){
 const names=new Set(products.map(x=>x.toLowerCase()));
 const related=facts.filter(f=>f.relatedToBusiness&&names.has(String(f.product).toLowerCase())&&f.status!=='INFERRED');
 const quant=related.filter(f=>f.type==='revenue_share'&&f.denominator!=='SEGMENT_REVENUE'&&(numeric(f.share)||Array.isArray(f.shareRange)&&f.shareRange.length===2&&f.shareRange.every(numeric)&&f.shareRange[0]<=f.shareRange[1])&&(!f.revenueLevel||f.revenueLevel===1)).sort((a,b)=>(a.revenueLevel||1)-(b.revenueLevel||1)||Date.parse(b.asOf)-Date.parse(a.asOf));
 const f=quant[0],share=f?(numeric(f.share)?f.share:f.shareRange[0]):null;
 const core=related.find(f=>f.type==='business_core'&&f.coreExplicit===true);
 const tier=share!==null?policy.revenueTiers.find(t=>share>=t.min):null;
 const concentration=share!==null?policy.concentrationTiers.find(t=>share>=t.min):null;
 return {status:f?.status||core?.status||'UNKNOWN',mode:f?(numeric(f.share)?'NUMERIC':'ESTIMATED_RANGE'):core?'QUALITATIVE_CORE':'UNKNOWN',share,shareRange:f?.shareRange||null,tier:tier?.label||'UNKNOWN',value:tier?.value??null,revenueLevel:f?.revenueLevel||null,source:f||core||null,coreExplicit:!!core,materialityGate:!!(f||core),concentration:concentration?.label||(core?'FOCUSED':'UNKNOWN'),concentrationValue:concentration?.value??(core?.coreExplicit?.valueOf()? .6:null),dilutionFactor:concentration?.dilution??1,dilutionBasis:concentration?'CONFIRMED_TARGET_SHARE':core?'QUALITATIVE_CORE_NO_NUMERIC_SHARE':'UNKNOWN_NO_ASSUMED_DILUTION',broaderSegments:related.filter(f=>f.type==='revenue_share'&&f.revenueLevel>=2)};
}
export function economicAssessment({facts,business,exposure,sensitivity,customers,overlap,momentum,passed}){
 const applicable=business.filter(x=>x.exposure.level==='DIRECT').map(x=>x.fact.product);
 const m=revenueMateriality(facts,applicable),application=policy.applicationValues[exposure.application]??0;
 // Share is counted once. Concentration/dilution remain descriptive metadata;
 // they must not multiply product applicability or demand sensitivity again.
 const dimensions={revenue:m.value,directness:business.length?application:null,sensitivity:policy.levels[sensitivity.level]??null,concentration:null,customer:overlap.length?1:customers.length?.6:null,momentum:momentum.length?1:null};
 const score=fixedExposureScore(dimensions);
 const applicationKnown=business.some(x=>x.fact.applicationQuote)&&['DIRECT','ADJACENT'].includes(exposure.level)&&!['UNKNOWN','SUBSTRATE_UNSPECIFIED','SEMICONDUCTOR_ADJACENT','SEMICONDUCTOR_PACKAGING_ADJACENT','GENERAL_ELECTRONICS'].includes(exposure.application);
 const finalEligible=passed&&m.materialityGate&&applicationKnown;
 const core=finalEligible&&exposure.level==='DIRECT'&&sensitivity.level==='HIGH'&&(m.share!==null?m.share>=policy.coreMinimumShare:m.coreExplicit);
 const group=!finalEligible?'WATCHLIST':core?'CORE_BENEFICIARIES':'SECONDARY_BENEFICIARIES';
 const coverage={revenue:m.status,application:applicationKnown?(business[0]?.fact.status||'UNKNOWN'):'UNKNOWN',customer:customers[0]?.status||'UNKNOWN',orders:momentum[0]?.status||'UNKNOWN'};
 const quality=xs=>xs.length?Math.max(...xs.map(x=>x.status==='VERIFIED'?1:x.status==='SUPPORTED'?.7:0)):0;
 const confidence=Math.round(35*quality(m.source?[m.source]:[])+35*quality(applicationKnown?business.map(x=>x.fact):[])+15*quality(customers)+15*quality(momentum));
 return {economicExposure:score.score,exposureScore:score,evidenceConfidence:confidence,economicMateriality:m,revenueExposure:m.share!==null?{share:m.share,shareRange:m.shareRange,period:m.source.period,sourceIds:m.source.sourceIds,claimId:m.source.id}:'UNKNOWN',exposureCoverage:coverage,beneficiaryGroup:group,finalEligible:!!finalEligible,purePlay:m.concentration,dilutionFactor:m.dilutionFactor,potentialEarningsSensitivity:core?'HIGH':finalEligible?'LIMITED':'UNKNOWN',materialityReason:!m.materialityGate?'TARGET_REVENUE_OR_CORE_BUSINESS_UNKNOWN':!applicationKnown?'TARGET_APPLICATION_UNCONFIRMED':core?'MATERIAL_TARGET_BUSINESS_AND_HIGH_SENSITIVITY':'LIMITED_COMPANY_WIDE_EXPOSURE'};
}
export function compareEconomicCandidates(a,b){
 const x=a.assessment,y=b.assessment;
 return (y.economicExposure??y.exposureScore.score)-(x.economicExposure??x.exposureScore.score)||(y.economicMateriality?.share??y.economicMateriality?.value??-1)-(x.economicMateriality?.share??x.economicMateriality?.value??-1)||(y.evidenceConfidence??0)-(x.evidenceConfidence??0)||(y.exposureScore.breakdown.momentum?.contribution||0)-(x.exposureScore.breakdown.momentum?.contribution||0)||String(a.asset?.id).localeCompare(String(b.asset?.id));
}
