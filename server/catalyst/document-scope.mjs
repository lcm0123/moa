import {norm} from './core.mjs';
import {researchConcepts} from '../../dist/js/catalyst-question-scope.js';
// Lexical identity only. These aliases never assert a taxonomy/technical edge.
const concepts=[
 ['FC_BGA',/\bfc[- ]?bga\b/ig],['ABF_SUBSTRATE',/\babf (?:substrates?|기판)\b/ig],
 ['BT_SUBSTRATE',/\bbt substrates?\b/ig],
 ['PACKAGE_SUBSTRATE',/\b(?:package|packaging|ic) substrates?\b|패키지\s*기판|패키징\s*기판/ig],
 ['PCB',/\bpcbs?\b|\bprinted circuit boards?\b|인쇄회로기판/ig],
 ['SUBSTRATE',/\bsubstrates?\b|기판/ig],['SEMICONDUCTOR_PACKAGE',/\bsemiconductor packag(?:e|es|ing)\b/ig],
 // Application aliases only: a transformer name alone is not grid evidence.
 ['POWER_GRID',/전력망|송배전|송전|배전|변전소|\b(?:power|electric(?:al|ity)?)\s+grids?\b|\b(?:power|electric(?:al|ity)?)\s+(?:transmission|distribution)\b|\btransmission\s+(?:and|&)\s+distribution\b|\bsubstations?\b/ig],
 ['DATA_CENTER',/데이터\s*센터|\bdata\s*cent(?:er|re)s?\b/ig],
 ...researchConcepts.map(([id,,pattern])=>[id,pattern])
];
export function scopeTerms(text){const found=[];for(const [id,re] of concepts){re.lastIndex=0;const matches=[...String(text||'').matchAll(re)];if(matches.length)found.push({id,terms:[...new Set(matches.map(m=>m[0]))]});}return found;}
export function scopeKey(text){const exact=String(text||'').toUpperCase();if(concepts.some(([id])=>id===exact))return exact;return scopeTerms(text)[0]?.id||norm(text).toLowerCase();}
export function scopeLabel(key){return ({FC_BGA:'FC-BGA',ABF_SUBSTRATE:'ABF substrate',BT_SUBSTRATE:'BT substrate',PACKAGE_SUBSTRATE:'package substrate',PCB:'PCB',SUBSTRATE:'substrate',POWER_GRID:'전력망',DATA_CENTER:'데이터센터'})[key]||researchConcepts.find(([id])=>id===key)?.[1]||key;}
export function resolveDocumentScope({document,targetProduct,targetProcess,targetApplication}){
 const body=String(document?.body||''),terms=scopeTerms(body),target=scopeKey(targetProduct),ids=terms.map(x=>x.id);
 const explicit=concepts.some(([id])=>id===target)?ids.includes(target):!!target&&norm(body).toLowerCase().includes(target);
 const details={productFamily:ids.includes('PCB')?'PCB':ids.includes('PACKAGE_SUBSTRATE')?'PACKAGE_SUBSTRATE':'UNKNOWN',productSubtype:ids.find(x=>['FC_BGA','ABF_SUBSTRATE','BT_SUBSTRATE'].includes(x))||'UNKNOWN',process:targetProcess&&norm(body).toLowerCase().includes(norm(targetProcess).toLowerCase())?targetProcess:'UNKNOWN',application:targetApplication&&norm(body).toLowerCase().includes(norm(targetApplication).toLowerCase())?targetApplication:'UNKNOWN',explicitTerms:terms.flatMap(x=>x.terms),broaderTerms:[],narrowerTerms:[],target};
 let status='UNKNOWN',rejectReason='TARGET_NOT_EXPLICIT';
 if(explicit){status='EXACT';rejectReason=null;}
 else if(['PCB','PACKAGE_SUBSTRATE','SUBSTRATE'].includes(target)&&ids.some(x=>['FC_BGA','ABF_SUBSTRATE','BT_SUBSTRATE'].includes(x))){status='NARROW';rejectReason='SCOPE_TOO_NARROW';details.narrowerTerms=ids.filter(x=>['FC_BGA','ABF_SUBSTRATE','BT_SUBSTRATE'].includes(x));}
 else if(ids.some(x=>['PCB','SUBSTRATE','SEMICONDUCTOR_PACKAGE','PACKAGE_SUBSTRATE'].includes(x))&&['PACKAGE_SUBSTRATE','FC_BGA','ABF_SUBSTRATE','BT_SUBSTRATE'].includes(target)){status='BROAD';rejectReason='SCOPE_TOO_BROAD';details.broaderTerms=ids;}
 else if(ids.length){status='MISMATCH';rejectReason='APPLICATION_MISMATCH';}
 if(targetProcess&&details.process==='UNKNOWN'||targetApplication&&details.application==='UNKNOWN'){status='MISMATCH';rejectReason='APPLICATION_MISMATCH';}
 return {...details,status,scopeRelation:status,rejectReason};
}
