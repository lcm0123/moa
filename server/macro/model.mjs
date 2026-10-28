import {catalog,topics,selectionConfig,roles,sourceNames} from './catalog.mjs';
import {calendarChanges} from './history.mjs';
const normalize=s=>String(s).toLowerCase().replace(/[\s·?？！!,]/g,'');
export function classify(question,{region,topic,years}={}){
 const q=normalize(question),us=/(미국|미연준|연준|\busa?\b|federal|\bfed\b)/i.test(question),kr=/(한국|국내|대한민국|한국은행|한은|korea)/i.test(question);
 const detected=us&&kr?'mixed':kr?'KR':us?'US':'unclear';
 const words={economy:/경기|경제성장|경제전반|미국경제|gdp|recession|economicgrowth/,inflation:/인플레|물가|inflation|cpi|근원pce|pcepi|ppi/,employment:/고용|실업|취업|일자리|employment|payroll|jolts|claims/,consumption:/소비(?!자물가)|소매|소득|구매력|retail|consumption|income/,rates:/금리|연준|국채|채권|interestrate|bond|fed/,housing:/주택|집값|부동산|주담대|housing|mortgage/,manufacturing:/기업|제조업|산업생산|내구재|설비투자|manufactur|durable/,credit:/신용|금융여건|금융시장|금융스트레스|자금조달|대출여건|credit|financialconditions|funding/,liquidity:/유동성|통화량|m2|역레포|연준자산|liquidity/,trade:/무역|수출|수입|달러|환율|환전|trade|dollar/,energy:/에너지|원자재|원유|유가|wti|oil|commodit/,fiscal:/재정|국가부채|연방부채|정부부채|fiscal|governmentdebt/};
 const found=Object.entries(words).map(([t,re])=>({t,index:q.search(re)})).filter(x=>x.index>=0).sort((a,b)=>a.index-b.index).map(x=>x.t);
 const matches=catalog.flatMap(s=>[s.id,...s.aliases].map(a=>({id:s.id,alias:normalize(a)}))).filter(a=>q.includes(a.alias)).sort((a,b)=>b.alias.length-a.alias.length);
 const explicit=[];let rest=q;for(const m of matches)if(rest.includes(m.alias)){if(!explicit.includes(m.id))explicit.push(m.id);rest=rest.replaceAll(m.alias,'');}
 for(const id of explicit)for(const t of catalog.find(s=>s.id===id).topics)if(!found.includes(t))found.push(t);
 const easing=/금리.*(내리|내릴|인하)|인하.*(판단|금리)|ratecut/.test(q),linked=[],connectionReasons={};
 const connect=(t,reason)=>{if(!found.includes(t)&&!linked.includes(t)){linked.push(t);connectionReasons[t]=reason;}};
 let scenario=null;
 if(/주식시장.*(부담|변화|위험)|stockmarket.*(risk|pressure)/.test(q)){scenario='market-pressure';found.splice(0,found.length,'rates','credit');connect('economy','성장 신호와 금융여건을 함께 확인');connect('inflation','물가 흐름을 추가로 확인');}
 else if(/침체|recession/.test(q)){scenario='recession';if(!found.includes('economy'))found.unshift('economy');connect('employment','성장 흐름과 고용의 동행 여부');connect('credit','실물 지표와 금융 스트레스 비교');connect('housing','주택 선행 신호 추가 확인');}
 else if(easing||(found.includes('inflation')&&found.includes('rates'))){scenario='inflation-rates';if(easing&&!found.includes('rates'))found.unshift('rates');connect('inflation','금리 판단에 참고하는 실제 물가');connect('employment','물가·금리와 함께 보는 노동시장');}
 else if(/경제전반|미국경제|전반적인경제|economyoverall/.test(q)){scenario='overview';connect('employment','성장과 노동시장 흐름 비교');connect('consumption','가계 지출·구매력 흐름 비교');connect('credit','금융여건 추가 확인');}
 else if(found.includes('economy')&&/둔화|약해|감속|줄|slow/.test(q)){scenario='slowdown';connect('employment','성장세와 고용 흐름 비교');connect('consumption','소비·소득 신호의 동행 여부');}
 else if(found.includes('consumption')&&/약해|줄|둔화|감소|소비/.test(q)){scenario='consumption';connect('employment','가계 구매력과 노동시장 흐름 비교');}
 else if(found.includes('housing')&&/약해|둔화|왜|하락/.test(q)){scenario='housing';connect('rates','주택 활동과 별도로 차입금리 확인');}
 const selectedTopic=topic==='fx'?'trade':topic;
 // A field-menu click is an explicit single-field exploration, not an unrelated query expansion.
 const browse=!!topics[selectedTopic];if(browse){found.splice(0,found.length,selectedTopic);linked.splice(0);}
 let intent=/언제|일정|발표일|schedule|release/.test(q)?'schedule':/비교|차이|compare/.test(q)?'compare':/왜|원인|이유|cause/.test(q)?'causes':/다시|추세|오르|내리|둔화|약해|줄|감소|변화|trend/.test(q)?'trend':'status';if(easing)intent='policy';
 const allTopics=[...new Set([...found,...linked])],activeTopics=allTopics.slice(0,selectionConfig.maxFields);
 const duration=q.match(/(\d{1,2})(년|year)/),months=q.match(/(\d{1,2})(개월|달|month)/),yearCount=Math.min(10,Math.max(1,Number(duration?.[1])||(months?Number(months[1])/12:0)||Number(years)||2));
 const resolvedRegion=['US','KR'].includes(detected)?detected:['US','KR'].includes(region)?region:detected;
 return {question,region:resolvedRegion,detectedRegion:detected,topics:activeTopics,directTopics:found,connectedTopics:linked,allTopics,omittedTopics:allTopics.slice(selectionConfig.maxFields),connectionReasons,scenario,browse,intent,explicit:browse?explicit.filter(id=>catalog.find(s=>s.id===id).topics.includes(selectedTopic)):explicit,comparisonTargets:explicit,years:yearCount,contextYears:yearCount>=10?10:5,periodLabel:`최근 ${yearCount}년`,needsRegion:resolvedRegion==='unclear'||resolvedRegion==='mixed',needsTopic:!allTopics.length,easing};
}
export function candidatesFor(a){return catalog.filter(s=>s.region===a.region&&s.topics.some(t=>a.topics.includes(t)));}
export function verifyMetadata(def,m,tags,{approved=false}={}){
 if(!m||m.id!==def.id||m.frequency_short!==def.frequency||m.seasonal_adjustment_short!==def.seasonal||!String(m.units).startsWith(def.unitsPrefix)||!/\d{4}-\d{2}-\d{2}/.test(m.last_updated||''))throw new Error('METADATA_MISMATCH');
 if(/discontinued/i.test(m.title||''))throw new Error('DISCONTINUED');
 const tagNames=(tags||[]).map(t=>t.name),tag=tagNames.find(t=>/^public domain:|^copyrighted:/.test(t));
 if(tags&&(!tag||!['public domain: citation requested','copyrighted: citation required'].includes(tag)&&!(approved&&tag==='copyrighted: pre-approval required')))throw new Error('USAGE_UNVERIFIED');
 const sources=(tags||[]).filter(t=>(t.group_id||t.group)==='src').map(t=>sourceNames[t.name]||t.name);
 return {id:m.id,title:m.title,units:m.units,frequency:m.frequency,frequencyShort:m.frequency_short,seasonal:m.seasonal_adjustment,seasonalShort:m.seasonal_adjustment_short,lastUpdated:m.last_updated,popularity:Number.isFinite(m.popularity)?m.popularity:0,observationStart:m.observation_start,observationEnd:m.observation_end,notes:m.notes||'',sources,usage:{tag:tag||'unverified',verified:!!tag,label:approved&&tag==='copyrighted: pre-approval required'?'사전 승인 자료 · 출처 표시':tag==='copyrighted: citation required'?'저작권 자료 · 출처 표시 필수':tag==='public domain: citation requested'?'공공 영역 자료 · 출처 표시':'이용 조건 미확인',url:'https://fred.stlouisfed.org/legal/'}};
}
const shiftedMonth=(date,n)=>{const d=new Date(date+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+n);return d.toISOString().slice(0,10);};
export function observationAge(def,date,now){
 const d=new Date(date+'T00:00:00Z');
 if(def.frequency==='M'||def.frequency==='Q'){d.setUTCMonth(d.getUTCMonth()+(def.frequency==='Q'?3:1),0);}
 return Math.max(0,(now-d.getTime())/86400000);
}
export function transformObservations(def,observations,{years=2,now=Date.now()}={}){
 const end=new Date(now).toISOString().slice(0,10),start=new Date(now);if(years!=='all')start.setUTCFullYear(start.getUTCFullYear()-Math.ceil(years));
 const raw=observations.filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&x.date<=end).map(x=>({date:x.date,value:x.value==='.'||x.value===null||String(x.value).trim()===''?null:Number(x.value),realtimeStart:x.realtime_start,realtimeEnd:x.realtime_end})).sort((a,b)=>a.date.localeCompare(b.date));
 const map=new Map(raw.map(x=>[x.date,x.value]));
 const transform=(p,type)=>{if(!Number.isFinite(p.value))return null;if(type==='level')return p.value;const prior=map.get(shiftedMonth(p.date,type==='yoy'?-12:-1));return !Number.isFinite(prior)||(type!=='difference'&&prior===0)?null:type==='difference'?p.value-prior:(p.value/prior-1)*100;};
 const visible=years==='all'?raw:raw.filter(x=>x.date>=start.toISOString().slice(0,10));
 const history=visible.map(p=>({date:p.date,value:transform(p,def.transform)}));
 // Missing latest observations stay missing. Last valid point is labelled, never imputed.
 const valid=history.filter(p=>Number.isFinite(p.value)),latest=valid.at(-1)||null;
 const step=def.frequency==='M'?-1:def.frequency==='Q'?-3:null;
 // Daily market holidays are not a release; compare the preceding valid daily
 // observation within 10 days. Weekly gaps beyond 8 days stay unavailable.
 const before=latest?valid.filter(p=>p.date<latest.date).at(-1):null;
 const prev=latest?(step?history.find(p=>p.date===shiftedMonth(latest.date,step)):before&&(Date.parse(latest.date)-Date.parse(before.date))/86400000<=(def.frequency==='W'?8:10)?before:null):null;
 const previous=prev&&Number.isFinite(prev.value)?prev:null,delta=latest&&previous?latest.value-previous.value:null;
 const unit=def.transform==='yoy'||def.transform==='mom'?'%':def.displayUnit|| (def.id==='T10Y2Y'?'%p':def.unitsPrefix==='Percent'?'%':def.unitsPrefix==='Thousands of Persons'?'천 명':def.unitsPrefix==='Level in Thousands'?'천 건':def.unitsPrefix==='Number'?'건':def.unitsPrefix);
 const deltaUnit=unit==='%'||unit==='%p'||unit==='% GDP'?'%p':unit;
 const p=raw.find(x=>x.date===latest?.date);
 return {history,rawHistory:def.transform==='level'?undefined:visible.map(({date,value})=>({date,value})),comparisons:calendarChanges(def,raw),latest,previous,delta,deltaUnit,unit,rawLatest:p||null,missingCount:raw.filter(x=>!Number.isFinite(x.value)).length,latestReportedDate:raw.at(-1)?.date||null,latestMissing:!!raw.length&&!Number.isFinite(raw.at(-1).value),mom:def.frequency==='M'&&def.transform==='yoy'&&p?transform(p,'mom'):null,transformLabel:def.transform==='yoy'?'전년 동기 대비':def.transform==='difference'?'전월 대비 증감':'원자료',formula:def.transform==='yoy'?'(해당 기간 값 / 정확히 12개월 전 값 − 1) × 100':def.transform==='difference'?'이번 달 취업자 수 − 직전 달 취업자 수 (천 명)':'FRED 원자료 그대로',direction:delta===null?'비교 불가':Math.abs(delta)<.005?'유지':delta>0?'상승':'하락'};
}
export function selectIndicators(items,a,usage={counts:{},visitors:0},now=Date.now()){
 const config=selectionConfig,usageEnabled=usage.visitors>=config.minimumUsageVisitors,weights={...config.weights};if(!usageEnabled)delete weights.usage;const sum=Object.values(weights).reduce((x,y)=>x+y,0);Object.keys(weights).forEach(k=>weights[k]/=sum);
 const maxUsage=Math.max(1,...Object.values(usage.counts));
 const scored=items.filter(s=>s.topics.some(t=>a.topics.includes(t))).map(s=>{
  const explicit=a.explicit.includes(s.id),overlap=s.topics.filter(t=>a.topics.includes(t)).length;
  let relevance=explicit?1:Math.min(.95,(s.topics.some(t=>a.directTopics?.includes(t))?.68:.52)+.15*overlap);
  if(a.intent==='trend'&&['underlying','expectations'].includes(s.role))relevance=Math.min(1,relevance+.1);
  if(a.intent==='causes'&&s.role==='detail')relevance=Math.min(1,relevance+.1);
  const age=s.latest?observationAge(s,s.latest.date,now):Infinity,freshness=Math.max(0,1-age/s.maxAgeDays);
  const parts={relevance,representation:s.representation,popularity:Math.max(0,Math.min(100,s.metadata.popularity))/100,freshness,usage:(usage.counts[s.id]||0)/maxUsage};
  const score=Object.entries(weights).reduce((v,[k,w])=>v+parts[k]*w,0);
  return {...s,score,explicit,reason:explicit?'질문에서 직접 지정한 지표입니다.':`${s.topics.map(t=>topics[t]).join('·')} · ${roles[s.role]} 확인에 사용하는 지표입니다.`,scoreParts:parts};
 }).sort((x,y)=>Number(y.explicit)-Number(x.explicit)||y.score-x.score||x.id.localeCompare(y.id));
 const core=[],groups=new Set(),counts=new Map();
 const assigned=scored.map(s=>({...s,field:a.topics.find(t=>s.topics.includes(t))}));
 const add=s=>{if(!s||core.some(c=>c.id===s.id)||core.length>=config.maxCore)return false;if(groups.has(s.group)&&!s.explicit)return false;core.push(s);groups.add(s.group);counts.set(s.field,(counts.get(s.field)||0)+1);return true;};
 assigned.filter(s=>s.explicit).forEach(add);
 // Cover each selected field before spending remaining slots. INDPRO is one card,
 // even when economy and manufacturing are both in the question.
 for(const field of a.topics){if(!core.some(s=>s.field===field))add(assigned.find(s=>s.field===field&&s.latest&&!s.delayed&&s.role!=='detail'));}
 for(let round=0;round<config.maxCore;round++)for(const field of a.topics){
  if(core.length>=config.maxCore)break;
  const available=assigned.filter(s=>s.field===field&&!core.some(c=>c.id===s.id)&&!groups.has(s.group)).sort((x,y)=>Number(y.topics[0]===field)-Number(x.topics[0]===field)||(['underlying','leading','expectations','current','detail'].indexOf(x.role)-['underlying','leading','expectations','current','detail'].indexOf(y.role))||y.score-x.score);
  const rolesUsed=new Set(core.filter(s=>s.field===field).map(s=>s.role));
  const next=available.find(s=>s.latest&&!s.delayed&&!rolesUsed.has(s.role))||available.find(s=>s.latest&&!s.delayed)||available[0];add(next);
 }
 core.sort((x,y)=>Number(y.explicit)-Number(x.explicit)||(x.explicit&&y.explicit?a.explicit.indexOf(x.id)-a.explicit.indexOf(y.id):a.topics.indexOf(x.field)-a.topics.indexOf(y.field)));
 for(const s of [...core,...assigned])s.reason=s.explicit?'질문에서 직접 지정한 지표입니다.':`${topics[s.field]} · ${roles[s.role]} 확인${a.connectedTopics?.includes(s.field)?' — '+a.connectionReasons[s.field]:''}`;
 return {core,related:assigned.filter(s=>!core.some(c=>c.id===s.id)),weights,usageEnabled};
}

export function summaryFor(core,a){
 const real=core.filter(s=>s.latest);if(!real.length)return '확인된 관측값이 없어 현재 상태를 판단할 수 없습니다.';
 const facts=real.slice(0,a.easing?3:2).map(s=>{const date=s.frequency==='M'?s.latest.date.slice(0,7):s.frequency==='Q'?s.latest.date.slice(0,4)+'년 '+Math.ceil(Number(s.latest.date.slice(5,7))/3)+'분기':s.latest.date;return `${s.name} ${date} 기준 ${s.latest.value.toLocaleString('ko-KR',{maximumFractionDigits:2})}${s.unit}${s.delta===null?'':`, 직전 관측 대비 ${s.direction} (${s.delta>=0?'+':''}${s.delta.toLocaleString('ko-KR',{maximumFractionDigits:2})}${s.deltaUnit})`}`;}).join(' · ');
 return facts+(a.easing?' — 금리 결정의 예측이 아닌 판단 자료입니다.':a.intent==='causes'?' — 이 자료만으로 변화의 원인을 단정하지 않습니다.':'');
}
