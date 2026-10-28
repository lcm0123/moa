// USDT is not assumed to equal USD. Use the actual public USDT/KRW market.
const KEY='binance:display:usdt-krw',TTL=60000;
export class CryptoKrwRate{
 constructor(store,fetcher=fetch){this.store=store;this.fetcher=fetcher;this.pending=null;this.loaded=false;this.value=null;this.next=0;this.failed=false;}
 snapshot(){return {...(this.value||{rate:null,asOf:null,receivedAt:null}),base:'USDT',quote:'KRW',source:'Upbit USDT/KRW',stale:this.failed||!this.value||Date.now()-Date.parse(this.value.asOf)>300000,status:this.value?'ready':'unavailable'};}
 async get(){
  if(this.pending)return this.pending;
  this.pending=(async()=>{
   if(!this.loaded){const old=await this.store.read(KEY);this.value=old?.data||null;this.next=old?.expires||0;this.loaded=true;}
   if(Date.now()<this.next)return this.snapshot();
   try{
    const response=await this.fetcher('https://api.upbit.com/v1/ticker?markets=KRW-USDT',{headers:{Accept:'application/json'},signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error('rate unavailable');
    const body=await response.json(),row=Array.isArray(body)?body.find(x=>x.market==='KRW-USDT'):null;
    if(!Number.isFinite(row?.trade_price)||row.trade_price<=0||!Number.isFinite(row.trade_timestamp)||row.trade_timestamp<=0||row.trade_timestamp>Date.now()+300000)throw new Error('invalid rate');
    const value={rate:row.trade_price,asOf:new Date(row.trade_timestamp).toISOString(),receivedAt:new Date().toISOString()};
    await this.store.write(KEY,value,TTL);this.value=value;this.failed=false;this.next=Date.now()+TTL;
   }catch{this.failed=true;this.next=Date.now()+300000;}
   return this.snapshot();
  })().finally(()=>{this.pending=null;});
  return this.pending;
 }
}
