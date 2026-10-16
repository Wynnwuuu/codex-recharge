import React from 'react';

export type RechargeCardProps = {frame:number; level:number|null; title?:string; showPercentage?:boolean; transparent?:boolean; compact?:boolean};
const clamp=(v:number)=>Math.max(0,Math.min(100,v));
export const demoLevel=(frame:number):number=>{
 const t=(frame/60)%15;
 const smooth=(x:number)=>x*x*(3-2*x);
 if(t<1.25)return 20;
 if(t<2.5)return 20+80*smooth((t-1.25)/1.25);
 if(t<8.2)return 100;
 if(t<10)return 100-80*smooth((t-8.2)/1.8);
 return 20;
};

/** Shared, deterministic vector scene used by both Remotion and the desktop Player. */
export function RechargeCard({frame,level,title='Codex',showPercentage=true,transparent=false,compact=false}:RechargeCardProps){
 const p=level===null?0:clamp(level);
 const cardHeight=compact?330:490;
 const cardWidth=compact?600:490, cardX=(720-cardWidth)/2;
 const pillInset=compact?48:31;
 const pillX=cardX+pillInset, pillWidth=cardWidth-pillInset*2;
 const pillY=compact?300:394, pillHeight=compact?95:178, pillRadius=pillHeight/2;
 const floor=115+cardHeight;
 const hue=p<30?Math.max(0,(p-20)*2):p<60?20+(p-30)*1.2:56+(p-60)*1.15;
 const phase=frame/60*Math.PI*2*0.6;
 const boundary=pillX+pillWidth*p/100;
 // A travelling liquid edge: generous alternating bends, with slower breathing.
 // At 0/100% the displacement fades so empty/full remain visually accurate.
 const edgeFactor=Math.min(1,p/15,(100-p)/15);
 const amplitude=(compact?25:20)*(1+.16*Math.sin(phase/3))*edgeFactor;
 const points=Array.from({length:9},(_,i)=>({
  x:boundary+Math.sin(phase+i/8*Math.PI*1.6)*amplitude,
  y:pillY-20+i/8*(pillHeight+40),
 }));
 let wave=`M ${pillX-26} ${points[0].y} H ${points[0].x}`;
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],before=points[Math.max(0,i-2)],after=points[Math.min(points.length-1,i+1)];
  wave+=` C ${a.x+(b.x-before.x)/6} ${a.y+(b.y-before.y)/6} ${b.x-(after.x-a.x)/6} ${b.y-(after.y-a.y)/6} ${b.x} ${b.y}`;
 }
 wave+=` H ${pillX-26} Z`;
 const hot=p>=95?'#ecff00':`hsl(${hue+12} 100% 53%)`;
 const middle=`hsl(${hue} 100% 49%)`;
 const dark=`hsl(${Math.min(120,hue+20)} 100% ${p>=60?16:42}%)`;
 const id=React.useId().replace(/:/g,'');
 const ref=(name:string)=>`url(#${id}-${name})`;
 return <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 720 ${compact?540:720}`} width="100%" height="100%" role="img" aria-label={`${title}, ${level===null?'用量读取中':`${Math.round(p)}% 剩余`}`}>
 <defs>
  <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#4b4b4a"/><stop offset=".47" stopColor="#262523"/><stop offset="1" stopColor="#11120e"/></linearGradient>
  <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#303030"/><stop offset=".55" stopColor="#20201f"/><stop offset="1" stopColor="#1c1e12"/></linearGradient>
  <linearGradient id={`${id}-fill`} x1="0" y1=".5" x2="1" y2=".5"><stop stopColor={dark}/><stop offset=".55" stopColor={middle}/><stop offset="1" stopColor={hot}/></linearGradient>
  <linearGradient id={`${id}-empty`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#fff" stopOpacity=".18"/><stop offset=".5" stopColor="#fff" stopOpacity=".015"/><stop offset="1" stopColor={hot} stopOpacity=".10"/></linearGradient>
  <linearGradient id={`${id}-outline`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff" stopOpacity=".28"/><stop offset=".5" stopColor={hot} stopOpacity=".12"/><stop offset="1" stopColor="#fff" stopOpacity=".48"/></linearGradient>
  <linearGradient id={`${id}-surface`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#fff" stopOpacity=".17"/><stop offset=".3" stopColor="#fff" stopOpacity="0"/><stop offset=".75" stopColor="#000" stopOpacity=".05"/><stop offset="1" stopColor="#fff" stopOpacity=".22"/></linearGradient>
  <radialGradient id={`${id}-pool`}><stop stopColor={middle} stopOpacity=".29"/><stop offset="1" stopColor={middle} stopOpacity="0"/></radialGradient>
  <filter id={`${id}-shadow`} x="-50%" y="-50%" width="200%" height="230%"><feGaussianBlur stdDeviation="19"/></filter>
  <filter id={`${id}-bloom`} x="-50%" y="-100%" width="200%" height="300%"><feGaussianBlur stdDeviation="12"/></filter>
  <filter id={`${id}-soft`}><feGaussianBlur stdDeviation="2.2"/></filter>
  <clipPath id={`${id}-pill`}><rect x={pillX} y={pillY} width={pillWidth} height={pillHeight} rx={pillRadius}/></clipPath>
  <clipPath id={`${id}-card`}><rect x={cardX+18} y="133" width={cardWidth-36} height={cardHeight-36} rx="110"/></clipPath>
  <pattern id={`${id}-dots`} width="11" height="11" patternUnits="userSpaceOnUse"><circle cx="5.5" cy="5.5" r="2.8" fill={hot} opacity=".018"/></pattern>
 </defs>
 {!transparent&&<rect width="720" height={compact?540:720} fill="white"/>}
 <rect x={cardX+18} y={compact?320:421} width={cardWidth-36} height={compact?137:196} rx="90" fill="#161610" opacity=".31" filter={ref('shadow')}/>
 <ellipse cx="360" cy={floor-17} rx="246" ry="80" fill={ref('pool')} filter={ref('bloom')}/>
 <rect x={cardX} y="115" width={cardWidth} height={cardHeight} rx="127" fill={ref('rim')}/>
 <rect x={cardX+18} y="133" width={cardWidth-36} height={cardHeight-36} rx="110" fill={ref('body')}/>
 <g clipPath={ref('card')}><ellipse cx="360" cy={compact?355:515} rx="340" ry="210" fill={ref('pool')}/><rect x={cardX+23} y={compact?245:290} width={cardWidth-46} height={compact?210:310} fill={ref('dots')}/></g>
 <text x="360" y={compact?233:256} textAnchor="middle" fill="#fafaf9" fontFamily="Arial, Helvetica, sans-serif" fontSize="72" fontWeight="700" letterSpacing="-3.2">{title}</text>
 <g fill="#fff" opacity=".28" fontFamily="Arial, Helvetica, sans-serif" fontSize="32"><text x={pillX+41} y={compact?279:370} textAnchor="middle">0</text><text x={compact?360:341} y={compact?279:370} textAnchor="middle">50</text><text x={pillX+pillWidth-59} y={compact?279:370} textAnchor="middle">100</text></g>
 <rect x={pillX} y={pillY} width={pillWidth} height={pillHeight} rx={pillRadius} fill={hot} opacity=".19" filter={ref('bloom')}/>
 <rect x={pillX} y={pillY} width={pillWidth} height={pillHeight} rx={pillRadius} fill="#272522"/>
 <g clipPath={ref('pill')}>
  <rect x={pillX} y={pillY} width={pillWidth} height={pillHeight} fill={ref('empty')}/>
  {level!==null&&<g><path d={wave} fill={ref('fill')}/><path d={wave} fill="none" stroke={hot} strokeWidth="13" opacity=".72" filter={ref('soft')}/></g>}
  <rect x={pillX+5} y={pillY+5} width={pillWidth-10} height={pillHeight-10} rx={pillRadius-5} fill="none" stroke={hot} strokeWidth="13" opacity={p>95?.47:.17} filter={ref('soft')}/>
  <rect x={pillX} y={pillY} width={pillWidth} height={pillHeight} fill={ref('surface')}/>
  <rect x={pillX+2} y={pillY+2} width={pillWidth-4} height={pillHeight-4} rx={pillRadius-2} fill="none" stroke={ref('outline')} strokeWidth="4"/>
  {showPercentage&&<text x="360" y={pillY+pillHeight*.612} textAnchor="middle" fill={p>75?'#183200':'#fff9ee'} opacity=".94" style={{fontVariantNumeric:'tabular-nums'}} fontFamily="Arial, Helvetica, sans-serif" fontSize="59" fontWeight="600" letterSpacing="-2">{level===null?'—':`${Math.round(p)}%`}</text>}
 </g>
 <rect x={pillX} y={pillY} width={pillWidth} height={pillHeight} rx={pillRadius} fill="none" stroke={ref('outline')} strokeWidth="2"/>
 </svg>;
}
