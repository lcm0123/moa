import fs from 'node:fs/promises';
import path from 'node:path';
export async function preparePdfAssets(root){
 const source=path.join(root,'node_modules/pdfjs-dist'),target=path.join(root,'dist/vendor/pdfjs');
 await fs.mkdir(target,{recursive:true});
 for(const file of ['pdf.mjs','pdf.worker.mjs'])await fs.copyFile(path.join(source,'build',file),path.join(target,file));
 for(const file of ['pdf_viewer.css','pdf_viewer.mjs'])await fs.copyFile(path.join(source,'web',file),path.join(target,file));
 await fs.copyFile(path.join(source,'LICENSE'),path.join(target,'LICENSE.txt'));
 for(const folder of ['cmaps','standard_fonts','wasm'])await fs.cp(path.join(source,folder),path.join(target,folder),{recursive:true});
}
