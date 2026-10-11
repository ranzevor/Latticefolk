import assert from 'node:assert/strict';
import test from 'node:test';
import {SimulationClock,SIMULATION_MAX_ADVANCE_MS,SIMULATION_MAX_INPUT_CHANGES,type PlayerMovementInput} from '../src/world/simulationClock.js';

const east:PlayerMovementInput={forward:0,right:1,sprint:false,directionX:0,directionZ:-1};
const near=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);
function fixture(){
  const clock=new SimulationClock(),steps:Array<{seconds:number;input:PlayerMovementInput|undefined}>=[];
  const frame=(at:number)=>clock.advance(at,(seconds,input)=>steps.push({seconds,input}));
  return{clock,steps,frame};
}

test('ten one-second foreground frames retain ten seconds in bounded substeps',()=>{
  const f=fixture();f.frame(0);f.clock.record(0,east);
  for(let i=1;i<=10;i++)f.frame(i*1000);
  near(f.steps.reduce((sum,s)=>sum+s.seconds,0),10);
  assert.equal(f.steps.length,200);assert.ok(f.steps.every(s=>s.seconds>0&&s.seconds<=.05));
});

test('a complete between-frame press retains only its real held interval',()=>{
  const f=fixture();f.frame(0);f.clock.record(100,east);f.clock.record(900,undefined);f.frame(1000);
  near(f.steps.filter(s=>s.input).reduce((sum,s)=>sum+s.seconds,0),.8);
  near(f.steps.reduce((sum,s)=>sum+s.seconds,0),1);
  f.steps.length=0;f.frame(2000);assert.ok(f.steps.every(s=>s.input===undefined));
});

test('Shift, opposite keys and heading snapshots stay in event order',()=>{
  const f=fixture();f.frame(0);f.clock.record(0,east);f.clock.record(123,{...east,sprint:true});
  f.clock.record(321,undefined);f.clock.record(555,{...east,directionX:1,directionZ:0});f.frame(1000);
  near(f.steps.filter(s=>s.input&&!s.input.sprint&&s.input.directionX===0).reduce((n,s)=>n+s.seconds,0),.123);
  near(f.steps.filter(s=>s.input?.sprint).reduce((n,s)=>n+s.seconds,0),.198);
  near(f.steps.filter(s=>s.input?.directionX===1).reduce((n,s)=>n+s.seconds,0),.445);
});

test('a step ending on a key edge applies the new state only to the following interval',()=>{
  const f=fixture();f.frame(0);f.clock.record(50,east);f.frame(50);
  assert.equal(f.steps[0].input,undefined);f.steps.length=0;f.frame(100);near(f.steps[0].seconds,.05);assert.deepEqual(f.steps[0].input,east);
});

test('same-time transitions coalesce and copied snapshots cannot be mutated by callers',()=>{
  const f=fixture(),input={...east};f.frame(0);f.clock.record(0,input);input.right=-1;
  f.frame(10);assert.equal(f.steps[0].input?.right,1);
  f.clock.record(10,east);f.clock.record(10,undefined);f.steps.length=0;f.frame(100);assert.ok(f.steps.every(s=>s.input===undefined));
});

test('input cancellation drops pending motion without dropping foreground world time',()=>{
  const f=fixture();f.frame(0);f.clock.record(100,east);f.clock.clearInput();f.frame(1000);
  near(f.steps.reduce((sum,s)=>sum+s.seconds,0),1);assert.ok(f.steps.every(s=>s.input===undefined));
});

test('explicit suspension clears elapsed time and held input before resume',()=>{
  const f=fixture();f.frame(0);f.clock.record(100,east);f.clock.reset();f.frame(100_000);
  assert.equal(f.steps.length,0);f.clock.record(100_100,east);f.frame(100_200);
  near(f.steps.filter(s=>s.input).reduce((sum,s)=>sum+s.seconds,0),.1);
});

test('the two-second work budget retains a longer foreground gap for bounded later drain',()=>{
  const f=fixture();f.frame(0);f.clock.record(0,east);assert.equal(f.frame(SIMULATION_MAX_ADVANCE_MS),true);
  assert.equal(f.steps.length,40);f.steps.length=0;assert.equal(f.frame(7000),true);
  near(f.steps.reduce((sum,s)=>sum+s.seconds,0),2);near(f.clock.diagnostics.pendingSeconds,3);
  f.clock.record(7000,undefined);f.frame(7050);near(f.clock.diagnostics.pendingSeconds,1.05);f.frame(7100);
  near(f.clock.diagnostics.pendingSeconds,0);near(f.steps.filter(s=>s.input).reduce((sum,s)=>sum+s.seconds,0),5);
  near(f.steps.reduce((sum,s)=>sum+s.seconds,0),5.1);
});

test('an input edge after a long foreground gap retains both the hold and release times',()=>{
  const f=fixture();f.frame(0);f.clock.record(100,east);assert.equal(f.clock.record(4900,undefined),true);
  f.frame(5000);f.frame(5050);f.frame(5100);
  near(f.steps.filter(s=>s.input).reduce((sum,s)=>sum+s.seconds,0),4.8);
  near(f.steps.reduce((sum,s)=>sum+s.seconds,0),5.1);
});

test('input arriving while behind does not apply to older simulation debt',()=>{
  const f=fixture();f.frame(0);f.frame(5000);f.clock.record(5050,east);f.clock.record(5150,undefined);
  f.frame(5200);assert.ok(f.steps.every(s=>s.input===undefined));f.frame(5250);
  near(f.steps.filter(s=>s.input).reduce((sum,s)=>sum+s.seconds,0),.1);
});

for(const at of [NaN,Infinity,-1])test(`invalid time ${at} resets rather than integrating`,()=>{
  const f=fixture();f.frame(0);f.clock.record(0,east);assert.equal(f.frame(at),false);assert.equal(f.steps.length,0);
  f.frame(100);f.frame(150);assert.equal(f.steps[0].input,undefined);
});

test('backward frame or input timestamps fail closed',()=>{
  const f=fixture();f.frame(100);assert.equal(f.clock.record(99,east),false);
  f.frame(100);f.clock.record(120,east);assert.equal(f.frame(119),false);assert.equal(f.steps.length,0);
});

test('queue overflow preserves accepted input/time debt and inserts a bounded release boundary',()=>{
  const f=fixture();f.frame(0);
  for(let i=0;i<SIMULATION_MAX_INPUT_CHANGES-1;i++)assert.equal(f.clock.record(i,{...east,directionX:i}),true);
  assert.equal(f.clock.record(255,{...east,sprint:true}),false);
  assert.equal(f.clock.record(255,east),false,'same-time input cannot replace the reserved release');
  assert.equal(f.clock.record(256,east),false);assert.equal(f.clock.diagnostics.inputOverflowCount,3);
  assert.equal(f.clock.diagnostics.resetReason,'input-overflow');
  f.frame(5000);
  assert.ok(f.steps.length<=40+SIMULATION_MAX_INPUT_CHANGES);
  near(f.steps.filter(s=>s.input).reduce((n,s)=>n+s.seconds,0),.255);
  near(f.steps.reduce((n,s)=>n+s.seconds,0),2);near(f.clock.diagnostics.pendingSeconds,3);
  assert.equal(f.clock.diagnostics.inputOverflowCount,3,'overflow remains visible after the frame');
  f.frame(5050);f.frame(5100);near(f.steps.reduce((n,s)=>n+s.seconds,0),5.1);
  near(f.steps.filter(s=>s.input).reduce((n,s)=>n+s.seconds,0),.255);
  assert.equal(f.clock.record(5150,east),true);f.frame(5250);
  near(f.steps.filter(s=>s.input).reduce((n,s)=>n+s.seconds,0),.355);
});
