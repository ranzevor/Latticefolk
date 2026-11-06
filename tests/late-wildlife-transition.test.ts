import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function browserCallback(path:string,name:string){
  const source=fs.readFileSync(new URL(path,import.meta.url),'utf8');
  return ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
    .replace(`export async function ${name}`,`async function ${name}`)+`\n${name};`;
}
const transition=browserCallback('../e2e/helpers/late-wildlife-transition.ts','driveLateWildlifeTransition');
const waypoint=browserCallback('../e2e/helpers/native-waypoint.ts','driveNativeWaypoint');

function fixture(failure?:'start'|'outbound'|'inbound'|'release'|'record'){
  const events=new EventTarget(),order:string[]=[],legs:unknown[]=[];
  const world={dataset:{materializedChunks:'1',wildlifeVisuals:'[{"id":"rabbit_rng"}]'}};
  let leg=0;
  const root={
    dispatchEvent:(event:Event)=>{
      if(event.type==='latticefolk-e2e-wildlife-arm')events.dispatchEvent(new CustomEvent('latticefolk-e2e-wildlife-created',{
        detail:JSON.stringify({requests:[{wildlife:{id:'rabbit_rng'}}]})
      }));
      return true;
    },
    lateWildlifeWaypoint:async(options:unknown)=>{
      legs.push(options);const current=++leg===1?'outbound':'inbound';order.push(current);
      if(failure===current)throw new Error(`${current} failed`);
      world.dataset.materializedChunks=current==='outbound'?'0':'1';
      return{reached:true,x:current==='outbound'?35.2:36.2};
    },
    releaseLateWildlife:async()=>{order.push('release');if(failure==='release')throw new Error('release failed');},
    nativeInputProbe:{
      start:()=>{order.push('start');if(failure==='start')throw new Error('start failed');},
      finish:async()=>{order.push('record');if(failure==='record')throw new Error('record failed');}
    }
  };
  const run=vm.runInNewContext(transition,{window:root,document:{querySelector:()=>world},performance:{now:()=>100},CustomEvent,
    addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),setTimeout,clearTimeout});
  return{order,legs,run:()=>run({wildlifeId:'rabbit_rng'})};
}

test('late wildlife reply is released after both native legs and before its single trace record',async()=>{
  const f=fixture(),result=await f.run();
  assert.deepEqual(f.order,['start','outbound','inbound','release','record']);
  assert.equal(f.legs.length,2);
  for(const options of f.legs)assert.deepEqual(JSON.parse(JSON.stringify(options)),{
    target:{x:options===f.legs[0]?35.2:36.2,z:1.2},timeoutMs:8000,tolerance:.2,maxInputSeconds:2,probeScope:'shared'
  });
  assert.equal(result.unloaded,0);assert.equal(result.materialized,1);assert.equal(result.visible,true);
});

for(const failure of ['start','outbound','inbound','release','record'] as const)test(`late wildlife ${failure} failure still awaits its single trace record`,async()=>{
  const f=fixture(failure);
  await assert.rejects(f.run(),new RegExp(`${failure} failed`));
  assert.equal(f.order.filter(step=>step==='start').length,1);
  assert.equal(f.order.filter(step=>step==='record').length,1);
  assert.equal(f.order.at(-1),'record');
  assert.equal(f.order.includes('release'),failure==='release'||failure==='record');
});

for(const shared of [false,true])test(`${shared?'shared':'standalone'} waypoint preserves probe lifecycle ownership`,async()=>{
  const canvas={},world={dataset:{playerX:'0',playerZ:'0',playerInputSeconds:'0',characterSoles:'[]',treePresentation:'[]',simulationClock:'{"pendingSeconds":0,"pendingInputChanges":0}'}};
  let starts=0,finishes=0;
  const probe={start:()=>{starts++;},pulse:async()=>{throw new Error('arrival must not issue input');},finish:async()=>{finishes++;}};
  const run=vm.runInNewContext(waypoint,{window:{nativeInputProbe:probe},document:{pointerLockElement:canvas,querySelector:(selector:string)=>selector==='#game canvas'?canvas:world},performance:{now:()=>0}});
  const result=await run({target:{x:0,z:0},timeoutMs:8000,tolerance:.2,maxInputSeconds:2,...(shared?{probeScope:'shared'}:{})});
  assert.equal(result.reached,true);assert.equal(starts,shared?0:1);assert.equal(finishes,shared?0:1);
});

test('shared waypoint cannot fall back to synthetic input without its native probe',async()=>{
  const canvas={};
  const run=vm.runInNewContext(waypoint,{window:{},document:{pointerLockElement:canvas,querySelector:()=>canvas}});
  await assert.rejects(run({target:{x:0,z:0},timeoutMs:8000,tolerance:.2,maxInputSeconds:2,probeScope:'shared'}),/requires the native input probe/);
});
