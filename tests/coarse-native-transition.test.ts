import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
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
   if(mode==='late-frame'||(mode==='debt'&&frames>2)){time=pulses.at(-1)!.deadlineEpochMs-10000;for(const expire of [...timers.values()])expire();return;}
   if(frames===2){world.dataset.materializedChunks=mode==='not-entered'?'0':pulses.length===1?'1':'0';world.dataset.simulationClock=mode==='invalid'?'invalid':mode==='debt'?'{"pendingSeconds":1}':'{"pendingSeconds":0}';for(const notify of observers)notify();}
   fn(time);
  });return n;}};
 const run=vm.runInNewContext(callback,context)();
 if(mode==='invalid')await assert.rejects(run,/JSON/);else{const r=await run;assert.equal(r.entered,mode==='normal');assert.equal(r.exited,mode==='normal');}
 assert.equal(pulses.length,mode==='normal'?2:1);assert.equal(pulses[0].codes.join(','),'ShiftLeft,KeyD');assert.equal(pulses[0].durationMs,200);assert.equal(pulses[0].deadlineEpochMs,12500);
 if(mode==='normal')assert.equal(pulses[1].codes.join(','),'ShiftLeft,KeyA');
 assert.equal(notified,Number(mode==='normal'));assert.equal(finished,1);assert.equal(observers.size,0);assert.equal(timers.size,0);
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
