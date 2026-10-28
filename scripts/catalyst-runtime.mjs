// Retired investment research runtime. Kept as a no-op for older callers;
// neither environment flags nor queued historical jobs can restart research.
export function startCatalystRuntime(){
 return ()=>{};
}
