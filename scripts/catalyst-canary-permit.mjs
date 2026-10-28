import {sourceIdentity} from './catalyst-security-ledger.mjs';
// In-memory capability: cannot be supplied through JSON/API/env. Never enables
// a worker. Every manifest URL gets at most one collection attempt.
const grants=new WeakMap();
export function createCanaryPermit(urls){
 if(!Array.isArray(urls)||!urls.length||urls.length>10)throw Error('CANARY_LIMIT');
 const keys=urls.map(url=>{const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)throw Error('CANARY_URL');return sourceIdentity(url).normalized_url_hash;});
 if(new Set(keys).size!==keys.length)throw Error('CANARY_DUPLICATE');
 const capability=Object.freeze({});grants.set(capability,new Set(keys));return capability;
}
export function consumeCanaryPermit(capability,url){
 const grant=grants.get(capability),key=sourceIdentity(url).normalized_url_hash;
 if(!grant?.has(key))return false;grant.delete(key);return true;
}
