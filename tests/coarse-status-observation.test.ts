import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {isDeepStrictEqual} from 'node:util';
import {CoarseWorldRuntime} from '../src/world/coarseWorld.js';
const make=()=>{
 const world=new CoarseWorldRuntime(new THREE.Scene(),'status-observation');
 Object.assign(world,{pending:true,regionPending:true,worldPending:true});
 return world;
};
const snapshot=(world:CoarseWorldRuntime)=>structuredClone([...world.chunks.values()]);
for(const restored of [false,true])test(`status leaves ${restored?'restored':'seeded'} ecology unchanged`,()=>{
 const world=make();if(restored)world.restoreKnownChunks(snapshot(world));
 const before=snapshot(world),status=world.status();
 assert.ok(isDeepStrictEqual(snapshot(world),before),'status changed stored ecology');
 const wildlife=before.reduce((sum,c)=>sum+c.wildlife!.reduce((n,p)=>n+p.count,0),0);
 const plants=before.reduce((sum,c)=>sum+c.plants!.grass+c.plants!.shrub+c.plants!.fruit+c.plants!.crop,0)/before.length;
 assert.equal(status.wildlifePopulation,wildlife);
 assert.ok(Math.abs(status.plantBiomass-plants)<1e-10);
 for(let i=0;i<10;i++)assert.deepEqual(world.status(),status);
 assert.ok(isDeepStrictEqual(snapshot(world),before),'status changed stored ecology');
});
test('presentation sampling frequency cannot change coarse simulation results',()=>{
 const sparse=make(),frequent=make();
 for(let i=0;i<8;i++){
  const context={day:3,gameTime:'10:30',weather:'clear',dt:1};
  for(let j=0;j<8;j++)frequent.status();
  sparse.update(context);frequent.update(context);
  assert.ok(isDeepStrictEqual(snapshot(frequent),snapshot(sparse)),'sampling frequency changed stored ecology');
 }
 assert.deepEqual(frequent.flowHistory(120),sparse.flowHistory(120));
});
test('status can observe deeply frozen persisted ecology',()=>{
 const world=make();
 const freeze=(value:unknown):void=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}};
 for(const chunk of world.chunks.values())freeze(chunk);
 assert.ok(Number.isFinite(world.status().wildlifePopulation));
});
