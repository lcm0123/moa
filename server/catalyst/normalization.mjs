import {norm} from './core.mjs';

export const eventStates=['PLANNED','ANNOUNCED','APPROVED','ORDERED','UNDER_CONSTRUCTION','INSTALLED','RAMPING','IN_PRODUCTION','COMPLETED'];
export function eventState(text){
 const t=norm(text);
 // Precedence matters: “완료할 계획” is a plan, never completion.
 if(/계획|예정|추진|검토|\bplans?\b|planned|proposed|intends? to/i.test(t))return 'PLANNED';
 if(/완료(?:했다|하였다|되었다|됐다|됨)?|completed/i.test(t))return 'COMPLETED';
 if(/가동률.{0,15}(높|상향)|램프업|ramping/i.test(t))return 'RAMPING';
 if(/양산(?:을)?\s*(시작|중)|가동 중|in production/i.test(t))return 'IN_PRODUCTION';
 if(/설치(?:했다|하였다|되었다|됐다|됨)|installed/i.test(t))return 'INSTALLED';
 if(/건설 중|공사 중|착공|under construction/i.test(t))return 'UNDER_CONSTRUCTION';
 if(/발주(?:했다|하였다|되었다|됐다)|ordered/i.test(t))return 'ORDERED';
 if(/승인(?:했다|하였다|되었다|됐다)|approved/i.test(t))return 'APPROVED';
 if(/발표(?:했다|하였다)|announced/i.test(t))return 'ANNOUNCED';
 return null;
}
const normalized=s=>norm(s).toLowerCase().replace(/[.!?。]+$/,'');
const ending='(?:한다|하고 있다|합니다|하고 있습니다|했다|하였다)';
const patterns=[
 ['CAN_SUPPLY',/^(.*?)\s*공급할 수 있다$/],
 ['NEGOTIATES_CUSTOMER',/^(.*?)\s*(?:고객으로 확보하기 위해 )?협의 중(?:이다)?$/],
 ['PURSUES_SUPPLY_CHAIN',/^(.*?)\s*공급망 진입(?:을)? 추진(?:한다| 중이다)?$/],
 ['EXPECTED_BENEFIT',/^(.*?)\s*수혜(?:를)? 기대(?:한다|하고 있다)?$/],
 ['TARGETS_MARKET',/^(.*?)\s*(?:시장 진출을 추진한다|시장을 공략한다)$/],
 ['TARGETED_PRODUCT',/^(.*?)향 제품(?:이다)?$/],
 ['COOPERATES_WITH',/^(.*?)와?\s*협력(?:한다|하고 있다)$/],
 ...[['PRODUCES','생산|제조'],['SELLS','판매'],['SUPPLIES','공급'],['SUPPLIES_TO','납품'],['DEVELOPS','개발'],['PROVIDES','제공']].map(([p,v])=>[p,new RegExp('^(.*?)\\s*(?:'+v+')'+ending+'$')]),
 ['USED_IN',/^(.*?)\s*(?:사용|적용)(?:된다|되고 있다|됩니다)$/],
 ['INVESTS',/^(.*?)\s*투자(?:한다|했다|하였다|하고 있다|를 완료했다|할 계획이다| 예정이다)$/],
 ['CAPACITY_EXPANSION',/^(.*?)\s*증설(?:한다|했다|하였다|하고 있다|할 계획이다|을 완료했다|을 계획하고 있다)$/],
 ['REPORTED_VALUE',/^(.*?)\s*(?:이다|입니다|였다)$/]
];
export function koreanProposition(text){
 const t=norm(text).replace(/[.!?。]+$/,'');
 // Require an explicit grammatical subject; never infer an issuer from a keyword.
 const m=/^(.+?)(?:은|는|이|가)\s+(.+)$/.exec(t);if(!m)return null;
 if(/않|아니|없|부인|고객사[가는의]|자회사/.test(m[2]))return null;
 for(const [predicate,re]of patterns){const v=re.exec(m[2]);if(!v)continue;
  let object=v[1].trim(),recipient=null,p=predicate;
  if(['SUPPLIES','SUPPLIES_TO'].includes(p)){
   const target=/^(.+?)(?:에게|에)\s+(.+)$/.exec(object);
   if(target){recipient=normalized(target[1]);object=target[2];p='SUPPLIES_TO';}
   else if(p==='SUPPLIES_TO')return null; // “납품” without recipient is not a customer claim.
  }
  object=object.replace(/(?:을|를|에|와|과)$/,'').trim();if(!object)return null;
  return {subject:normalized(m[1]),predicate:p,object:normalized(object),recipient,eventState:eventState(t),tense:/(했다|하였다|였다|되었다|됐다)$/.test(t)?'PAST':'PRESENT',language:'ko'};
 }
 return null;
}
export function exposure(text){
 const t=norm(text),revenue=/매출|revenue|sales/i.test(t);
 if(revenue&&/사업부|사업|부문|segment/i.test(t))return 'SEGMENT_REVENUE';
 if(revenue&&/제품|product/i.test(t))return 'PRODUCT_REVENUE';
 if(/주요 사업|주력|생산|제조|판매|manufactur|produc|sell/i.test(t))return 'QUALITATIVE';
 return 'UNKNOWN';
}
