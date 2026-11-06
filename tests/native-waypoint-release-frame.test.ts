import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../e2e/helpers/native-waypoint.ts',import.meta.url),'utf8');
const callback=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace('export async function driveNativeWaypoint','async function driveNativeWaypoint')+'\ndriveNativeWaypoint;';

function inputEvents(){
 const listeners=new Map<string,Set<(event:{code:string})=>void>>();
 return {listenerCount:()=>[...listeners.values()].reduce((sum,list)=>sum+list.size,0),addEventListener:(type:string,listener:(event:{code:string})=>void)=>{const list=listeners.get(type)??new Set();list.add(listener);listeners.set(type,list);},removeEventListener:(type:string,listener:(event:{code:string})=>void)=>listeners.get(type)?.delete(listener),release:(code='KeyD')=>{for(const listener of listeners.get('keyup')??[])listener({code});}};
}

for(const mode of ['settled','deadline','invalid'] as const)test(`native release frame ${mode} cannot use a partial observation`,async()=>{
 let time=0,x=0,input=0,pulses=0,frames=0,id=0;const timers=new Map<number,()=>void>(),observers=new Set<()=>void>();
 const canvas={},world={dataset:{get playerX(){return String(x);},playerZ:'0',get playerInputSeconds(){return String(input);},simulationClock:'{"pendingSeconds":0,"pendingInputChanges":0}',characterSoles:'[]',treePresentation:'[]'}};
 const keyEvents=inputEvents();
 const context={...keyEvents,performance:{now:()=>time,timeOrigin:100000},document:{pointerLockElement:canvas,querySelector:(s:string)=>s==='#game canvas'?canvas:world},
  window:{nativeInputProbe:{start(){},async pulse(){if(++pulses>1)throw new Error('second pulse used incomplete release position');time=250;x=.225;input=.05;keyEvents.release();},async finish(){}},dispatchEvent(){throw new Error('native route must not synthesize keys');}},
  MutationObserver:class {fn:()=>void;constructor(fn:()=>void){this.fn=fn;}observe(){observers.add(this.fn);}takeRecords(){return [];}disconnect(){observers.delete(this.fn);}},
  setTimeout:(fn:()=>void)=>{timers.set(++id,fn);return id;},clearTimeout:(n:number)=>timers.delete(n),cancelAnimationFrame(){},
  requestAnimationFrame:(fn:(at:number)=>void)=>{const n=++id;setImmediate(()=>{time+=16;frames++;if(mode==='deadline'&&frames===2){time=2000;for(const expire of [...timers.values()])expire();return;}if(frames===2){x=1.125;input=.25;if(mode==='invalid')world.dataset.simulationClock='invalid';for(const notify of observers)notify();}fn(time);});return n;}};
 const run=vm.runInNewContext(callback,context)({target:{x:1.125,z:0},timeoutMs:2000,tolerance:.01});
 if(mode==='invalid')await assert.rejects(run,/JSON/);else{const result=await run;assert.equal(result.reached,mode==='settled');assert.equal(result.inputSeconds,mode==='settled'?.25:.05);}
 assert.equal(pulses,1);assert.equal(observers.size,0);assert.equal(timers.size,0);assert.equal(keyEvents.listenerCount(),0);
});

for(const mode of ['consumed','partial','invalid','pending'] as const)test(`trusted release boundary ${mode} uses completed simulation time`,async()=>{
  let time=0,x=0,input=0,frames=0,id=0;
  const observers=new Set<()=>void>(),timers=new Map<number,()=>void>();
  const canvas={},world={dataset:{get playerX(){return String(x);},playerZ:'0',get playerInputSeconds(){return String(input);},
    simulationClock:'{"pendingSeconds":0,"pendingInputChanges":0}',simulationConsumedThrough:'0',characterSoles:'[]',treePresentation:'[]'}};
  const keyEvents=inputEvents();
 const context={...keyEvents,performance:{now:()=>time,timeOrigin:100000},document:{pointerLockElement:canvas,querySelector:(s:string)=>s==='#game canvas'?canvas:world},
    window:{nativeInputProbe:{start(){},async pulse(){
      time=1200;x=1.125;input=.25;
      world.dataset.simulationConsumedThrough=mode==='partial'?'700':mode==='invalid'?'Infinity':'800';
      world.dataset.simulationClock=mode==='pending'?'{"pendingSeconds":0.1,"pendingInputChanges":1}':'{"pendingSeconds":0,"pendingInputChanges":0}';
      keyEvents.release();return {releasedEventAt:750};
    },async finish(){}},dispatchEvent(){throw Error('unexpected synthetic input');}},
    MutationObserver:class {fn:()=>void;constructor(fn:()=>void){this.fn=fn;}observe(){observers.add(this.fn);}takeRecords(){return [];}disconnect(){observers.delete(this.fn);}},
    setTimeout:(fn:()=>void)=>{timers.set(++id,fn);return id;},clearTimeout:(n:number)=>timers.delete(n),cancelAnimationFrame(){},
    requestAnimationFrame:(fn:(at:number)=>void)=>{const n=++id;setImmediate(()=>{
      frames++;time+=16;
      if(frames===2){world.dataset.simulationConsumedThrough='1250';world.dataset.simulationClock='{"pendingSeconds":0,"pendingInputChanges":0}';}
      for(const notify of observers)notify();fn(time);
    });return n;}};
  const result=await vm.runInNewContext(callback,context)({target:{x:1.125,z:0},timeoutMs:2000,tolerance:.01});
  assert.equal(result.reached,true);assert.equal(result.inputSeconds,.25);
  assert.equal(frames,mode==='consumed'?1:2);
  assert.equal(observers.size,0);assert.equal(timers.size,0);assert.equal(keyEvents.listenerCount(),0);
});

for(const scenario of [
  {name:'world debt with no queued input',clock:{pendingSeconds:1,pendingInputChanges:0},reached:true},
  {name:'queued release',clock:{pendingSeconds:0,pendingInputChanges:1},reached:false},
  {name:'stale HUD',clock:{pendingSeconds:0,pendingInputChanges:0},stale:true,reached:false},
  {name:'missing queue',clock:{pendingSeconds:0},error:/clock observation/},
  {name:'negative queue',clock:{pendingSeconds:0,pendingInputChanges:-1},error:/clock observation/},
  {name:'fractional queue',clock:{pendingSeconds:0,pendingInputChanges:.5},error:/clock observation/},
  {name:'timer registration error',clock:{pendingSeconds:0,pendingInputChanges:0},timerError:true,error:/timer failed/},
  {name:'observer registration error',clock:{pendingSeconds:0,pendingInputChanges:0},observerError:true,error:/observe failed/},
  {name:'listener registration error',clock:{pendingSeconds:0,pendingInputChanges:0},listenerError:true,error:/listener failed/},
  {name:'record rejection',clock:{pendingSeconds:0,pendingInputChanges:0},recordError:true,error:/record failed/}
])test(`waypoint release completion rejects ${scenario.name} without losing cleanup`,async()=>{
  let time=0,id=0,finished=0,pulses=0,x=0,input=0;
  const observers=new Set<()=>void>(),timers=new Map<number,()=>void>();
  const canvas={},world={dataset:{get playerX(){return String(x);},playerZ:'0',get playerInputSeconds(){return String(input);},simulationConsumedThrough:'0',simulationClock:'{"pendingSeconds":0,"pendingInputChanges":0}',characterSoles:'[]',treePresentation:'[]'}};
  const keyEvents=inputEvents();
 const context={...keyEvents,performance:{now:()=>time,timeOrigin:10000},document:{pointerLockElement:canvas,querySelector:(selector:string)=>selector==='#game canvas'?canvas:world},
    window:{nativeInputProbe:{start(){},async pulse(){pulses++;time=250;x=1.125;input=.25;world.dataset.simulationConsumedThrough='250';world.dataset.simulationClock=JSON.stringify(scenario.clock);keyEvents.release();return{releasedEventAt:200};},async finish(){finished++;if(scenario.recordError)throw Error('record failed');}},dispatchEvent(){throw Error('unexpected synthetic input');}},
    MutationObserver:class{constructor(readonly notify:()=>void){}observe(){observers.add(this.notify);if(scenario.observerError)throw Error('observe failed');}takeRecords(){return [];}disconnect(){observers.delete(this.notify);}},
    setTimeout:(fn:()=>void)=>{if(scenario.timerError)throw Error('timer failed');timers.set(++id,fn);return id;},clearTimeout:(key:number)=>timers.delete(key),cancelAnimationFrame(){},
    requestAnimationFrame:(fn:(at:number)=>void)=>{const key=++id;setImmediate(()=>{time+=16;if(time>=2000){time=2000;for(const expire of [...timers.values()])expire();return;}if(!scenario.stale)for(const notify of observers)notify();fn(time);});return key;}};
  if(scenario.listenerError)context.addEventListener=(type,listener)=>{keyEvents.addEventListener(type,listener);throw Error('listener failed');};
  const run=vm.runInNewContext(callback,context)({target:{x:1.125,z:0},timeoutMs:2000,tolerance:.01,maxInputSeconds:2});
  if(scenario.error)await assert.rejects(run,scenario.error);else assert.equal((await run).reached,scenario.reached);
  assert.equal(pulses,scenario.observerError||scenario.listenerError?0:1);assert.equal(finished,1);assert.equal(observers.size,0);assert.equal(timers.size,0);assert.equal(keyEvents.listenerCount(),0);
});

const require=createRequire(import.meta.url);
const {JSDOM}=require('jsdom');
for(const ordering of ['before-keyup','after-keyup','before-duplicate-keyup','after-delivered-duplicate-keyup'] as const)test(`real DOM release freshness respects ${ordering} mutation records`,async()=>{
  const dom=new JSDOM('<div id="game"><canvas></canvas></div><div id="worldStatus"></div>',{pretendToBeVisual:true});
  const w=dom.window,document=w.document as Document,world=document.querySelector<HTMLElement>('#worldStatus')!,canvas=document.querySelector('canvas');
  Object.defineProperty(document,'pointerLockElement',{get:()=>canvas});
  Object.assign(world.dataset,{playerX:'0',playerZ:'0',playerInputSeconds:'0',simulationConsumedThrough:'0',simulationClock:'{"pendingSeconds":0,"pendingInputChanges":0}',characterSoles:'[]',treePresentation:'[]'});
  const observers=new Set<MutationObserver>(),listeners=new Set<unknown>(),timers=new Set<ReturnType<typeof setTimeout>>(),frames=new Set<number>();
  let delivered=0,pulses=0,finished=0,receipt=0;
  class ObservedMutations extends w.MutationObserver {
    constructor(callback:MutationCallback){super((records:MutationRecord[],observer:MutationObserver)=>{delivered+=records.length;callback(records,observer);});observers.add(this as unknown as MutationObserver);}
    disconnect(){super.disconnect();observers.delete(this as unknown as MutationObserver);}
  }
  w.nativeInputProbe={start(){},async pulse(){
    pulses++;world.dataset.playerX='1.125';world.dataset.playerInputSeconds='.25';
    const release=()=>{const event=new w.KeyboardEvent('keyup',{code:'KeyD',bubbles:true});w.dispatchEvent(event);receipt=event.timeStamp;world.dataset.simulationConsumedThrough=String(receipt);};
    const publish=()=>{world.dataset.simulationClock='{"pendingSeconds":0,"pendingInputChanges":0}';};
    if(ordering==='before-keyup'){publish();release();}
    else {release();publish();if(ordering==='before-duplicate-keyup')release();if(ordering==='after-delivered-duplicate-keyup'){await Promise.resolve();release();}}
    await Promise.resolve();
    return {releasedEventAt:receipt};
  },async finish(){finished++;}};
  const context={window:w,document,performance:{now:()=>Date.now(),timeOrigin:0},MutationObserver:ObservedMutations,
    addEventListener:(type:string,listener:EventListener)=>{w.addEventListener(type,listener);listeners.add(listener);},removeEventListener:(type:string,listener:EventListener)=>{w.removeEventListener(type,listener);listeners.delete(listener);},
    setTimeout:(fn:()=>void,delay:number)=>{const id=setTimeout(()=>{timers.delete(id);fn();},delay);timers.add(id);return id;},clearTimeout:(id:ReturnType<typeof setTimeout>)=>{clearTimeout(id);timers.delete(id);},
    requestAnimationFrame:(fn:(at:number)=>void)=>{const id=w.requestAnimationFrame(()=>{frames.delete(id);fn(Date.now());});frames.add(id);return id;},cancelAnimationFrame:(id:number)=>{w.cancelAnimationFrame(id);frames.delete(id);}};
  try{
    const result=await vm.runInNewContext(callback,context)({target:{x:1.125,z:0},timeoutMs:ordering==='after-keyup'?2000:100,tolerance:.01,maxInputSeconds:2});
    assert.equal(result.reached,ordering==='after-keyup');assert.equal(pulses,1);assert.equal(finished,1);assert.ok(receipt>0);
    assert.equal(delivered>0,ordering==='after-keyup'||ordering==='after-delivered-duplicate-keyup');assert.equal(observers.size,0);assert.equal(listeners.size,0);assert.equal(timers.size,0);assert.equal(frames.size,0);
  }finally{w.close();}
});
