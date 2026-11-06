import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as THREE from 'three';
import {SimulationClock} from '../src/world/simulationClock.js';
import {CoarseWorldRuntime} from '../src/world/coarseWorld.js';
import {FinePhysicsAuthority} from '../src/world/finePhysics.js';
import {registerHomeTerrain,registerFineTerrainForChunk} from '../src/world/fineTerrain.js';
import {playerHeadConstraint} from '../src/world/characterContact.js';
import {planFineChunk} from '../src/world/materialization.js';
import {readWorldRandomness,keyedRandom} from '../src/world/worldRandom.js';
import {foldFineWildlifePopulationCount} from '../src/world/fineWildlifeMigration.js';
import {scheduleNativePulse,type NativeKeyCommand} from '../e2e/helpers/native-pulse-scheduler.js';
const source=fs.readFileSync(new URL('../e2e/helpers/coarse-native-transition.ts',import.meta.url),'utf8');
const callback=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace('export async function crossCoarseBoundary','async function crossCoarseBoundary')+'\ncrossCoarseBoundary;';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
function withPulseEvents(context:any,setupFailure?:string,registrationError?:Error){
 const listeners=new Map<string,Set<(event:unknown)=>void>>();
 context.addEventListener=(type:string,listener:(event:unknown)=>void)=>{
  if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type)!.add(listener);
  if(setupFailure===`${type}-listener`)throw registrationError;
 };
 context.removeEventListener=(type:string,listener:(event:unknown)=>void)=>listeners.get(type)?.delete(listener);
 context.pendingInputListeners=()=>[...listeners.values()].reduce((sum,set)=>sum+set.size,0);
 const pulse=context.window.nativeInputProbe.pulse;
 context.window.nativeInputProbe.pulse=async(request:{codes:string[]})=>{
  const emit=(type:string,at:number)=>{for(const code of request.codes)for(const listener of [...listeners.get(type)??[]])listener({type,code,timeStamp:at,isTrusted:true,repeat:false});};
  emit('keydown',context.performance.now());
  let result:any;
  try{result=await pulse(request);return result;}finally{emit('keyup',result?.releasedEventAt??context.performance.now());}
 };
 return context;
}
for(const mode of ['normal','late-frame','debt','invalid','not-entered'] as const)test(`coarse native transition ${mode} preserves release and deadline`,async()=>{
 let time=0,frames=0,id=0,finished=0,notified=0;const observers=new Set<(...args:any[])=>void>(),timers=new Map<number,()=>void>(),pulses:Array<{codes:string[];durationMs:number;deadlineEpochMs:number}>=[];
 const world={dataset:{coarseRequestTimeouts:'0',coarseDecidedChunks:'8',coarseLastBatchSize:'8',materializedChunks:'0',simulationConsumedThrough:'0',simulationClock:'{"pendingSeconds":0,"pendingInputChanges":0}'}};
 const context={performance:{now:()=>time,timeOrigin:10000},document:{querySelector:()=>world},
  window:{nativeInputProbe:{start(){},async pulse(p:{codes:string[];durationMs:number;deadlineEpochMs:number}){pulses.push(p);time+=200;frames=0;return {releasedEventAt:time};},async finish(){finished++;}},async notifyCoarseTransitionExited(){notified++;}},
  MutationObserver:class {fn:()=>void;constructor(fn:()=>void){this.fn=fn;}observe(){observers.add(this.fn);}takeRecords(){return [];}disconnect(){observers.delete(this.fn);}},
  setTimeout:(fn:()=>void)=>{timers.set(++id,fn);return id;},clearTimeout:(n:number)=>timers.delete(n),cancelAnimationFrame(){},requestAnimationFrame:(fn:(at:number)=>void)=>{const n=++id;setImmediate(()=>{
   time+=16;frames++;
   if(mode==='late-frame'||(mode==='debt'&&frames>2)||time>=pulses.at(-1)!.deadlineEpochMs-10000){time=pulses.at(-1)!.deadlineEpochMs-10000;for(const expire of [...timers.values()])expire();return;}
   if(frames===2){world.dataset.simulationConsumedThrough=String(time);world.dataset.materializedChunks=mode==='not-entered'?'0':pulses.length===1?'1':'0';world.dataset.simulationClock=mode==='invalid'?'invalid':mode==='debt'?'{"pendingSeconds":1,"pendingInputChanges":1}':'{"pendingSeconds":0,"pendingInputChanges":0}';for(const notify of observers)notify([{attributeName:'data-simulation-clock'}]);}
   fn(time);
  });return n;}};
 const run=vm.runInNewContext(callback,withPulseEvents(context))();
 if(mode==='invalid')await assert.rejects(run,/JSON/);else{const r=await run;assert.equal(r.entered,mode==='normal');assert.equal(r.exited,mode==='normal');}
 assert.equal(pulses.length,mode==='normal'?2:1);assert.equal(pulses[0].codes.join(','),'ShiftLeft,KeyD');assert.equal(pulses[0].durationMs,200);assert.equal(pulses[0].deadlineEpochMs,12500);
 if(mode==='normal')assert.equal(pulses[1].codes.join(','),'ShiftLeft,KeyA');
 assert.equal(notified,Number(mode==='normal'));assert.equal(finished,1);assert.equal(observers.size,0);assert.equal(timers.size,0);
});

const main=ts.createSourceFile('main.ts',fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const names=new Set(['playerInputAllowed','playerMovementKey','recordPlayerInput','simulateStep','updatePlayer','updateFineChunkMaterialization','materializeFineChunk','collapseFineChunk','animate']);
const members:string[]=[],diagnostics:string[]=[];
for(const node of main.statements)if(ts.isClassDeclaration(node)&&node.name?.text==='TownGame')for(const member of node.members){
  if((ts.isMethodDeclaration(member)||ts.isPropertyDeclaration(member))&&names.has(member.name.getText(main)))members.push(member.getText(main));
  if(ts.isMethodDeclaration(member)&&member.name.getText(main)==='updateUi')for(const statement of member.body!.statements){
    if(ts.isExpressionStatement(statement)&&ts.isBinaryExpression(statement.expression)&&
      ['materializedChunks','simulationClock','simulationConsumedThrough','playerX','playerZ','playerInputSeconds'].some(key=>(statement.expression as ts.BinaryExpression).left.getText(main)===`ui.world.dataset.${key}`))diagnostics.push(statement.getText(main));
  }
}
assert.equal(members.length,names.size);assert.equal(diagnostics.length,6);
const runtimeCode=ts.transpileModule(`return class Runtime {${members.join('\n')}\nupdateUi(){const world=this.coarseWorld.status();${diagnostics.join('\n')}}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;

for(const boundary of ['pulse-return','first-consumed-frame'] as const)test(`coarse transition waits for late native input after the ${boundary} boundary`,async()=>{
  let time=1000,id=0,finished=0,notified=0,pump:ReturnType<typeof setImmediate>|undefined;
  const frames=new Map<number,(at:number)=>void>(),timers=new Map<number,{at:number;fn:()=>void}>(),observers=new Set<(...args:any[])=>void>();
  const pulses:Array<{codes:string[];durationMs:number;deadlineEpochMs:number;issuedAt:number}>=[];
  const consumedBeforeCrossing:number[]=[],changes:Array<{at:number;materialized:number;terrain:number}>=[];
  const world={dataset:{coarseRequestTimeouts:'0',coarseDecidedChunks:'8',coarseLastBatchSize:'8',materializedChunks:'0',simulationClock:'{"pendingSeconds":0,"pendingInputChanges":0}',simulationConsumedThrough:''}};
  const document={hidden:false,hasFocus:()=>true,querySelector:()=>world};
  let runtime:any;
  const schedule=()=>{
    if(pump)return;
    pump=setImmediate(()=>{
      pump=undefined;time=(Math.floor(time/50)+1)*50;
      for(const [key,timer] of [...timers])if(timer.at<=time){timers.delete(key);timer.fn();}
      const pending=[...frames];frames.clear();
      for(const [,frame] of pending)frame(time);
      if(frames.size||timers.size)schedule();
    });
  };
  const requestAnimationFrame=(fn:(at:number)=>void)=>{frames.set(++id,fn);schedule();return id;};
  const context={performance:{now:()=>time,timeOrigin:10000},document,
    requestAnimationFrame,cancelAnimationFrame:(key:number)=>frames.delete(key),
    setTimeout:(fn:()=>void,delay:number)=>{timers.set(++id,{at:time+delay,fn});schedule();return id;},clearTimeout:(key:number)=>timers.delete(key),
    MutationObserver:class{constructor(readonly fn:()=>void){}observe(){observers.add(this.fn);}takeRecords(){return [];}disconnect(){observers.delete(this.fn);}},
    window:{nativeInputProbe:{start(){},async pulse(p:{codes:string[];durationMs:number;deadlineEpochMs:number}){
      const issuedAt=time;pulses.push({...p,issuedAt});
      time=issuedAt+(boundary==='pulse-return'?300:200);
      const pending=[...frames];frames.clear();for(const [,frame] of pending)frame(time);
      time=Math.max(time,issuedAt+210)+1;
      runtime.playerMovementKey('ShiftLeft',true,false,issuedAt+10);
      runtime.playerMovementKey(p.codes[1],true,false,issuedAt+10);
      time++;
      runtime.playerMovementKey(p.codes[1],false,false,issuedAt+210);
      runtime.playerMovementKey('ShiftLeft',false,false,issuedAt+210);
      assert.equal(runtime.simulationClock.diagnostics.pendingSeconds,0);
      assert.equal(world.dataset.materializedChunks,pulses.length===1?'0':'1');
      assert.equal(Number(world.dataset.simulationConsumedThrough)>=issuedAt+210,boundary==='pulse-return');
      return{releasedEventAt:issuedAt+210};
    },async finish(){finished++;}},async notifyCoarseTransitionExited(){notified++;}}};
  const Runtime=new Function('THREE','now','requestAnimationFrame','navigator','document','ui','i18n',runtimeCode)(THREE,()=>time,requestAnimationFrame,{},document,{world},{t:(_key:string,args:{error:string})=>args.error});
  runtime=new Runtime();
  const physics=new FinePhysicsAuthority();registerHomeTerrain(physics,72);
  const coarseWorld=new CoarseWorldRuntime(new THREE.Scene());coarseWorld.update=()=>{};
  const camera=new THREE.PerspectiveCamera();camera.position.set(35.1,1.7,1.2);
  Object.assign(runtime,{camera,physics,coarseWorld,keys:new Set<string>(),simulationClock:new SimulationClock(),persistenceReady:true,cameraMode:'firstPerson',
    controls:{isLocked:true},playerPosition:{x:35.1,z:1.2},firstPersonRotation:new THREE.Euler(),playerInputSeconds:0,playerBlockedNpcs:new Set(),npcs:new Map(),materializedChunks:new Map(),activeFineChunkId:undefined as string|undefined,
    lastPersistenceSaveAt:time,lastHealthPoll:time,streamedPresentation:{unitIds:()=>['unit_1_0']},playerInputAllowed:()=>true,physicsDynamicColliders:()=>[],groundHeightAt:()=>0,
    updateTime(){},gameTimeText:()=> '08:15',updateObjects(){},updateNpcs(){},updateWildlife(){},updateCameraShadow(){},updateRaycast(){},updateSpeech(){},updateSelectionVisuals(){},renderer:{render(){}},syncKnownActorPresentation(){},syncStreamedPresentation(){},
    resetPlayerInput(){throw Error('Unexpected input reset');},clearMovablePersistenceQueue(){},log(error:string){throw Error(error);},
    materializeFineChunk(chunk:any){this.activeFineChunkId=chunk.id;this.materializedChunks.set(chunk.id,{});coarseWorld.setMaterialized(chunk.id,true);registerFineTerrainForChunk(physics,chunk,coarseWorld.chunkSize);changes.push({at:time,materialized:1,terrain:physics.stats().terrainSurfaces});},
    collapseFineChunk(chunkId:string){this.activeFineChunkId=undefined;this.materializedChunks.delete(chunkId);coarseWorld.setMaterialized(chunkId,false);physics.clearChunk(chunkId);changes.push({at:time,materialized:0,terrain:physics.stats().terrainSurfaces});}
  });
  const updateUi=runtime.updateUi.bind(runtime);
  runtime.updateUi=()=>{
    updateUi();for(const observer of observers)observer([{attributeName:'data-simulation-clock'}]);
    const pulse=pulses.at(-1);
    if(pulse&&runtime.simulationClock.consumedThroughMs>=pulse.issuedAt+210&&runtime.simulationClock.diagnostics.pendingSeconds===0&&world.dataset.materializedChunks===(pulses.length===1?'0':'1'))consumedBeforeCrossing.push(pulses.length);
  };
  runtime.animate(time);
  try{
    const result=await vm.runInNewContext(callback,withPulseEvents(context))();
    assert.equal(result.entered,true);assert.equal(result.exited,true);assert.equal(result.materialized,0);
    assert.equal(pulses.length,2);assert.deepEqual(pulses.map(p=>p.codes.join(',')),['ShiftLeft,KeyD','ShiftLeft,KeyA']);
    for(const pulse of pulses){assert.equal(pulse.durationMs,200);assert.equal(pulse.deadlineEpochMs,10000+pulse.issuedAt+2500);}
    assert.ok(consumedBeforeCrossing.includes(1));assert.ok(consumedBeforeCrossing.includes(2));
    assert.deepEqual(changes.map(change=>[change.materialized,change.terrain]),[[1,2],[0,1]]);
    assert.ok(changes.every((change,index)=>change.at<pulses[index].issuedAt+2500));
    assert.ok(Math.abs(runtime.playerPosition.x-35.1)<1e-9);assert.equal(runtime.playerPosition.z,1.2);
    assert.ok(Math.abs(runtime.playerInputSeconds-.4)<1e-9);assert.equal(runtime.simulationClock.pendingInputChanges,0);
    assert.equal(runtime.simulationClock.diagnostics.resetReason,'none');assert.equal(runtime.keys.size,0);
    assert.equal(finished,1);assert.equal(notified,1);assert.equal(observers.size,0);assert.equal(timers.size,0);
    assert.equal([...frames.values()].filter(frame=>frame!==runtime.animate).length,0);
  }finally{if(pump)clearImmediate(pump);frames.clear();timers.clear();}
});

for(const mode of ['consumed','partial','late'] as const)test(`coarse native release ${mode} uses the unchanged leg deadline`,async()=>{
  let time=0,frames=0,id=0,legs=0,notified=0;
  const observers=new Set<(...args:any[])=>void>(),timers=new Map<number,()=>void>();
  const world={dataset:{coarseRequestTimeouts:'0',coarseDecidedChunks:'8',coarseLastBatchSize:'8',materializedChunks:'0',simulationClock:'{"pendingSeconds":0,"pendingInputChanges":0}',simulationConsumedThrough:'0'}};
  const context={performance:{now:()=>time,timeOrigin:10000},document:{querySelector:()=>world},
    window:{nativeInputProbe:{start(){},async pulse(){
      legs++;time+=mode==='late'?2600:1200;
      world.dataset.materializedChunks=legs===1?'1':'0';
      world.dataset.simulationConsumedThrough=String(time-(mode==='partial'?600:100));
      return {releasedEventAt:time-500};
    },async finish(){}},async notifyCoarseTransitionExited(){notified++;}},
    MutationObserver:class {fn:()=>void;constructor(fn:()=>void){this.fn=fn;}observe(){observers.add(this.fn);}takeRecords(){return [];}disconnect(){observers.delete(this.fn);}},
    setTimeout:(fn:()=>void)=>{timers.set(++id,fn);return id;},clearTimeout:(n:number)=>timers.delete(n),cancelAnimationFrame(){},
    requestAnimationFrame:(fn:(at:number)=>void)=>{const n=++id;setImmediate(()=>{
      frames++;time+=16;world.dataset.simulationConsumedThrough=String(time);
      for(const notify of observers)notify([{attributeName:'data-simulation-clock'}]);fn(time);
    });return n;}};
  const result=await vm.runInNewContext(callback,withPulseEvents(context))();
  assert.equal(result.entered,mode!=='late');assert.equal(result.exited,mode!=='late');
  assert.equal(legs,mode==='late'?1:2);assert.equal(notified,mode==='late'?0:1);
  assert.equal(frames,mode==='late'?0:2);assert.equal(observers.size,0);assert.equal(timers.size,0);
});

const waitingCases=[
  {name:'never enters',enterAt:Infinity,entered:false,exited:false},
  {name:'never exits',enterAt:216,exitAt:Infinity,entered:true,exited:false},
  {name:'last frame before the deadline',enterAt:2499,exitAt:2499,offsets:[216,2499],entered:true,exited:true},
  {name:'frame at the deadline',enterAt:2500,offsets:[216,2500],timerDelay:100,entered:false,exited:false},
  {name:'frame after the deadline',enterAt:2600,offsets:[216,2600],timerDelay:1000,entered:false,exited:false},
  {name:'no frames',noFrames:true,entered:false,exited:false},
  {name:'release still unconsumed',unconsumed:true,enterAt:216,entered:false,exited:false},
  {name:'outstanding input debt',clock:'{"pendingSeconds":1,"pendingInputChanges":1}',enterAt:216,entered:false,exited:false},
  {name:'settled input with outstanding world debt',clock:'{"pendingSeconds":1,"pendingInputChanges":0}',enterAt:216,entered:true,exited:true},
  {name:'missing input queue',clock:'{"pendingSeconds":0}',error:/clock is unavailable/},
  {name:'negative input queue',clock:'{"pendingSeconds":0,"pendingInputChanges":-1}',error:/clock is unavailable/},
  {name:'fractional input queue',clock:'{"pendingSeconds":0,"pendingInputChanges":0.5}',error:/clock is unavailable/},
  {name:'malformed clock',clock:'invalid',error:/JSON/},
  {name:'missing clock',clock:'null',error:/clock is unavailable/},
  {name:'negative clock',clock:'{"pendingSeconds":-1}',error:/clock is unavailable/},
  {name:'nonfinite clock',clock:'{"pendingSeconds":1e400}',error:/clock is unavailable/},
  {name:'observer construction fails',setupFailure:'observer-construction',error:/Registration failed/},
  {name:'observer registration fails after activation',setupFailure:'observer-observe',error:/Registration failed/},
  {name:'keydown listener registration fails',setupFailure:'keydown-listener',error:/Registration failed/},
  {name:'keyup listener registration fails',setupFailure:'keyup-listener',error:/Registration failed/},
  {name:'observer queued-record drain fails',setupFailure:'observer-drain',error:/Registration failed/},
  {name:'timer registration fails',setupFailure:'timer',error:/Registration failed/},
  {name:'second leg timer registration fails',setupFailure:'second-leg-timer',error:/Registration failed/},
  {name:'initial frame registration fails',setupFailure:'first-frame',error:/Registration failed/},
  {name:'subsequent frame registration fails',setupFailure:'next-frame',enterAt:Infinity,error:/Registration failed/},
  {name:'frame registration fails',rafError:true,error:/RAF failed/},
  {name:'pulse fails after release',pulseError:true,error:/Pulse failed/},
  {name:'predicate read fails',predicateError:true,error:/Materialization read failed/}
];
for(const scenario of waitingCases)test(`coarse transition waiting cleans up when ${scenario.name}`,async()=>{
  let time=0,id=0,issuedAt=0,framesSeen=0,finished=0,notified=0,timerCalls=0,rafCalls=0,pump:ReturnType<typeof setImmediate>|undefined;
  const registrationError=new Error('Registration failed');
  const timers=new Map<number,{at:number;fn:()=>void}>(),frames=new Map<number,(at:number)=>void>(),observers=new Set<(...args:any[])=>void>(),held=new Set<string>();
  const pulses:Array<{codes:string[];durationMs:number;deadlineEpochMs:number;issuedAt:number}>=[];
  const world={dataset:{coarseRequestTimeouts:'0',coarseDecidedChunks:'8',coarseLastBatchSize:'8',materializedChunks:'0',simulationClock:'{"pendingSeconds":0,"pendingInputChanges":0}',simulationConsumedThrough:'0'}};
  const schedule=()=>{
    if(pump)return;
    pump=setImmediate(()=>{
      pump=undefined;
      const next=scenario.noFrames?Infinity:issuedAt+(scenario.offsets?.[framesSeen]??(216+framesSeen*16));
      const timer=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];
      if(timer&&timer[1].at<=next){time=timer[1].at;timers.delete(timer[0]);timer[1].fn();}
      else{
        time=next;framesSeen++;
        world.dataset.materializedChunks=time-issuedAt>=(pulses.length===1?(scenario.enterAt??216):(scenario.exitAt??216))?(pulses.length===1?'1':'0'):(pulses.length===1?'0':'1');
        world.dataset.simulationClock=scenario.clock??'{"pendingSeconds":0,"pendingInputChanges":0}';
        if(scenario.predicateError)Object.defineProperty(world.dataset,'materializedChunks',{get(){throw Error('Materialization read failed');}});
        for(const observer of observers)observer([{attributeName:'data-simulation-clock'}]);
        const pending=[...frames.values()];frames.clear();for(const frame of pending)frame(time);
      }
      if(frames.size||timers.size)schedule();
    });
  };
  const context={performance:{now:()=>time,timeOrigin:10000},document:{querySelector:()=>world},
    MutationObserver:class{constructor(readonly fn:()=>void){if(scenario.setupFailure==='observer-construction')throw registrationError;}observe(){observers.add(this.fn);if(scenario.setupFailure==='observer-observe')throw registrationError;}takeRecords(){if(scenario.setupFailure==='observer-drain')throw registrationError;return [];}disconnect(){observers.delete(this.fn);}},
    setTimeout:(fn:()=>void,delay:number)=>{timerCalls++;if(scenario.setupFailure==='timer'||(scenario.setupFailure==='second-leg-timer'&&timerCalls===2))throw registrationError;timers.set(++id,{at:time+delay+(scenario.timerDelay??0),fn});schedule();return id;},clearTimeout:(key:number)=>timers.delete(key),
    requestAnimationFrame:(fn:(at:number)=>void)=>{rafCalls++;if(scenario.setupFailure==='first-frame'||(scenario.setupFailure==='next-frame'&&rafCalls===2))throw registrationError;if(scenario.rafError)throw Error('RAF failed');frames.set(++id,fn);schedule();return id;},cancelAnimationFrame:(key:number)=>frames.delete(key),
    window:{nativeInputProbe:{start(){},async pulse(p:{codes:string[];durationMs:number;deadlineEpochMs:number}){
      issuedAt=time;framesSeen=0;pulses.push({...p,issuedAt});for(const code of p.codes)held.add(code);
      time+=200;held.clear();world.dataset.simulationConsumedThrough=String(time-(scenario.unconsumed?1:0));
      if(scenario.pulseError)throw Error('Pulse failed');return{releasedEventAt:time};
    },async finish(){finished++;}},async notifyCoarseTransitionExited(){notified++;}}};
  try{
    const run=vm.runInNewContext(callback,withPulseEvents(context,scenario.setupFailure,registrationError))();
    if(scenario.setupFailure){await assert.rejects(run,error=>error===registrationError);assert.equal(notified,0);assert.equal(pulses.length,['next-frame','second-leg-timer','observer-drain'].includes(scenario.setupFailure)?1:0);}
    else if(scenario.error)await assert.rejects(run,scenario.error);
    else{
      const result=await run;assert.equal(result.entered,scenario.entered);assert.equal(result.exited,scenario.exited);
      assert.equal(notified,Number(scenario.exited));assert.equal(pulses.length,scenario.entered?2:1);
      if(!scenario.entered&&!scenario.timerDelay)assert.equal(result.finishedAt,2500);
    }
    for(const [index,pulse] of pulses.entries()){
      assert.equal(pulse.codes.join(','),index?'ShiftLeft,KeyA':'ShiftLeft,KeyD');assert.equal(pulse.durationMs,200);
      assert.equal(pulse.deadlineEpochMs,10000+pulse.issuedAt+2500);
    }
    assert.equal(finished,1);assert.equal(held.size,0);assert.equal((context as any).pendingInputListeners(),0);assert.equal(observers.size,0);assert.equal(timers.size,0);assert.equal(frames.size,0);
  }finally{if(pump)clearImmediate(pump);}
});

const probeAst=ts.createSourceFile('probe.ts',fs.readFileSync(new URL('../e2e/helpers/native-input-probe.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);let init:ts.Expression|undefined;
(function visit(node:ts.Node){if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='addInitScript')init=node.arguments[0];ts.forEachChild(node,visit);})(probeAst);assert.ok(init);
const probeCode=ts.transpileModule(`(${init.getText(probeAst)})();`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;

type Options={name:string;frameMs?:number;initialDebt?:number;delivery?:'prompt'|'batched'|'historical';inputPendingUntil?:number;clockFrameLag?:number;block?:boolean;turnAtMs?:number;upDelayMs?:number;keyUpAckAtMs?:number;releaseAfterHudAtMs?:number;repeatReleaseAtMs?:number;repeatReleaseAfterHudMs?:number;pulseFailure?:Error;registrationFailure?:Error;rafFailureAtCall?:number;expectedFinishAtMs?:number};
async function nativeComponentRoute(options:Options){
 let time=10_000,id=0,nextFrame=time,active=true,record:any,notify=0,leg=0,rafCalls=0,finishedReports=0,pump:ReturnType<typeof setImmediate>|undefined;
 const frames=new Map<number,(at:number)=>void>(),timers=new Map<number,{at:number;fn:()=>void}>(),events=new Map<number,{at:number;fn:()=>void}>(),listeners=new Map<string,Array<(event:any)=>void>>();
 const history:any[]=[],commands:any[]=[],pulses:any[]=[],materializationChanges:any[]=[],deferredReleases:Array<{at:number;fn:()=>void}>=[];
 const dom=new JSDOM('<div id="worldStatus"></div>'),world=dom.window.document.querySelector('#worldStatus') as HTMLElement;Object.assign(world.dataset,{coarseRequestTimeouts:'0',coarseDecidedChunks:'8',coarseLastBatchSize:'8',materializedChunks:'0',simulationClock:'null',simulationConsumedThrough:'',playerX:'35.1',playerZ:'1.2',playerInputSeconds:'0',characterSoles:'[]'});
 const observers=new Set<()=>void>();
 const emit=(type:string,code:string,eventAt:number)=>{const e={type,code,timeStamp:eventAt,isTrusted:true,repeat:false};for(const listener of listeners.get(type)??[])listener(e);};
 const addEventListener=(type:string,fn:(event:any)=>void)=>listeners.set(type,[...(listeners.get(type)??[]),fn]);
 const removeEventListener=(type:string,fn:(event:any)=>void)=>listeners.set(type,(listeners.get(type)??[]).filter(listener=>listener!==fn));
 const document={hidden:false,hasFocus:()=>true,activeElement:null,querySelector:()=>world};
 const requestAnimationFrame=(fn:(at:number)=>void)=>{rafCalls++;if(rafCalls===options.rafFailureAtCall)throw options.registrationFailure;frames.set(++id,fn);schedule();return id;};
 const setTimeout=(fn:()=>void,delay:number)=>{timers.set(++id,{at:time+delay,fn});schedule();return id;};
 const queue=(at:number,fn:()=>void)=>{events.set(++id,{at,fn});schedule();};
 function schedule(){if(pump||!active)return;pump=setImmediate(()=>{pump=undefined;
  const nextTimer=Math.min(...[...timers.values()].map(t=>t.at)),nextEvent=Math.min(...[...events.values()].map(e=>e.at));
  const next=Math.min(frames.size?nextFrame:Infinity,nextTimer,nextEvent);if(!Number.isFinite(next))return;
  time=Math.max(time,next);
  for(const [key,event] of [...events])if(event.at<=time){events.delete(key);event.fn();}
  for(const [key,timer] of [...timers])if(timer.at<=time){timers.delete(key);timer.fn();}
  if(frames.size&&nextFrame<=time){nextFrame=time+(options.frameMs??50);const pending=[...frames.values()];frames.clear();for(const fn of pending)fn(time-(options.clockFrameLag??0));}
  if(frames.size||timers.size||events.size)schedule();
 });}
 const root:any={async __latticeNativePulse(request:any){
   leg++;const issuedAt=time;pulses.push({...request,issuedAt,priorInputSeconds:runtime.playerInputSeconds,priorPendingInputChanges:runtime.simulationClock.pendingInputChanges});
   if(options.repeatReleaseAtMs!==undefined)queue(issuedAt+options.repeatReleaseAtMs,()=>{for(const key of request.codes)emit('keyup',key,issuedAt+200);});
   const delivery=options.delivery==='batched'?issuedAt+300:options.delivery==='historical'?issuedAt+300:undefined;
   const result=await scheduleNativePulse(request,{now:()=>10_000+time,schedule:setTimeout,cancel:key=>timers.delete(key as number),dispatch:(command:NativeKeyCommand)=>new Promise<void>(resolve=>{
     const issued=time,at=command.type==='keyUp'&&options.upDelayMs!==undefined?issued+options.upDelayMs:(delivery??issued);
     commands.push({leg,type:command.type,code:command.code,issuedAt:issued,handledAt:at});
     const deliver=()=>{emit(command.type==='rawKeyDown'?'keydown':'keyup',command.code,options.delivery==='historical'?issued:time);if(command.type==='keyUp'&&options.keyUpAckAtMs!==undefined)queue(issuedAt+options.keyUpAckAtMs,resolve);else resolve();};
     if(command.type==='keyUp'&&options.releaseAfterHudAtMs!==undefined)deferredReleases.push({at:issuedAt+options.releaseAfterHudAtMs,fn:deliver});else queue(at,deliver);
   })});
   Object.assign(pulses.at(-1),{returnedAt:time,hudClockAtReturn:JSON.parse(world.dataset.simulationClock??'null'),hudMaterializedAtReturn:Number(world.dataset.materializedChunks),pendingInputAtReturn:runtime.simulationClock.pendingInputChanges});
   if(options.pulseFailure)throw options.pulseFailure;
   return result;
 },async __latticeNativeProbeRecord(value:any){finishedReports++;record=value;},async notifyCoarseTransitionExited(){notify++;}};
 const context={window:root,performance:{now:()=>time,timeOrigin:10_000},document,addEventListener,removeEventListener,requestAnimationFrame,cancelAnimationFrame:(key:number)=>frames.delete(key),setTimeout,clearTimeout:(key:number)=>timers.delete(key),MutationObserver:class{observer:any;constructor(readonly fn:()=>void){this.observer=new dom.window.MutationObserver(fn);}observe(target:any,settings:any){this.observer.observe(target,settings);observers.add(this.fn);}takeRecords(){return this.observer.takeRecords();}disconnect(){this.observer.disconnect();observers.delete(this.fn);}}};
 vm.runInNewContext(probeCode,context);
 const ui={world,admin:{classList:{contains:()=>true}},overlay:{classList:{contains:()=>true}}};
 const Runtime=new Function('THREE','now','requestAnimationFrame','navigator','document','ui','i18n','planFineChunk','registerFineTerrainForChunk','keyedRandom','clamp','foldFineWildlifePopulationCount','playerHeadConstraint',runtimeCode)(THREE,()=>time,requestAnimationFrame,{scheduling:{isInputPending:()=>time<(options.inputPendingUntil??0)}},document,ui,{t:(_key:string,args:{error:string})=>args.error},planFineChunk,registerFineTerrainForChunk,keyedRandom,(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v)),foldFineWildlifePopulationCount,playerHeadConstraint);
 const runtime=new Runtime(),physics=new FinePhysicsAuthority();registerHomeTerrain(physics,72);
 if(options.block)physics.registerStatic({id:'wall',minX:35.65,maxX:35.9,minZ:0,maxZ:2});
 const coarseWorld=new CoarseWorldRuntime(new THREE.Scene());coarseWorld.update=()=>{};
 const camera=new THREE.PerspectiveCamera();camera.position.set(35.1,1.7,1.2);
 const node=()=>({classList:{add(){}},remove(){}});
 const noop=()=>{};
 Object.assign(runtime,{camera,physics,coarseWorld,keys:new Set<string>(),simulationClock:new SimulationClock(),persistenceReady:true,cameraMode:'firstPerson',interactionOpen:false,controls:{isLocked:true},playerPosition:{x:35.1,z:1.2},firstPersonRotation:new THREE.Euler(),playerInputSeconds:0,playerBlockedNpcs:new Set(),npcs:new Map(),materializedChunks:new Map(),activeFineChunkId:undefined,
 lastPersistenceSaveAt:time,lastHealthPoll:time,streamedPresentation:{unitIds:()=>['unit_1_0'],activate:()=>[],deactivate:noop,has:()=>false},physicsDynamicColliders:()=>[],groundHeightAt:(x:number,z:number)=>physics.groundContactAt(x,z)?.height??0,
 updateTime:noop,gameTimeText:()=> '08:15',updateObjects:noop,updateNpcs:noop,updateWildlife:noop,updateCameraShadow:noop,updateRaycast:noop,updateSpeech:noop,updateSelectionVisuals:noop,renderer:{render:noop},syncKnownActorPresentation:noop,syncStreamedPresentation:noop,resetPlayerInput(){throw Error('Unexpected input reset');},resetSimulationClock(){throw Error('Unexpected clock reset');},clearMovablePersistenceQueue:noop,
 fineChunkCache:new Map(),portables:{restoreFine:noop},randomness:readWorldRandomness(undefined),wildlifeTransfers:new Map(),wildlifeLineage:new Map(),wildlife:new Map(),objects:new Map(),visualTargets:[],streamedNpcs:{hasMesh:()=>false},
 fineWorkplaceForRole:()=>undefined,fineSpawnPosition:(position:any)=>position,
 spawnFineNpc(state:any,characterAsset:string){const mesh=new THREE.Object3D();mesh.position.set(state.position.x,0,state.position.z);this.npcs.set(state.id,{state,characterAsset,mesh,speechEl:node(),nameEl:node()});},spawnWildlife:()=>false,materializePendingWildlifeTransfers:noop,fineMetrics:()=>({food:0,wood:0,ecology:0,prosperity:0,shrub:0,fruit:0,crop:0}),event:noop,log(message:string,level:string){if(level!=='developer')throw Error(message);}
 });
 for(const method of ['materializeFineChunk','collapseFineChunk']){const original=runtime[method].bind(runtime);runtime[method]=(...args:any[])=>{original(...args);materializationChanges.push({method,at:time,x:runtime.playerPosition.x,materialized:coarseWorld.status().materializedChunks,terrain:physics.stats().terrainSurfaces});};}
 const updateUi=runtime.updateUi.bind(runtime);runtime.updateUi=()=>{
  updateUi();
  for(const release of [...deferredReleases])if(release.at<=time){deferredReleases.splice(deferredReleases.indexOf(release),1);release.fn();}
  const pulse=pulses.at(-1);
  if(pulse&&options.repeatReleaseAfterHudMs!==undefined&&time===pulse.issuedAt+options.repeatReleaseAfterHudMs)queueMicrotask(()=>{for(const key of pulse.codes)emit('keyup',key,pulse.issuedAt+200);});
  history.push({at:time,consumed:runtime.simulationClock.consumedThroughMs,pending:runtime.simulationClock.diagnostics.pendingSeconds,pendingInputChanges:runtime.simulationClock.pendingInputChanges,input:runtime.playerInputSeconds,x:runtime.playerPosition.x,materialized:Number(world.dataset.materializedChunks)});};
 addEventListener('keydown',event=>runtime.playerMovementKey(event.code,true,event.repeat,event.timeStamp));addEventListener('keyup',event=>runtime.playerMovementKey(event.code,false,false,event.timeStamp));
 runtime.simulationClock.advance(time-(options.initialDebt??0),()=>{});runtime.updateUi();
 runtime.animate(time-(options.clockFrameLag??0));nextFrame=time+(options.frameMs??50);
 if(options.turnAtMs!==undefined)queue(time+options.turnAtMs,()=>{camera.rotation.y=Math.PI;runtime.recordPlayerInput();});
 const originalListeners=[...listeners.values()].reduce((sum,entries)=>sum+entries.length,0);
 try{
  const result=await vm.runInNewContext(callback,context)();
  return {options,result,notify,pulses,commands,record,history,materializationChanges,final:{x:runtime.playerPosition.x,input:runtime.playerInputSeconds,pendingInputChanges:runtime.simulationClock.pendingInputChanges,pending:runtime.simulationClock.diagnostics.pendingSeconds}};
 }finally{active=false;if(pump)clearImmediate(pump);frames.clear();timers.clear();events.clear();assert.equal(finishedReports,1);assert.equal(record.held.length,0);if(options.expectedFinishAtMs!==undefined)assert.equal(time,10000+options.expectedFinishAtMs);assert.equal(observers.size,0);assert.equal([...listeners.values()].reduce((sum,entries)=>sum+entries.length,0),originalListeners);dom.window.close();}
}

const componentCases=[
 {name:'prompt',entered:true},
 {name:'slow RAF',frameMs:500,entered:true},
 {name:'retimed future release',delivery:'historical',entered:true},
 {name:'input consumed before world debt drains',initialDebt:5000,frameMs:900,entered:true},
 {name:'native timestamps collapse in batched delivery',delivery:'batched',entered:false},
 {name:'initial clock debt outlasts the leg',initialDebt:10_000,frameMs:800,entered:false},
 {name:'discrete input remains pending',inputPendingUntil:13_000,entered:false},
 {name:'authoritative collision blocks the crossing',block:true,entered:false},
 {name:'target materializes and unloads within one frame',frameMs:250,turnAtMs:150,entered:false},
 {name:'published target disappears before effective release',delivery:'historical',frameMs:25,upDelayMs:240,turnAtMs:425,entered:false},
 {name:'post-keyup HUD precedes delayed host acknowledgement',frameMs:1200,keyUpAckAtMs:2499,entered:true},
 {name:'host acknowledgement outlasts the deadline',frameMs:1200,keyUpAckAtMs:2600,entered:false},
 {name:'pre-keyup records delivered after keyup are discarded',delivery:'historical',frameMs:25,releaseAfterHudAtMs:425,turnAtMs:425,entered:false},
 {name:'same-task repeated keyup invalidates published proof',frameMs:1200,keyUpAckAtMs:2499,repeatReleaseAfterHudMs:2400,entered:false},
 {name:'later-task repeated keyup invalidates published proof',frameMs:1200,keyUpAckAtMs:2499,repeatReleaseAtMs:2401,entered:false},
 {name:'first RAF is after the leg deadline',frameMs:2600,entered:false}
] satisfies Array<Options&{entered:boolean}>;
for(const scenario of componentCases)test(`coarse transition real components: ${scenario.name}`,async()=>{
 const f=await nativeComponentRoute(scenario);
 assert.equal(f.result.entered,scenario.entered);assert.equal(f.result.exited,scenario.entered);
 assert.equal(f.pulses.length,scenario.entered?2:1);assert.equal(f.notify,Number(scenario.entered));
 assert.equal(f.record.held.length,0);assert.ok(f.record.keys.every((key:any)=>key.trusted));
 for(const [index,pulse] of f.pulses.entries()){
  assert.equal(pulse.codes.join(','),index?'ShiftLeft,KeyA':'ShiftLeft,KeyD');assert.equal(pulse.durationMs,200);
  assert.equal(pulse.deadlineEpochMs,10_000+pulse.issuedAt+2500);
  const commands=f.commands.filter(command=>command.leg===index+1);
  assert.equal(commands.length,4);assert.ok(commands.filter(command=>command.type==='keyUp').every(command=>command.issuedAt===pulse.issuedAt+200));
 }
 if(scenario.entered){
  assert.ok(Math.abs(f.pulses[1].priorInputSeconds-.2)<1e-9);
  assert.equal(f.pulses[1].priorPendingInputChanges,0);
  assert.ok(Math.abs(f.final.input-.4)<1e-9);assert.equal(f.final.pendingInputChanges,0);
  assert.ok(Math.abs(f.final.x-35.1)<1e-9);assert.equal(f.result.materialized,0);
  assert.ok(f.pulses[1].issuedAt<f.pulses[0].issuedAt+2500);
  assert.ok(f.result.finishedAt<f.pulses[1].issuedAt+2500);
  assert.deepEqual(f.materializationChanges.map(change=>[change.materialized,change.terrain]),[[1,2],[0,1]]);
 }else assert.equal(f.result.finishedAt,f.pulses[0].issuedAt+Math.max(2500,scenario.keyUpAckAtMs??0));
 if(scenario.keyUpAckAtMs!==undefined)assert.equal(f.pulses[0].returnedAt,f.pulses[0].issuedAt+scenario.keyUpAckAtMs);
 if(scenario.name==='retimed future release')assert.ok(f.history.some(frame=>frame.materialized===1&&frame.pending===0&&frame.pendingInputChanges>0&&frame.input<.2));
 if(scenario.name==='input consumed before world debt drains')assert.ok(f.history.some(frame=>frame.materialized===1&&frame.pending>0&&frame.pendingInputChanges===0&&Math.abs(frame.input-.2)<1e-9));
 if(scenario.name==='published target disappears before effective release'){
  assert.equal(f.pulses[0].hudMaterializedAtReturn,1);assert.equal(f.pulses[0].hudClockAtReturn.pendingInputChanges,0);
  assert.ok(f.pulses[0].pendingInputAtReturn>0);
  assert.deepEqual(f.materializationChanges.map(change=>change.materialized),[1,0]);
  assert.ok(f.history.some(frame=>frame.materialized===1&&frame.pendingInputChanges>0));
  assert.equal(f.result.materialized,0);
 }
 if(scenario.name==='target materializes and unloads within one frame'){
  assert.deepEqual(f.materializationChanges.map(change=>change.materialized),[1,0]);
  assert.ok(f.history.every(frame=>frame.materialized===0));assert.equal(f.result.materialized,0);
 }
});


for(const kind of ['pulse-rejection','in-flight-RAF-registration'] as const)test(`coarse transition owns delayed native terminal after ${kind}`,async()=>{
 const failure=new Error(kind);
 const options:Options={name:kind,frameMs:1200,keyUpAckAtMs:kind==='pulse-rejection'?2600:2499,expectedFinishAtMs:kind==='pulse-rejection'?2600:2499};
 if(kind==='pulse-rejection')options.pulseFailure=failure;
 else {options.rafFailureAtCall=6;options.registrationFailure=failure;}
 await assert.rejects(nativeComponentRoute(options),error=>error===failure);
});
