import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {DatabaseSync} from 'node:sqlite';
import {detectEarningsFlow} from '../server/earnings-flow.mjs';
import {standaloneQuarters} from '../server/quarter-normalization.mjs';
import {saveEarningsFlow} from '../server/earnings-flow-api.mjs';
import {d1Adapter} from '../server/sqlite-adapter.mjs';
import {processNotifications} from '../server/notification-events.mjs';
import {notificationApi} from '../server/notifications-api.mjs';
function sample(n=16){return {status:'ready',profile:{sector:'Technology',name:'검증기업'},quarterly:Array.from({length:n},(_,i)=>{const year=2022+Math.floor(i/4),month=i%4*3,start=new Date(Date.UTC(year,month,1)).toISOString().slice(0,10),end=new Date(Date.UTC(year,month+3,0)).toISOString().slice(0,10),revenue=100+(i>=10?(i-9)**2*5:0),oi=i<10?-10:(i-9)*3,cf=i<10?-5:(i-9)*12;const values={};for(const [key,value] of Object.entries({revenue,operatingIncome:oi,eps:oi/10,operatingCashFlow:cf,freeCashFlow:cf-5}))values[key]={value,start,end,unit:key==='eps'?'KRW/shares':'KRW',tag:key,basis:'CFS',accession:'receipt'+i,filedAt:new Date(Date.UTC(year,month+4,15)).toISOString().slice(0,10),url:'https://dart.fss.or.kr/example/'+i,source:'OpenDART'};return {end,label:`FY ${year} Q${i%4+1}`,values};})};}
const at=d=>Date.parse(d+'T12:00:00Z');
test('loss transition has no fabricated growth rate; independent signals need 12 quarters and sustained breadth',()=>{
 const d=sample(13),f=detectEarningsFlow(d,{now:at('2025-05-30')});assert.equal(f.state,'confirmed');assert.equal(f.points.at(-1).metrics.operatingIncome.yoy,null);assert.equal(f.points.at(-1).profit,'흑자 전환');assert.ok(f.reasons.some(r=>r.includes('영업현금흐름')));
 assert.equal(detectEarningsFlow(sample(11),{now:at('2024-12-30')}).state,'hold');
 const missing=sample(13);missing.quarterly.splice(8,1);assert.match(detectEarningsFlow(missing,{now:at('2025-05-30')}).reason,/분기 실적이 부족/);
 const bad=sample(14);bad.quarterly.at(-1).values.operatingIncome.value=-50;bad.quarterly.at(-1).values.operatingCashFlow.value=-70;bad.quarterly.at(-1).values.freeCashFlow.value=-90;
 assert.equal(detectEarningsFlow(bad,{now:at('2025-08-30')}).state,'slowing');
});
test('revenue alone, financial issuers, missing cash and exceptional disclosures cannot confirm recovery',()=>{
 const d=sample(13);for(const p of d.quarterly.slice(-2))for(const k of ['operatingCashFlow','freeCashFlow'])delete p.values[k];assert.equal(detectEarningsFlow(d,{now:at('2025-05-30')}).state,'early');
 for(const mutate of [d=>d.profile.sector='Financial',d=>d.quarterly.at(-1).risks=['일회성 이익 확인 필요'],d=>d.quarterly.at(-1).values.revenue.revised=true,d=>d.quarterly.at(-1).values.operatingIncome.basis='OFS']){const x=sample(13);mutate(x);assert.equal(detectEarningsFlow(x,{now:at('2025-05-30')}).state,'hold');}
 const x=sample(13);for(const q of x.quarterly){q.values.operatingIncome.value=-q.values.revenue.value*.1;q.values.operatingCashFlow.value=-q.values.revenue.value*.2;q.values.freeCashFlow.value=-q.values.revenue.value*.3;}assert.equal(detectEarningsFlow(x,{now:at('2025-05-30')}).state,'worsening');
});
test('cumulative cash/Q4 subtraction tracks both filings, never subtracts EPS, incompatible basis or revisions',()=>{
 const p={start:'2025-01-01',end:'2025-06-30',value:80,unit:'USD',tag:'CF',basis:'CFS',filedAt:'2025-08-01',accession:'a',url:'https://www.sec.gov/a'},q={...p,end:'2025-09-30',value:110,filedAt:'2025-11-01',accession:'b'};
 const r=standaloneQuarters([p,q]);assert.equal(r.length,1);assert.equal(r[0].start,'2025-07-01');assert.equal(r[0].value,30);assert.equal(r[0].inputs.length,2);
 assert.equal(standaloneQuarters([p,q],{additive:false}).length,0);assert.equal(standaloneQuarters([p,{...q,basis:'OFS'}]).length,0);
 assert.equal(standaloneQuarters([p,{...p,value:90,filedAt:'2025-09-01',accession:'a2'},q]).length,0);
});
test('a single new improvement is early, low base/revised filings hold, stale input never confirms',()=>{
 const d=sample(13);for(const q of d.quarterly.slice(0,-1)){q.values.revenue.value=100;q.values.operatingIncome.value=-10;q.values.operatingCashFlow.value=-5;q.values.freeCashFlow.value=-10;}
 assert.equal(detectEarningsFlow(d,{now:at('2025-05-30')}).state,'early');
 const low=sample(13);low.quarterly[8].values.revenue.value=1;assert.match(detectEarningsFlow(low,{now:at('2025-05-30')}).reason,/기저/);
 assert.equal(detectEarningsFlow({...sample(13),stale:true},{now:at('2025-05-30')}).state,'hold');
 assert.match(detectEarningsFlow(sample(13),{now:at('2025-05-30'),filings:[{id:'receipt12',title:'[기재정정] 분기보고서'}]}).reason,/확인 필요/);
});
test('financial snapshots remain stored without automated assessment alerts',async()=>{
 const sqlite=new DatabaseSync(':memory:');for(const file of ['0005_fluffy_george_stacy.sql','0006_dapper_wolfsbane.sql','0012_research.sql','0030_sec_filings.sql','0031_filing_sources.sql','0037_dart_filings.sql','0038_watch_notifications.sql','0039_earnings_flow.sql'])sqlite.exec(fs.readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const env={DB:d1Adapter(sqlite),LOCAL_PREVIEW:true},key='KR:005930',first='2025-05-30T10:00:00Z',next='2025-08-20T10:00:00Z';
 sqlite.prepare('INSERT INTO earnings_flow_targets(security_key,created_at) VALUES(?,?)').run(key,first);
 await saveEarningsFlow(env,key,sample(13),[],{now:first});assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM earnings_flow_events').get().n,0);
 await saveEarningsFlow(env,key,sample(13),[],{now:first});assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM earnings_flow_events').get().n,0);
 const d=sample(14);d.quarterly.at(-1).values.operatingIncome.value=-50;d.quarterly.at(-1).values.operatingCashFlow.value=-70;d.quarterly.at(-1).values.freeCashFlow.value=-90;
 const filing={id:'receipt13',title:'반기보고서',publishedDate:'2025-08-15',collectedAt:'2025-08-16T10:00:00Z'};
 await saveEarningsFlow(env,key,d,[filing],{now:next});await saveEarningsFlow(env,key,d,[filing],{now:next});assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM earnings_flow_events').get().n,0);
 sqlite.prepare('INSERT INTO notification_settings(user_id,updated_at) VALUES(?,?)').run('user',first);sqlite.prepare('INSERT INTO notification_watches(user_id,security_key,created_at) VALUES(?,?,?)').run('user',key,first);
 assert.equal((await processNotifications(env,{now:next})).created,0);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM user_notifications').get().n,0);
 sqlite.close();
});
test('late/recalculated prior filings and version changes are silent; stale data cannot consume a new receipt',async()=>{
 const sqlite=new DatabaseSync(':memory:');for(const file of ['0005_fluffy_george_stacy.sql','0006_dapper_wolfsbane.sql','0012_research.sql','0030_sec_filings.sql','0031_filing_sources.sql','0037_dart_filings.sql','0038_watch_notifications.sql','0039_earnings_flow.sql'])sqlite.exec(fs.readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const env={DB:d1Adapter(sqlite)},key='KR:005930',first='2025-05-30T10:00:00Z';sqlite.prepare('INSERT INTO earnings_flow_targets(security_key,created_at) VALUES(?,?)').run(key,first);
 await saveEarningsFlow(env,key,sample(13),[],{now:first});
 const changed=sample(13);for(const p of Object.values(changed.quarterly.at(-1).values)){p.accession='correction';p.filedAt='2025-06-10';p.revised=true;}
 const f={id:'correction',title:'[기재정정] 분기보고서',publishedDate:'2025-06-10',collectedAt:'2025-06-11T10:00:00Z'};
 await saveEarningsFlow(env,key,{...changed,stale:true},[f],{now:'2025-06-12T10:00:00Z'});assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM earnings_flow_evaluations WHERE accession='correction'").get().n,0);
 await saveEarningsFlow(env,key,changed,[f],{now:'2025-06-13T10:00:00Z'});assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM earnings_flow_events').get().n,0);
 const d=sample(14);sqlite.prepare("UPDATE earnings_flow_targets SET last_version='old-version'").run();await saveEarningsFlow(env,key,d,[{id:'receipt13',publishedDate:'2025-08-15',collectedAt:'2025-08-16T10:00:00Z'}],{now:'2025-08-20T10:00:00Z'});assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM earnings_flow_events').get().n,0);
 sqlite.close();
});


 test('configuration and numeric comparisons are saved, missing quarters hide collapsed evidence',async()=>{
 const {default:config}=await import('../config/earnings-flow.json',{with:{type:'json'}});
 const {renderEarningsFlow}=await import('../dist/js/earnings-flow.js');
 const f=detectEarningsFlow(sample(13),{now:at('2025-05-30')});
 assert.deepEqual(f.config,config);assert.equal(f.evidence[0].previous,f.points.at(-2).revenueYoy);
 assert.equal(f.evidence[1].previous,f.points.at(-1).yearAgoMargin);
 assert.ok(f.sources.some(s=>s.accession==='receipt8'));
 const html=renderEarningsFlow({flow:f});const summary=html.split('</summary>')[0];
 assert.equal((summary.match(/title=/g)||[]).length,2);assert.ok(!summary.includes('<svg'));
 const short=detectEarningsFlow(sample(4),{now:at('2024-03-01')});
 assert.ok(!renderEarningsFlow({flow:short}).split('</summary>')[0].includes('earnings-flow-facts'));
 });
 test('persistent independent domains confirm deterioration; profit and margin alone do not confirm recovery',()=>{
 const d=sample(14);for(const q of d.quarterly){q.values.revenue.value=100;q.values.operatingIncome.value=5;q.values.operatingCashFlow.value=10;q.values.freeCashFlow.value=5;}
 for(const q of d.quarterly.slice(-2)){q.values.operatingIncome.value=8;}
 assert.equal(detectEarningsFlow(d,{now:at('2025-08-30')}).state,'early');
 for(const q of d.quarterly.slice(-2)){q.values.operatingIncome.value=1;q.values.operatingCashFlow.value=1;}
 assert.equal(detectEarningsFlow(d,{now:at('2025-08-30')}).state,'worsening');
 });

test('financial trend UI excludes assessments, interpretation and state-colored points',async()=>{
 const {renderEarningsFlow}=await import('../dist/js/earnings-flow.js');
 const flow=detectEarningsFlow(sample(13),{now:at('2025-05-30')});
 const html=renderEarningsFlow({flow},true);
 assert.doesNotMatch(html,/회복|둔화|악화|판정|조짐|흑자 전환|적자 축소|일회성/);
 assert.match(html,/매출 YoY/);assert.match(html,/영업이익률/);assert.match(html,/공시 원문/);
 assert.doesNotMatch(renderEarningsFlow({status:'unavailable',message:'판정 보류'}),/판정/);
});
