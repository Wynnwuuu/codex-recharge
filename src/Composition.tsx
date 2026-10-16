import React from 'react';
import {AbsoluteFill,useCurrentFrame} from 'remotion';
import {RechargeCard,demoLevel} from './RechargeCard';
export type SceneProps={mode:'reference'|'usage';remainingPercent:number|null;transparent:boolean;compact?:boolean};
export function RechargeComposition({mode,remainingPercent,transparent,compact}:SceneProps){
 const frame=useCurrentFrame();
 return <AbsoluteFill><RechargeCard frame={frame} level={mode==='reference'?demoLevel(frame):remainingPercent} transparent={transparent} compact={compact}/></AbsoluteFill>;
}
