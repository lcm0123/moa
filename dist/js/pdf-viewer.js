import {icon,escapeHtml as esc} from './components.js';
import {capturePdfAnchor,restorePdfAnchor,clamp,wheelScale,touchGeometry,MIN_PDF_SCALE,MAX_PDF_SCALE} from './pdf-navigation.js';
import {mountPdfReadingState} from './pdf-reading-state.js';

export function openPdfViewer(report){
 const attachment=report.attachment;
 if(!attachment?.url||!/^\/api\/reports\/-?\d+%3A\d+\/pdf$/i.test(attachment.url))return null;
 const opener=document.activeElement,dialog=document.createElement('dialog');dialog.className='report-pdf-viewer';
 dialog.setAttribute('aria-label','PDF 리포트 뷰어');
 dialog.innerHTML=`<div class="pdf-head"><div class="pdf-document-icon">${icon('report')}</div><div class="pdf-title"><span>PDF</span><h2>${esc(attachment.filename||'리포트')}</h2></div><a class="pdf-download" href="${esc(attachment.url)}" download="${esc(attachment.filename||'report.pdf')}">내려받기</a><button class="icon-button" data-pdf="close" aria-label="PDF 뷰어 닫기">${icon('close')}</button></div>
 <div class="pdf-toolbar" aria-label="PDF 도구">
 <div class="pdf-paging"><button data-pdf="previous" aria-label="이전 페이지" disabled>‹</button><label><input class="pdf-page-number" type="number" inputmode="numeric" min="1" value="1" aria-label="페이지 번호" disabled><span class="pdf-total">/ —</span></label><button data-pdf="next" aria-label="다음 페이지" disabled>›</button></div>
 <div class="pdf-zoom"><button data-pdf="width" aria-pressed="true" disabled>너비 맞춤</button><button data-pdf="page" aria-pressed="false" disabled>페이지 맞춤</button><button data-pdf="actual" disabled>100%</button><button data-pdf="minus" aria-label="축소" disabled>−</button><output class="pdf-scale" aria-label="현재 확대율">—</output><button data-pdf="plus" aria-label="확대" disabled>+</button></div>
 <div class="pdf-tools"><button data-pdf="hand" aria-pressed="false" title="손 도구: 문서를 잡아 상하좌우로 이동" disabled>손 도구</button><button data-pdf="search" aria-expanded="false" aria-controls="pdf-search" disabled>검색</button><button data-pdf="contents" aria-expanded="false" aria-controls="pdf-reading-tools">목차·북마크</button></div></div>
 <section id="pdf-reading-tools" class="pdf-reading-tools" hidden><div><strong>목차</strong><div class="pdf-outline">원문 목차를 확인하고 있습니다.</div></div><div><strong>북마크</strong><button type="button" data-pdf-bookmark>현재 페이지 북마크 추가/해제</button><div class="pdf-bookmark-list"></div><p class="pdf-reading-status" role="status"></p><button type="button" data-pdf-reading-retry>저장 상태 다시 불러오기</button></div></section>
 <form class="pdf-search" id="pdf-search" hidden><input type="search" placeholder="문서에서 찾기" aria-label="PDF 검색어"><button type="button" data-pdf="find-previous" aria-label="이전 검색 결과">↑</button><button type="submit" aria-label="다음 검색 결과">↓</button><span class="pdf-find-result" role="status"></span><button type="button" data-pdf="search-close" aria-label="검색 닫기">×</button></form>
 <div class="pdf-scroll-wrap"><div class="pdf-stage" tabindex="0" aria-label="PDF 문서 · Ctrl 또는 Command와 휠로 확대 · 손 도구로 이동"><div class="pdfViewer"></div></div><div class="pdf-message" role="status">PDF를 여는 중입니다…</div></div><div class="sr-only pdf-announcement" aria-live="polite"></div>`;
 document.body.append(dialog);const priorOverflow=document.body.style.overflow;document.body.style.overflow='hidden';dialog.showModal();
 const stage=dialog.querySelector('.pdf-stage'),message=dialog.querySelector('.pdf-message'),pageInput=dialog.querySelector('.pdf-page-number'),search=dialog.querySelector('.pdf-search'),query=search.querySelector('input');
 const lifecycle=new AbortController(),signal=lifecycle.signal,button=a=>dialog.querySelector(`[data-pdf="${a}"]`);
 let closed=false,doc,loading,viewer,eventBus,linkService,findController,fitMode='width',hand=false,drag=null,touch=null,gesture=null;
 let pending=null,lastCenter=null,restoreFrame=0,wheelFrame=0,wheelRequest=null,touchFrame=0,touchRequest=null,resizeTimer,searchTimer,goRevision=0,reading=null;
 const center=()=>capturePdfAnchor(viewer,stage);
 const remember=()=>{if(viewer?.pagesCount&&!closed){lastCenter=center();reading?.changed();}};
 function updateControls(){
  const ready=!!doc&&!!viewer?.pagesCount;
  pageInput.disabled=!ready;pageInput.value=viewer?.currentPageNumber||1;pageInput.max=doc?.numPages||1;
  dialog.querySelector('.pdf-total').textContent='/ '+(doc?.numPages||'—');
  dialog.querySelector('.pdf-scale').textContent=ready?Math.round(viewer.currentScale*100)+'%':'—';
  for(const a of ['width','page','actual','minus','plus','hand','search'])button(a).disabled=!ready;
  button('previous').disabled=!ready||viewer.currentPageNumber<=1;button('next').disabled=!ready||viewer.currentPageNumber>=doc.numPages;
  button('width').setAttribute('aria-pressed',String(fitMode==='width'));button('page').setAttribute('aria-pressed',String(fitMode==='page'));
  if(ready){button('minus').disabled=viewer.currentScale<=MIN_PDF_SCALE;button('plus').disabled=viewer.currentScale>=MAX_PDF_SCALE;}
 }
 function stopAnchor(){pending=null;cancelAnimationFrame(restoreFrame);}
 function stopWheel(){cancelAnimationFrame(wheelFrame);wheelFrame=0;wheelRequest=null;}
 function restore(){if(pending&&!closed){restorePdfAnchor(viewer,stage,pending.anchor);remember();}}
 function fitScale(mode,page=viewer.currentPageNumber){
  const view=viewer.getPageView(page-1),width=view.viewport.width/view.scale,height=view.viewport.height/view.scale;
  return clamp(Math.min((stage.clientWidth-32)/width,mode==='page'?(stage.clientHeight-32)/height:Infinity),MIN_PDF_SCALE,MAX_PDF_SCALE);
 }
 function zoomTo(scale,anchor=center(),mode=null){
  if(!viewer?.pagesCount||closed)return;
  fitMode=mode;scale=clamp(scale,MIN_PDF_SCALE,MAX_PDF_SCALE);stopAnchor();
  if(viewer.currentScaleValue!==null&&Math.abs(viewer.currentScale-scale)<.001){restorePdfAnchor(viewer,stage,anchor);remember();updateControls();return;}
  pending={anchor,scale};
  // Page boxes/viewports resize synchronously; PDF.js lazily rerenders the visible pages.
  // Restore immediately, after layout, and after the anchored page's final canvas render.
  // updateScale multiplies PDF.js's internal initial UNKNOWN_SCALE (0); seed it once.
  if(viewer.currentScaleValue===null)viewer.currentScale=scale;
  else viewer.updateScale({scaleFactor:scale/viewer.currentScale,drawingDelay:100});
  pending.scale=viewer.currentScale;restore();
  restoreFrame=requestAnimationFrame(()=>{restoreFrame=0;restore();});updateControls();
 }
 async function go(value){
  if(!doc||!viewer)return;const n=++goRevision,page=clamp(Math.round(Number(value)||1),1,doc.numPages);stopAnchor();stopWheel();
  try{const pdfPage=await doc.getPage(page);if(closed||n!==goRevision)return;
   const view=viewer.getPageView(page-1);if(!view.pdfPage)view.setPdfPage(pdfPage);
   if(fitMode)zoomTo(fitScale(fitMode,page),null,fitMode);
   stopAnchor();viewer.scrollPageIntoView({pageNumber:page});remember();updateControls();
  }catch{if(!closed)announce('페이지를 불러오지 못했습니다. 다시 시도해 주세요.');}
 }
 const announce=text=>dialog.querySelector('.pdf-announcement').textContent=text;
 function setHand(value){hand=value;stage.classList.toggle('pdf-hand',hand);button('hand').setAttribute('aria-pressed',String(hand));if(!hand){drag=null;stage.classList.remove('pdf-dragging');}}
 function find(previous=false,type='again'){
  if(!findController)return;stopAnchor();
  eventBus.dispatch('find',{source:dialog,type,query:query.value,caseSensitive:false,entireWord:false,highlightAll:true,findPrevious:previous,matchDiacritics:false});
 }
 function toggleSearch(open){search.hidden=!open;button('search').setAttribute('aria-expanded',String(open));if(open){query.focus();query.select();}else{clearTimeout(searchTimer);eventBus?.dispatch('findbarclose',{source:dialog});stage.focus();}}
 function close(){
  if(closed)return;reading?.close();closed=true;clearTimeout(resizeTimer);clearTimeout(searchTimer);stopAnchor();stopWheel();cancelAnimationFrame(touchFrame);observer.disconnect();lifecycle.abort();
  viewer?.setDocument(null);linkService?.setDocument(null);findController?.setDocument(null);if(loading)Promise.resolve(loading.destroy()).catch(()=>{});
  dialog.close();dialog.remove();document.body.style.overflow=priorOverflow;if(opener?.isConnected)opener.focus();
 }
 dialog.addEventListener('cancel',e=>{e.preventDefault();if(!search.hidden)toggleSearch(false);else close();},{signal});
 dialog.addEventListener('click',e=>{
  if(e.target===dialog){close();return;}const action=e.target.closest('[data-pdf]')?.dataset.pdf;
  if(action==='close'){close();return;}if(action==='contents'){const panel=dialog.querySelector('.pdf-reading-tools');panel.hidden=!panel.hidden;button('contents').setAttribute('aria-expanded',String(!panel.hidden));return;}if(!viewer?.pagesCount)return;
  if(['plus','minus','width','page','actual'].includes(action))stopWheel();
  if(action==='plus'||action==='minus')zoomTo(viewer.currentScale*(action==='plus'?1.2:1/1.2));
  else if(action==='width'||action==='page')zoomTo(fitScale(action),center(),action);
  else if(action==='actual')zoomTo(1);
  else if(action==='previous'||action==='next')go(viewer.currentPageNumber+(action==='next'?1:-1));
  else if(action==='hand')setHand(!hand);
  else if(action==='search'||action==='search-close')toggleSearch(action==='search'?search.hidden:false);
  else if(action==='find-previous')find(true);
 },{signal});
 dialog.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'){e.preventDefault();toggleSearch(true);}
  if((e.ctrlKey||e.metaKey)&&['+','=','-'].includes(e.key)&&stage.contains(e.target)){e.preventDefault();zoomTo(viewer.currentScale*(e.key==='-'?1/1.2:1.2));}
  if(['PageDown','PageUp','Home','End','ArrowDown','ArrowUp','ArrowLeft','ArrowRight'].includes(e.key)&&e.target===stage)stopAnchor();
 },{signal});
 pageInput.addEventListener('change',()=>go(pageInput.value),{signal});pageInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();go(pageInput.value);}},{signal});
 search.addEventListener('submit',e=>{e.preventDefault();clearTimeout(searchTimer);find();},{signal});
 query.addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>find(false,''),200);},{signal});
 stage.addEventListener('wheel',e=>{
  if(!e.ctrlKey&&!e.metaKey){stopAnchor();stopWheel();return;}e.preventDefault();e.stopPropagation();if(!viewer?.pagesCount)return;
  wheelRequest={scale:wheelScale(wheelRequest?.scale||viewer.currentScale,e.deltaY,e.deltaMode,stage.clientHeight),x:e.clientX,y:e.clientY};
  if(!wheelFrame)wheelFrame=requestAnimationFrame(()=>{wheelFrame=0;const r=wheelRequest;wheelRequest=null;if(r)zoomTo(r.scale,capturePdfAnchor(viewer,stage,r.x,r.y));});
 },{passive:false,signal});
 stage.addEventListener('pointerdown',e=>{
  if(e.pointerType==='touch')return;stopAnchor();stopWheel();if(!hand||e.button!==0)return;
  e.preventDefault();stage.setPointerCapture(e.pointerId);drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:stage.scrollLeft,top:stage.scrollTop};stage.classList.add('pdf-dragging');
 },{signal});
 stage.addEventListener('pointermove',e=>{if(drag?.id!==e.pointerId)return;e.preventDefault();stage.scrollLeft=clamp(drag.left+drag.x-e.clientX,0,stage.scrollWidth-stage.clientWidth);stage.scrollTop=clamp(drag.top+drag.y-e.clientY,0,stage.scrollHeight-stage.clientHeight);},{signal});
 const endDrag=()=>{drag=null;stage.classList.remove('pdf-dragging');remember();};
 for(const name of ['pointerup','pointercancel','lostpointercapture'])stage.addEventListener(name,endDrag,{signal});
 stage.addEventListener('click',e=>{stopAnchor();if(hand){e.preventDefault();e.stopPropagation();}},{capture:true,signal});
 function beginTouch(touches){
  if(touches.length>=2){const g=touchGeometry(touches);touch={kind:'pinch',...g,scale:viewer.currentScale,anchor:capturePdfAnchor(viewer,stage,g.x,g.y)};}
  else if(touches.length===1){const p=touches[0];touch={kind:'pan',x:p.clientX,y:p.clientY,left:stage.scrollLeft,top:stage.scrollTop};}else touch=null;
 }
 stage.addEventListener('touchstart',e=>{if(!viewer?.pagesCount)return;stopAnchor();stopWheel();beginTouch(e.touches);if(e.touches.length>=2)e.preventDefault();},{passive:false,signal});
 function flushTouch(){touchFrame=0;const r=touchRequest;touchRequest=null;if(!r||closed)return;if(r.kind==='pinch')zoomTo(r.scale,r.anchor);else{stage.scrollLeft=clamp(r.left,0,stage.scrollWidth-stage.clientWidth);stage.scrollTop=clamp(r.top,0,stage.scrollHeight-stage.clientHeight);}}
 stage.addEventListener('touchmove',e=>{
  if(!touch)return;
  if(e.touches.length>=2){e.preventDefault();if(touch.kind!=='pinch')beginTouch(e.touches);const g=touchGeometry(e.touches),bounds=stage.getBoundingClientRect();touchRequest={kind:'pinch',scale:touch.scale*g.distance/touch.distance,anchor:{...touch.anchor,screenX:g.x-bounds.left,screenY:g.y-bounds.top}};}
  else if(e.touches.length===1&&touch.kind==='pan'){
   const p=e.touches[0];if(Math.hypot(p.clientX-touch.x,p.clientY-touch.y)<5)return;
   // Preserve native long-press text-selection handles in selection mode.
   if(!hand&&!window.getSelection()?.isCollapsed)return;
   e.preventDefault();stopAnchor();touchRequest={kind:'pan',left:touch.left+touch.x-p.clientX,top:touch.top+touch.y-p.clientY};
  }
  if(touchRequest&&!touchFrame)touchFrame=requestAnimationFrame(flushTouch);
 },{passive:false,signal});
 for(const name of ['touchend','touchcancel'])stage.addEventListener(name,e=>{if(!viewer?.pagesCount)return;cancelAnimationFrame(touchFrame);flushTouch();beginTouch(e.touches);remember();},{signal});
 // Safari trackpads use gesture events; Chromium trackpads deliver ctrl+wheel.
 stage.addEventListener('gesturestart',e=>{if(!viewer?.pagesCount||touch?.kind==='pinch')return;e.preventDefault();stopAnchor();gesture={scale:viewer.currentScale,anchor:capturePdfAnchor(viewer,stage,e.clientX||undefined,e.clientY||undefined)};},{passive:false,signal});
 stage.addEventListener('gesturechange',e=>{if(!gesture)return;e.preventDefault();zoomTo(gesture.scale*e.scale,gesture.anchor);},{passive:false,signal});
 stage.addEventListener('gestureend',e=>{if(gesture)e.preventDefault();gesture=null;},{passive:false,signal});
 stage.addEventListener('scroll',remember,{passive:true,signal});
 let lastSize={width:stage.clientWidth,height:stage.clientHeight};
 const observer=new ResizeObserver(()=>{
  const size={width:stage.clientWidth,height:stage.clientHeight};if(size.width===lastSize.width&&size.height===lastSize.height)return;lastSize=size;
  const anchor=lastCenter?{...lastCenter,screenX:size.width/2,screenY:size.height/2}:null;
  clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(!viewer?.pagesCount||closed)return;if(fitMode)zoomTo(fitScale(fitMode),anchor,fitMode);else{stopAnchor();restorePdfAnchor(viewer,stage,anchor);remember();}},100);
 });observer.observe(stage);
 (async()=>{try{
  const library=await import('/vendor/pdfjs/pdf.mjs');if(closed)return;globalThis.pdfjsLib=library;
  const {PDFViewer,EventBus,ScrollMode,PDFLinkService,PDFFindController,LinkTarget,DownloadManager}=await import('/vendor/pdfjs/pdf_viewer.mjs');if(closed)return;
  library.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.mjs';eventBus=new EventBus();
  linkService=new PDFLinkService({eventBus,externalLinkTarget:LinkTarget.BLANK,externalLinkRel:'noopener noreferrer',ignoreDestinationZoom:true});findController=new PDFFindController({eventBus,linkService});
  viewer=new PDFViewer({container:stage,viewer:stage.querySelector('.pdfViewer'),eventBus,linkService,findController,downloadManager:new DownloadManager(),abortSignal:signal,annotationMode:library.AnnotationMode.ENABLE,enableScripting:false,enableAutoLinking:false,maxCanvasPixels:4000000,maxCanvasDim:8192,enableDetailCanvas:false});
  linkService.setViewer(viewer);viewer.scrollMode=ScrollMode.VERTICAL;
  eventBus.on('pagesinit',()=>{if(closed)return;zoomTo(fitScale('width'),null,'width');stage.scrollLeft=0;stage.scrollTop=0;remember();message.hidden=true;updateControls();
   reading=mountPdfReadingState({url:attachment.url.replace(/\/pdf$/,'/state'),root:dialog.querySelector('.pdf-reading-tools'),signal,getAnchor:center,restore:async anchor=>{if(anchor.page>doc.numPages)return;await go(anchor.page);if(closed)return;const restored={...anchor,screenX:stage.clientWidth/2,screenY:stage.clientHeight/2};restorePdfAnchor(viewer,stage,restored);remember();}});void reading.load();
   void doc.getOutline().then(items=>{if(closed)return;const outline=dialog.querySelector('.pdf-outline');outline.replaceChildren();let count=0;const add=(rows,depth=0)=>{for(const item of rows||[]){if(count++>=200)return;if(item.dest){const b=document.createElement('button');b.type='button';b.textContent=String(item.title||'제목 없음');b.style.paddingInlineStart=(8+Math.min(depth,4)*12)+'px';b.addEventListener('click',()=>{stopAnchor();void linkService.goToDestination(item.dest);},{signal});outline.append(b);}add(item.items,depth+1);}};add(items);if(!outline.childElementCount)outline.textContent='이 PDF에 저장된 목차가 없습니다. 문서 검색을 사용해 주세요.';}).catch(()=>{if(!closed)dialog.querySelector('.pdf-outline').textContent='목차를 읽지 못했습니다. 문서 검색을 사용해 주세요.';});
  });
  eventBus.on('pagechanging',({pageNumber})=>{if(closed)return;updateControls();announce(pageNumber+' / '+doc.numPages+' 페이지');});
  eventBus.on('scalechanging',()=>{if(!closed)updateControls();});
  eventBus.on('pagerendered',({pageNumber,cssTransform,error})=>{
   if(closed)return;if(error){message.hidden=false;message.textContent='일부 페이지를 표시하지 못했습니다. 파일을 내려받아 확인해 주세요.';return;}
   if(pending&&!cssTransform&&Math.abs(viewer.currentScale-pending.scale)<.001){restore();if(pageNumber===pending.anchor?.page){stopAnchor();remember();}}
  });
  eventBus.on('updatefindmatchescount',({matchesCount})=>{if(!closed)search.querySelector('.pdf-find-result').textContent=matchesCount.total?`${matchesCount.current} / ${matchesCount.total}건`:'검색 결과 없음';});
  eventBus.on('updatefindcontrolstate',({state,matchesCount})=>{if(closed)return;search.querySelector('.pdf-find-result').textContent=state===3?'검색 중…':state===1?'검색 결과 없음':matchesCount?.total?`${matchesCount.current} / ${matchesCount.total}건`:'';});
  eventBus.on('namedaction',()=>{stopAnchor();});
  loading=library.getDocument({url:attachment.url,cMapUrl:'/vendor/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/pdfjs/standard_fonts/',wasmUrl:'/vendor/pdfjs/wasm/',isEvalSupported:false,disableAutoFetch:true,disableStream:true});doc=await loading.promise;if(closed)return;linkService.setDocument(doc,location.origin+attachment.url);viewer.setDocument(doc);updateControls();
 }catch(error){if(closed)return;message.textContent=error.name==='PasswordException'?'암호로 보호된 PDF입니다. 파일을 내려받아 열어 주세요.':'PDF를 불러오지 못했습니다. 닫은 뒤 다시 열어 주세요.';}})();
 return {close,isOpen:()=>!closed};
}
