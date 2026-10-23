import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {CoarseWorldRuntime} from '../src/world/coarseWorld.js';

test('restored coarse windows release each owned tile resource once across repeated streaming',()=>{
 const scene=new THREE.Scene(),world=new CoarseWorldRuntime(scene);
 world.ensureWindowAround(240,0);world.ensureWindowAround(0,0);
 world.restoreKnownChunks([...world.chunks.values()].map(state=>structuredClone(state)));
 const states=[...world.chunks.values()].map(state=>structuredClone(state)),home=[...world.activeChunkIds].sort();
 const owned=new Map<THREE.BufferGeometry|THREE.Material,number>();
 const visit=(fn:(resource:THREE.BufferGeometry|THREE.Material)=>void)=>scene.traverse(node=>{
  const mesh=node as THREE.Mesh;if(!mesh.isMesh)return;
  for(const resource of [mesh.geometry,...(Array.isArray(mesh.material)?mesh.material:[mesh.material])])fn(resource);
 });
 const watch=()=>visit(resource=>{if(owned.has(resource))return;owned.set(resource,0);resource.addEventListener('dispose',()=>owned.set(resource,owned.get(resource)!+1));});
 watch();
 for(let cycle=0;cycle<8;cycle++){
  world.restoreKnownChunks(states);world.ensureWindowAround(240,0);watch();world.ensureWindowAround(0,0);watch();
  assert.deepEqual([...world.activeChunkIds].sort(),home);assert.deepEqual([...world.chunks.values()],states);
 }
 const live=new Set<THREE.BufferGeometry|THREE.Material>();visit(resource=>live.add(resource));
 assert.equal(live.size,home.length*2);assert.ok(owned.size>live.size);
 for(const [resource,count]of owned)assert.equal(count,live.has(resource)?0:1);
 assert.equal(world.materialized.size,0);
});
