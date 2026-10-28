const running=new Map(),memory=new Map(),cooldown=new Map();
export async function cachedResearch(env,key,ttl,loader){
 const stamp=Date.now();let saved=memory.get(key);
 if(!saved&&env.DB){const row=(await env.DB.prepare('SELECT payload,updated_at FROM research_cache WHERE cache_key=?').bind(key).all()).results[0];if(row)saved={value:JSON.parse(row.payload),at:Date.parse(row.updated_at)};}
 if(saved&&stamp-saved.at<ttl)return {...saved.value,cacheUpdatedAt:new Date(saved.at).toISOString()};
 if(cooldown.get(key)>stamp){if(saved)return {...saved.value,stale:true,cacheUpdatedAt:new Date(saved.at).toISOString()};throw new Error('Provider cooling down');}
 if(running.has(key))return running.get(key);
 const task=(async()=>{try{const value=await loader(),at=new Date().toISOString();memory.set(key,{value,at:Date.parse(at)});if(memory.size>150)memory.delete(memory.keys().next().value);if(env.DB)await env.DB.prepare('INSERT INTO research_cache(cache_key,payload,updated_at) VALUES(?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').bind(key,JSON.stringify(value),at).run();return {...value,cacheUpdatedAt:at};}catch(e){cooldown.set(key,Date.now()+300000);if(saved)return {...saved.value,stale:true,cacheUpdatedAt:new Date(saved.at).toISOString()};throw e;}finally{running.delete(key);}})();running.set(key,task);return task;
}
