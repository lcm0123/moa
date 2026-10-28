import settings from '../../config/catalyst-research.json' with {type:'json'};
import {norm,hash} from './core.mjs';
import {questionScopeVersion,explicitScenario} from '../../dist/js/catalyst-question-scope.js';
export const researchConfig=settings;
export const researchKinds={ALL:['KR_STOCK','US_STOCK','CRYPTO'],KR:['KR_STOCK'],US:['US_STOCK'],CRYPTO:['CRYPTO']};
export function normalizedResearchQuestion(query){
 let s=norm(query).toLowerCase();
 for(const [from,to] of Object.entries(settings.normalizationAliases).sort((a,b)=>b[0].length-a[0].length))s=s.split(from).join(to);
 return s.replace(/[?？!.,·]/g,' ').replace(/\s+/g,' ').trim();
}
export async function researchKey(query,{market='ALL',mode='normal',conditional=false}={}){
 return hash(JSON.stringify([settings.version,questionScopeVersion,normalizedResearchQuestion(query),market,mode,conditional]));
}
export const definiteScenario=q=>explicitScenario.test(q);
// Model-proposed subtypes remain search hypotheses, not user-confirmed conditions.
export function explicitConditionTargets(query,targets){const question=normalizedResearchQuestion(query);return targets.filter(t=>topicMatch(question,normalizedResearchQuestion(t)));}
export function concreteTarget(value){const v=norm(value).toLowerCase();return v.length>=3&&!settings.genericTargets.includes(v);}
export function topicMatch(text,targets){const hay=norm(text).toLowerCase();return (Array.isArray(targets)?targets:[targets]).filter(concreteTarget).some(t=>{
 const needle=norm(t).toLowerCase();return /[가-힣]/.test(needle)?hay.includes(needle):new RegExp('(^|[^a-z0-9])'+needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'([^a-z0-9]|$)','i').test(hay);
 });}
