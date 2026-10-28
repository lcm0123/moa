import {norm} from './core.mjs';
// Exact sentence grammar preserves modal strength. No prose generation or
// keyword co-occurrence inference. Passive application edges retain direction.
export function promotionAssertions(body){
 const out=[];
 for(const raw of String(body||'').split(/\n|(?<=[.!?])\s+(?=[A-Z])/)){
  const quote=norm(raw);if(quote.length<24||quote.length>1200||/\b(?:not|no longer|might|could|rumor)\b/i.test(quote))continue;
  let m,predicate,subject,object;
  if((m=/^(?:The )?(.{3,100}? system) provides (?:innovative |automated |advanced )?(?:defect )?inspection(?: and metrology)? for (?:the )?(.{0,45}?(?:IC substrates?|package substrates?|printed circuit boards?))(?=\s|[,.]|$)/i.exec(quote))){subject=m[1];object=m[2];predicate='INSPECTS';}
  else if((m=/^The .{3,90}? series of (automated optical inspection systems) delivers .{0,35}?AOI performance for (?:advanced )?(IC substrate|package substrate) production\.$/i.exec(quote))){subject=m[1];object=m[2];predicate='INSPECTS';}
  else if((m=/^(.{3,160}?) (requires?|uses?|can use|consumes?) (?:the )?(.{3,180}?) (process|equipment|material)s?[.!]?$/i.exec(quote))){
   subject=m[1];object=m[3]+' '+m[4];const verb=m[2].toLowerCase();predicate=(verb.startsWith('require')?'REQUIRES':verb==='can use'?'CAN_USE':verb.startsWith('consume')?'CONSUMES':'USES')+'_'+m[4].toUpperCase();
  }else if((m=/^(.{3,160}?) (?:is|are) (used|designed|required) (?:in|for) (.{3,250}?)[.!]?$/i.exec(quote))){subject=m[1];object=m[3];predicate=({used:'USED_IN',designed:'DESIGNED_FOR',required:'REQUIRED_FOR'})[m[2].toLowerCase()];}
  else if((m=/^(.{3,160}?) (?:inspects|processes) (.{3,200}?)[.!]?$/i.exec(quote))){subject=m[1];object=m[2];predicate=/ inspects /i.test(quote)?'INSPECTS':'PROCESSES';}
  if(!m||/^(?:it|they|we|this|these|those)\b/i.test(subject)||/\b(?:and|or)\b|[,;]/i.test(subject))continue;
  out.push({ref:String(out.length),kind:'technical',subject:norm(subject).toLowerCase(),object:norm(object).replace(/[.!]$/,'').toLowerCase(),predicate,quote});
 }return out;
}
