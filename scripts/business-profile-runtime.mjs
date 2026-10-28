import {createProfileOneShot} from './catalyst-profile-oneshot.mjs';
import {createProfileBatchDispatch} from './profile-batch-dispatch.mjs';
import {deliverySourceAllowed} from './catalyst-delivery-security.mjs';
import {startDomesticProfileRuntime} from './profile-domestic-runtime.mjs';

// Stock business/revenue data remains available after investment research ends.
// Optional domestic stock-data rollout shares the existing profile worker.
// No chat, thesis or historical research queue is activated.
export function startBusinessProfileRuntime(env){
 env.CATALYST_SOURCE_ALLOWED=source=>deliverySourceAllowed(env,source);
 const profile=createProfileOneShot(env),batch=createProfileBatchDispatch(env);
 let serial=Promise.resolve();
 const run=fn=>{const pending=serial.then(fn);serial=pending.catch(()=>{});return pending;};
 env.CATALYST_ONESHOT={
  submitProfile:asset=>run(()=>profile.submit(asset)),
  startProfileBatch:id=>run(()=>batch.start(id)),
  pauseProfileBatch:id=>batch.pause(id),
 };
 const stopDomestic=startDomesticProfileRuntime(env,batch);
 return ()=>{stopDomestic();profile.stop();batch.stop();};
}
