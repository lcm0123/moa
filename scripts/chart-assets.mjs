import fs from 'node:fs/promises';
import path from 'node:path';

// Serve the pinned library locally; browsers never fetch a chart vendor script.
export async function prepareChartAssets(root){
 const source=path.join(root,'node_modules/lightweight-charts'),target=path.join(root,'dist/vendor/lightweight-charts');
 await fs.mkdir(target,{recursive:true});
 await fs.copyFile(path.join(source,'dist/lightweight-charts.standalone.production.mjs'),path.join(target,'lightweight-charts.mjs'));
 await fs.copyFile(path.join(source,'LICENSE'),path.join(target,'LICENSE.txt'));
 // v5.2.0 NOTICE (the npm tarball omits it): github.com/tradingview/lightweight-charts/blob/v5.2.0/NOTICE
 await fs.writeFile(path.join(target,'NOTICE.txt'),'TradingView Lightweight Charts™\nCopyright (с) 2025 TradingView, Inc. https://www.tradingview.com/\n');
}
