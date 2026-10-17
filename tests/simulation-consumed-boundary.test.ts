import assert from 'node:assert/strict';
import test from 'node:test';
import {SimulationClock} from '../src/world/simulationClock.js';

test('consumed boundary records only completed simulation advances',()=>{
  const clock=new SimulationClock();
  const input={forward:1,right:0,sprint:false,directionX:0,directionZ:-1};
  clock.record(0,input);assert.equal(clock.consumedThroughMs,undefined);
  clock.advance(100,()=>{});assert.equal(clock.consumedThroughMs,100);
  clock.record(250,undefined);assert.equal(clock.consumedThroughMs,100);
  clock.advance(250,()=>{});assert.equal(clock.consumedThroughMs,250);
  clock.advance(3000,()=>{});assert.equal(clock.consumedThroughMs,2250);
  assert.equal(clock.diagnostics.pendingSeconds,.75);
  clock.reset();assert.equal(clock.consumedThroughMs,undefined);
  clock.advance(4000,()=>{});assert.equal(clock.consumedThroughMs,4000);
  clock.advance(3999,()=>{});assert.equal(clock.consumedThroughMs,undefined);
});
