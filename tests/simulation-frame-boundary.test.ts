import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SimulationClock} from '../src/world/simulationClock.js';
const east={forward:0,right:1,sprint:false,directionX:0,directionZ:-1};
test('captured delayed native edges retain their interval behind the rendering boundary',()=>{
 const clock=new SimulationClock();let input=0,total=0;
 const step=(dt:number,active:unknown)=>{total+=dt;if(active)input+=dt;};
 clock.advanceFrame(8000,8000,step);
 clock.advanceFrame(8571.6,9017.7,step);
 clock.recordEvent(8595.5,10134.8,east);clock.recordEvent(8845.4,10135.1,undefined);
 clock.advanceFrame(9821.4,10303.7,step);
 assert.ok(Math.abs(input-.2499)<1e-9,`accepted ${input}`);
 assert.ok(Math.abs(total-1.8214)<1e-9);assert.equal(clock.diagnostics.resetReason,'none');
});
test('future queued input is retained until its frame boundary without resetting',()=>{
 const clock=new SimulationClock();let input=0;
 const step=(dt:number,active:unknown)=>{if(active)input+=dt;};
 clock.advanceFrame(0,0,step);clock.recordEvent(150,200,east);clock.recordEvent(250,300,undefined);
 assert.equal(clock.advanceFrame(100,310,step),true);assert.equal(input,0);
 assert.equal(clock.advanceFrame(400,450,step),true);assert.ok(Math.abs(input-.1)<1e-9);
});
test('startup without a RAF timestamp and suspension preserve existing timing',()=>{
 const clock=new SimulationClock();let input=0;
 const step=(dt:number,active:unknown)=>{if(active)input+=dt;};
 clock.advanceFrame(undefined,100,step);clock.recordEvent(150,150,east);clock.advanceFrame(200,230,step);
 assert.ok(Math.abs(input-.05)<1e-9);clock.reset();clock.advanceFrame(10000,10100,step);
 assert.ok(Math.abs(input-.05)<1e-9);
});
for(const [frame,handled] of [[NaN,100],[101,100],[-1,100],[100,NaN]])test(`invalid rendering boundary ${frame}/${handled} is rejected`,()=>{
 const clock=new SimulationClock();assert.equal(clock.advanceFrame(frame,handled,()=>assert.fail('no invalid steps')),false);
});
test('input recorded before the first RAF is retained without integrating before initialization',()=>{
 const clock=new SimulationClock();let input=0;const step=(dt:number,active:unknown)=>{if(active)input+=dt;};
 clock.record(100,east);assert.equal(clock.advanceFrame(90,110,step),true);assert.equal(input,0);
 clock.recordEvent(150,150,undefined);clock.advanceFrame(200,210,step);assert.ok(Math.abs(input-.05)<1e-9);
 assert.equal(clock.advanceFrame(199,220,step),false);assert.equal(clock.diagnostics.resetReason,'invalid-time');
});
