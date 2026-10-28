// Additive provenance for the numeric chart payload. No contract is inferred
// from a successful HTTP response, a key, the provider label, or a collection time.
const provenance=new WeakMap();
const fields=['basDt','srtnCd','isinCd','itmsNm','idxNm','idxCsf','mrktCtg','clpr','trPrc','trqu'];
const encoder=new TextEncoder();
export async function fscHash(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
const canonical=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);

// Preserve JSON numeric tokens before parsing. Quoted text (including escaped
// quotes and digits inside names) is matched as one token and left untouched.
// Paging metadata is converted separately after validation by parseFscResponse.
export function parseFscJsonExact(text){
 if(typeof text!=='string')throw new TypeError('FSC_JSON_TEXT_REQUIRED');
 return JSON.parse(text.replace(/"(?:\\.|[^"\\])*"|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,(token,numeric)=>numeric===undefined?token:JSON.stringify(numeric)));
}

export function fscExactDecimal(value){
 if(typeof value!=='string')return null;
 const text=value.trim();
 if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text))return null;
 const negative=text.startsWith('-'),unsigned=text.replace(/^[+-]/,''),[integer='0',fraction='']=unsigned.split('.');
 if(integer.length>128||fraction.length>64)return null;
 const whole=(integer||'0').replace(/^0+(?=\d)/,''),tail=fraction.replace(/0+$/,'');
 const magnitude=whole+(tail?'.'+tail:'');
 return negative&&magnitude!=='0'?'-'+magnitude:magnitude;
}

export async function stampFscRows(items,{responseHash=null,page=null,itemShape='array'}={}){
 for(let i=0;i<items.length;i++){
  const row=items[i];
  if(!row||typeof row!=='object'||Array.isArray(row))continue;
  // This is a canonical row hash, distinct from the original response-byte hash.
  const rowHash=await fscHash(canonical(row));
  provenance.set(row,{responseHash,rowHash,revision:'sha256:'+rowHash,locator:{page,row:i,path:itemShape==='object'?'response.body.items.item':`response.body.items.item[${i}]`}});
 }
 return items;
}

export function makeFscExact(row,{operation,endpoint,receivedAt,...context}={}){
 const rawFields=Object.fromEntries(fields.map(field=>[field,typeof row[field]==='string'?row[field]:null]));
 const values={close:fscExactDecimal(row.clpr),turnover:fscExactDecimal(row.trPrc),volume:fscExactDecimal(row.trqu)};
 const stamped={...provenance.get(row),...context};
 return {
  schemaVersion:'fsc-exact-1',values,rawFields,
  valueStatus:Object.fromEntries(Object.entries(values).map(([key,value])=>[key,value===null?'EXACT_VALUE_UNAVAILABLE':'PRESERVED'])),
  source:{provider:'data_go_kr',operation,endpoint,receivedAt,hashAlgorithm:'SHA-256',responseHash:stamped.responseHash||null,rowHash:stamped.rowHash||null,revision:stamped.revision||null,locator:stamped.locator||null},
  contract:{verification:'UNVERIFIED',currency:'UNKNOWN',priceUnit:'UNKNOWN',turnoverUnit:'UNKNOWN',volumeUnit:'UNKNOWN',venueScope:'UNKNOWN',sessionScope:'UNKNOWN',aggregationScope:'UNKNOWN',adjustment:'UNVERIFIED',finality:'UNVERIFIED'}
 };
}
