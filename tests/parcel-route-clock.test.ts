import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import {FinePhysicsAuthority} from '../src/world/finePhysics.js';
import {nativeInputClock} from './helpers/native-input-clock.js';

const source=fs.readFileSync(new URL('../e2e/helpers/parcel-route.ts',import.meta.url),'utf8');
const callback=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}})
  .outputText.replace('export async function traverseNativeParcelRoute','async function traverseNativeParcelRoute')+'\ntraverseNativeParcelRoute;';

async function replay(frameMs:number,obstacle=false,prime:'none'|'catch-up'|'starved'|'at-goal'|'overshot'='none'){
  const start={x:44.60367976,z:4.26291002};let p={...start},yaw=0;
  const physics=new FinePhysicsAuthority();
  if(obstacle)physics.registerStatic({id:'prop',minX:40,maxX:40.3,minZ:4.1,maxZ:4.5});
  const clock=nativeInputClock({frameMs,frameIntervals:prime==='none'?undefined:[5000],direction:()=>({directionX:Math.sin(yaw),directionZ:-Math.cos(yaw)}),onStep:(dt,_keys,input)=>{
    const length=Math.hypot(input.forward,input.right),speed=4.5*dt;
    p=physics.moveKinematic({id:'player',position:p,radius:.3,displacement:{
      x:(input.directionX*input.forward-input.directionZ*input.right)/length*speed,
      z:(input.directionZ*input.forward+input.directionX*input.right)/length*speed},dynamic:[]}).position;
  }});
  const canvas={dispatchEvent:(event:{movementX:number})=>{yaw+=event.movementX*.002;}};
  const dataset=new Proxy({},{get:(_,key)=>key==='playerX'?p.x.toFixed(4):key==='playerZ'?p.z.toFixed(4)
    :key==='simulationConsumedThrough'?String(clock.clock.consumedThroughMs):key==='playerInputSeconds'?String(clock.inputSeconds):key==='simulationClock'?JSON.stringify({...clock.clock.diagnostics,pendingInputChanges:clock.clock.pendingInputChanges}):key==='wildlifeVisuals'?'[]':undefined,
    set:()=>{throw Error('diagnostics are read only');}});
  let started=0,finished=0;
  const probe={start(){assert.equal(started,finished);started++;},async pulse(request:{codes:string[];durationMs:number;deadlineEpochMs:number}){
    assert.equal(started,finished+1);assert.deepEqual(Array.from(request.codes),[request.codes[0]]);
    assert.ok(request.deadlineEpochMs>clock.time);assert.ok(request.durationMs>0&&request.durationMs<=250);
    for(const code of request.codes)clock.context.window.dispatchEvent({type:'keydown',code,timeStamp:clock.time,isTrusted:true,repeat:false} as any);
    await new Promise<void>(resolve=>clock.context.setTimeout(()=>{for(const code of request.codes)clock.context.window.dispatchEvent({type:'keyup',code,timeStamp:clock.time,isTrusted:true,repeat:false} as any);resolve();},request.durationMs));
    return {releasedEventAt:clock.time};
  },async finish(){finished++;}};
  const context={...clock.context,MutationObserver:class extends clock.context.MutationObserver{constructor(notify:(records:unknown[])=>void){super(()=>notify([{attributeName:'data-simulation-clock'}]));}},performance:{...clock.context.performance,timeOrigin:0},window:{nativeInputProbe:probe,dispatchEvent(){throw Error('Synthetic keyboard input is forbidden');}},document:{pointerLockElement:canvas,querySelector:(selector:string)=>selector==='#game canvas'?canvas:{dataset}},MouseEvent:class{}};
  const fn=vm.runInNewContext(callback,context) as (args:object)=>Promise<{position:{x:number;z:number};detours:number}>;
  try{
    if(prime!=='none'&&prime!=='overshot')await new Promise<void>(resolve=>clock.context.requestAnimationFrame(resolve));
    const began=clock.time,initialDebt=clock.clock.diagnostics.pendingSeconds;
    if(prime!=='none'&&prime!=='overshot'){assert.ok(initialDebt>0);assert.equal(clock.events.length,0);}
    if(prime==='overshot'){
      const result=await fn({key:'KeyD',targetX:start.x-1,laneZ:start.z});
      assert.ok(Math.abs(result.position.x-(start.x-1))<.005,'overshoot must return to the pickup approach');
      assert.ok(clock.events.some(e=>e.type==='keydown'));return;
    }
    if(prime==='starved'){
      await assert.rejects(fn({key:'KeyA',targetX:35.6,laneZ:start.z}),/bounded input budget/);
      assert.equal(clock.time-began,90000);assert.equal(clock.events.length,0);assert.equal(clock.inputSeconds,0);
      assert.ok(clock.clock.diagnostics.pendingSeconds>initialDebt);return;
    }
    if(prime==='at-goal'){
      const result=await fn({key:'KeyD',targetX:start.x,laneZ:start.z});
      assert.ok(Math.abs(result.position.x-start.x)<.005);assert.equal(clock.time-began,3000);
      assert.equal(clock.clock.diagnostics.pendingSeconds,0);assert.equal(clock.events.length,0);return;
    }
    const outbound=await fn({key:'KeyA',targetX:35.6,laneZ:start.z});const outboundAt=clock.time;
    assert.ok(outbound.position.x<=35.6001);assert.ok(Math.abs(outbound.position.z-start.z)<.005);
    assert.equal(clock.clock.diagnostics.pendingSeconds,0);assert.ok(outboundAt-began<=90000);
    if(prime==='catch-up')assert.equal(clock.events.find(e=>e.type==='keydown')?.at,began+3000);
    const inbound=await fn({key:'KeyD',targetX:start.x,laneZ:start.z});
    assert.ok(Math.abs(inbound.position.x-start.x)<.005);assert.ok(Math.abs(inbound.position.z-start.z)<.005);
    assert.equal(clock.clock.diagnostics.pendingSeconds,0);assert.ok(clock.time-outboundAt<=90000);
    assert.ok(Math.abs(yaw)<1e-12);assert.equal(clock.clock.diagnostics.inputOverflowCount,0);
    if(obstacle)assert.equal(outbound.detours,1);
  }finally{clock.finish();assert.equal(started,['starved','at-goal','overshot'].includes(prime)?1:2);assert.equal(finished,started);}
}
for(const frameMs of [16,500,1000,1800])test(`parcel round trip settles both key releases at ${frameMs} ms frames`,()=>replay(frameMs));
for(const frameMs of [100,1000])test(`parcel detour restores its original lane at ${frameMs} ms frames`,()=>replay(frameMs,true));

test('parcel route drains existing foreground debt before its first key press',()=>replay(1000,false,'catch-up'));
test('parcel route cannot accept its initial goal while debt remains',()=>replay(1000,false,'at-goal'));
test('parcel route keeps initial debt and issues no input when the original deadline expires',()=>replay(2500,false,'starved'));

test('parcel route corrects an overshot inbound goal before reporting arrival',()=>replay(1000,false,'overshot'));


import {releasedInputRuntime} from './helpers/released-input-runtime.js';

test('parcel waits for retimed native keyup in the real input, physics and HUD path',async()=>{
  const f=releasedInputRuntime({delivery:'historical'});
  const pulse=f.context.window.__latticeNativePulse;
  f.context.window.__latticeNativePulse=(request:any)=>{
    assert.equal(f.runtime.simulationClock.pendingInputChanges,0,'the previous native release must be consumed before another pulse');
    return pulse(request);
  };
  try{
    const result=await vm.runInNewContext(callback,f.context)({key:'KeyD',targetX:1.125,laneZ:0});
    assert.equal(result.position.x,1.125);assert.equal(f.pulses.length,1);
    assert.ok(Math.abs(f.runtime.playerInputSeconds-.25)<1e-9);assert.equal(f.runtime.simulationClock.pendingInputChanges,0);
    assert.ok(f.history.some(frame=>frame.pending===0&&frame.queue>0&&frame.consumed>=10250));
  }finally{f.close({probeUsed:true});}
});

for(const scenario of [
  {name:'prompt input',frameMs:50},
  {name:'slow native frames',frameMs:1800},
  {name:'late original event timestamps',delivery:'historical'},
  {name:'post-release HUD before delayed host acknowledgement',frameMs:1200,keyUpAckMs:89_999},
  {name:'host acknowledgement after the original deadline',frameMs:1200,keyUpAckMs:90_001,error:/bounded input budget/},
  {name:'pre-keyup mutation records delivered after keyup',frameMs:25,delivery:'historical',releaseAfterHudMs:425,noHudAfterRelease:true,error:/bounded input budget/},
  {name:'same-task duplicate keyup after published proof',repeatAfterHudMs:250,keyUpAckMs:89_999,noHudAfterRelease:true,error:/bounded input budget/},
  {name:'later-task duplicate keyup after published proof',repeatAtMs:251,keyUpAckMs:89_999,noHudAfterRelease:true,error:/bounded input budget/}
] as const)test(`parcel real components retain ${scenario.name}`,async()=>{
  const f=releasedInputRuntime(scenario);
  try{
    const run=vm.runInNewContext(callback,f.context)({key:'KeyD',targetX:1.125,laneZ:0});
    if('error' in scenario&&scenario.error)await assert.rejects(run,scenario.error);
    else {const result=await run;assert.equal(result.position.x,1.125);assert.equal(result.position.z,0);assert.ok(f.time<100_000);}
    assert.equal(f.pulses.length,1);assert.equal(f.pulses[0].durationMs,250);assert.equal(f.pulses[0].deadlineEpochMs,110_000);
    assert.ok(Math.abs(f.runtime.playerInputSeconds-.25)<1e-9);assert.equal(f.runtime.simulationClock.pendingInputChanges,0);
    assert.equal(f.commands.map(c=>c.type).join(','),'rawKeyDown,keyUp');
    if('error' in scenario&&scenario.error)assert.equal(f.time,'keyUpAckMs' in scenario&&typeof scenario.keyUpAckMs==='number'?Math.max(100_000,10_000+scenario.keyUpAckMs):100_000);
    if('keyUpAckMs' in scenario&&typeof scenario.keyUpAckMs==='number')assert.equal(f.pulses[0].returnedAt,10_000+scenario.keyUpAckMs);
    if('releaseAfterHudMs' in scenario)assert.ok(f.history.some(frame=>frame.queue>0&&frame.pending===0));
  }finally{f.close({probeUsed:true});}
});

for(const field of [undefined,-1,.5,NaN,'0'])test(`parcel rejects an invalid input queue ${String(field)}`,async()=>{
  const f=releasedInputRuntime();
  f.world.dataset.simulationClock=JSON.stringify({pendingSeconds:0,pendingInputChanges:field});
  try{await assert.rejects(vm.runInNewContext(callback,f.context)({key:'KeyD',targetX:0,laneZ:0}),/clock observation is unavailable/);assert.equal(f.pulses.length,0);}
  finally{f.close({probeUsed:true});}
});

for(const registrationFailure of ['observer','keydown','keyup','timer','raf'] as const)test(`parcel cleans partial ${registrationFailure} registration and preserves its error`,async()=>{
  const error=new Error(`registration ${registrationFailure}`),f=releasedInputRuntime({registrationFailure,registrationError:error,finishError:new Error('record failure')});
  try{await assert.rejects(vm.runInNewContext(callback,f.context)({key:'KeyD',targetX:1.125,laneZ:0}),value=>value===error);assert.equal(f.pulses.length,0);}
  finally{f.close({probeUsed:true});}
});

for(const mode of ['pulse-rejection','in-flight-frame-error'] as const)test(`parcel owns native pulse terminal after ${mode}`,async()=>{
  const error=new Error(mode),f=releasedInputRuntime({keyUpAckMs:90_001,finishError:new Error('record failure'),...(mode==='pulse-rejection'?{pulseError:error}:{rafFailureAt:6,registrationError:error})});
  try{await assert.rejects(vm.runInNewContext(callback,f.context)({key:'KeyD',targetX:1.125,laneZ:0}),value=>value===error);assert.equal(f.time,100_001);assert.equal(f.pulses.length,1);assert.equal(f.pulses[0].returnedAt,100_001);}
  finally{f.close({probeUsed:true});}
});

test('parcel cannot claim its initial goal while an accepted release remains in the future',async()=>{
  const f=releasedInputRuntime();
  try{
    await new Promise<void>(resolve=>f.queue(10_300,()=>{f.emit('keydown','KeyD',10_000);f.emit('keyup','KeyD',10_250);resolve();}));
    assert.ok(f.runtime.simulationClock.pendingInputChanges>0);
    const result=await vm.runInNewContext(callback,f.context)({key:'KeyD',targetX:1.125,laneZ:0});
    assert.equal(result.position.x,1.125);assert.equal(f.pulses.length,0);assert.equal(f.runtime.simulationClock.pendingInputChanges,0);
  }finally{f.close({probeUsed:true});}
});

test('parcel reports a native record failure after cleaning a successful route',async()=>{
  const error=new Error('record failure'),f=releasedInputRuntime({finishError:error});
  try{await assert.rejects(vm.runInNewContext(callback,f.context)({key:'KeyD',targetX:1.125,laneZ:0}),value=>value===error);assert.equal(f.pulses.length,1);}
  finally{f.close({probeUsed:true});}
});
