import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import type {observeReleasedPlayerFrame} from '../e2e/helpers/released-player-frame.js';
const compiled=ts.transpileModule(fs.readFileSync(new URL('../e2e/helpers/released-player-frame.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;

function fixture(){
  const dataset={playerX:'-9',playerZ:'-9.9183',playerInputSeconds:'2.1457',simulationClock:JSON.stringify({pendingSeconds:0,pendingInputChanges:0})};
  const frames=new Map<number,(at:number)=>void>();let now=100,serial=0,changed=(_records?:unknown[])=>{},timer=()=>{},disconnected=false,timerCleared=false;
  class Observer {constructor(callback:()=>void){changed=callback;}observe(){}takeRecords(){return [];}disconnect(){disconnected=true;}}
  const call=new Function('document','performance','MutationObserver','requestAnimationFrame','cancelAnimationFrame','setTimeout','clearTimeout','addEventListener','removeEventListener',`const exports={};${compiled};return exports.observeReleasedPlayerFrame();`);
  const promise=call({querySelector:()=>({dataset})},{now:()=>now},Observer,
    (callback:(at:number)=>void)=>{frames.set(++serial,callback);return serial;},(id:number)=>frames.delete(id),
    (callback:()=>void)=>{timer=callback;return 1;},()=>{timerCleared=true;},()=>{},()=>{}) as ReturnType<typeof observeReleasedPlayerFrame>;
  let resolved=false;void promise.then(()=>{resolved=true;},()=>{});
  const frame=async(at:number)=>{now=Math.max(now,at);const [id,callback]=frames.entries().next().value!;frames.delete(id);callback(at);await Promise.resolve();};
  return {dataset,promise,frame,changed:()=>changed([{attributeName:'data-simulation-clock'}]),timeout:()=>timer(),resolved:()=>resolved,cleaned:()=>disconnected&&timerCleared&&frames.size===0};
}

test('release observation rejects stale HUD and pre-release frame timestamps',async()=>{
  const f=fixture();await f.frame(101);assert.equal(f.resolved(),false);
  f.changed();await f.frame(99);assert.equal(f.resolved(),false);
  await f.frame(102);assert.equal(f.resolved(),false);
  f.dataset.playerZ='-9.9403';f.dataset.playerInputSeconds='2.5006';f.changed();await f.frame(103);
  assert.deepEqual(await f.promise,{x:-9,z:-9.9403,inputSeconds:2.5006,frameAt:103});assert.equal(f.cleaned(),true);
});

test('release observation retains simulation debt until a fresh zero-debt frame',async()=>{
  const f=fixture();f.dataset.simulationClock=JSON.stringify({pendingSeconds:.25,pendingInputChanges:0});f.changed();await f.frame(110);assert.equal(f.resolved(),false);
  f.dataset.simulationClock=JSON.stringify({pendingSeconds:0,pendingInputChanges:0});await f.frame(111);assert.equal(f.resolved(),false);
  f.changed();await f.frame(112);assert.equal((await f.promise).frameAt,112);assert.equal(f.cleaned(),true);
});

test('missing settled frame fails and disconnects observation',async()=>{
  const f=fixture();f.timeout();await assert.rejects(f.promise,/no fresh settled simulation frame/);assert.equal(f.cleaned(),true);
});

import vm from 'node:vm';
import {releasedInputRuntime} from './helpers/released-input-runtime.js';

test('released frame waits for the accepted future keyup through real physics and HUD',async()=>{
  const f=releasedInputRuntime();
  try{
    await new Promise<void>(resolve=>f.queue(10_300,()=>{f.emit('keydown','KeyW',10_000);f.emit('keyup','KeyW',10_250);resolve();}));
    const fn=vm.runInNewContext(`${compiled};exports.observeReleasedPlayerFrame;`,{...f.context,exports:{}});
    const result=await fn();
    assert.ok(Math.abs(result.inputSeconds-.25)<1e-9,'the complete accepted key duration must be observed');
    assert.equal(result.z,-1.125);assert.equal(f.runtime.simulationClock.pendingInputChanges,0);
    assert.ok(f.history.some(frame=>frame.pending===0&&frame.queue>0));
  }finally{f.close();}
});

for(const ordering of ['before-keyup','after-keyup','delivered-before-duplicate-keyup'] as const)test(`released frame freshness excludes ${ordering} mutation records`,async()=>{
  const f=releasedInputRuntime({noHudAfterRelease:true});
  try{
    await new Promise<void>(resolve=>f.queue(10_300,()=>{f.emit('keydown','KeyW',10_000);f.emit('keyup','KeyW',10_250);resolve();}));
    const fn=vm.runInNewContext(`${compiled};exports.observeReleasedPlayerFrame;`,{...f.context,exports:{}});
    const run=fn(1000);
    f.queue(10_600,()=>{
      const duplicate=()=>f.emit('keyup','KeyW',10_250);
      if(ordering==='after-keyup'){duplicate();f.runtime.updateUi();}
      else {f.runtime.updateUi();if(ordering==='before-keyup')duplicate();else queueMicrotask(duplicate);}
    });
    if(ordering==='after-keyup'){const result=await run;assert.ok(Math.abs(result.inputSeconds-.25)<1e-9);assert.equal(result.z,-1.125);}
    else await assert.rejects(run,/no fresh settled simulation frame/);
    assert.equal(f.runtime.simulationClock.pendingInputChanges,0);
  }finally{f.close();}
});

test('released frame cannot reuse the HUD published before its public request',async()=>{
  const f=releasedInputRuntime({noHudAfterRelease:true});
  try{
    await new Promise<void>(resolve=>f.queue(10_300,()=>{f.emit('keydown','KeyW',10_000);f.emit('keyup','KeyW',10_250);resolve();}));
    const fn=vm.runInNewContext(`${compiled};exports.observeReleasedPlayerFrame;`,{...f.context,exports:{}});
    await assert.rejects(fn(1000),/no fresh settled simulation frame/);
    assert.equal(f.time,11_300);
  }finally{f.close();}
});

for(const registrationFailure of ['observer','keydown','keyup','timer','raf'] as const)test(`released frame cleans partial ${registrationFailure} registration and preserves its error`,async()=>{
  const error=new Error(`registration ${registrationFailure}`),f=releasedInputRuntime({registrationFailure,registrationError:error});
  try{const fn=vm.runInNewContext(`${compiled};exports.observeReleasedPlayerFrame;`,{...f.context,exports:{}});await assert.rejects(fn(),value=>value===error);}
  finally{f.close();}
});

for(const value of [
  {pendingSeconds:0},
  {pendingSeconds:0,pendingInputChanges:-1},
  {pendingSeconds:0,pendingInputChanges:.5},
  {pendingSeconds:0,pendingInputChanges:'0'},
  {pendingSeconds:-1,pendingInputChanges:0},
  {pendingSeconds:'0',pendingInputChanges:0},
  null
])test(`released frame fails closed on invalid clock ${JSON.stringify(value)}`,async()=>{
  const f=fixture();f.dataset.simulationClock=JSON.stringify(value);f.changed();
  await assert.rejects(f.promise,/clock observation is unavailable/);assert.equal(f.cleaned(),true);
});

test('released frame rejects malformed diagnostics and cleans pending work',async()=>{
  const f=fixture();f.dataset.simulationClock='invalid';f.changed();
  await assert.rejects(f.promise,/JSON/);assert.equal(f.cleaned(),true);
});

for(const at of [20_100,20_101])test(`released frame cannot return at wall timestamp ${at} after its default deadline`,async()=>{
  const f=fixture();f.changed();await f.frame(at);
  await assert.rejects(f.promise,/no fresh settled simulation frame/);assert.equal(f.cleaned(),true);
});
