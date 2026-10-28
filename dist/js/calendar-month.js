import {calendarMonth,chronological,kstClock,isMajorEconomic} from './calendar-model.js';
import {economicTooltip} from './calendar-presentation.js';
import {economicLabel} from './economic-labels.js';
import {escapeHtml as esc} from './components.js';
export function monthCaption(date){return date.slice(0,4)+'년 '+Number(date.slice(5,7))+'월';}
export function renderMonthGrid(items,selected,today){
 const {cells}=calendarMonth(selected),days=new Map();
 for(const event of chronological(items)){if(event.dateConfirmed===false)continue;const day=event.dateKst;if(!days.has(day))days.set(day,[]);days.get(day).push(event);}
 const rows=[];
 for(let i=0;i<cells.length;i+=7)rows.push('<div class="economic-week" role="row">'+cells.slice(i,i+7).map((day,column)=>{
  if(!day)return '<div class="economic-day empty-day" role="gridcell"></div>';
  const events=days.get(day)||[],label=day+' · '+(events.length?events.length+'건':'일정 없음');
  return '<div role="gridcell" class="economic-day '+(column===0?'sunday':column===6?'saturday':'')+'" aria-selected="'+(day===selected)+'"><button class="economic-day-button" data-calendar="day" data-date="'+day+'" aria-label="'+label+'"'+(day===today?' aria-current="date"':'')+' tabindex="'+(day===selected?0:-1)+'"><span class="economic-day-top"><b>'+Number(day.slice(-2))+'</b>'+(day===today?'<small>오늘</small>':'')+'</span><span class="economic-day-events">'+events.slice(0,2).map(event=>'<span class="economic-mini-event '+(isMajorEconomic(event)?'is-important':'')+'" title="'+esc(economicTooltip(event).join('\n'))+'"><time>'+(event.startsAt?kstClock(event.startsAt):'미정')+'</time><span>'+esc((isMajorEconomic(event)?'✓ ':'')+economicLabel(event).title)+'</span></span>').join('')+(events.length>2?'<span class="economic-day-more">+'+(events.length-2)+'건</span>':'')+'</span>'+(events.length?'<span class="economic-day-count">'+events.length+'건</span>':'')+'</button></div>';
 }).join('')+'</div>');
 return '<div class="economic-month" role="grid" aria-label="'+monthCaption(selected)+' 경제 일정"><div class="economic-week weekdays" role="row">'+['일','월','화','수','목','금','토'].map(day=>'<span role="columnheader">'+day+'</span>').join('')+'</div>'+rows.join('')+'</div>';
}
