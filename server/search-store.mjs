export async function recordSearch(db,event,now=Date.now()){
 const sessionHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(event.session)))).map(v=>v.toString(16).padStart(2,'0')).join('');
 const result=await db.prepare('INSERT OR IGNORE INTO search_events (id,stock_id,name,ticker,market,session_hash,minute_bucket,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),event.id,event.name,event.ticker,event.market,sessionHash,Math.floor(now/60000),now).run();
 return {recorded:(result.meta?.changes??0)>0};
}
export async function searchRanking(db,market,now=Date.now()){
 const start=now-24*60*60*1000;
 const query=market==='all'?'SELECT stock_id AS id,name,ticker,market,COUNT(*) AS searchCount FROM search_events WHERE created_at>=? AND created_at<=? GROUP BY stock_id,name,ticker,market ORDER BY searchCount DESC, MAX(created_at) DESC,stock_id ASC LIMIT 100':'SELECT stock_id AS id,name,ticker,market,COUNT(*) AS searchCount FROM search_events WHERE created_at>=? AND created_at<=? AND market=? GROUP BY stock_id,name,ticker,market ORDER BY searchCount DESC, MAX(created_at) DESC,stock_id ASC LIMIT 100';
 const statement=db.prepare(query),result=await (market==='all'?statement.bind(start,now):statement.bind(start,now,market)).all();
 return {status:result.results.length?'ready':'empty',items:result.results,asOf:new Date(now).toISOString(),periodStart:new Date(start).toISOString(),periodEnd:new Date(now).toISOString(),method:'최근 24시간 · 검색 결과 선택 기준 · 동일 세션/종목 1분 내 중복 제외',source:'MOA 검색 이벤트',mode:'realtime'};
}
