import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../e2e/helpers/native-waypoint.ts',import.meta.url),'utf8');
const callback=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace('export async function driveNativeWaypoint','async function driveNativeWaypoint')+'\ndriveNativeWaypoint;';

for(const mode of ['settled','deadline','invalid'] as const)test(`native release frame ${mode} cannot use a partial observation`,async()=>{
 let time=0,x=0,input=0,pulses=0,frames=0,id=0;const timers=new Map<number,()=>void>(),observers=new Set<()=>void>();
 const canvas={},world={dataset:{get playerX(){return String(x);},playerZ:'0',get playerInputSeconds(){return String(input);},simulationClock:'{"pendingSeconds":0}',characterSoles:'[]',treePresentation:'[]'}};
 const context={performance:{now:()=>time,timeOrigin:100000},document:{pointerLockElement:canvas,querySelector:(s:string)=>s==='#game canvas'?canvas:world},
  window:{nativeInputProbe:{start(){},async pulse(){if(++pulses>1)throw new Error('second pulse used incomplete release position');time=250;x=.225;input=.05;},async finish(){}},dispatchEvent(){throw new Error('native route must not synthesize keys');}},
  MutationObserver:class {fn:()=>void;constructor(fn:()=>void){this.fn=fn;}observe(){observers.add(this.fn);}disconnect(){observers.delete(this.fn);}},
  setTimeout:(fn:()=>void)=>{timers.set(++id,fn);return id;},clearTimeout:(n:number)=>timers.delete(n),cancelAnimationFrame(){},
  requestAnimationFrame:(fn:(at:number)=>void)=>{const n=++id;setImmediate(()=>{time+=16;frames++;if(mode==='deadline'&&frames===2){time=2000;for(const expire of [...timers.values()])expire();return;}if(frames===2){x=1.125;input=.25;if(mode==='invalid')world.dataset.simulationClock='invalid';for(const notify of observers)notify();}fn(time);});return n;}};
 const run=vm.runInNewContext(callback,context)({target:{x:1.125,z:0},timeoutMs:2000,tolerance:.01});
 if(mode==='invalid')await assert.rejects(run,/JSON/);else{const result=await run;assert.equal(result.reached,mode==='settled');assert.equal(result.inputSeconds,mode==='settled'?.25:.05);}
 assert.equal(pulses,1);assert.equal(observers.size,0);assert.equal(timers.size,0);
});
