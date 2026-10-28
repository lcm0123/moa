import {validateClaim} from './claims.mjs';
import {koreanProposition} from './normalization.mjs';
import {norm} from './core.mjs';

// Reuses documents already collected. No search, model call, or candidate
// discovery. Source-bound identifiers make extraction idempotent across runs.
export async function verifyStructuredSource(store,source,asset,{now=Date.now()}={}){
 if(!asset||source.assetId!==asset.id||!['official','business','regulatory'].includes(source.sourceType))return [];
 const proposals=[];
 for(const c of (source.tables||[]).flatMap(t=>t.cells||[]).filter(c=>c.eligible).slice(0,64)){
  proposals.push({id:c.source_location,type:'business',subject_id:asset.id,predicate:'REPORTED_VALUE',value:'',quote:'',source_id:source.id,
   table_ref:{table_id:c.table_id,source_location:c.source_location},table_value:{subject:c.subject,row_header:c.row_header,column_header:c.column_header,value:c.cell_value,unit:c.unit,period:c.period,scope:c.scope,exposure_type:c.exposure_type}});
 }
 for(const quote of String(source.body||'').split(/\n|(?<=[.。])\s+/).slice(0,300)){
  if(proposals.length>=96)break;const p=koreanProposition(quote);
  if(!p||p.subject!==norm(asset.name).toLowerCase())continue;
  const type=p.predicate==='SUPPLIES_TO'?'customer':['PRODUCES','SELLS','SUPPLIES','DEVELOPS','PROVIDES'].includes(p.predicate)?'business':'event';
  proposals.push({id:'sentence:'+norm(quote),type,subject_id:asset.id,predicate:p.predicate,value:quote,quote,source_id:source.id});
 }
 const claims=[];for(const proposal of proposals){const c=await validateClaim(proposal,[source],[asset],'source:'+source.id,now);await store.saveClaim(c,'source:'+source.id);claims.push(c);}
 return claims;
}
