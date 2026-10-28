// PDF coordinates, rather than canvas pixels, survive zoom, rotation and page-size changes.
export const MIN_PDF_SCALE=.1,MAX_PDF_SCALE=6;
export const clamp=(value,min,max)=>Math.min(Math.max(value,min),Math.max(min,max));
export function wheelScale(scale,delta,mode=0,height=800){
 const pixels=delta*(mode===1?16:mode===2?height:1);
 return clamp(scale*Math.exp(-clamp(pixels,-300,300)*.002),MIN_PDF_SCALE,MAX_PDF_SCALE);
}
export function touchGeometry(touches){
 const [a,b]=touches;if(!a||!b)return null;
 return {x:(a.clientX+b.clientX)/2,y:(a.clientY+b.clientY)/2,distance:Math.max(1,Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY))};
}
export function capturePdfAnchor(viewer,stage,clientX,clientY){
 const bounds=stage.getBoundingClientRect();
 clientX??=bounds.left+stage.clientWidth/2;clientY??=bounds.top+stage.clientHeight/2;
 let chosen=null,best=Infinity;
 for(let index=0;index<viewer.pagesCount;index++){
  const page=viewer.getPageView(index),rect=page.div.getBoundingClientRect();
  const distance=Math.max(rect.top-clientY,clientY-rect.bottom,0);
  if(distance<best){chosen=page;best=distance;}if(!distance)break;
 }
 if(!chosen)return null;
 const rect=chosen.div.getBoundingClientRect();
 // PDF.js rounds page CSS dimensions to canvas pixel increments (especially HiDPI).
 // Convert through the displayed content box so that those rounding differences do not drift.
 const [x,y]=chosen.viewport.convertToPdfPoint((clientX-rect.left-chosen.div.clientLeft)*chosen.viewport.width/chosen.div.clientWidth,(clientY-rect.top-chosen.div.clientTop)*chosen.viewport.height/chosen.div.clientHeight);
 return {page:chosen.id,x,y,screenX:clientX-bounds.left,screenY:clientY-bounds.top};
}
export function restorePdfAnchor(viewer,stage,anchor){
 if(!anchor)return;
 const page=viewer.getPageView(anchor.page-1);if(!page)return;
 const [x,y]=page.viewport.convertToViewportPoint(anchor.x,anchor.y),rect=page.div.getBoundingClientRect(),bounds=stage.getBoundingClientRect();
 stage.scrollLeft=clamp(stage.scrollLeft+rect.left+page.div.clientLeft+x*page.div.clientWidth/page.viewport.width-bounds.left-anchor.screenX,0,stage.scrollWidth-stage.clientWidth);
 stage.scrollTop=clamp(stage.scrollTop+rect.top+page.div.clientTop+y*page.div.clientHeight/page.viewport.height-bounds.top-anchor.screenY,0,stage.scrollHeight-stage.clientHeight);
}
