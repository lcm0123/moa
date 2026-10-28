export function retainWatchQuotes(previous,items,keys){
 const next=new Map();
 for(const key of keys){const incoming=items.find(row=>row.key===key),old=previous.get(key);
  const identityOk=incoming&&(!incoming.market||incoming.market===key.slice(0,2))&&(!incoming.ticker||incoming.ticker===key.slice(3));
  const timestamp=row=>row?.baseDate?Date.parse(row.baseDate):row?.asOfKind!=='received'?Date.parse(row?.asOf):NaN;
  const older=Number.isFinite(timestamp(old))&&Number.isFinite(timestamp(incoming))&&timestamp(incoming)<timestamp(old);
  if(incoming?.status==='ready'&&Number.isFinite(incoming.price)&&identityOk)next.set(key,older?old:incoming);
  else if(incoming&&!identityOk)next.set(key,{key,market:key.slice(0,2),ticker:key.slice(3),status:'unavailable',reason:'종목 식별 정보 불일치'});
  else if(old?.status==='ready'&&incoming?.reason!=='시세 표시 권한 확인 필요')next.set(key,{...old,stale:true,reason:incoming?.reason||'시세 연결 오류'});
  else next.set(key,incoming||{key,market:key.slice(0,2),ticker:key.slice(3),status:'unavailable',reason:'시세 연결 오류'});
 }
 return next;
}
export function sortedWatchQuotes(keys,quotes,sort='manual'){
 const rows=keys.map(key=>quotes.get(key)||{key,market:key.slice(0,2),ticker:key.slice(3),status:'loading'});
 if(sort==='name')rows.sort((a,b)=>(a.name||a.ticker).localeCompare(b.name||b.ticker,'ko'));
 if(['gainers','losers'].includes(sort))rows.sort((a,b)=>(Number.isFinite(a.changePct)&&Number.isFinite(b.changePct)?(sort==='gainers'?-1:1)*(a.changePct-b.changePct):Number.isFinite(a.changePct)?-1:Number.isFinite(b.changePct)?1:0)||keys.indexOf(a.key)-keys.indexOf(b.key));
 return rows;
}
