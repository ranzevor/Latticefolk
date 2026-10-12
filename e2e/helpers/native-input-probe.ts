import {test as base,expect,type Page,type TestInfo,type APIRequestContext} from '@playwright/test';
import {scheduleNativePulse,type NativePulseRequest} from './native-pulse-scheduler.js';

const lateWildlife='late wildlife intent cannot mutate a rematerialized entity or consume its saved cursor';
const selected=new Set([
  'fine NPC parcel belongs to its source chunk and survives native unload/revisit before one-shot pickup',
  'coarse policy reply crossing a real materialize-unload transition is discarded and retry recovers',
  lateWildlife,
  'real playable scene keeps God View observer-only and uses authoritative ground',
  'ordinary walking crosses the home edge into the visible layout and preserves it through return and reload',
  'saved actors stay visible across an internal owner boundary and reload without expanding fine simulation'
]);

export const test=base.extend<{nativeInputProbe:void}>({nativeInputProbe:[async({page},use,info)=>{
  if(!selected.has(info.title)){await use();return;}
  const session=await page.context().newCDPSession(page);
  const report={test:info.title,hostTimeOrigin:performance.timeOrigin,pulses:[] as unknown[],routes:[] as unknown[],errors:[] as string[]};
  await page.exposeBinding('__latticeNativePulse',async(_source,request:NativePulseRequest&{routeId:string;browserIssuedAt:number})=>{
    const entry:{routeId:string;request:typeof request;hostReceivedAt:number;result?:unknown;error?:string}={
      routeId:request.routeId,request,hostReceivedAt:performance.timeOrigin+performance.now()
    };report.pulses.push(entry);
    const result=await scheduleNativePulse(request,{
      now:()=>performance.timeOrigin+performance.now(),
      schedule:(callback,delay)=>setTimeout(callback,delay),cancel:timer=>clearTimeout(timer as ReturnType<typeof setTimeout>),
      dispatch:command=>session.send('Input.dispatchKeyEvent',command)
    }).catch(error=>{entry.error=String(error);throw error;});
    entry.result=result;
    if(result.errors.length)throw new Error(result.errors.join('; '));
    return result;
  });
  await page.exposeBinding('__latticeNativeProbeRecord',(_source,value:unknown)=>{report.routes.push(value);});
  await page.addInitScript(()=>{
    type State={x:number;z:number;inputSeconds:number;clock:unknown;focused:boolean;hidden:boolean;nearbyActors?:unknown[]};
    type KeySample={type:string;code:string;eventAt:number;handledAt:number;trusted:boolean;state:State};
    type FrameSample={callbackAt:number;rafTimestamp:number;state:State};
    const root=window as unknown as {
      __latticeNativePulse:(value:unknown)=>Promise<{skipped?:boolean}>;
      __latticeNativeProbeRecord:(value:unknown)=>Promise<void>;
      nativeInputProbe:unknown;
    };
    let active=false,frame=0,sequence=0,routeId='',route:unknown,startedAt=0,startState:State|undefined;
    let keys:KeySample[]=[],frames:FrameSample[]=[],truncatedKeys=0,truncatedFrames=0;
    const held=new Set<string>();
    const releases=new Map<string,KeySample>();
    const read=():State=>{
      const d=document.querySelector<HTMLElement>('#worldStatus')?.dataset;
      return {x:Number(d?.playerX),z:Number(d?.playerZ),inputSeconds:Number(d?.playerInputSeconds),clock:JSON.parse(d?.simulationClock??'null'),focused:document.hasFocus(),hidden:document.hidden};
    };
    const boundaryState=():State=>{
      const state=read(),d=document.querySelector<HTMLElement>('#worldStatus')?.dataset;
      const actors=JSON.parse(d?.characterSoles??'[]') as Array<{id?:string;position:{x:number;z:number};headYaw:number;headEnvelope:unknown}>;
      state.nearbyActors=actors.filter(actor=>Math.hypot(actor.position.x-state.x,actor.position.z-state.z)<=4).slice(0,12)
        .map(actor=>({id:actor.id,position:actor.position,headYaw:actor.headYaw,headEnvelope:actor.headEnvelope}));
      return state;
    };
    const sample=(rafTimestamp:number)=>{
      if(!active)return;
      frames.push({callbackAt:performance.now(),rafTimestamp,state:read()});
      if(frames.length>512){frames.shift();truncatedFrames++;}
      frame=requestAnimationFrame(sample);
    };
    const key=(event:KeyboardEvent)=>{
      if(!active||!['KeyW','KeyA','KeyS','KeyD','ShiftLeft'].includes(event.code)||event.repeat)return;
      if(event.type==='keydown')held.add(event.code);else held.delete(event.code);
      const entry={type:event.type,code:event.code,eventAt:event.timeStamp,handledAt:performance.now(),trusted:event.isTrusted,state:read()};
      keys.push(entry);
      if(event.type==='keyup')releases.set(event.code,entry);
      if(keys.length>2048){keys.shift();truncatedKeys++;}
    };
    addEventListener('keydown',key);addEventListener('keyup',key);
    root.nativeInputProbe={
      start:(options:unknown)=>{
        routeId=`${performance.timeOrigin}:${++sequence}`;route=options;startedAt=performance.now();startState=boundaryState();
        keys=[];frames=[];held.clear();releases.clear();truncatedKeys=0;truncatedFrames=0;active=true;frame=requestAnimationFrame(sample);
      },
      pulse:async(request:{codes:string[];durationMs:number;deadlineEpochMs:number})=>{
        const previous=request.codes.map(code=>releases.get(code));
        const result=await root.__latticeNativePulse({...request,routeId,browserIssuedAt:performance.timeOrigin+performance.now()});
        if(result.skipped)return {result};
        const released=request.codes.map(code=>releases.get(code));
        if(released.some((event,index)=>!event||!event.trusted||!Number.isFinite(event.eventAt)||event.eventAt<0||event===previous[index]))throw new Error('Native pulse has no trusted release event');
        return {result,releasedEventAt:Math.max(...released.map(event=>event!.eventAt))};
      },
      finish:async()=>{
        active=false;cancelAnimationFrame(frame);
        await root.__latticeNativeProbeRecord({routeId,route,browserTimeOrigin:performance.timeOrigin,startedAt,startState,
          finishedAt:performance.now(),keys,frames,truncatedKeys,truncatedFrames,held:[...held],final:boundaryState()});
        if(keys.some(event=>!event.trusted)||held.size)throw new Error('Native probe observed untrusted input or an unreleased key');
      }
    };
  });
  try{await use();}finally{
    if(!page.isClosed())await session.detach().catch(error=>{report.errors.push(String(error));});
    const routes=report.routes.slice(-4).map(value=>{
      const route=value as {routeId:string;route:unknown;startedAt:number;finishedAt:number;startState:unknown;final:unknown;
        keys:unknown[];frames:unknown[];truncatedKeys:number;truncatedFrames:number;held:string[]};
      return {...route,keys:route.keys.slice(-16),frames:route.frames.slice(-16),
        omittedKeys:Math.max(0,route.keys.length-16),omittedFrames:Math.max(0,route.frames.length-16)};
    });
    const summary=JSON.stringify({test:report.test,routes,pulses:report.pulses.slice(-12),errors:report.errors.slice(-8)});
    if(Buffer.byteLength(summary)<=64*1024)console.info('native-input-summary',summary);
    else console.info('native-input-summary',JSON.stringify({test:report.test,summaryOmitted:true,bytes:Buffer.byteLength(summary)}));
    await info.attach('independent-native-input-probe',{body:Buffer.from(JSON.stringify(report,null,2)),contentType:'application/json'});
  }
},{auto:true}]});

export {expect};
export type {Page,TestInfo,APIRequestContext};


