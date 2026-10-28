import {escapeHtml as esc} from './components.js';
import {indicatorNames,indicatorFields} from './stock-chart-controls.js';
import {panelIndicatorKinds,oscillatorKinds} from './stock-chart-state.js';

const descriptions={sma:'가격 평균 · 기본 20봉',ema:'최근 가격에 가중치 · 기본 12봉',bb:'가격 변동 범위 · 20봉 / 2배',volume:'거래량 · 보조 패널',rsi:'상대강도 · 14봉 / 30·70 기준선',macd:'추세와 모멘텀 · 12·26·9',ichimoku:'전환선·기준선·구름대 · 9·26·52',stochastic:'과매수·과매도 · 14·3·3',atr:'평균 가격 변동폭 · 14봉',obv:'거래량 누적 흐름'};
const repeatable=new Set(['sma','ema','bb']);
const keywords=(kind)=>[kind,indicatorNames[kind],descriptions[kind],kind==='bb'?'bollinger bands':kind==='volume'?'volume':kind==='sma'||kind==='ema'?'이평선 이동평균선':''].join(' ').toLowerCase();
const label=c=>indicatorNames[c.kind]+(['sma','ema'].includes(c.kind)?` · ${c.period}봉`:'');
const panelOptions=(c,settings)=>!panelIndicatorKinds.includes(c.kind)?'':`<div class="indicator-panel-options"><button data-collapse="${esc(c.id)}" aria-expanded="${!c.collapsed}">패널 ${c.collapsed?'펼치기':'접기'}</button><label>패널 높이<input type="range" data-panel-height="${esc(c.id)}" min="60" max="300" step="10" value="${c.height}" aria-label="${esc(indicatorNames[c.kind])} 패널 높이" ${c.collapsed?'disabled':''}></label>${oscillatorKinds.includes(c.kind)?`<button data-mobile-aux="${c.kind}" aria-pressed="${settings.mobileAux===c.kind}">좁은 화면에 표시</button>`:''}</div>`;

export function indicatorPicker(settings,{view='catalog',expandedId=null,ohlc=true,volume=true}={}){
 const applied=view==='applied';
 return `<div class="indicator-picker-heading"><div><h2>차트 지표</h2><p>검색해서 추가하고, 적용 중인 지표를 관리하세요.</p></div><button data-menu-close aria-label="지표 메뉴 닫기">×</button></div>
 <div class="indicator-picker-search"><input class="sc-indicator-search" type="search" aria-label="지표 검색" placeholder="지표 검색 · 일목, 이동평균, RSI…" autocomplete="off"></div>
 <div class="indicator-picker-tabs" role="tablist" aria-label="지표 목록"><button role="tab" id="indicator-tab-catalog" data-indicator-view="catalog" aria-controls="indicator-panel-catalog" aria-selected="${!applied}">지표 찾기</button><button role="tab" id="indicator-tab-applied" data-indicator-view="applied" aria-controls="indicator-panel-applied" aria-selected="${applied}">적용 중 <span>${settings.indicators.length}</span></button></div>
 <div class="indicator-picker-scroll" tabindex="0" role="tabpanel" id="indicator-panel-${view}" aria-labelledby="indicator-tab-${view}" aria-label="${applied?'적용 중인':'추가할'} 지표 목록 · 스크롤">
 ${applied?`<div class="sc-indicator-list">${settings.indicators.map(c=>`<fieldset data-indicator-id="${esc(c.id)}" data-indicator-search="${esc(keywords(c.kind))}"><legend class="sr-only">${esc(label(c))}</legend><div class="indicator-applied-row"><label><input type="checkbox" data-config="enabled" ${c.enabled?'checked':''} aria-label="${esc(label(c))} 표시"><span><strong>${esc(label(c))}</strong><small>${c.enabled?'차트에 표시 중':'숨김'}</small></span></label><div><button data-indicator-settings="${esc(c.id)}" aria-label="${esc(label(c))} 설정" aria-expanded="${expandedId===c.id}">설정</button><button data-remove-indicator="${esc(c.id)}" aria-label="${esc(label(c))} 삭제">삭제</button></div></div><div class="indicator-settings" ${expandedId===c.id?'':'hidden'}>${indicatorFields(c)}${panelOptions(c,settings)}</div></fieldset>`).join('')}</div>`:
 `<div class="sc-catalog">${Object.entries(indicatorNames).map(([kind,name])=>{const added=!repeatable.has(kind)&&settings.indicators.some(c=>c.kind===kind&&c.enabled),unavailable=!ohlc&&['ichimoku','stochastic','atr'].includes(kind)||!volume&&['volume','obv'].includes(kind);return `<div data-catalog="${kind}" data-indicator-search="${esc(keywords(kind))}"><div class="indicator-catalog-label"><strong>${esc(name)}</strong><small>${unavailable?'필요한 가격·거래량 자료 없음':descriptions[kind]}</small></div><button data-add-indicator="${kind}" aria-label="${esc(name)} ${added?'적용 중':'추가'}" ${added||unavailable?'disabled':''}>${added?'적용 중':'+ 추가'}</button></div>`;}).join('')}</div>`}
 <p class="indicator-picker-empty" hidden>검색 결과가 없습니다.</p></div>
 <div class="indicator-picker-footer"><span class="indicator-picker-feedback" role="status">${applied?'설정 버튼으로 기간·색상·두께를 변경합니다.':'목록 안에서 스크롤해 다른 지표를 볼 수 있습니다.'}</span><small>설정은 이 브라우저에 종목별로 저장됩니다.</small></div>`;
}

export function filterIndicatorPicker(node,query){
 const normalize=s=>s.toLowerCase().replace(/\s+/g,''),needle=normalize(query);let count=0;
 node.querySelectorAll('[data-indicator-search]').forEach(row=>{row.hidden=!normalize(row.dataset.indicatorSearch).includes(needle);if(!row.hidden)count++;});
 const empty=node.querySelector('.indicator-picker-empty');empty.hidden=!!count;empty.textContent=needle?'검색 결과가 없습니다.':'적용 중인 지표가 없습니다.';
}
