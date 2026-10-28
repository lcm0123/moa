// Keep provider sector assignments. Industry names are never inferred from tickers.
export function industryHierarchy(sectors){
 const seen=new Set();
 return sectors.map(sector=>{
  const stocks=(sector.stocks||[]).filter(stock=>{const key=stock.market+':'+stock.id;if(seen.has(key))return false;seen.add(key);return true;}),groups=new Map();
  for(const stock of stocks){
   const industry=typeof stock.industryName==='string'&&stock.industryName.trim()?stock.industryName.trim():null;
   const id=JSON.stringify([sector.id,industry]);
   if(!groups.has(id))groups.set(id,{id,name:industry||'기타',sectorId:sector.id,sectorName:sector.name,missing:industry===null,marketCap:0,stocks:[]});
   const group=groups.get(id);group.stocks.push(stock);group.marketCap+=stock.marketCap;
  }
  return {...sector,stocks,marketCap:stocks.reduce((sum,s)=>sum+s.marketCap,0),industries:[...groups.values()]};
 }).filter(sector=>sector.stocks.length);
}
