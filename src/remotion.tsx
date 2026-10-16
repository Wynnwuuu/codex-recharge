import React from 'react';
import {Composition,registerRoot} from 'remotion';
import {RechargeComposition} from './Composition';
function Root(){return <>
 <Composition id="CodexRecharge" component={RechargeComposition} durationInFrames={900} fps={60} width={720} height={720} defaultProps={{mode:'reference' as const,remainingPercent:null,transparent:false}}/>
 <Composition id="CodexUsage" component={RechargeComposition} durationInFrames={900} fps={60} width={720} height={720} defaultProps={{mode:'usage' as const,remainingPercent:null,transparent:false}}/>
 </>};registerRoot(Root);
