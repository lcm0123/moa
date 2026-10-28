// Lightweight Charts 5 series primitive. Projection uses logical BAR positions.
// It adds no dates, prices or volume to the market-data series/time scale.
export class IchimokuPrimitive {
 constructor(series,config,count){
  this.lines=series;this.config=config;this.count=count;
  this.views=[{zOrder:()=> 'bottom',renderer:()=>({draw:target=>this.draw(target,true)})},{zOrder:()=> 'normal',renderer:()=>({draw:target=>this.draw(target,false)})}];
 }
 attached({chart,series,requestUpdate}){this.chart=chart;this.series=series;requestUpdate();}
 detached(){this.chart=null;this.series=null;}
 paneViews(){return this.views;}
 bounds(){const r=this.chart?.timeScale().getVisibleLogicalRange();return r?{from:Math.max(0,Math.floor(r.from)-1),to:Math.min(this.count+this.config.displacement-1,Math.ceil(r.to)+1)}:null;}
 autoscaleInfo(){const r=this.bounds();if(!r)return null;let min=Infinity,max=-Infinity;for(const s of this.lines)for(let i=r.from;i<=r.to;i++){const v=s.values[i];if(Number.isFinite(v)){min=Math.min(min,v);max=Math.max(max,v);}}return Number.isFinite(min)?{priceRange:{minValue:min,maxValue:max}}:null;}
 draw(target,cloud){
  if(!this.chart||!this.series)return;const r=this.bounds();if(!r)return;
  target.useMediaCoordinateSpace(({context:ctx,mediaSize})=>{
   const x=i=>this.chart.timeScale().logicalToCoordinate(i),y=v=>this.series.priceToCoordinate(v),valid=Number.isFinite;
   ctx.save();ctx.beginPath();ctx.rect(0,0,mediaSize.width,mediaSize.height);ctx.clip();
   if(cloud&&this.config.cloud){
    const a=this.lines.find(s=>s.component==='spanA')?.values||[],b=this.lines.find(s=>s.component==='spanB')?.values||[];ctx.globalAlpha=this.config.cloudOpacity/100;
    const fill=(x0,x1,a0,a1,b0,b1,bull)=>{ctx.fillStyle=this.config.colors[bull?2:3];ctx.beginPath();ctx.moveTo(x0,y(a0));ctx.lineTo(x1,y(a1));ctx.lineTo(x1,y(b1));ctx.lineTo(x0,y(b0));ctx.closePath();ctx.fill();};
    for(let i=Math.max(1,r.from);i<=r.to;i++){const a0=a[i-1],a1=a[i],b0=b[i-1],b1=b[i],x0=x(i-1),x1=x(i);if(![a0,a1,b0,b1,x0,x1].every(valid))continue;const d0=a0-b0,d1=a1-b1;
     if(d0*d1<0){const t=d0/(d0-d1),xc=x0+(x1-x0)*t,c=a0+(a1-a0)*t;fill(x0,xc,a0,c,b0,c,d0>0);fill(xc,x1,c,a1,c,b1,d1>0);}else fill(x0,x1,a0,a1,b0,b1,(d0||d1)>=0);
    }
   }else if(!cloud){
    for(const s of this.lines){ctx.strokeStyle=s.color;ctx.lineWidth=s.width;ctx.lineJoin='round';ctx.beginPath();let active=false;
     for(let i=r.from;i<=r.to;i++){const value=s.values[i],px=x(i),py=valid(value)?y(value):null;if(![value,px,py].every(valid)){active=false;continue;}if(active)ctx.lineTo(px,py);else ctx.moveTo(px,py);active=true;}ctx.stroke();
    }
    // v5.2 logicalToCoordinate accepts integer indices: interpolate the half-bar boundary.
    const last=x(this.count-1),next=x(this.count),boundary=valid(last)&&valid(next)?(last+next)/2:null;
    if(valid(boundary)&&boundary<mediaSize.width&&this.lines.some(s=>['spanA','spanB'].includes(s.component)&&s.values.slice(this.count).some(valid))){ctx.strokeStyle='#9aa6b570';ctx.lineWidth=1;ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(boundary,0);ctx.lineTo(boundary,mediaSize.height);ctx.stroke();ctx.setLineDash([]);ctx.font='11px sans-serif';ctx.fillStyle='#748399';ctx.fillText('선행 구간',Math.max(4,boundary+6),18);}
   }
   ctx.restore();
  });
 }
}
