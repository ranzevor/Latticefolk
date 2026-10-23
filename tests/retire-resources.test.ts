import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {retireResources,retireAsyncResources} from '../src/scene/retireResources.js';
import {disposeOwnedSkeletons} from '../src/scene/ownedSkeletons.js';
import {disposeFarmCropRows} from '../src/scene/farmCrops.js';

test('synchronous retirement continues in order and preserves nested errors and thrown values',()=>{
  const order:string[]=[];
  const first={kind:'first'};
  const nested=new AggregateError([new Error('inner')],'nested');
  const raw='raw failure';
  let caught:unknown;
  try{
    retireResources([
      ()=>{order.push('first');throw first;},
      ()=>{order.push('second');throw nested;},
      ()=>{order.push('third');throw raw;},
      ()=>{order.push('last');}
    ]);
  }catch(error){caught=error;}
  assert.deepEqual(order,['first','second','third','last']);
  assert.ok(caught instanceof AggregateError);
  assert.deepEqual(caught.errors,[first,nested,raw]);
  assert.equal(caught.errors[1],nested,'nested AggregateError is retained rather than flattened');
});

test('skeletons deduplicate by identity within a traversal and continue after a failure',()=>{
  const calls:string[]=[];
  const failure={skeleton:'S'};
  const skeletonS={dispose(){calls.push('S');throw failure;}};
  const skeletonT={dispose(){calls.push('T');}};
  const nodes=[
    {isSkinnedMesh:true,skeleton:skeletonS},
    {isSkinnedMesh:true,skeleton:skeletonS},
    {isSkinnedMesh:true,skeleton:skeletonT},
    {isSkinnedMesh:false,skeleton:{dispose(){calls.push('ordinary');}}}
  ];
  const root={traverse(callback:(node:unknown)=>void){for(const node of nodes)callback(node);}} as unknown as THREE.Object3D;
  let caught:unknown;
  try{disposeOwnedSkeletons(root);}catch(error){caught=error;}
  assert.ok(caught instanceof AggregateError);
  assert.deepEqual(caught.errors,[failure]);
  assert.deepEqual(calls,['S','T'],'shared S is attempted once in this traversal and T still runs');

  try{disposeOwnedSkeletons(root);}catch{}
  assert.deepEqual(calls,['S','T','S','T'],'a later explicit call retries; no cross-call/global deduplication');
});

test('farm crop retirement is terminal on failure, reentrancy-safe and leaves shared resources alone',()=>{
  const root=new THREE.Group();
  const geometry=new THREE.BufferGeometry();
  const texture=new THREE.Texture();
  const material=new THREE.MeshBasicMaterial({map:texture});
  const first=new THREE.InstancedMesh(geometry,material,1);
  const second=new THREE.InstancedMesh(geometry,material,1);
  const unmarked=new THREE.InstancedMesh(geometry,material,1);
  const ordinary=new THREE.Mesh(geometry,material);
  first.userData.farmCropRows=true;
  second.userData.farmCropRows=true;
  root.add(first,second,unmarked,ordinary);

  const otherPlot=new THREE.Group();
  const other=new THREE.InstancedMesh(geometry,material,1);
  other.userData.farmCropRows=true;otherPlot.add(other);
  const order:string[]=[];
  const failureA={dispose:'first'};
  const failureB={dispose:'second'};
  let reentered=false;
  first.dispose=()=>{order.push('first');if(!reentered){reentered=true;disposeFarmCropRows(root);}throw failureA;};
  second.dispose=()=>{order.push('second');throw failureB;};
  let unmarkedDisposals=0,ordinaryDisposals=0,otherDisposals=0;
  unmarked.dispose=()=>{unmarkedDisposals++;return unmarked;};
  Object.assign(ordinary,{dispose:()=>{ordinaryDisposals++;}});
  other.dispose=()=>{otherDisposals++;return other;};
  let geometryDisposals=0,materialDisposals=0,textureDisposals=0;
  geometry.addEventListener('dispose',()=>geometryDisposals++);
  material.addEventListener('dispose',()=>materialDisposals++);
  texture.addEventListener('dispose',()=>textureDisposals++);

  let caught:unknown;
  try{disposeFarmCropRows(root);}catch(error){caught=error;}
  assert.ok(caught instanceof AggregateError);
  assert.deepEqual(caught.errors,[failureA,failureB]);
  assert.deepEqual(order,['first','second'],'all rows were marked before disposal, so reentry does not retry either row');

  try{disposeFarmCropRows(root);}catch{}
  assert.deepEqual(order,['first','second'],'failed rows are terminal and a second call does not retry');
  assert.equal(unmarkedDisposals,0);
  assert.equal(ordinaryDisposals,0);
  assert.equal(otherDisposals,0);
  assert.deepEqual([geometryDisposals,materialDisposals,textureDisposals],[0,0,0]);
  assert.equal(first.geometry,geometry);assert.equal(second.material,material);assert.equal(other.geometry,geometry);
});

test('async retirement awaits sequentially and continues after synchronous throws and rejections',async()=>{
  const order:string[]=[];
  const failureSync={kind:'sync'};
  const failureReject={kind:'reject'};
  let releaseFirst!:()=>void;
  const result=retireAsyncResources([
    ()=>{order.push('first:start');return new Promise<void>(resolve=>{releaseFirst=()=>{order.push('first:end');resolve();};});},
    ()=>{order.push('sync-throw');throw failureSync;},
    async ()=>{order.push('reject:start');await Promise.resolve();order.push('reject:end');throw failureReject;},
    ()=>{order.push('last');}
  ]);
  await Promise.resolve();
  assert.deepEqual(order,['first:start'],'later actions must wait for the first promise');
  releaseFirst();
  let caught:unknown;
  try{await result;}catch(error){caught=error;}
  assert.ok(caught instanceof AggregateError);
  assert.deepEqual(caught.errors,[failureSync,failureReject]);
  assert.deepEqual(order,['first:start','first:end','sync-throw','reject:start','reject:end','last']);
});
