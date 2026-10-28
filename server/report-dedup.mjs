const normalize=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[\s_\-·.,()[\]]/g,'');
const validDay=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export function reportPublication(payload,filename){
 const f=payload.fields||{},name=String(filename||'').replace(/\.pdf$/i,'');
 const dates=[...name.matchAll(/(?:^|[^\d])((?:20)?\d{6})(?=$|[^\d])/g)].map(m=>{const d=m[1].length===6?'20'+m[1]:m[1];return d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8);}).filter(validDay);
 const date=validDay(f.issuedDate?.value)?f.issuedDate.value:new Set(dates).size===1?dates[0]:null;
 // Only an explicit broker token is accepted; upload dates are never issue dates.
 const brokers=[...name.matchAll(/(?:^|[\s_])([가-힣A-Za-z&]+증권)(?=$|[\s_])/g)].map(m=>m[1]);
 const broker=f.broker?.value||(new Set(brokers).size===1?brokers[0]:null);
 return {date,broker};
}
export function reportIdentity(row){
 const p=row.parsed||JSON.parse(row.payload),f=p.fields||{},a=p.attachment||{},keys=[];
 if(/^[a-f0-9]{64}\.pdf$/.test(a.key||''))keys.push('file:'+a.key);
 const {date,broker}=reportPublication(p,row.filename||a.filename),title=normalize(f.title?.value||row.title),stock=normalize(row.ticker||f.ticker?.value||f.stockName?.value);
 if(date&&broker&&title.length>=4&&(stock||row.effective_kind==='market'))keys.push('issue:'+JSON.stringify([title,normalize(broker),date,row.market,stock]));
 return keys;
}
export function uniqueReports(rows){
 const parents=rows.map((_,i)=>i),byKey=new Map();
 const find=i=>parents[i]===i?i:(parents[i]=find(parents[i]));
 rows.forEach((row,i)=>{row.parsed=JSON.parse(row.payload);for(const key of reportIdentity(row)){if(byKey.has(key))parents[find(i)]=find(byKey.get(key));else byKey.set(key,i);}});
 const groups=new Map();rows.forEach((r,i)=>{const key=find(i);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);});
 // Preserve every source message in storage, expose one usable representative.
 const priority=r=>(r.manual_kind?1000:0)+(r.parsed.attachment?.status==='ready'?100:0)+Object.values(r.parsed.fields||{}).filter(f=>f?.value!=null).length;
 return [...groups.values()].map(group=>({...group.sort((a,b)=>priority(b)-priority(a)||b.posted_at.localeCompare(a.posted_at)||b.id.localeCompare(a.id))[0],duplicateSources:group.map(r=>({id:r.id,name:r.channel_username,url:r.source_url}))})).sort((a,b)=>b.posted_at.localeCompare(a.posted_at)||Number(b.message_id)-Number(a.message_id));
}
