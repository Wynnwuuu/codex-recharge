import React from 'react';

export type RechargeCardProps = {frame:number; level:number|null; title?:string; showPercentage?:boolean; transparent?:boolean};
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
export function RechargeCard({frame,level,title='Codex',showPercentage=true,transparent=false}:RechargeCardProps){
 const p=level===null?0:clamp(level);
 const hue=p<30?Math.max(0,(p-20)*2):p<60?20+(p-30)*1.2:56+(p-60)*1.15;
 const phase=frame/60*Math.PI*2*0.6;
 const boundary=146+428*p/100;
 const wobble=Math.sin(phase)*4.5;
 const wave=`M 120 375 H ${boundary} C ${boundary-13+wobble} 438 ${boundary+14+wobble} 465 ${boundary-3} 493 C ${boundary-16+wobble} 529 ${boundary+7} 554 ${boundary} 588 H 120 Z`;
 const hot=p>=95?'#ecff00':`hsl(${hue+12} 100% 53%)`;
 const middle=`hsl(${hue} 100% 49%)`;
 const dark=`hsl(${Math.min(120,hue+20)} 100% ${p>=60?16:42}%)`;
 const id=React.useId().replace(/:/g,'');
 const ref=(name:string)=>`url(#${id}-${name})`;
 return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 720" width="100%" height="100%" role="img" aria-label={`${title}, ${level===null?'用量读取中':`${Math.round(p)}% 剩余`}`}>
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
  <clipPath id={`${id}-pill`}><rect x="146" y="394" width="428" height="178" rx="89"/></clipPath>
  <clipPath id={`${id}-card`}><rect x="133" y="133" width="454" height="454" rx="110"/></clipPath>
  <pattern id={`${id}-dots`} width="11" height="11" patternUnits="userSpaceOnUse"><circle cx="5.5" cy="5.5" r="2.8" fill={hot} opacity=".018"/></pattern>
 </defs>
 {!transparent&&<rect width="720" height="720" fill="white"/>}
 <rect x="133" y="421" width="454" height="196" rx="90" fill="#161610" opacity=".31" filter={ref('shadow')}/>
 <ellipse cx="360" cy="588" rx="246" ry="80" fill={ref('pool')} filter={ref('bloom')}/>
 <rect x="115" y="115" width="490" height="490" rx="127" fill={ref('rim')}/>
 <rect x="133" y="133" width="454" height="454" rx="110" fill={ref('body')}/>
 <g clipPath={ref('card')}><ellipse cx="360" cy="515" rx="340" ry="210" fill={ref('pool')}/><rect x="138" y="290" width="444" height="310" fill={ref('dots')}/></g>
 <text x="360" y="256" textAnchor="middle" fill="#fafaf9" fontFamily="Arial, Helvetica, sans-serif" fontSize="72" fontWeight="700" letterSpacing="-3.2">{title}</text>
 <g fill="#fff" opacity=".28" fontFamily="Arial, Helvetica, sans-serif" fontSize="32"><text x="187" y="370" textAnchor="middle">0</text><text x="341" y="370" textAnchor="middle">50</text><text x="515" y="370" textAnchor="middle">100</text></g>
 <rect x="146" y="394" width="428" height="178" rx="89" fill={hot} opacity=".19" filter={ref('bloom')}/>
 <rect x="146" y="394" width="428" height="178" rx="89" fill="#272522"/>
 <g clipPath={ref('pill')}>
  <rect x="146" y="394" width="428" height="178" fill={ref('empty')}/>
  {level!==null&&<g><path d={wave} fill={ref('fill')}/><path d={wave} fill="none" stroke={hot} strokeWidth="13" opacity=".72" filter={ref('soft')}/></g>}
  <rect x="151" y="399" width="418" height="168" rx="84" fill="none" stroke={hot} strokeWidth="13" opacity={p>95?.47:.17} filter={ref('soft')}/>
  <rect x="146" y="394" width="428" height="178" fill={ref('surface')}/>
  <rect x="148" y="396" width="424" height="174" rx="87" fill="none" stroke={ref('outline')} strokeWidth="4"/>
  {showPercentage&&<text x="360" y="503" textAnchor="middle" fill={p>75?'#183200':'#fff9ee'} opacity=".94" style={{fontVariantNumeric:'tabular-nums'}} fontFamily="Arial, Helvetica, sans-serif" fontSize="59" fontWeight="600" letterSpacing="-2">{level===null?'—':`${Math.round(p)}%`}</text>}
 </g>
 <rect x="146" y="394" width="428" height="178" rx="89" fill="none" stroke={ref('outline')} strokeWidth="2"/>
 </svg>;
}
