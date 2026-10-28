// A rating upgrade or an earnings forecast change is not a price-target revision.
export function explicitTargetRevision(text=''){
 const directions=new Set();
 for(const match of String(text).slice(0,100000).matchAll(/(?:목표\s*(?:주가|가)|target\s*price|price\s*target|\bTP\b)([^\n;]{0,110})/gi)){
  const tail=match[1],direction=/(상향|하향|\braised\b|\bincreased\b|\blowered\b|\breduced\b|\bcut\b)/i.exec(tail);
  if(!direction)continue;
  const before=tail.slice(0,direction.index);
  if(/유지|동결|가능|예상|전망|여력|투자\s*의견|영업\s*이익|순이익|매출|\bEPS\b|\brating\b|\bpotential\b|\bexpect/i.test(before))continue;
  if(/(?:가능|예정|검토|할\s*수|하지\s*않)/.test(tail.slice(direction.index+direction[0].length,direction.index+direction[0].length+12)))continue;
  directions.add(/상향|raised|increased/i.test(direction[0])?'up':'down');
 }
 return directions.size===1?[...directions][0]:null;
}
export function reportTargetInfo(fields={},rawText=''){
 const extracted=fields.targetPriceRevision?.status==='extracted'&&['up','down'].includes(fields.targetPriceRevision.value)?fields.targetPriceRevision.value:null;
 const explicit=explicitTargetRevision(rawText),revision=extracted&&explicit&&extracted!==explicit?null:extracted||explicit;
 // Accept only a labeled, currency-qualified single price, optionally followed by a revision label.
 let target=fields.targetPrice?.value||null;
 if(!target){const prices=[...String(rawText).matchAll(/^\s*(?:[-*•]\s*)?(?:목표\s*(?:주가|가)|Target\s*Price|TP)\s*[:：]\s*((?:(?:USD|KRW|\$|₩)\s*)?[\d,]+(?:\.\d+)?\s*(?:원|달러|USD|KRW)?)(?:\s*[（(](?:상향|하향|유지)[)）])?\s*$/gim)].map(m=>m[1].trim()).filter(v=>/USD|KRW|[$₩]|원|달러/i.test(v));if(new Set(prices).size===1)target=prices[0];}
 return {value:target,revision};
}
