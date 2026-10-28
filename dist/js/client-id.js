// IDs for chart preferences/drawings only, never authentication or credentials.
// randomUUID is HTTPS-only; getRandomValues also works on a public HTTP origin.
let sequence=0;
export function clientId(random=globalThis.crypto){
 if(typeof random?.randomUUID==='function')return random.randomUUID();
 if(typeof random?.getRandomValues==='function'){
  const bytes=random.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
 }
 // Very old/restricted browsers still need distinct local UI IDs.
 return 'local-'+Date.now().toString(36)+'-'+(++sequence).toString(36)+'-'+Math.random().toString(36).slice(2);
}
