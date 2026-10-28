export function monthShift(month,delta){const [year,m]=month.split('-').map(Number),d=new Date(Date.UTC(year,m-1+delta,1));return d.toISOString().slice(0,7);}
export function monthCells(month){
 const [year,m]=month.split('-').map(Number),offset=new Date(Date.UTC(year,m-1,1)).getUTCDay(),days=new Date(Date.UTC(year,m,0)).getUTCDate();
 return Array.from({length:Math.ceil((offset+days)/7)*7},(_,i)=>i<offset||i>=offset+days?null:month+'-'+String(i-offset+1).padStart(2,'0'));
}
export function monthLabel(month){const [year,m]=month.split('-');return year+'년 '+Number(m)+'월';}
