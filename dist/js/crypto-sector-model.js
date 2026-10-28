const UNCLASSIFIED={id:'unclassified',name:'Unclassified',label:'미분류'};
export function cryptoSectors(items,period,method='equal'){
 const groups=new Map();for(const c of items){const p=c.primary||UNCLASSIFIED;if(!groups.has(p.id))groups.set(p.id,{...p,members:[]});groups.get(p.id).members.push(c);}
 return [...groups.values()].map(({members,...g})=>{const valid=members.filter(c=>Number.isFinite(c.returns?.[period])&&c.quoteVolume>0),capReady=valid.length>0&&valid.every(c=>c.marketCap>0&&!c.capStale),ready=method!=='cap'||capReady,total=valid.reduce((s,c)=>s+(c.marketCap||0),0),coins=ready?valid.map(c=>({...c,contribution:c.returns[period]*(method==='cap'?c.marketCap/total:1/valid.length)})):[];return {...g,count:coins.length,available:members.length,value:coins.length?coins.reduce((s,c)=>s+c.contribution,0):null,rising:coins.filter(c=>c.returns[period]>0).length,falling:coins.filter(c=>c.returns[period]<0).length,leaders:[...coins].sort((a,b)=>Math.abs(b.contribution)-Math.abs(a.contribution)).slice(0,3),reason:!ready?'동일 기준 시가총액 부족':!coins.length?'기간 데이터 준비 중':null};}).sort((a,b)=>(b.value??-Infinity)-(a.value??-Infinity));
}

