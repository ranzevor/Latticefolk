import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';
import {SimulationClock} from '../src/world/simulationClock.js';
import {CoarseWorldRuntime} from '../src/world/coarseWorld.js';
import {FinePhysicsAuthority} from '../src/world/finePhysics.js';
import {registerHomeTerrain,registerFineTerrainForChunk} from '../src/world/fineTerrain.js';
const source=fs.readFileSync(new URL('../e2e/helpers/coarse-native-transition.ts',import.meta.url),'utf8');
const callback=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace('export async function crossCoarseBoundary','async function crossCoarseBoundary')+'\ncrossCoarseBoundary;';
for(const mode of ['normal','late-frame','debt','invalid','not-entered'] as const)test(`coarse native transition ${mode} preserves release and deadline`,async()=>{
 let time=0,frames=0,id=0,finished=0,notified=0;const observers=new Set<()=>void>(),timers=new Map<number,()=>void>(),pulses:Array<{codes:string[];durationMs:number;deadlineEpochMs:number}>=[];
 const world={dataset:{coarseRequestTimeouts:'0',coarseDecidedChunks:'8',coarseLastBatchSize:'8',materializedChunks:'0',simulationClock:'{"pendingSeconds":0}'}};
 const context={performance:{now:()=>time,timeOrigin:10000},document:{querySelector:()=>world},
  window:{nativeInputProbe:{start(){},async pulse(p:{codes:string[];durationMs:number;deadlineEpochMs:number}){pulses.push(p);time+=200;frames=0;},async finish(){finished++;}},async notifyCoarseTransitionExited(){notified++;}},
  MutationObserver:class {fn:()=>void;constructor(fn:()=>void){this.fn=fn;}observe(){observers.add(this.fn);}disconnect(){observers.delete(this.fn);}},
  setTimeout:(fn:()=>void)=>{timers.set(++id,fn);return id;},clearTimeout:(n:number)=>timers.delete(n),cancelAnimationFrame(){},requestAnimationFrame:(fn:(at:number)=>void)=>{const n=++id;setImmediate(()=>{
   time+=16;frames++;
   if(mode==='late-frame'||(mode==='debt'&&frames>2)||time>=pulses.at(-1)!.deadlineEpochMs-10000){time=pulses.at(-1)!.deadlineEpochMs-10000;for(const expire of [...timers.values()])expire();return;}
   if(frames===2){world.dataset.materializedChunks=mode==='not-entered'?'0':pulses.length===1?'1':'0';world.dataset.simulationClock=mode==='invalid'?'invalid':mode==='debt'?'{"pendingSeconds":1}':'{"pendingSeconds":0}';for(const notify of observers)notify();}
   fn(time);
  });return n;}};
 const run=vm.runInNewContext(callback,context)();
 if(mode==='invalid')await assert.rejects(run,/JSON/);else{const r=await run;assert.equal(r.entered,mode==='normal');assert.equal(r.exited,mode==='normal');}
 assert.equal(pulses.length,mode==='normal'?2:1);assert.equal(pulses[0].codes.join(','),'ShiftLeft,KeyD');assert.equal(pulses[0].durationMs,200);assert.equal(pulses[0].deadlineEpochMs,12500);
 if(mode==='normal')assert.equal(pulses[1].codes.join(','),'ShiftLeft,KeyA');
 assert.equal(notified,Number(mode==='normal'));assert.equal(finished,1);assert.equal(observers.size,0);assert.equal(timers.size,0);
});

const main=ts.createSourceFile('main.ts',fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const names=new Set(['playerMovementKey','recordPlayerInput','simulateStep','updatePlayer','updateFineChunkMaterialization','animate']);
const members:string[]=[],diagnostics:string[]=[];
for(const node of main.statements)if(ts.isClassDeclaration(node)&&node.name?.text==='TownGame')for(const member of node.members){
  if((ts.isMethodDeclaration(member)||ts.isPropertyDeclaration(member))&&names.has(member.name.getText(main)))members.push(member.getText(main));
  if(ts.isMethodDeclaration(member)&&member.name.getText(main)==='updateUi')for(const statement of member.body!.statements){
    if(ts.isExpressionStatement(statement)&&ts.isBinaryExpression(statement.expression)&&
      ['materializedChunks','simulationClock','simulationConsumedThrough'].some(key=>(statement.expression as ts.BinaryExpression).left.getText(main)===`ui.world.dataset.${key}`))diagnostics.push(statement.getText(main));
  }
}
assert.equal(members.length,names.size);assert.equal(diagnostics.length,3);
const runtimeCode=ts.transpileModule(`return class Runtime {${members.join('\n')}\nupdateUi(){const world=this.coarseWorld.status();${diagnostics.join('\n')}}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;

for(const boundary of ['pulse-return','first-consumed-frame'] as const)test(`coarse transition waits for late native input after the ${boundary} boundary`,async()=>{
  let time=1000,id=0,finished=0,notified=0,pump:ReturnType<typeof setImmediate>|undefined;
  const frames=new Map<number,(at:number)=>void>(),timers=new Map<number,{at:number;fn:()=>void}>(),observers=new Set<()=>void>();
  const pulses:Array<{codes:string[];durationMs:number;deadlineEpochMs:number;issuedAt:number}>=[];
  const consumedBeforeCrossing:number[]=[],changes:Array<{at:number;materialized:number;terrain:number}>=[];
  const world={dataset:{coarseRequestTimeouts:'0',coarseDecidedChunks:'8',coarseLastBatchSize:'8',materializedChunks:'0',simulationClock:'{"pendingSeconds":0}',simulationConsumedThrough:''}};
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
    MutationObserver:class{constructor(readonly fn:()=>void){}observe(){observers.add(this.fn);}disconnect(){observers.delete(this.fn);}},
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
    updateUi();for(const observer of observers)observer();
    const pulse=pulses.at(-1);
    if(pulse&&runtime.simulationClock.consumedThroughMs>=pulse.issuedAt+210&&runtime.simulationClock.diagnostics.pendingSeconds===0&&world.dataset.materializedChunks===(pulses.length===1?'0':'1'))consumedBeforeCrossing.push(pulses.length);
  };
  runtime.animate(time);
  try{
    const result=await vm.runInNewContext(callback,context)();
    assert.equal(result.entered,true);assert.equal(result.exited,true);assert.equal(result.materialized,0);
    assert.equal(pulses.length,2);assert.deepEqual(pulses.map(p=>p.codes.join(',')),['ShiftLeft,KeyD','ShiftLeft,KeyA']);
    for(const pulse of pulses){assert.equal(pulse.durationMs,200);assert.equal(pulse.deadlineEpochMs,10000+pulse.issuedAt+2500);}
    assert.ok(consumedBeforeCrossing.includes(1));assert.ok(consumedBeforeCrossing.includes(2));
    assert.deepEqual(changes.map(change=>[change.materialized,change.terrain]),[[1,2],[0,1]]);
    assert.ok(changes.every((change,index)=>change.at<pulses[index].issuedAt+2500));
    assert.ok(Math.abs(runtime.playerPosition.x-35.82)<1e-9);assert.equal(runtime.playerPosition.z,1.2);
    assert.equal(runtime.simulationClock.diagnostics.resetReason,'none');assert.equal(runtime.keys.size,0);
    assert.equal(finished,1);assert.equal(notified,1);assert.equal(observers.size,0);assert.equal(timers.size,0);
    assert.equal([...frames.values()].filter(frame=>frame!==runtime.animate).length,0);
  }finally{if(pump)clearImmediate(pump);frames.clear();timers.clear();}
});

for(const mode of ['consumed','partial','late'] as const)test(`coarse native release ${mode} uses the unchanged leg deadline`,async()=>{
  let time=0,frames=0,id=0,legs=0,notified=0;
  const observers=new Set<()=>void>(),timers=new Map<number,()=>void>();
  const world={dataset:{coarseRequestTimeouts:'0',coarseDecidedChunks:'8',coarseLastBatchSize:'8',materializedChunks:'0',simulationClock:'{"pendingSeconds":0}',simulationConsumedThrough:'0'}};
  const context={performance:{now:()=>time,timeOrigin:10000},document:{querySelector:()=>world},
    window:{nativeInputProbe:{start(){},async pulse(){
      legs++;time+=mode==='late'?2600:1200;
      world.dataset.materializedChunks=legs===1?'1':'0';
      world.dataset.simulationConsumedThrough=String(time-(mode==='partial'?600:100));
      return {releasedEventAt:time-500};
    },async finish(){}},async notifyCoarseTransitionExited(){notified++;}},
    MutationObserver:class {fn:()=>void;constructor(fn:()=>void){this.fn=fn;}observe(){observers.add(this.fn);}disconnect(){observers.delete(this.fn);}},
    setTimeout:(fn:()=>void)=>{timers.set(++id,fn);return id;},clearTimeout:(n:number)=>timers.delete(n),cancelAnimationFrame(){},
    requestAnimationFrame:(fn:(at:number)=>void)=>{const n=++id;setImmediate(()=>{
      frames++;time+=16;world.dataset.simulationConsumedThrough=String(time);
      for(const notify of observers)notify();fn(time);
    });return n;}};
  const result=await vm.runInNewContext(callback,context)();
  assert.equal(result.entered,mode!=='late');assert.equal(result.exited,mode!=='late');
  assert.equal(legs,mode==='late'?1:2);assert.equal(notified,mode==='late'?0:1);
  assert.equal(frames,mode==='partial'?2:0);assert.equal(observers.size,0);assert.equal(timers.size,0);
});

const waitingCases=[
  {name:'never enters',enterAt:Infinity,entered:false,exited:false},
  {name:'never exits',enterAt:216,exitAt:Infinity,entered:true,exited:false},
  {name:'last frame before the deadline',enterAt:2499,exitAt:2499,offsets:[216,2499],entered:true,exited:true},
  {name:'frame at the deadline',enterAt:2500,offsets:[216,2500],timerDelay:100,entered:false,exited:false},
  {name:'frame after the deadline',enterAt:2600,offsets:[216,2600],timerDelay:1000,entered:false,exited:false},
  {name:'no frames',noFrames:true,entered:false,exited:false},
  {name:'release still unconsumed',unconsumed:true,enterAt:216,entered:false,exited:false},
  {name:'outstanding simulation debt',clock:'{"pendingSeconds":1}',enterAt:216,entered:false,exited:false},
  {name:'malformed clock',clock:'invalid',error:/JSON/},
  {name:'missing clock',clock:'null',error:/clock is unavailable/},
  {name:'negative clock',clock:'{"pendingSeconds":-1}',error:/clock is unavailable/},
  {name:'nonfinite clock',clock:'{"pendingSeconds":1e400}',error:/clock is unavailable/},
  {name:'frame registration fails',rafError:true,error:/RAF failed/},
  {name:'pulse fails after release',pulseError:true,error:/Pulse failed/},
  {name:'predicate read fails',predicateError:true,error:/Materialization read failed/}
];
for(const scenario of waitingCases)test(`coarse transition waiting cleans up when ${scenario.name}`,async()=>{
  let time=0,id=0,issuedAt=0,framesSeen=0,finished=0,notified=0,pump:ReturnType<typeof setImmediate>|undefined;
  const timers=new Map<number,{at:number;fn:()=>void}>(),frames=new Map<number,(at:number)=>void>(),observers=new Set<()=>void>(),held=new Set<string>();
  const pulses:Array<{codes:string[];durationMs:number;deadlineEpochMs:number;issuedAt:number}>=[];
  const world={dataset:{coarseRequestTimeouts:'0',coarseDecidedChunks:'8',coarseLastBatchSize:'8',materializedChunks:'0',simulationClock:'{"pendingSeconds":0}',simulationConsumedThrough:'0'}};
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
        world.dataset.simulationClock=scenario.clock??'{"pendingSeconds":0}';
        if(scenario.predicateError)Object.defineProperty(world.dataset,'materializedChunks',{get(){throw Error('Materialization read failed');}});
        for(const observer of observers)observer();
        const pending=[...frames.values()];frames.clear();for(const frame of pending)frame(time);
      }
      if(frames.size||timers.size)schedule();
    });
  };
  const context={performance:{now:()=>time,timeOrigin:10000},document:{querySelector:()=>world},
    MutationObserver:class{constructor(readonly fn:()=>void){}observe(){observers.add(this.fn);}disconnect(){observers.delete(this.fn);}},
    setTimeout:(fn:()=>void,delay:number)=>{timers.set(++id,{at:time+delay+(scenario.timerDelay??0),fn});schedule();return id;},clearTimeout:(key:number)=>timers.delete(key),
    requestAnimationFrame:(fn:(at:number)=>void)=>{if(scenario.rafError)throw Error('RAF failed');frames.set(++id,fn);schedule();return id;},cancelAnimationFrame:(key:number)=>frames.delete(key),
    window:{nativeInputProbe:{start(){},async pulse(p:{codes:string[];durationMs:number;deadlineEpochMs:number}){
      issuedAt=time;framesSeen=0;pulses.push({...p,issuedAt});for(const code of p.codes)held.add(code);
      time+=200;held.clear();world.dataset.simulationConsumedThrough=String(time-(scenario.unconsumed?1:0));
      if(scenario.pulseError)throw Error('Pulse failed');return{releasedEventAt:time};
    },async finish(){finished++;}},async notifyCoarseTransitionExited(){notified++;}}};
  try{
    const run=vm.runInNewContext(callback,context)();
    if(scenario.error)await assert.rejects(run,scenario.error);
    else{
      const result=await run;assert.equal(result.entered,scenario.entered);assert.equal(result.exited,scenario.exited);
      assert.equal(notified,Number(scenario.exited));assert.equal(pulses.length,scenario.entered?2:1);
      if(!scenario.entered&&!scenario.timerDelay)assert.equal(result.finishedAt,2500);
    }
    for(const [index,pulse] of pulses.entries()){
      assert.equal(pulse.codes.join(','),index?'ShiftLeft,KeyA':'ShiftLeft,KeyD');assert.equal(pulse.durationMs,200);
      assert.equal(pulse.deadlineEpochMs,10000+pulse.issuedAt+2500);
    }
    assert.equal(finished,1);assert.equal(held.size,0);assert.equal(observers.size,0);assert.equal(timers.size,0);assert.equal(frames.size,0);
  }finally{if(pump)clearImmediate(pump);}
});
