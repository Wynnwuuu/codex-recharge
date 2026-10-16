import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Player} from '@remotion/player';
import {RechargeComposition} from './Composition';
import './style.css';

type Status={remainingPercent:number|null;windows?:{label:string;remainingPercent:number;resetsAt:number|null}[];activeTasks:number|null;usageStatus:string;tasksStatus:string;updatedAt?:string;message?:string};
declare global {interface Window {codexDesktop?:boolean;__codexInitialStatus?:Status;webkit?:{messageHandlers:{codex:{postMessage:(data:unknown)=>void}}}}}
const empty:Status={remainingPercent:null,activeTasks:null,usageStatus:'unavailable',tasksStatus:'unavailable'};
const bridge=(action:string,extra={})=>window.webkit?.messageHandlers.codex.postMessage({action,...extra});
const openCodex=()=>{if(window.codexDesktop)bridge('openCodex');else window.location.href='codex://';};
function App(){
 const desktop=!!window.codexDesktop;
 const [status,setStatus]=useState<Status>(window.__codexInitialStatus??empty);
 const [demo,setDemo]=useState(false);
 const down=useRef<{x:number;y:number}|null>(null);
 useEffect(()=>{
  const handler=(event:Event)=>setStatus((event as CustomEvent<Status>).detail);
  window.addEventListener('codex-status',handler);bridge('getStatus');
  if(!desktop){const load=()=>fetch('/api/status').then(r=>r.ok?r.json():Promise.reject()).then(setStatus).catch(()=>{});load();const timer=setInterval(load,30000);return()=>{clearInterval(timer);window.removeEventListener('codex-status',handler);};}
  return()=>window.removeEventListener('codex-status',handler);
 },[desktop]);
 const tasks=status.activeTasks===null?'任务状态暂不可用':`${status.activeTasks} 个任务正在运行${status.tasksStatus==='stale'?' · 上次读取':''}`;
 const stale=status.usageStatus==='stale';
 const usage=status.remainingPercent===null?'正在读取 Codex 用量':`${Math.round(status.remainingPercent)}% 剩余${stale?' · 上次读取':''}`;
 return <main className={desktop?'desktop':'preview'}>
 {!desktop&&<header><span className="brand-mark">◈</span><span>CODEX RECHARGE</span><span className="local-badge">本机运行</span></header>}
 <section className="companion" data-usage-status={status.usageStatus}>
 <button className="pet" aria-label={`打开 Codex，${usage}，${tasks}`} onPointerDown={e=>{down.current={x:e.screenX,y:e.screenY};if(desktop)bridge('drag',{phase:'start'});}} onPointerUp={e=>{if(desktop)bridge('drag',{phase:'end'});const d=down.current;down.current=null;if(d&&Math.hypot(e.screenX-d.x,e.screenY-d.y)<5){openCodex();}}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openCodex();}}}>
 <Player component={RechargeComposition} compositionWidth={720} compositionHeight={720} durationInFrames={900} fps={60} autoPlay loop controls={false} clickToPlay={false} doubleClickToFullscreen={false} spaceKeyToPlayOrPause={false} inputProps={{mode:demo?'reference':'usage',remainingPercent:status.remainingPercent,transparent:desktop}} style={{width:'100%',height:'100%',pointerEvents:'none'}}/>
 </button>
 <div className="tooltip" role="status"><div className="tooltip-title"><i className={status.activeTasks?'busy':'idle'}/>{tasks}</div><div>{usage}</div>{status.windows?.map((w,i)=><small key={i}>{w.label} · {Math.round(w.remainingPercent)}% 剩余</small>)}<small>点击打开 Codex · 拖动调整位置</small></div>
 </section>
 {!desktop&&<footer><p className="status-line">{usage}<span>·</span>{tasks}</p><div className="controls"><button className={demo?'':'selected'} onClick={()=>setDemo(false)}>实时用量</button><button className={demo?'selected':''} onClick={()=>setDemo(true)}>参考动画</button></div><p className="footnote">悬停查看任务状态，点击打开 Codex</p></footer>}
 </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
