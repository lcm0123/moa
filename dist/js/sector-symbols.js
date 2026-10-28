import {escapeHtml as esc} from './components.js';
const symbols={
 Technology:{label:'기술',tone:'technology',path:'M7 7h10v10H7zM9 3v4m6-4v4M9 17v4m6-4v4M3 9h4m10 0h4M3 15h4m10 0h4'},
 'Communication Services':{label:'통신',tone:'communication',path:'M4 4h16v12H10l-5 4v-4H4zM8 8h8M8 12h5'},
 Financial:{label:'금융',tone:'financial',path:'m3 8 9-5 9 5ZM5 10v8m7-8v8m7-8v8M3 21h18'},
 'Consumer Cyclical':{label:'경기소비재',tone:'cyclical',path:'M5 8h14l1 13H4ZM8 8V6a4 4 0 0 1 8 0v2'},
 Healthcare:{label:'헬스케어',tone:'healthcare',path:'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z'},
 Industrials:{label:'산업재',tone:'industrials',path:'M3 21V11l6 3V9l7 4V3h4v18ZM7 18h1m4 0h1m4 0h1'},
 'Consumer Defensive':{label:'필수소비재',tone:'defensive',path:'M4 8h16l-2 13H6ZM8 8l4-5 4 5M9 12v5m6-5v5'},
 Energy:{label:'에너지',tone:'energy',path:'m14 2-9 12h6l-1 8 9-12h-6z'},
 Utilities:{label:'유틸리티',tone:'utilities',path:'M8 16c0-3-3-4-3-7a7 7 0 0 1 14 0c0 3-3 4-3 7ZM8 19h8m-6 3h4'},
 'Real Estate':{label:'부동산',tone:'realestate',path:'M4 21V3h12v18M16 10h4v11M8 7h4m-4 4h4m-4 4h4m-3 6v-3h2v3'},
 'Basic Materials':{label:'소재',tone:'materials',path:'m12 3 9 5v9l-9 5-9-5V8Zm0 0v19M3 8l9 5 9-5'}
};
// Display symbols only: keep the provider's actual sector assignment unchanged.
const gicsSymbols={'10':'Energy','15':'Basic Materials','20':'Industrials','25':'Consumer Cyclical','30':'Consumer Defensive','35':'Healthcare','40':'Financial','45':'Technology','50':'Communication Services','55':'Utilities','60':'Real Estate'};
const koreanSymbols={'에너지':'Energy','소재':'Basic Materials','산업재':'Industrials','경기관련소비재':'Consumer Cyclical','경기소비재':'Consumer Cyclical','자유소비재':'Consumer Cyclical','필수소비재':'Consumer Defensive','건강관리':'Healthcare','헬스케어':'Healthcare','금융':'Financial','정보기술':'Technology','커뮤니케이션서비스':'Communication Services','통신서비스':'Communication Services','유틸리티':'Utilities','부동산':'Real Estate'};
export function sectorSymbol(sector){const code=String(sector?.id||'').match(/^GICS:(\d{2})$/)?.[1],key=gicsSymbols[code]||koreanSymbols[String(sector?.name||'').replace(/\s/g,'')]||sector?.name;return symbols[key]||{label:sector?.name||'분류 없음',tone:'other',path:'M12 3 21 8v9l-9 5-9-5V8Z'};}
export function sectorMark(sector){const symbol=sectorSymbol(sector);return '<span class="sector-mark sector-tone-'+symbol.tone+'" title="'+esc(symbol.label+' · '+sector.name)+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+symbol.path+'"/></svg></span>';}
