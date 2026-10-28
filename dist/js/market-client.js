const controllers=new Map(),versions=new Map();
export async function requestChannel(channel,url,onLoading,onData){
 controllers.get(channel)?.abort();const controller=new AbortController();controllers.set(channel,controller);const version=(versions.get(channel)||0)+1;versions.set(channel,version);onLoading?.();
 let result;
 try{const response=await fetch(url,{signal:controller.signal,cache:'no-store'});if(!response.ok)throw new Error('Unavailable');result=await response.json();}
 catch(error){if(error.name==='AbortError')return;result={status:'error',items:[],message:'데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'};}
 finally{if(controllers.get(channel)===controller)controllers.delete(channel);}
 // Rendering failures are not provider failures. Never call the renderer again
 // with empty data after it has received a successful response.
 if(versions.get(channel)===version)onData(result);
}
export function setText(node,text){if(node&&node.textContent!==String(text))node.textContent=String(text);}
export function setHTML(node,html){if(node&&node.innerHTML!==html)node.innerHTML=html;}
export function reconcile(parent,items,key,create,update){
 const existing=new Map([...parent.children].map(el=>[el.dataset.key,el]));let cursor=parent.firstElementChild;
 for(const item of items){const id=key(item);let node=existing.get(id);if(!node){node=create(item);node.dataset.key=id;}existing.delete(id);update(node,item);if(node!==cursor)parent.insertBefore(node,cursor);cursor=node.nextElementSibling;}
 for(const node of existing.values())node.remove();
}
