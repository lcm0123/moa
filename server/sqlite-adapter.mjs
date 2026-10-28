export function d1Adapter(sqlite,{statementCacheSize=0}={}) {
 const operations=new WeakMap();
 const cache=new Map();
 const prepare=sql=>{
  let statement=cache.get(sql);
  if(!statement){statement=sqlite.prepare(sql);if(statementCacheSize>0){if(cache.size>=statementCacheSize)cache.delete(cache.keys().next().value);cache.set(sql,statement);}}
  const bound=params=>{
   const run=()=>{const result=statement.run(...params);return {meta:{changes:Number(result.changes)}};};
   const api={bind:(...values)=>bound(values),async all(){return {results:statement.all(...params)};},async run(){return run();}};
   operations.set(api,run);return api;
  };
  return bound([]);
 };
 return {prepare,async batch(statements){
  const runs=statements.map(s=>{const op=operations.get(s);if(!op)throw new Error('Foreign database statement');return op;});
  sqlite.exec('BEGIN IMMEDIATE');
  try{const results=runs.map(run=>run());sqlite.exec('COMMIT');return results;}
  catch(error){sqlite.exec('ROLLBACK');throw error;}
 }};
}
