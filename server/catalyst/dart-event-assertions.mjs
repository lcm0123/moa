import {clean,norm} from './core.mjs';
const nullable=s=>!s||/^[-–—]$/.test(s)?null:s;
// Production/backlog tables are retained as observations. Ambiguous merged
// headers or missing units/periods cannot become an event or revenue exposure.
export function dartOperationalTables(html,{heading='',sourceId=null}={}){
 if(!/생산설비|생산능력|수주상황/.test(heading))return [];
 const out=[];
 for(const [i,m]of [...String(html).matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].slice(0,12).entries()){
  const merged=/\b(?:rowspan|colspan)=["']?[2-9]/i.test(m[1]);
  const rows=[...m[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].slice(0,100).map(r=>[...r[1].matchAll(/<(?:td|th|te)\b[^>]*>([\s\S]*?)<\/(?:td|th|te)>/gi)].map(c=>norm(clean(c[1]))));
  out.push({kind:/수주/.test(heading)?'ORDER_BACKLOG':/생산능력/.test(heading)?'PRODUCTION_CAPACITY':'FACILITIES',heading,source_id:sourceId,locator:'table-'+(i+1),headers:rows[0]||[],rows:rows.slice(1),unit:null,period:null,event_state:null,verification_status:'UNVERIFIED',reason:merged?'MERGED_HEADERS_REQUIRE_REVIEW':'UNIT_PERIOD_SCOPE_REQUIRE_VERIFICATION'});
 }return out;
}
// Key/value regulatory tables, not prose inference. Values retain their exact
// labels and row locators, including rowspan labels and subsidiary identity.
export function dartEventAssertions(html,{title='',issuer=''}={}){
 if(!/신규시설투자|유형자산.?취득|단일판매|공급계약|생산설비|생산능력|수주상황/.test(title)||/타법인|주식.*취득/.test(title))return [];
 const cells=[];let spans=[];
 for(const [ri,r]of [...String(html||'').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].entries()){
  const row=[];let col=0;
  const fill=()=>{while(spans[col]?.left>0){row[col]=spans[col].value;spans[col].left--;col++;}};fill();
  for(const c of r[1].matchAll(/<(td|th|te)\b([^>]*)>([\s\S]*?)<\/\1>/gi)){
   fill();const text=norm(clean(c[3])),width=Math.min(12,Number(/colspan=["']?(\d+)/i.exec(c[2])?.[1])||1),height=Math.min(100,Number(/rowspan=["']?(\d+)/i.exec(c[2])?.[1])||1);
   for(let x=0;x<width;x++){row[col]=text;if(height>1)spans[col]={value:text,left:height-1};col++;}
  }fill();const unique=row.filter((x,i)=>x&&x!==row[i-1]);if(unique.length<2)continue;
  cells.push({label:unique.slice(0,-1).join(' '),value:nullable(unique.at(-1)),quote:unique.join(' '),locator:'row-'+(ri+1)});
 }
 const get=re=>cells.find(c=>re.test(c.label)&&c.value),field=re=>get(re)?.value||null,date=re=>{const s=field(re),m=s&&/(20\d{2})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/.exec(s);return m?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:null;};
 const purpose=get(/투자목적|취득목적|계약내용|체결계약명|판매.?공급계약 내용/),amount=get(/(?:투자금액|취득금액|확정 계약금액|계약금액).*\(원\)/),board=date(/이사회.*결의|결정일/);
 if(!purpose)return [];
 const amountValue=amount&&/^[\d,]+$/.test(amount.value)?amount.value.replaceAll(',',''):null;
 const subsidiary=field(/^종속회사명(?:\s|$)/)||/종속회사인\s+(.+?)\s+의 주요경영사항/.exec(norm(clean(html)))?.[1]||null;
 if(/종속회사/.test(title)&&!subsidiary)return [];
 const contract=/단일판매|공급계약/.test(title),state=contract?'ORDERED':board?'APPROVED':/결정|신규시설투자/.test(title)?'ANNOUNCED':'UNKNOWN';
 const target=purpose.value; // Never specialize "substrate" to FC-BGA.
 return [{ref:'dart-event-0',kind:'event',subject:issuer,predicate:state,object:target,quote:purpose.quote,
  issuer,event_entity:subsidiary||issuer,event_type:contract?'SUPPLY_CONTRACT':/증설|확대/.test(target)?'CAPACITY_EXPANSION':'FACILITY_INVESTMENT',
  investment_amount:contract?null:amountValue,contract_amount:contract?amountValue:null,currency:amountValue?'KRW':null,
  investment_purpose:contract?null:target,production_target:target,facility:field(/취득물건명|투자대상|시설명/),location:field(/투자지역|소재지|판매.?공급지역/),
  start_date:date(/시작일|시작 일|투자시작/),end_date:date(/종료일|종료 일|투자종료|취득예정일/),board_date:board,eventState:state,
  rows:[purpose,...(amount?[amount]:[]),...(get(/이사회.*결의|결정일/)?[get(/이사회.*결의|결정일/)]:[])],title,exposureType:'UNKNOWN'}];
}
