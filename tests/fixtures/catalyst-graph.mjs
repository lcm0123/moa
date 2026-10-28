// Synthetic test evidence. Never import into a production collector or seed DB.
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {d1Adapter} from '../../server/sqlite-adapter.mjs';
import {CatalystStore} from '../../server/catalyst/store.mjs';
import {CatalystGraph} from '../../server/catalyst/graph.mjs';
import {validateClaim} from '../../server/catalyst/claims.mjs';
export const fixtureNow=Date.parse('2026-10-05T00:00:00Z');
export function graphDatabase(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 for(const f of fs.readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync('drizzle/'+f,'utf8'));
 const db=d1Adapter(sqlite),store=new CatalystStore(db),graph=new CatalystGraph(db,{namespace:'fixture'});return {sqlite,db,store,graph};
}
export async function fixtureClaim(store,text,predicate,{suffix='',asset=null}={}){
 const subject=asset?.id||'EVENT';
 const source=await store.addSource({url:'https://technical.fixture.invalid/'+encodeURIComponent(text)+suffix,assetId:subject,sourceType:'official',publishedAt:'2026-10-01',body:text,authority:{kind:'issuer_document',assetId:subject,verified:true,verificationSource:'https://technical.fixture.invalid/identity'}});
 const c=await validateClaim({id:'fixture',type:asset?'business':'event',subject_id:subject,predicate,value:text,quote:text,source_id:source.id},[source],asset?[asset]:[],'fixture',fixtureNow);
 if(c.status!=='VERIFIED')throw Error('Fixture failed verification: '+JSON.stringify(c.validationChecks));
 await store.saveClaim(c,'fixture');return c;
}
export async function fixtureEdge(ctx,from,to,relation,text,{pending=false,condition={},claimOptions={},...rest}={}){
 const source=await ctx.graph.node({kind:from[1],label:from[0],assetId:from[2]}),target=await ctx.graph.node({kind:to[1],label:to[0],assetId:to[2]});
 const input={source_node_id:source,target_node_id:target,relation_type:relation,condition,status:'VERIFIED',...rest};
 const c=await fixtureClaim(ctx.store,text,relation,claimOptions);
 await ctx.graph.propose(input,{claimIds:[c.id],runId:'fixture'});
 const edge=pending?{...input,status:'PENDING'}:await ctx.graph.publish(input,[c.id],{now:fixtureNow});
 return {source,target,c,edge,input};
}
export async function fixturePaths(ctx){
 const pcb=await fixtureEdge(ctx,['FC-BGA','PROCESS'],['Inspection','PROCESS'],'REQUIRES','FC-BGA requires Inspection.');
 await fixtureEdge(ctx,['Inspection','PROCESS'],['AOI','EQUIPMENT'],'REQUIRES','Inspection requires AOI.');
 await fixtureEdge(ctx,['AOI','EQUIPMENT'],['Inspection optics','MATERIAL'],'REQUIRES','AOI requires Inspection optics.');
 const memory=await fixtureEdge(ctx,['HBM','PRODUCT'],['Bonding process','PROCESS'],'REQUIRES','HBM requires Bonding process.');
 await fixtureEdge(ctx,['Bonding process','PROCESS'],['Bonding Equipment','EQUIPMENT'],'REQUIRES','Bonding process requires Bonding Equipment.');
 const ai=await fixtureEdge(ctx,['AI Data Center','END_MARKET'],['Electricity Demand','MACRO_FACTOR'],'INCREASES','AI Data Center increases Electricity Demand.');
 await fixtureEdge(ctx,['Electricity Demand','MACRO_FACTOR'],['Transformer Demand','PRODUCT'],'INCREASES','Electricity Demand increases Transformer Demand.');
 const crypto=await fixtureEdge(ctx,['Stablecoin Adoption','CATALYST'],['DEX Volume','PROCESS'],'INCREASES','Stablecoin Adoption increases DEX Volume.');
 await fixtureEdge(ctx,['DEX Volume','PROCESS'],['DEX Protocol','PROTOCOL'],'PART_OF','DEX Volume is part of DEX Protocol.');
 return {pcb:pcb.source,hbm:memory.source,ai:ai.source,crypto:crypto.source};
}
