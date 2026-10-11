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

async function replay(frameMs:number,obstacle=false,prime:'none'|'catch-up'|'starved'|'at-goal'='none'){
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
    :key==='playerInputSeconds'?String(clock.inputSeconds):key==='simulationClock'?JSON.stringify(clock.clock.diagnostics):key==='wildlifeVisuals'?'[]':undefined,
    set:()=>{throw Error('diagnostics are read only');}});
  const context={...clock.context,document:{pointerLockElement:canvas,querySelector:(selector:string)=>selector==='#game canvas'?canvas:{dataset}},MouseEvent:class{}};
  const fn=vm.runInNewContext(callback,context) as (args:object)=>Promise<{position:{x:number;z:number};detours:number}>;
  try{
    if(prime!=='none')await new Promise<void>(resolve=>clock.context.requestAnimationFrame(resolve));
    const began=clock.time,initialDebt=clock.clock.diagnostics.pendingSeconds;
    if(prime!=='none'){assert.ok(initialDebt>0);assert.equal(clock.events.length,0);}
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
  }finally{clock.finish();}
}
for(const frameMs of [16,500,1000,1800])test(`parcel round trip settles both key releases at ${frameMs} ms frames`,()=>replay(frameMs));
for(const frameMs of [100,1000])test(`parcel detour restores its original lane at ${frameMs} ms frames`,()=>replay(frameMs,true));

test('parcel route drains existing foreground debt before its first key press',()=>replay(1000,false,'catch-up'));
test('parcel route cannot accept its initial goal while debt remains',()=>replay(1000,false,'at-goal'));
test('parcel route keeps initial debt and issues no input when the original deadline expires',()=>replay(2500,false,'starved'));
