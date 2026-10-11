import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import type {observeReleasedPlayerFrame} from '../e2e/helpers/released-player-frame.js';
const compiled=ts.transpileModule(fs.readFileSync(new URL('../e2e/helpers/released-player-frame.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;

function fixture(){
  const dataset={playerX:'-9',playerZ:'-9.9183',playerInputSeconds:'2.1457',simulationClock:JSON.stringify({pendingSeconds:0})};
  const frames=new Map<number,(at:number)=>void>();let serial=0,changed=()=>{},timer=()=>{},disconnected=false,timerCleared=false;
  class Observer {constructor(callback:()=>void){changed=callback;}observe(){}disconnect(){disconnected=true;}}
  const call=new Function('document','performance','MutationObserver','requestAnimationFrame','cancelAnimationFrame','setTimeout','clearTimeout',`const exports={};${compiled};return exports.observeReleasedPlayerFrame();`);
  const promise=call({querySelector:()=>({dataset})},{now:()=>100},Observer,
    (callback:(at:number)=>void)=>{frames.set(++serial,callback);return serial;},(id:number)=>frames.delete(id),
    (callback:()=>void)=>{timer=callback;return 1;},()=>{timerCleared=true;}) as ReturnType<typeof observeReleasedPlayerFrame>;
  let resolved=false;void promise.then(()=>{resolved=true;},()=>{});
  const frame=async(at:number)=>{const [id,callback]=frames.entries().next().value!;frames.delete(id);callback(at);await Promise.resolve();};
  return {dataset,promise,frame,changed:()=>changed(),timeout:()=>timer(),resolved:()=>resolved,cleaned:()=>disconnected&&timerCleared&&frames.size===0};
}

test('release observation rejects stale HUD and pre-release frame timestamps',async()=>{
  const f=fixture();await f.frame(101);assert.equal(f.resolved(),false);
  f.changed();await f.frame(99);assert.equal(f.resolved(),false);
  await f.frame(102);assert.equal(f.resolved(),false);
  f.dataset.playerZ='-9.9403';f.dataset.playerInputSeconds='2.5006';f.changed();await f.frame(103);
  assert.deepEqual(await f.promise,{x:-9,z:-9.9403,inputSeconds:2.5006,frameAt:103});assert.equal(f.cleaned(),true);
});

test('release observation retains simulation debt until a fresh zero-debt frame',async()=>{
  const f=fixture();f.dataset.simulationClock=JSON.stringify({pendingSeconds:.25});f.changed();await f.frame(110);assert.equal(f.resolved(),false);
  f.dataset.simulationClock=JSON.stringify({pendingSeconds:0});await f.frame(111);assert.equal(f.resolved(),false);
  f.changed();await f.frame(112);assert.equal((await f.promise).frameAt,112);assert.equal(f.cleaned(),true);
});

test('missing settled frame fails and disconnects observation',async()=>{
  const f=fixture();f.timeout();await assert.rejects(f.promise,/no fresh settled simulation frame/);assert.equal(f.cleaned(),true);
});
