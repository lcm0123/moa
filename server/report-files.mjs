import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
export function localReportFiles(root){
 const directory=path.resolve(root,'.sites-runtime/telegram-pdfs');
 return {async read(key){
  if(!/^[a-f0-9]{64}\.pdf$/.test(key))return null;
  const target=path.resolve(directory,key);
  if(path.dirname(target)!==directory)return null;
  try{const info=await stat(target);if(!info.isFile()||info.size>20*1024*1024)return null;return new Uint8Array(await readFile(target));}catch(error){if(error.code==='ENOENT')return null;throw error;}
 }};
}
