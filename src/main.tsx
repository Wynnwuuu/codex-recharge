import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Player} from '@remotion/player';
import {RechargeComposition} from './Composition';
import './style.css';

type Placement='above'|'below';
type Status={remainingPercent:number|null;windows?:{label:string;remainingPercent:number;resetsAt:number|null}[];activeTasks:number|null;usageStatus:string;tasksStatus:string;updatedAt?:string;message?:string};
declare global {interface Window {codexDesktop?:boolean;__codexInitialStatus?:Status;__codexTooltipPlacement?:Placement;__codexDesktopHeight?:number;__codexNativeHovered?:boolean;webkit?:{messageHandlers:{codex:{postMessage:(data:unknown)=>void}}}}}
const empty:Status={remainingPercent:null,activeTasks:null,usageStatus:'unavailable',tasksStatus:'unavailable'};
const bridge=(action:string,extra={})=>window.webkit?.messageHandlers.codex.postMessage({action,...extra});
const openCodex=()=>{if(window.codexDesktop)bridge('openCodex');else window.location.href='codex://';};
function App(){
 const desktop=!!window.codexDesktop;
 const [status,setStatus]=useState<Status>(window.__codexInitialStatus??empty);
 const [demo,setDemo]=useState(false);
 const [hovered,setHovered]=useState(window.__codexNativeHovered===true);
 const [placement,setPlacement]=useState<Placement>(window.__codexTooltipPlacement??'below');
 const [desktopHeight,setDesktopHeight]=useState(window.__codexDesktopHeight??240);
 const companionRef=useRef<HTMLElement>(null);
 const tooltipRef=useRef<HTMLDivElement>(null);
 const down=useRef<{x:number;y:number}|null>(null);
 useEffect(()=>{
  const handler=(event:Event)=>setStatus((event as CustomEvent<Status>).detail);
  window.addEventListener('codex-status',handler);bridge('getStatus');
  if(!desktop){const load=()=>fetch('/api/status').then(r=>r.ok?r.json():Promise.reject()).then(setStatus).catch(()=>{});load();const timer=setInterval(load,30000);return()=>{clearInterval(timer);window.removeEventListener('codex-status',handler);};}
  return()=>window.removeEventListener('codex-status',handler);
 },[desktop]);
 useEffect(()=>{
  if(desktop){
   const onLayout=(event:Event)=>{
    const detail=(event as CustomEvent<{placement:Placement;panelHeight?:number}>).detail;
    if(detail?.placement==='above'||detail?.placement==='below')setPlacement(detail.placement);
    if(typeof detail?.panelHeight==='number'&&Number.isFinite(detail.panelHeight)&&detail.panelHeight>=240&&detail.panelHeight<=800)setDesktopHeight(detail.panelHeight);
   };
   const onHover=(event:Event)=>setHovered((event as CustomEvent<{hovered:boolean}>).detail?.hovered===true);
   let lastRegion='';
   const reportRegion=()=>{
    const companion=companionRef.current;
    const card=companion?.querySelector<SVGRectElement>('[data-card-surface]');
    if(!companion||!card)return;
    const outer=companion.getBoundingClientRect(), bounds=card.getBoundingClientRect();
    const scale=card.width.baseVal.value?bounds.width/card.width.baseVal.value:1;
    const region={x:bounds.left-outer.left,y:bounds.top-outer.top,width:bounds.width,height:bounds.height,radius:card.rx.baseVal.value*scale};
    const key=JSON.stringify(region);
    if(key!==lastRegion){lastRegion=key;bridge('setHoverRegion',region);}
   };
   const reportHeight=()=>{if(tooltipRef.current)bridge('setTooltipHeight',{height:Math.ceil(tooltipRef.current.getBoundingClientRect().height)});reportRegion();};
   const observer=new ResizeObserver(reportHeight);
   if(tooltipRef.current)observer.observe(tooltipRef.current);
   if(companionRef.current)observer.observe(companionRef.current);
   const mutationObserver=new MutationObserver(reportRegion);
   if(companionRef.current)mutationObserver.observe(companionRef.current,{childList:true,subtree:true});
   window.addEventListener('codex-layout',onLayout);window.addEventListener('codex-hover',onHover);
   bridge('getLayout');bridge('getHover');reportHeight();
   return()=>{observer.disconnect();mutationObserver.disconnect();window.removeEventListener('codex-layout',onLayout);window.removeEventListener('codex-hover',onHover);};
  }
  const update=()=>{
   const bounds=companionRef.current?.getBoundingClientRect();
   const tooltip=tooltipRef.current;
   if(!bounds||!tooltip)return;
   const viewport=window.visualViewport;
   const top=viewport?.offsetTop??0, bottom=top+(viewport?.height??window.innerHeight);
   const above=bounds.top-top, below=bottom-bounds.bottom;
   const needed=tooltip.offsetHeight+8;
   setPlacement(below>=needed&&(below>=above||above<needed)?'below':'above');
  };
  const observer=new ResizeObserver(update);
  if(companionRef.current)observer.observe(companionRef.current);
  if(tooltipRef.current)observer.observe(tooltipRef.current);
  window.addEventListener('resize',update);window.addEventListener('scroll',update,true);
  window.visualViewport?.addEventListener('resize',update);window.visualViewport?.addEventListener('scroll',update);
  update();
  return()=>{observer.disconnect();window.removeEventListener('resize',update);window.removeEventListener('scroll',update,true);window.visualViewport?.removeEventListener('resize',update);window.visualViewport?.removeEventListener('scroll',update);};
 },[desktop]);
 const tasks=status.activeTasks===null?'任务状态暂不可用':`${status.activeTasks} 个任务正在运行${status.tasksStatus==='stale'?' · 上次读取':''}`;
 const stale=status.usageStatus==='stale';
 const usage=status.remainingPercent===null?'正在读取 Codex 用量':`${Math.round(status.remainingPercent)}% 剩余${stale?' · 上次读取':''}`;
 return <main className={desktop?'desktop':'preview'} data-placement={placement} data-hovered={hovered} style={desktop?{height:desktopHeight}:undefined}>
 {!desktop&&<header><span className="brand-mark">◈</span><span>CODEX RECHARGE</span><span className="local-badge">本机运行</span></header>}
 <section ref={companionRef} className="companion" data-placement={placement} data-usage-status={status.usageStatus} onPointerEnter={()=>{if(desktop){bridge('getLayout');bridge('getHover');}}} onFocus={()=>{if(desktop)bridge('getLayout');}}>
 <button className="pet" aria-label={`打开 Codex，${usage}，${tasks}`} onPointerDown={e=>{down.current={x:e.screenX,y:e.screenY};if(desktop)bridge('drag',{phase:'start'});}} onPointerUp={e=>{if(desktop)bridge('drag',{phase:'end'});const d=down.current;down.current=null;if(d&&Math.hypot(e.screenX-d.x,e.screenY-d.y)<5){openCodex();}}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openCodex();}}}>
 <Player component={RechargeComposition} compositionWidth={720} compositionHeight={540} durationInFrames={900} fps={60} autoPlay loop controls={false} clickToPlay={false} doubleClickToFullscreen={false} spaceKeyToPlayOrPause={false} inputProps={{mode:demo?'reference':'usage',remainingPercent:status.remainingPercent,transparent:desktop,compact:true}} style={{width:'100%',height:'100%',pointerEvents:'none'}}/>
 </button>
 <div ref={tooltipRef} className="tooltip" role="status"><div className="tooltip-title"><i className={status.activeTasks?'busy':'idle'}/>{tasks}</div><div>{usage}</div>{status.windows?.map((w,i)=><small key={i}>{w.label} · {Math.round(w.remainingPercent)}% 剩余</small>)}<small>点击打开 Codex · 拖动调整位置</small></div>
 </section>
 {!desktop&&<footer><p className="status-line">{usage}<span>·</span>{tasks}</p><div className="controls"><button className={demo?'':'selected'} onClick={()=>setDemo(false)}>实时用量</button><button className={demo?'selected':''} onClick={()=>setDemo(true)}>参考动画</button></div><p className="footnote">悬停查看任务状态，点击打开 Codex</p></footer>}
 </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
