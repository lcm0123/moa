import fs from 'node:fs/promises';import path from 'node:path';import {build} from 'esbuild';
import {preparePdfAssets} from './pdf-assets.mjs';
import {prepareChartAssets} from './chart-assets.mjs';
const root=path.resolve(import.meta.dirname,'..');process.chdir(root);await fs.mkdir('dist/server',{recursive:true});await fs.mkdir('dist/client',{recursive:true});
await preparePdfAssets(root);
await prepareChartAssets(root);
const assets={};async function collect(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){if(['server','client','.openai'].includes(entry.name))continue;const p=path.join(dir,entry.name);if(entry.isDirectory())await collect(p);else if(/\.(html|css|js|mjs|svg|bcmap|ttf|pfb|wasm|txt)$/.test(p)||/^(?:LICENSE|NOTICE)(?:[._-].*)?$/i.test(entry.name)){const key='/'+path.relative('dist',p).replaceAll('\\','/');assets[key]=/\.(bcmap|ttf|pfb|wasm)$/.test(p)?{base64:(await fs.readFile(p)).toString('base64')}:await fs.readFile(p,'utf8');await fs.mkdir(path.dirname(path.join('dist/client',key)),{recursive:true});await fs.copyFile(p,path.join('dist/client',key));}}}
await collect('dist');await fs.mkdir('.sites-runtime',{recursive:true});await fs.writeFile('.sites-runtime/assets.mjs',`export default ${JSON.stringify(assets)};`);
await build({entryPoints:['server/worker.mjs'],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'dist/server/index.js',minify:true});console.log('Built Cloudflare Worker and public assets.');
