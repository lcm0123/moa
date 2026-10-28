import test from 'node:test';
import assert from 'node:assert/strict';
import {capturePdfAnchor,restorePdfAnchor,wheelScale,touchGeometry,clamp} from '../dist/js/pdf-navigation.js';

function documentModel(){
 let scale=1;
 const sizes=Array.from({length:18},(_,i)=>i===9?[840,600]:[600,840]);
 const stage={clientWidth:900,clientHeight:640,scrollLeft:0,scrollTop:0,getBoundingClientRect:()=>({left:42,top:118}),get scrollWidth(){return Math.max(this.clientWidth,840*scale+32);},get scrollHeight(){return sizes.reduce((sum,s)=>sum+s[1]*scale+18,32);}};
 const pages=sizes.map(([w,h],i)=>({id:i+1,get viewport(){return {width:w*scale,height:h*scale,convertToPdfPoint:(x,y)=>[x/scale,h-y/scale],convertToViewportPoint:(x,y)=>[x*scale,(h-y)*scale]};},div:{clientLeft:0,clientTop:0,get clientWidth(){return w*scale;},get clientHeight(){return h*scale;},getBoundingClientRect(){const left=42+(stage.scrollWidth-w*scale)/2-stage.scrollLeft,top=118+16+sizes.slice(0,i).reduce((s,p)=>s+p[1]*scale+18,0)-stage.scrollTop;return {left,top,right:left+w*scale,bottom:top+h*scale,width:w*scale,height:h*scale};}}}));
 return {stage,viewer:{pagesCount:pages.length,getPageView:i=>pages[i]},scale:value=>scale=value};
}
function close(actual,expected){assert.ok(Math.abs(actual-expected)<.001,`${actual} != ${expected}`);}
test('zoom retains the PDF point at each viewport corner, across 18 mixed-size pages',()=>{
 for(const pageIndex of [0,8,9,10,17])for(const [x,y] of [[30,25],[870,25],[30,610],[870,610],[450,320]]){
  const m=documentModel();m.scale(2);const r=m.viewer.getPageView(pageIndex).div.getBoundingClientRect();m.stage.scrollTop=clamp(r.top-118+80,0,m.stage.scrollHeight-m.stage.clientHeight);m.stage.scrollLeft=300;
  const before=capturePdfAnchor(m.viewer,m.stage,42+x,118+y);m.scale(3);restorePdfAnchor(m.viewer,m.stage,before);
  const after=capturePdfAnchor(m.viewer,m.stage,42+x,118+y);assert.equal(after.page,before.page);close(after.x,before.x);close(after.y,before.y);
 }
});
test('fit-to-zoom centering and zoom-out respect reachable document bounds',()=>{
 const m=documentModel();m.stage.scrollTop=4000;const before=capturePdfAnchor(m.viewer,m.stage);m.scale(2);restorePdfAnchor(m.viewer,m.stage,before);const after=capturePdfAnchor(m.viewer,m.stage);close(after.x,before.x);close(after.y,before.y);
 m.scale(.2);restorePdfAnchor(m.viewer,m.stage,{...before,screenX:900,screenY:640});assert.equal(m.stage.scrollLeft,0);assert.ok(m.stage.scrollTop>=0&&m.stage.scrollTop<=m.stage.scrollHeight-m.stage.clientHeight);
});
test('pinch combines magnification with moving midpoint, without changing anchored PDF coordinates',()=>{
 const m=documentModel();m.scale(2);m.stage.scrollTop=5000;m.stage.scrollLeft=300;
 const start=touchGeometry([{clientX:242,clientY:318},{clientX:442,clientY:318}]);
 const end=touchGeometry([{clientX:262,clientY:358},{clientX:562,clientY:358}]);
 const anchor=capturePdfAnchor(m.viewer,m.stage,start.x,start.y);m.scale(2*end.distance/start.distance);
 restorePdfAnchor(m.viewer,m.stage,{...anchor,screenX:end.x-42,screenY:end.y-118});
 const actual=capturePdfAnchor(m.viewer,m.stage,end.x,end.y);assert.equal(actual.page,anchor.page);close(actual.x,anchor.x);close(actual.y,anchor.y);
});
test('wheel/trackpad delta units, limits and drag bounds are explicit',()=>{
 close(wheelScale(1,-16,0),wheelScale(1,-1,1));assert.ok(wheelScale(1,-50)>1);assert.ok(wheelScale(1,50)<1);
 assert.equal(wheelScale(6,-300),6);assert.equal(wheelScale(.1,300),.1);assert.equal(clamp(-800,0,40),0);assert.equal(clamp(800,0,40),40);
});
test('canvas-aligned CSS rounding does not drift from the actual visible point',()=>{
 let scale=2;const stage={clientWidth:390,clientHeight:600,scrollLeft:350,scrollTop:230,scrollWidth:5000,scrollHeight:6000,getBoundingClientRect:()=>({left:0,top:80})};
 const page={id:1,get viewport(){return {width:600.4*scale,height:840.4*scale,convertToPdfPoint:(x,y)=>[x/scale,y/scale],convertToViewportPoint:(x,y)=>[x*scale,y*scale]};},div:{clientLeft:0,clientTop:0,get clientWidth(){return Math.ceil(600.4*scale/4)*4;},get clientHeight(){return Math.ceil(840.4*scale/4)*4;},getBoundingClientRect(){return {left:-stage.scrollLeft,top:80-stage.scrollTop,bottom:80-stage.scrollTop+this.clientHeight};}}};
 const viewer={pagesCount:1,getPageView:()=>page},a=capturePdfAnchor(viewer,stage,30,120);scale=2.37;restorePdfAnchor(viewer,stage,a);const b=capturePdfAnchor(viewer,stage,30,120);close(a.x,b.x);close(a.y,b.y);
});
