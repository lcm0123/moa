import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {providerContract} from './catalyst-provider-contracts.mjs';
export async function parseDartArchive(raw,file,{receipt,issuer,title},env={}){
 if(raw.detected_type!=='ZIP'||raw.providerContract!=='DART_OFFICIAL_ARCHIVE'||providerContract(raw.url)!=='DART_OFFICIAL_ARCHIVE')throw Error('DART_CONTRACT_REQUIRED');
 const context={receipt,issuer,title,url:raw.url,sha256:raw.content_sha256,contract:raw.providerContract};
 const result=await new Promise((resolve,reject)=>{
  const child=spawn(env.MOA_PYTHON||'python',['-X','utf8','scripts/catalyst_dart_archive.py',raw.file,file],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let output='';child.stdin.on('error',()=>{});child.stderr.resume();child.stdout.on('data',b=>{output+=b.toString();if(output.length>12000)child.kill();});
  const timer=setTimeout(()=>child.kill(),45000);child.once('error',()=>{clearTimeout(timer);reject(Error('STATIC_PARSER_UNAVAILABLE'));});
  child.once('close',code=>{clearTimeout(timer);let parsed;try{parsed=JSON.parse(output);}catch{return reject(Error('DART_INVALID_DOCUMENT'));}if(code||parsed.classification==='DART_INVALID_DOCUMENT'){const error=Error(parsed.reason||'DART_INVALID_DOCUMENT');error.diagnostics=parsed;reject(error);}else resolve(parsed);});
  child.stdin.end(JSON.stringify(context));
 });
 fs.chmodSync(file,0o600);return result;
}
