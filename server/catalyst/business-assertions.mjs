import {norm} from './core.mjs';
// Extractive grammar only. The complete verbatim sentence remains the evidence.
// These rules do not use a company, industry or recommended-product dictionary.
export function businessAssertions(body){
 const out=[];
 const sentences=String(body||'').split(/\n|(?<=[.!?。])(?=\s|[가-힣A-Z])/).map(norm).filter(t=>t.length>=12&&t.length<=1200);
 const add=(quote,predicate,object,extra={})=>{if(!object||object.length>180)return;out.push({ref:String(out.length),quote,subject:'당사',predicate,object:norm(object).toLowerCase(),...extra});};
 for(const line of sentences.slice(0,600)){
  const revenue=/^Our (.{3,100}?) product sales accounted for ([\d.]+)% of (?:total |net |consolidated )?revenue in (20\d\d(?: Q[1-4]| H[12])?)\.$/.exec(line);
  const krRevenue=/^당사의 (.{2,100}?) 제품 매출 비중은 (20\d\d년(?: [1-4]분기| 상반기| 하반기)?) ([\d.]+)%입니다\.$/.exec(line);
  if(revenue||krRevenue){const m=revenue||krRevenue;add(line,'REPORTED_REVENUE_SHARE',m[1],{category:'revenue_share',exposureType:'PRODUCT_REVENUE'});}
  // An explicitly named issuer's own product portfolio is business evidence;
  // ownership of the website alone is not. Keep the original named subject.
  const namedPortfolio=/^(.{2,65}?)[’']s portfolio of .{3,160}? includes (?:both )?(.{3,400})\.$/.exec(line);
  if(namedPortfolio&&!/plans|future|expected|customers|competitors/i.test(line)){
   for(const item of namedPortfolio[2].split(/ and (?=[a-z])/)){
    const product=item.replace(/ for .+$/,'');const before=out.length;
    add(line,'REPORTS_PRODUCTS',product,{category:'products',relationship:'OWN_PRODUCT_PORTFOLIO',explicitSubject:true});
    if(out.length>before)out.at(-1).subject=norm(namedPortfolio[1]).toLowerCase();
   }
  }
  // Explicit issuer-owned product description; keep the complete sentence.
  // "development planned" or another company's products do not match.
  const primary=/^(.{3,100}?)(?:은|는) 당사의 (?:기존 )?주력 사업으로 (.{3,100}?)에 사용되는 (.{3,120}?)(?:을|를) 중심으로 다양한 장비를 개발 및 생산하고 있으며, .+ 공급하고 있습니다\.$/.exec(line);
  if(primary&&!/추정|계획|추진|않|아니/.test(line))add(line,'PRODUCES',primary[3],{category:'products',relationship:'PRIMARY_PRODUCT'});
  const portfolio=/^Our product portfolio .+ including (.+)\.$/.exec(line)||/^We sell our products .+ including (.+)\.$/.exec(line);
  if(portfolio){for(const product of portfolio[1].split(/,\s*(?:and )?| and /)){const before=out.length;add(line,'REPORTS_PRODUCTS',product,{category:'products',relationship:'UNKNOWN'});if(out.length>before)out.at(-1).subject='our company';}}
  const start=line.indexOf('당사');if(start<0)continue;const quote=line.slice(start);
  if(/고객사가|생산하지|판매하지|영위하지|추정|가정/.test(quote))continue;
  if(/^당사는 .+사업부문/.test(quote)){
   const text=quote.replace(/^당사는 /,'');
   for(const m of text.matchAll(/(?:^|, )([^,]+(?:\([^)]*\))?[^,]*?)(?:을|를) 생산하는 ([^,]+?) 사업부문/g)){
    add(quote,'PRODUCES',m[1],{category:'products',relationship:'UNKNOWN'});
    add(quote,'REPORTS_SEGMENT',m[2],{category:'business_segments',relationship:'UNKNOWN'});
   }
  }
  const production=/^당사는 (.+?)(?:을|를) (주력 )?(?:생산 및 판매|생산,?\s*판매|생산|제조)(?:하고 있습니다|하고 있다|합니다|한다)\.?$/.exec(quote);
  if(production){
   const product=production[1].replace(/^.+? 전문업체로 (?:우리말로는 )?/,'');
   add(quote,'PRODUCES',product,{category:'products',relationship:production[2]?'PRIMARY_PRODUCT':'UNKNOWN'});
  }
  const customer=/^당사의 주요 매출처는 (.+?)(?:이며|이고|입니다)/.exec(quote);
  if(customer)add(quote,'CUSTOMER_OF',customer[1],{category:'customers',relationship:'CONFIRMED_CUSTOMER'});
  const supplier=/^당사는 (.{2,90}?)(?:으로부터|로부터) (.+?)(?:을|를) 매입하고 있습니다\.?$/.exec(quote);
  if(supplier)add(quote,'SUPPLIER_OF',supplier[1],{category:'suppliers',relationship:'CONFIRMED_SUPPLIER'});
  const endMarket=/^당사의 제품은 (.+?) 시장에 (?:사용|적용)됩니다\.?$/.exec(quote);
  if(endMarket)add(quote,'USED_IN',endMarket[1],{category:'end_markets',relationship:'CONFIRMED_USE'});
  const capex=/^당사는 (.+?(?:설비|CAPA|투자).+?)(?:을|를) 사용하였습니다\.?$/.exec(quote);
  if(capex)add(quote,'REPORTED_CAPEX',capex[1],{category:'capex_exposure',relationship:'UNKNOWN',eventState:'COMPLETED'});
 }
 return out;
}
