import test from 'node:test';
import assert from 'node:assert/strict';
import {revenueCompositionModel,revenueCompositionMarkup} from '../dist/js/revenue-composition.js';
import {businessProfileMarkup,cleanBusinessProfileSelection} from '../dist/js/business-profile.js';

const period={start:'2026-01-01',end:'2026-06-30',type:'HALF_YEAR',label:'2026년 반기 누적'};
const row=(label,percent,extra={})=>({id:label,businessItemId:label,label,percent,amountExact:percent===null?null:String(percent),verificationStatus:'VERIFIED',dimension:'PRODUCT',issuer:'KR:fixture',period,scope:'CONSOLIDATED',currency:'KRW',unit:'천원',denominatorKind:'COMPANY_TOTAL_REVENUE',denominatorLabel:'전체 매출',revenueDefinition:'EXTERNAL_CUSTOMER',totalRevenueExact:'100',valueOrigin:'DISCLOSED',basis:'DISCLOSED',sourceUrl:'https://example.org/filing',quote:label+' actual disclosure',locator:'stored:table:1:'+label,...extra});
const dataset=items=>({key:'table',period,scope:'CONSOLIDATED',sourceUrl:'https://example.org/filing',sourceTitle:'원문 사업보고서',publishedAt:'2026-08-14',items});
const profile=ds=>({groups:{PRODUCT:{status:'PARTIAL',datasets:[ds]}},descriptions:[],calculations:{quarters:[],ttm:[],changes:[],issues:[]}});
const closedDataset=()=>({...dataset([row('표 항목 A',62.5,{amountExact:'625',calculatedShare:62.5}),row('표 항목 B',37.5,{amountExact:'375',calculatedShare:37.5})]),scope:'UNSPECIFIED',items:[row('표 항목 A',62.5,{amountExact:'625',calculatedShare:62.5}),row('표 항목 B',37.5,{amountExact:'375',calculatedShare:37.5})].map(r=>({...r,scope:'UNSPECIFIED',sourceId:'verified-source',tableKey:'table',entityScope:r.issuer,denominatorKind:'DISCLOSED_TABLE_TOTAL',denominatorLabel:'해당 공시 매출표 합계',revenueDefinition:'DISCLOSED_OPERATING_TABLE',totalRevenueExact:'1000',shareOrigin:'DERIVED',comparabilityReview:true,scopeNotes:['해당 표의 일부 과거 항목에는 범위 주석이 있습니다.'],headerEvidence:{closedTable:true,tableTotal:'1000',sumOfRows:'1000',roundingDifference:'0'}}))});
const disclosedClosedDataset=()=>{const d=closedDataset();d.items=d.items.map(r=>({...r,shareOrigin:'DISCLOSED',reportedShare:r.percent,calculatedShare:null,quote:r.label+' '+r.amountExact+'('+r.percent+'%)'}));return d;};
function signedDataset(amounts=['3334','3333','4333','-1000'],shares=[33.3,33.3,43.3,-10]){
 const net=amounts.reduce((s,n)=>s+BigInt(n),0n).toString(),gross=amounts.filter(n=>BigInt(n)>=0n).reduce((s,n)=>s+BigInt(n),0n).toString(),adjustment=amounts.filter(n=>BigInt(n)<0n).reduce((s,n)=>s+BigInt(n),0n).toString(),sumPercent=shares.reduce((s,n)=>s+n,0);
 return {...dataset(amounts.map((amount,i)=>row('공시 항목 '+i,shares[i],{amountExact:amount,reportedShare:shares[i],scope:'UNSPECIFIED',sourceId:'signed-source',tableKey:'signed-table',entityScope:'KR:fixture',denominatorKind:'DISCLOSED_TABLE_TOTAL',denominatorLabel:'공시 순매출 합계',revenueDefinition:'SEGMENT_WITH_INTERSEGMENT',totalRevenueExact:net,shareOrigin:'DISCLOSED',isAdjustment:BigInt(amount)<0n,adjustmentType:BigInt(amount)<0n?'INTERSEGMENT_ELIMINATION':null,comparabilityReview:true,headerEvidence:{closedTable:true,signedTable:true,netReconciled:true,tableTotal:net,sumOfRows:net,grossRevenue:gross,adjustmentAmount:adjustment,roundingDifference:'0',reportedShareTotal:100,sumReportedShares:sumPercent,shareRoundingDifference:sumPercent-100,percentDecimals:1,percentTolerance:.05+100/Number(net)}}))),key:'signed-table',scope:'UNSPECIFIED'};
}

test('verified net-revenue table uses signed linear bars and preserves rounded 99.9 total',()=>{
 const ds=signedDataset(),model=revenueCompositionModel(ds,'PRODUCT'),html=revenueCompositionMarkup(ds,'PRODUCT');assert.equal(model.drawable,true);assert.equal(model.chartType,'signedBar');assert.ok(Math.abs(model.total-99.9)<1e-8);assert.equal(model.adjustments[0].percent,-10);assert.match(html,/rc-signed-bars/);assert.match(html,/공시 비중 합계 99.9%/);assert.match(html,/-10%/);assert.doesNotMatch(html,/rc-donut|rc-unavailable/);assert.deepEqual(ds.items.map(r=>r.percent),[33.3,33.3,43.3,-10]);
 const card=businessProfileMarkup(profile(ds));assert.doesNotMatch(card,/<p class="bp-period">[^<]*연결/);assert.match(card,/공시 매출표 기준 · 연결·별도 미확인 · 공시 비중/);
});
test('signed table permits verified shares beyond 100 without clipping or renormalizing',()=>{
 for(const ds of [signedDataset(['1200','200','-400'],[120,20,-40]),signedDataset(['2500','-1500'],[250,-150])]){const m=revenueCompositionModel(ds,'PRODUCT'),html=revenueCompositionMarkup(ds,'PRODUCT');assert.equal(m.chartType,'signedBar');assert.deepEqual(m.barRows.map(r=>r.percent),ds.items.map(r=>r.percent));assert.match(html,new RegExp(ds.items[0].percent+'%'));assert.doesNotMatch(html,/rc-donut/);}
});
test('signed table fails closed on net/gross metadata, share precision, source or adjustment tampering',()=>{
 const changes=[{sourceId:'different'},{tableKey:'different'},{period:{...period,end:'2025-12-31'}},{amountExact:'3330'},{percent:30,reportedShare:30},{shareOrigin:'DERIVED'},{reportedShare:33.1},{headerEvidence:{netReconciled:false}},{headerEvidence:{grossRevenue:'10999'}},{headerEvidence:{adjustmentAmount:'-999'}},{headerEvidence:{percentTolerance:100}},{headerEvidence:{sumReportedShares:100}},{headerEvidence:{shareRoundingDifference:0}},{headerEvidence:{reportedShareTotal:99.9}}];
 for(const change of changes){const ds=signedDataset();if(change.headerEvidence)ds.items[0].headerEvidence={...ds.items[0].headerEvidence,...change.headerEvidence};else Object.assign(ds.items[0],change);assert.equal(revenueCompositionModel(ds,'PRODUCT').drawable,false,JSON.stringify(change));}
 const unmarked=signedDataset();unmarked.items.at(-1).isAdjustment=false;assert.equal(revenueCompositionModel(unmarked,'PRODUCT').drawable,false);const missing=signedDataset();missing.items.pop();assert.equal(revenueCompositionModel(missing,'PRODUCT').drawable,false);
});

test('verified closed operating table draws its own composition with scope caveat, not consolidated share',()=>{
 const ds=closedDataset(),model=revenueCompositionModel(ds,'PRODUCT'),html=revenueCompositionMarkup(ds,'PRODUCT');assert.equal(model.drawable,true);assert.equal(model.tableOnly,true);assert.equal(model.total,100);assert.equal(ds.scope,'UNSPECIFIED');assert.match(html,/공시 매출표 구성/);assert.match(html,/연결·별도 미확인/);assert.match(html,/회사 전체 연결 매출 비중이나 기간 간 비교로 해석하지 않습니다/);assert.match(html,/범위 주석/);assert.match(html,/stroke-dasharray="62.5 37.5"/);
});

test('closed same-table disclosed shares require source amount(percent) evidence and retain disclosed labeling',()=>{
 const ds=disclosedClosedDataset(),m=revenueCompositionModel(ds,'PRODUCT'),html=revenueCompositionMarkup(ds,'PRODUCT');assert.equal(m.drawable,true);assert.equal(m.tableShareOrigin,'DISCLOSED');assert.equal(m.total,100);assert.match(html,/공시 매출표 기준 · 연결·별도 미확인 · 공시 비중/);assert.match(html,/대조한 공시 비중/);assert.doesNotMatch(html,/계산 비중/);assert.deepEqual(ds.items.map(r=>r.percent),[62.5,37.5]);
});

test('disclosed unknown-scope exception rejects missing rows, mismatched source evidence and metadata tampering',()=>{
 const changes=[{sourceId:'other-source'},{sourceUrl:'https://example.org/other'},{tableKey:'other-table'},{quote:'표 항목 B 374(37.5%)'},{quote:'표 항목 B -375(37.5%)'},{quote:'표 항목 B 375(37.4%)'},{quote:'37.5% historical; latest amount 375, current percentage missing'},{reportedShare:37.4},{percent:37.2,reportedShare:37.2,quote:'표 항목 B 375(37.2%)'},{calculatedShare:37.5},{shareOrigin:'DERIVED'},{headerEvidence:{closedTable:false,tableTotal:'1000',sumOfRows:'1000',roundingDifference:'0'}},{headerEvidence:{closedTable:true,tableTotal:'1000',sumOfRows:'999',roundingDifference:'-1'}}];
 for(const change of changes){const ds=disclosedClosedDataset();Object.assign(ds.items[1],change);assert.equal(revenueCompositionModel(ds,'PRODUCT').drawable,false,JSON.stringify(change));}
 const key=disclosedClosedDataset();key.key='other';assert.equal(revenueCompositionModel(key,'PRODUCT').drawable,false);const missing=disclosedClosedDataset();missing.items.pop();assert.equal(revenueCompositionModel(missing,'PRODUCT').drawable,false);
});

test('disclosed rounded sum above 100 stays withheld rather than being normalized',()=>{
 const ds=disclosedClosedDataset(),seed=ds.items[0];ds.items=['3335','3335','3330'].map((amount,i)=>({...seed,id:'r'+i,label:'r'+i,businessItemId:'r'+i,amountExact:amount,totalRevenueExact:'10000',percent:i<2?33.4:33.3,reportedShare:i<2?33.4:33.3,quote:'r'+i+' '+amount+'('+(i<2?'33.4':'33.3')+'%)',headerEvidence:{closedTable:true,tableTotal:'10000',sumOfRows:'10000',roundingDifference:'0'}}));
 const m=revenueCompositionModel(ds,'PRODUCT');assert.equal(m.drawable,false);assert.match(m.reason,/100\.1%/);assert.deepEqual(ds.items.map(r=>r.percent),[33.4,33.4,33.3]);
});
test('closed-table exception rejects source/table/period/amount/share/denominator substitutions and ordinary unknown scope',()=>{
 const changes=[{sourceId:'another-source'},{tableKey:'another-table'},{issuer:'another-issuer'},{unit:'USD'},{period:{...period,end:'2025-12-31'}},{totalRevenueExact:'1001'},{amountExact:'374'},{percent:37.4},{calculatedShare:37.4},{denominatorKind:'UNKNOWN'},{revenueDefinition:'DISCLOSED_OTHER'},{shareOrigin:null},{valueOrigin:'DERIVED'},{verificationStatus:'SUPPORTED'},{headerEvidence:{closedTable:false,tableTotal:'1000',sumOfRows:'1000',roundingDifference:'0'}},{headerEvidence:{closedTable:true,tableTotal:'1000',sumOfRows:'999',roundingDifference:'-1'}}];
 for(const change of changes){const ds=closedDataset();Object.assign(ds.items[1],change);assert.equal(revenueCompositionModel(ds,'PRODUCT').drawable,false,JSON.stringify(change));}
 const unknown=closedDataset();unknown.scope='UNKNOWN';unknown.items.forEach(r=>r.scope='UNKNOWN');assert.equal(revenueCompositionModel(unknown,'PRODUCT').drawable,false);const subset=closedDataset();subset.items.pop();assert.equal(revenueCompositionModel(subset,'PRODUCT').drawable,false);
});
test('closed-table amount verification retains exact large decimals without unsafe number summation',()=>{
 const ds=closedDataset();for(const [i,r] of ds.items.entries()){r.amountExact=i?'375000000000000000000000':'625000000000000000000000';r.totalRevenueExact='1000000000000000000000000';r.headerEvidence={closedTable:true,tableTotal:r.totalRevenueExact,sumOfRows:r.totalRevenueExact,roundingDifference:'0'};}
 assert.equal(revenueCompositionModel(ds,'PRODUCT').drawable,true);ds.items[1].amountExact='374999999999999999999999';assert.equal(revenueCompositionModel(ds,'PRODUCT').drawable,false);
});

test('disclosed 60+30 draws absolute arcs and an unknown 10 gap, never normalized shares',()=>{
 const ds=dataset([row('제품 A',60),row('제품 B',30)]),m=revenueCompositionModel(ds,'PRODUCT'),html=revenueCompositionMarkup(ds,'PRODUCT');
 assert.equal(m.drawable,true);assert.equal(m.total,90);assert.equal(m.gap,10);assert.match(html,/stroke-dasharray="60 40"/);assert.match(html,/미확인 구간 10%/);assert.doesNotMatch(html,/66\.67|33\.33|기타 10/);assert.equal(ds.items[0].percent,60);
});
test('unknown share remains missing and never becomes a zero-slice',()=>{
 const m=revenueCompositionModel(dataset([row('알려진 항목',60),row('비중 미공개 항목',null)]),'PRODUCT');assert.equal(m.drawable,true);assert.equal(m.gap,40);assert.equal(m.portions.length,1);
 const html=revenueCompositionMarkup(dataset([row('비중 미공개 항목',null)]),'PRODUCT');assert.match(html,/비중 미확인/);assert.doesNotMatch(html,/rc-donut|stroke-dasharray|0%/);
});
test('period, unit, issuer, denominator, scope and verification differences cannot form a donut',()=>{
 const cases=[{period:{...period,end:'2025-12-31'}},{unit:'USD million'},{issuer:'US:other'},{denominatorKind:'SEGMENT_REVENUE'},{dimension:'BUSINESS_SEGMENT'},{scope:'SEPARATE'},{verificationStatus:'SUPPORTED'},{valueOrigin:'ESTIMATED'},{comparabilityReview:true},{totalRevenueExact:'200'}];
 for(const change of cases)assert.equal(revenueCompositionModel(dataset([row('A',60),row('B',30,change)]),'PRODUCT').drawable,false,JSON.stringify(change));
 assert.equal(revenueCompositionModel({...dataset([row('A',60,{scope:'UNSPECIFIED'})]),scope:'UNSPECIFIED'},'PRODUCT').drawable,false);
 assert.equal(revenueCompositionModel(dataset([row('parent',60),row('child',30,{parent:'parent'})]),'PRODUCT').drawable,false);
});
test('negative elimination and above-100 total retain values but do not become a normalized donut',()=>{
 const ds=dataset([row('사업 A',85),row('사업 B',30),row('내부 거래 조정',-15)]),m=revenueCompositionModel(ds,'PRODUCT'),html=revenueCompositionMarkup(ds,'PRODUCT');assert.equal(m.drawable,false);assert.equal(m.adjustments[0].percent,-15);assert.match(html,/-15%/);assert.match(html,/음수·조정 항목/);assert.doesNotMatch(html,/rc-donut/);
 assert.equal(revenueCompositionModel(dataset([row('A',85),row('B',30)]),'PRODUCT').drawable,false);
});
test('one active dimension retains cumulative period, source locations and scope notes for every company',()=>{
 const ds=dataset([row('제품 A',60,{scopeNotes:['범위 검토 주석'],shareOrigin:'DERIVED'}),row('제품 B',30)]),data=profile(ds);data.groups.GEOGRAPHY={status:'PARTIAL',datasets:[dataset([row('지역 A',100,{dimension:'GEOGRAPHY'})])]};
 const html=businessProfileMarkup(data,{type:'YTD',dimension:'PRODUCT'});assert.equal((html.match(/class="bp-section"/g)||[]).length,1);assert.match(html,/2026년 반기 누적/);assert.match(html,/자료 기준 2026-06-30/);assert.match(html,/공시일 2026-08-14/);assert.match(html,/저장된 추출 위치/);assert.match(html,/범위 검토 주석/);assert.match(html,/비중은 공시 금액으로 계산/);assert.doesNotMatch(html,/삼성전자|FnGuide|지역 A/);
 const region=businessProfileMarkup(data,{dimension:'GEOGRAPHY'});assert.match(region,/지역 A/);assert.doesNotMatch(region,/제품 A actual/);
});
test('calculated items in one compatible period become one composition, not separate one-item cards',()=>{
 const data=profile(dataset([]));data.groups.PRODUCT.datasets=[];data.calculations.quarters=[row('A',60,{basis:'DERIVED',valueOrigin:'DERIVED',tableKey:'q2',period:{...period,start:'2026-04-01',type:'SINGLE_QUARTER'}}),row('B',30,{basis:'DERIVED',valueOrigin:'DERIVED',tableKey:'q2',period:{...period,start:'2026-04-01',type:'SINGLE_QUARTER'}})];const html=businessProfileMarkup(data,{type:'SINGLE_QUARTER'});assert.match(html,/stroke-dasharray="60 40"/);assert.match(html,/stroke-dasharray="30 70"/);assert.match(html,/미확인 구간 10%/);
});
test('latest available half-year opens before an older annual table unless a period was selected',()=>{
 const recent=dataset([row('최근 반기 제품',60)]),older={...dataset([row('전년 연간 제품',60)]),key:'old',period:{...period,start:'2025-01-01',end:'2025-12-31',type:'ANNUAL',label:'2025년 연간'}};const data=profile(recent);data.groups.PRODUCT.datasets=[older,recent];
 const latestHtml=businessProfileMarkup(data);assert.match(latestHtml,/최근 반기 제품/);assert.doesNotMatch(latestHtml,/전년 연간 제품/);const oldHtml=businessProfileMarkup(data,{PRODUCT:'old'});assert.match(oldHtml,/전년 연간 제품/);assert.doesNotMatch(oldHtml,/최근 반기 제품/);
});
test('shared legend is keyboard/click actionable, safely escaped, and state rejects unknown fields',()=>{
 const html=businessProfileMarkup(profile(dataset([row('<img src=x onerror=alert(1)>',60)])));assert.match(html,/data-bp-evidence-id/);assert.match(html,/aria-label="&lt;img/);assert.match(html,/tabindex="-1"/);assert.doesNotMatch(html,/<img src=/);
 assert.deepEqual(cleanBusinessProfileSelection({type:'YTD',dimension:'PRODUCT',PRODUCT:'table',privateSecret:'ignored',OTHER:'ignored'}),{type:'YTD',dimension:'PRODUCT',PRODUCT:'table'});assert.deepEqual(cleanBusinessProfileSelection({type:'invalid',dimension:'invalid',PRODUCT:'x'.repeat(1001)}),{});assert.deepEqual(cleanBusinessProfileSelection(null),{});
});
