import {norm,safeUrl} from './core.mjs';
const compact=s=>norm(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ');
function original(s){return safeUrl(s.originalSourceUrl)||safeUrl(s.originUrl)||safeUrl(s.originRef)||safeUrl(s.origin_url)||safeUrl(s.quoted_source);}
export function sourceGroup(source){
 const url=original(source)||safeUrl(source.url);
 if(!original(source)&&source.publicationFamily)return 'publisher:'+source.publicationFamily;
 // Legacy random keys are not evidence of independence.
 return url?'publisher:'+new URL(url).hostname.replace(/^www\./,''):'unknown';
}
export function copiedSource(a,b){
 if(a.url===b.url||a.contentHash&&a.contentHash===b.contentHash)return true;
 if(original(a)&&original(a)===original(b))return true;
 if(original(a)===b.url||original(b)===a.url)return true;
 const left=compact(a.body),right=compact(b.body);
 if(left.length>=80&&left===right)return true;
 if(Math.min(left.length,right.length)<200)return false;
 const shingles=s=>{const w=s.split(' '),out=new Set();for(let i=0;i+8<=w.length;i++)out.add(w.slice(i,i+8).join(' '));return out;};
 const x=shingles(left),y=shingles(right);if(!x.size||!y.size)return false;
 let common=0;for(const v of x)if(y.has(v))common++;
 return common/Math.min(x.size,y.size)>=.85;
}
export function groupSources(sources){
 const roots=sources.map((_,i)=>i),root=i=>{while(roots[i]!==i)i=roots[i];return i;};
 for(let i=0;i<sources.length;i++)for(let j=0;j<i;j++)if(sourceGroup(sources[i])===sourceGroup(sources[j])||copiedSource(sources[i],sources[j])||(sources[i].lineageVersion==='lineage-1'&&sources[j].lineageVersion==='lineage-1'&&sources[i].independenceKey===sources[j].independenceKey))roots[root(i)]=root(j);
 return sources.map((s,i)=>{const first=sources[root(i)];return {...s,independenceKey:first.lineageVersion==='lineage-1'?first.independenceKey:sourceGroup(first),lineageVersion:'lineage-1'};});
}
