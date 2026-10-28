import defaults from '../config/news-live.json' with {type:'json'};
export const articleRelationOwner='system:public-news-relations-v1';
export function newsLivePolicy(env={}){
 const integer=(key,fallback,min,max)=>{const n=Number(env[key]);return Number.isFinite(n)&&n>0?Math.max(min,Math.min(max,Math.floor(n))):fallback;};
 return {...defaults,enabled:env.NEWS_COMPANIES_ENABLED==='true'&&env.NEWS_AUTO_COLLECT_ENABLED!=='false',pollMs:integer('NEWS_POLL_SECONDS',defaults.pollMs/1000,60,3600)*1000,maxPending:integer('NEWS_MAX_PENDING',defaults.maxPending,6,200),minimumFreeMemoryMB:integer('NEWS_MIN_FREE_MEMORY_MB',defaults.minimumFreeMemoryMB,128,2048)};
}
