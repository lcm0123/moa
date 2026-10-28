import {rows,dartDay,dartFrom,validDate,dartTypes,filingGroup,dartUrl} from './dart-filings.mjs';
import {readerSession,applyReadState} from './research-events.mjs';
const json=(d,status=200,h={})=>new Response(JSON.stringify(d),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',...h}});
const errorText={DART_BATCH_LIMIT:'공시 조회 범위가 큽니다. 기간을 줄여 다시 조회해 주세요.',DART_MAPPING_ERROR:'종목코드와 DART 기업 고유번호 매핑 오류',DART_IDENTITY_MISMATCH:'DART 기업 식별자 불일치',DART_KEY_MISSING:'OPENDART_API_KEY 서버 설정 필요',DART_TYPE_LOOKUP_FAILED:'공시 목록은 수집했으나 일부 유형 확인이 지연되고 있습니다.',DART_MAPPING_STALE:'기업 매핑 갱신 지연 · 마지막 확인한 매핑 사용'};
export async function dartFilingsApi(request,env){
 const url=new URL(request.url),p=url.searchParams,db=env.DB;
 if(!db)return json({status:'error',message:'공시 저장소 연결 필요',items:[]},503);
 try{
  if(url.pathname.endsWith('/subscriptions')){
   if(request.method!=='POST')return json({message:'Method not allowed'},405);
   if(request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.startsWith('application/json'))return json({message:'잘못된 요청'},403);
   const text=await request.text();if(text.length>4096)return json({message:'요청 범위 초과'},413);
   const {tickers}=JSON.parse(text);if(!Array.isArray(tickers)||tickers.length>100||tickers.some(t=>!/^\d{6}$/.test(t)))return json({message:'종목코드 오류'},400);
   const reader=await readerSession(request),unique=[...new Set(tickers)],now=new Date().toISOString();
   const old=await rows(db,'SELECT ticker FROM dart_subscriptions WHERE reader_hash=?',[reader.hash]);
   const ops=old.filter(s=>!unique.includes(s.ticker)).map(s=>db.prepare('DELETE FROM dart_subscriptions WHERE reader_hash=? AND ticker=?').bind(reader.hash,s.ticker));
   for(const ticker of unique)ops.push(db.prepare('INSERT OR IGNORE INTO dart_subscriptions(reader_hash,ticker,created_at,start_date) VALUES(?,?,?,?)').bind(reader.hash,ticker,now,dartDay()));
   if(ops.length)await db.batch(ops);
   // Saving a watch subscription does not create a collection range or wake a worker.
   return json({status:'saved',count:unique.length},200,reader.headers);
  }
  if(request.method!=='GET')return json({message:'Method not allowed'},405);
  if(url.pathname.endsWith('/notifications')){
   const reader=await readerSession(request);
   const data=await rows(db,`SELECT e.*,f.corp_name FROM dart_subscriptions s JOIN dart_filings f ON f.ticker=s.ticker JOIN research_events e ON e.id=f.event_id WHERE s.reader_hash=? AND s.baseline_receipt IS NOT NULL AND f.first_seen_at>s.baseline_at AND f.received_date>=s.start_date AND f.first_seen_at>=s.created_at AND e.merged_into IS NULL ORDER BY f.received_date DESC,f.receipt DESC LIMIT 100`,[reader.hash]);
   const events=data.map(e=>({...JSON.parse(e.payload),companyName:e.corp_name,eventId:e.id,eventRevision:1}));
   const status=await rows(db,'SELECT s.ticker,s.baseline_receipt,t.error,(SELECT error FROM dart_ranges r WHERE r.ticker=s.ticker AND r.is_live=1 ORDER BY date_to DESC LIMIT 1) AS sync_error FROM dart_subscriptions s LEFT JOIN dart_targets t ON s.ticker=t.ticker WHERE s.reader_hash=?',[reader.hash]);
   return json({items:await applyReadState(db,events,reader.hash),coverage:status.map(s=>({ticker:s.ticker,pending:s.baseline_receipt===null,error:s.error||s.sync_error||null})),scope:'이 브라우저의 관심종목',keyConfigured:!!env.OPENDART_API_KEY},200,reader.headers);
  }
  const ticker=p.get('ticker'),from=p.get('from')||dartFrom(),to=p.get('to')||dartDay(),group=p.get('group')||'all',page=Number(p.get('page')||1),receipt=p.get('receipt');
  if(!/^\d{6}$/.test(ticker||'')||!validDate(from)||!validDate(to)||from>to||to>dartDay()||Date.parse(to)-Date.parse(from)>366*5*86400000||!['all','major','regular','ownership','other'].includes(group)||!Number.isInteger(page)||page<1||page>10000||receipt&&!/^\d{14}$/.test(receipt))return json({message:'종목·기간·페이지를 확인해 주세요. 기간은 최대 5년입니다.'},400);
  const target=(await rows(db,'SELECT * FROM dart_targets WHERE ticker=?',[ticker]))[0]||{},range=(await rows(db,'SELECT * FROM dart_ranges WHERE ticker=? AND date_from<=? AND date_to>=? ORDER BY synced_at DESC LIMIT 1',[ticker,from,to]))[0]||{};
  const saved=await rows(db,'SELECT * FROM dart_filings WHERE ticker=? AND '+(receipt?'receipt=?':'received_date>=? AND received_date<=?')+' ORDER BY received_date DESC,receipt DESC',receipt?[ticker,receipt]:[ticker,from,to]);
  const filtered=saved.filter(f=>group==='all'||filingGroup(f)===group),items=filtered.slice((page-1)*30,page*30).map(f=>({...f,badges:JSON.parse(f.badges),raw:undefined,event_id:undefined,group:filingGroup(f),typeLabel:dartTypes[f.filing_type]||'유형 확인 중',url:dartUrl(f.receipt)}));
  const code=target.error||range.error;
  const mappingError=code?.includes('MAPPING_ERROR')||code?.includes('IDENTITY');
  return json({status:mappingError?'mapping_error':code?(saved.length?'stale':'error'):filtered.length?'ready':!range.synced_at?'not_collected':'empty',message:code?errorText[code]||'OpenDART 연결 오류 · 마지막 저장 목록 표시':!range.synced_at?'선택한 기간의 수집 완료 기록이 없습니다. 저장된 목록만 표시합니다.':!filtered.length?'선택한 기간·유형의 공시가 없습니다.':null,items,total:filtered.length,page,pages:Math.max(1,Math.ceil(filtered.length/30)),from,to,corpCode:target.corp_code,name:target.name,mappingAt:target.mapping_at,syncedAt:range.synced_at||null,source:'OpenDART',collectionMode:'stored',intervalSeconds:null});
 }catch{return json({status:'error',message:'공시 조회 처리 오류',items:[]},500);}
}
