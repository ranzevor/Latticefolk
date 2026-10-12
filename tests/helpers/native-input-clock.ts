import assert from 'node:assert/strict';
import {SimulationClock,type PlayerMovementInput} from '../../src/world/simulationClock.js';

export function nativeInputClock(options:{frameMs:number;frameIntervals?:number[];onStep:(dt:number,keys:Set<string>,input:PlayerMovementInput)=>void;direction?:()=>{directionX:number;directionZ:number};onFrame?:()=>void;rafThrows?:boolean;timerDelayMs?:number;noFrames?:boolean}){
  const clock=new SimulationClock(),held=new Set<string>();
  const timers=new Map<number,{at:number;callback:()=>void}>(),frames=new Map<number,()=>void>();
  const events:Array<{type:string;code:string;at:number;frame:number}>=[];
  let time=0,count=0,inputSeconds=0,id=0,nextFrame=options.frameIntervals?.[0]??options.frameMs,scheduled=false,failure:unknown;
  clock.advance(0,()=>{});
  const keys=(input:PlayerMovementInput|undefined)=>{
    const result=new Set<string>();if(!input)return result;
    if(input.right>0)result.add('KeyD');if(input.right<0)result.add('KeyA');
    if(input.forward>0)result.add('KeyW');if(input.forward<0)result.add('KeyS');
    if(input.sprint)result.add('ShiftLeft');return result;
  };
  const pump=()=>{
    if(scheduled||(!timers.size&&!frames.size))return;
    scheduled=true;setImmediate(()=>{
      scheduled=false;
      const timer=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
      if(timer&&(options.noFrames||timer[1].at<nextFrame)){
        time=timer[1].at;timers.delete(timer[0]);timer[1].callback();
      }else if(!options.noFrames){
        time=nextFrame;count++;nextFrame+=options.frameIntervals?.[count]??options.frameMs;options.onFrame?.();
        try{clock.advance(time,(dt,input)=>{
          const active=keys(input);
          if([...active].some(key=>key!=='ShiftLeft')){inputSeconds+=dt;options.onStep(dt,active,input!);}
        });}catch(error){failure=error;}
        const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback();
      }
      queueMicrotask(pump);
    });
  };
  const context={performance:{now:()=>time},KeyboardEvent:class{type:string;code:string;constructor(type:string,options:{code:string}){this.type=type;this.code=options.code;}},
    window:{dispatchEvent:(event:{type:string;code:string})=>{
      events.push({...event,at:time,frame:count});event.type==='keydown'?held.add(event.code):held.delete(event.code);
      const right=Number(held.has('KeyD'))-Number(held.has('KeyA')),forward=Number(held.has('KeyW'))-Number(held.has('KeyS'));
      assert.equal(clock.record(time,right||forward?{right,forward,sprint:held.has('ShiftLeft'),...(options.direction?.()??{directionX:0,directionZ:-1})}:undefined),true);
      return true;
    }},setTimeout:(callback:()=>void,delay:number)=>{const key=++id;timers.set(key,{at:time+delay+(options.timerDelayMs??0),callback});pump();return key;},
    clearTimeout:(key:number)=>{timers.delete(key);},requestAnimationFrame:(callback:()=>void)=>{
      if(failure)throw failure;
      if(options.rafThrows)throw Error('RAF registration failed');const key=++id;frames.set(key,callback);pump();return key;
    },cancelAnimationFrame:(key:number)=>{frames.delete(key);}};
  return {context,held,events,clock,get time(){return time;},get frames(){return count;},get inputSeconds(){return inputSeconds;},
    finish(){assert.equal(held.size,0,'all exits release keys');assert.equal(timers.size,0,'all timers are cleared');assert.equal(frames.size,0,'all frame callbacks are cleared');}};
}
