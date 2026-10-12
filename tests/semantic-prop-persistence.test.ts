import {WildlifeVisualRuntime} from '../src/scene/wildlifeVisualRuntime.js';
import {resolveWildlifeAsset} from '../src/scene/wildlifeAssetResolver.js';
import {prepareVisualPrograms,prepareVisualShadows} from '../src/scene/visualPrograms.js';
import * as worldRandom from '../src/world/worldRandom.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';
import * as crops from '../src/scene/farmCrops.js';
import {prepareWellGeometry} from '../src/scene/wellPresentation.js';
import {StreamedPresentation} from '../src/scene/streamedPresentation.js';
import {StreamedLayoutRegistry,StreamedLayoutValidationError,readStreamedLayout,assertStreamedLayoutStates} from '../src/world/streamedLayouts.js';
import * as portable from '../src/world/portableObjects.js';
import * as movable from '../src/world/movablePhysics.js';
import {PortableObjectRuntime} from '../src/world/portableObjectRuntime.js';
import {FinePhysicsAuthority} from '../src/world/finePhysics.js';
import {registerHomeTerrain} from '../src/world/fineTerrain.js';
import {restoreBuildingForLayout} from '../src/world/buildingRestore.js';
import {WorldPersistence} from '../server/worldPersistence.js';
import type {WorldPersistenceSnapshot} from '../src/types.js';

// Exercise startup, persistence, interactions, physics and the visual lifecycle.
// The renderer, unrelated town population/buildings and asset transport are omitted.
const source=fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const wanted=new Set(['initializeWorld','clearMovablePersistenceQueue','initializePersistence','setupWorld','decorationState','spawnAssetDecoration','attachVisualTarget','applyVisualTarget','normalizeModel','restoreWorldState','buildWorldSnapshot','buildFinalWorldSnapshot','executePlayerInteraction','registerWorldObjectPhysics','updateObjects','loadVisualAssets']);
const methods:string[]=[];
for(const n of ast.statements)if(ts.isClassDeclaration(n)&&n.name?.text==='TownGame')for(const m of n.members)if(ts.isMethodDeclaration(m)&&wanted.has(m.name.getText(ast)))methods.push(m.getText(ast));
assert.equal(methods.length,wanted.size);
const code=ts.transpileModule(`return class Runtime {${methods.join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const ids={crate:'prop_crate_rts_23_-3',axe:'prop_axe_-20_8_6_5',shovel:'prop_shovel_-22_8_-10_7',bush:'prop_bush_-16_1'};
const normalized=(value:any)=>JSON.parse(JSON.stringify(value));
function model(){
  const group=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(1,2,3),new THREE.MeshBasicMaterial());
  mesh.position.set(2,1,-3);group.add(mesh);return group;
}
function fixture(snapshot:WorldPersistenceSnapshot|null=null){
  const io={snapshot,epoch:Date.now(),gets:0,setups:0,restores:0,loads:0,failed:false,gate:undefined as Promise<void>|undefined};
  class CoarseWorldRuntime {constructor(_scene?:unknown,readonly seed='latticefolk-default'){}chunks=new Map();setPresentationBridge(){}restoreKnownChunks(){}ensureWindowAround(){}chunkAtWorld(){return undefined;}}
  const load=async()=>{io.loads++;if(io.gate)await io.gate;if(io.failed)throw Error('asset unavailable');return{scene:model(),animations:[]};};
  const deps={prepareVisualPrograms,prepareVisualShadows,...worldRandom,StreamedLayoutRegistry,...portable,...movable,...crops,THREE,prepareWellGeometry,StreamedLayoutValidationError,readStreamedLayout,assertStreamedLayoutStates,CoarseWorldRuntime,registerHomeTerrain,restoreBuildingForLayout,WORLD_SIZE:72,WATER_PATCH_ASSET:'water',BAKING_OVEN_ASSET:'oven',
    now:()=>1000,Date:{now:()=>io.epoch},i18n:{t:(key:string)=>key},fetch:async()=>{io.gets++;return{ok:true,json:async()=>({snapshot:io.snapshot,revision:4})};}};
  const Runtime=new Function(...Object.keys(deps),code)(...Object.values(deps)),r=new Runtime();
  Object.assign(r,{randomness:worldRandom.readWorldRandomness(undefined),day:1,minuteOfDay:495,weather:'clear',weatherEpoch:1,
    playerInventory:{apple:0,bread:0,wood:2,coin:10,flower:0,grain:0,flour:0,water:0,stone:0,plank:0,tool:0},playerPosition:{x:23,z:-2},cameraMode:'firstPerson',camera:{position:new THREE.Vector3()},scene:new THREE.Scene(),
    renderer:{shadowMap:{enabled:false},compileAsync:async(scene:THREE.Object3D)=>scene},assets:new Map(),assetRoot:'/assets/quaternius',gltfLoader:{loadAsync:load},fbxLoader:{loadAsync:async()=>{const asset=await load();return Object.assign(asset.scene,{animations:[]});}},assetLoadFailures:[],assetsReady:false,
    objects:new Map(),npcs:new Map(),wildlife:new Map(),materializedChunks:new Map(),fineChunkCache:new Map(),wildlifeLineage:new Map(),wildlifeTransfers:new Map(),lineageEpoch:0,visualTargets:[],physics:new FinePhysicsAuthority(),
    movableDirty:false,scheduleMovablePersistence(){},groundHeightAt:()=>0,reconcileLineageOffspring(){},updateFineChunkMaterialization(){},worldSeason:()=> 'spring',
    addBuilding(){},addObject(){},addAssetObject(){},addTreeDecoration(){},setupNpcs(){io.setups++;},log(){},toast(){},event(){},itemName:(kind:string)=>kind,parcelLabel:(kind:string,count:number)=>`${kind} ${count}`});
  r.wildlifeVisualRuntime=new WildlifeVisualRuntime({load:async()=>({scene:Object.assign(model(),{name:'raccoon-template'}),animations:Object.values(resolveWildlifeAsset('raccoon').definition!.clips).map(name=>new THREE.AnimationClip(name,1,[]))})},async scene=>{await prepareVisualPrograms(r.renderer,r.camera,r.scene,[scene]);prepareVisualShadows(r.renderer,r.camera,r.scene,[scene]);});
  r.streamedPresentation=new StreamedPresentation({objects:r.objects,create(){throw Error('No streamed layout in decoration fixture');},release(){}});
  r.playerOverlapsObjectTrigger=(id:string)=>r.physics.overlappingTriggers(r.objects.get(id).state.position).some((t:any)=>t.id===`object-trigger:${id}`);
  r.portables=new PortableObjectRuntime(r);
  const restore=r.restoreWorldState.bind(r);r.restoreWorldState=(saved:WorldPersistenceSnapshot)=>{io.restores++;restore(saved);};
  return{r,io};
}

test('all twelve semantic decorations exist with physics before asset loading or save restoration',async()=>{
  const f=fixture();await f.r.initializePersistence();
  assert.equal(f.io.gets,1);assert.equal(f.io.setups,1);assert.equal(f.io.loads,0);assert.equal(f.r.persistenceReady,true);
  assert.equal(f.r.objects.size,12);assert.equal(f.r.visualTargets.length,12);assert.equal(f.r.physics.stats().triggers,12);
  for(const object of f.r.objects.values()){assert.equal(object.mesh.children.length,0);assert.ok(f.r.playerOverlapsObjectTrigger(object.state.id));}
  assert.equal(f.r.physics.isBlocked(23,-3),true);assert.equal(f.r.physics.isBlocked(31,8),true);
  const before=f.r.objects.get(ids.crate);f.r.spawnAssetDecoration('crate_rts',23,-3,1.1,.3);
  f.r.setupWorld();
  assert.equal(f.r.objects.get(ids.crate),before);assert.equal(f.r.objects.size,12);assert.equal(f.r.visualTargets.length,12);
  assert.equal(f.r.physics.stats().triggers,12);
});

for(const storageId of [ids.crate,'prop_barrel_10_-8_8','prop_barrel_11_-8_5'])for(const checkpoint of ['buildWorldSnapshot','buildFinalWorldSnapshot'])test(`${checkpoint} ${storageId}: stored contents and depleted resources survive SQLite reload and late visuals`,async()=>{
  const live=fixture();await live.r.initializePersistence();await live.r.loadVisualAssets();
  live.r.executePlayerInteraction(live.r.objects.get(storageId),'store');live.r.executePlayerInteraction(live.r.objects.get(ids.bush),'forage');
  const snapshot=normalized(live.r[checkpoint]()),store=new WorldPersistence(':memory:');
  try{
    store.save(snapshot,0);const loaded=store.load()!;assert.equal(loaded.meta.playerInventory.wood,1);
    const restored=fixture(loaded);let release!:()=>void;restored.io.gate=new Promise<void>(resolve=>{release=resolve;});
    const loading=restored.r.loadVisualAssets();await restored.r.initializePersistence();
    const crate=restored.r.objects.get(storageId),bush=restored.r.objects.get(ids.bush);
    assert.deepEqual(crate.state.storage,[{kind:'wood',count:1}]);assert.equal(bush.state.resourceAmount,2);assert.equal(crate.mesh.children.length,0);
    assert.equal(restored.r.persistenceReady,true);assert.equal(crate.mesh.children.length,0);
    restored.r.executePlayerInteraction(crate,'store');restored.r.executePlayerInteraction(crate,'store');const stateBefore=structuredClone(crate.state);
    const npc={state:{money:37},task:{action:'work'}};restored.r.npcs.set('sentinel',npc);
    release();await loading;
    assert.equal(restored.io.restores,1);assert.equal(restored.io.setups,1);assert.equal(restored.io.gets,1);
    assert.equal(restored.r.objects.get(storageId),crate);assert.deepEqual(crate.state,stateBefore);assert.equal(bush.state.resourceAmount,2);assert.equal(crate.mesh.children.length,1);
    assert.equal(restored.r.npcs.get('sentinel'),npc);assert.equal(npc.state.money,37);assert.equal(npc.task.action,'work');
    assert.equal(restored.r.playerInventory.wood,0);assert.equal(crate.state.storage[0].count,2);
    restored.r.executePlayerInteraction(crate,'take');assert.equal(restored.r.playerInventory.wood,1);
    restored.r.executePlayerInteraction(crate,'take');assert.equal(restored.r.playerInventory.wood,2);assert.equal(crate.state.storage[0].count,0);
    restored.r.executePlayerInteraction(crate,'take');assert.equal(restored.r.playerInventory.wood,2);
  }finally{store.close();}
});

for(const id of [ids.axe,ids.shovel])test(`${id}: loading a consumed tool never permits pickup before its original respawn`,async()=>{
  const live=fixture();await live.r.initializePersistence();await live.r.loadVisualAssets();
  live.r.executePlayerInteraction(live.r.objects.get(id),'pickup');const saved=normalized(live.r.buildWorldSnapshot());
  const tool=saved.homeObjects.find((x:any)=>x.id===id);assert.equal(saved.meta.playerInventory.tool,1);assert.equal(tool.pickupable,false);assert.ok(tool.respawnAt>Date.now());
  const restored=fixture(saved);await restored.r.initializePersistence();const object=restored.r.objects.get(id);
  assert.equal(object.mesh.visible,false);
  if(id===ids.axe){restored.io.failed=true;await restored.r.loadVisualAssets();assert.equal(object.mesh.visible,false);assert.equal(object.state.pickupable,false);restored.io.failed=false;}
  let release!:()=>void;restored.io.gate=new Promise<void>(resolve=>{release=resolve;});const loading=restored.r.loadVisualAssets();
  restored.r.executePlayerInteraction(object,'pickup');assert.equal(restored.r.playerInventory.tool,1);assert.equal(object.mesh.children.length,0);
  release();await loading;assert.equal(object.mesh.visible,false);assert.equal(object.state.respawnAt,tool.respawnAt);
  restored.r.executePlayerInteraction(object,'pickup');assert.equal(restored.r.playerInventory.tool,1);
  restored.io.epoch=tool.respawnAt-1;restored.r.updateObjects(0);restored.r.executePlayerInteraction(object,'pickup');assert.equal(restored.r.playerInventory.tool,1);assert.equal(object.mesh.visible,false);
  restored.io.epoch=tool.respawnAt;restored.r.updateObjects(0);assert.equal(object.mesh.visible,true);assert.equal(object.state.pickupable,true);
  restored.r.executePlayerInteraction(object,'pickup');assert.equal(restored.r.playerInventory.tool,2);assert.equal(object.mesh.visible,false);
});

test('failed and repeated asset loading never replaces restored semantic state or adds duplicate targets',async()=>{
  const live=fixture();await live.r.initializePersistence();live.r.objects.get(ids.crate).state.storage=[{kind:'wood',count:3}];
  const f=fixture(normalized(live.r.buildWorldSnapshot()));f.io.failed=true;await f.r.initializePersistence();const object=f.r.objects.get(ids.crate),state=object.state;
  await f.r.loadVisualAssets();assert.equal(f.r.assetsReady,false);assert.ok(f.r.assetLoadFailures.includes('crate_rts'));assert.equal(object.mesh.children.length,0);
  assert.equal(f.r.objects.get(ids.crate).state,state);assert.equal(state.storage[0].count,3);assert.equal(f.r.physics.isBlocked(23,-3),true);
  f.io.failed=false;await f.r.loadVisualAssets();await f.r.loadVisualAssets();
  assert.equal(f.r.objects.size,12);assert.equal(f.r.visualTargets.length,12);assert.equal(object.mesh.children.length,1);assert.equal(object.state,state);assert.equal(state.storage[0].count,3);assert.equal(f.io.restores,1);
});

test('assets resolving before the initial GET still receive exactly one saved-state restoration',async()=>{
  const live=fixture();await live.r.initializePersistence();live.r.objects.get(ids.crate).state.storage=[{kind:'wood',count:3}];
  const saved=normalized(live.r.buildWorldSnapshot()),f=fixture(saved);
  await f.r.loadVisualAssets();assert.equal(f.r.objects.size,0);assert.equal(f.r.assetsReady,true);
  await f.r.initializePersistence();const object=f.r.objects.get(ids.crate);assert.equal(object.mesh.children.length,1);assert.deepEqual(object.state.storage,[{kind:'wood',count:3}]);
  assert.equal(f.io.restores,1);assert.equal(f.io.setups,1);await f.r.loadVisualAssets();assert.equal(object.state.storage[0].count,3);
});

test('semantic-first groups retain the previous authored model placement and scale',()=>{
  const f=fixture(),template=model();f.r.initializeWorld();f.r.assets.set('crate_rts',{scene:template,animations:[]});
  const previous=template.clone(true);f.r.normalizeModel(previous,1.1);previous.rotation.y=.3;previous.position.x=23;previous.position.z=-3;
  f.r.spawnAssetDecoration('crate_rts',23,-3,1.1,.3);f.r.applyVisualTarget(f.r.visualTargets.find((t:any)=>t.asset==='crate_rts'));const group=f.r.objects.get(ids.crate).mesh;
  previous.updateMatrixWorld(true);group.updateMatrixWorld(true);
  const before=new THREE.Box3().setFromObject(previous),after=new THREE.Box3().setFromObject(group);
  assert.deepEqual(after.min.toArray(),before.min.toArray());assert.deepEqual(after.max.toArray(),before.max.toArray());
});

test('visual targets are attached only after shader preparation finishes',async()=>{
  const f=fixture();await f.r.initializePersistence();
  let release!:()=>void,entered!:()=>void;
  const compiling=new Promise<void>(resolve=>{entered=resolve;});
  const gate=new Promise<void>(resolve=>{release=resolve;});
  f.r.renderer.compileAsync=async(scene:THREE.Object3D)=>{entered();await gate;return scene;};
  const loading=f.r.loadVisualAssets();await compiling;
  assert.equal(f.r.assetsReady,false);
  assert.equal(f.r.assets.size,0,'unprepared templates were exposed to new visual targets');
  for(const object of f.r.objects.values())assert.equal(object.mesh.children.length,0);
  release();await loading;assert.equal(f.r.assetsReady,true);
  for(const object of f.r.objects.values())assert.ok(object.mesh.children.length>0);
});

test('shader preparation failures remain asset failures and expose no unprepared template',async()=>{
  const f=fixture();await f.r.initializePersistence();
  f.r.renderer.compileAsync=async()=>{throw new Error('shader preparation failed');};
  await f.r.loadVisualAssets();
  assert.equal(f.r.assetsReady,false);assert.equal(f.r.assets.size,0);
  assert.ok(f.r.assetLoadFailures.includes('crate_rts'));
  for(const object of f.r.objects.values())assert.equal(object.mesh.children.length,0);
});

for(const fail of [false,true])test(`asset publication follows real shadow staging ${fail?'failure':'success'}`,async()=>{
 const f=fixture();await f.r.initializePersistence();const sun=new THREE.DirectionalLight();sun.castShadow=true;f.r.scene.add(sun);let rendered=0,wildlifeRendered=0;
 Object.assign(f.r.renderer,{shadowMap:{enabled:true,needsUpdate:false},getRenderTarget:()=>null,getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,
  getViewport:(v:THREE.Vector4)=>v.set(0,0,800,600),getScissor:(v:THREE.Vector4)=>v.set(0,0,800,600),getScissorTest:()=>false,
  setRenderTarget(){},setViewport(){},setScissor(){},setScissorTest(){},render(staging:THREE.Scene){
   assert.equal(f.r.assets.size,fail?0:rendered);assert.equal(f.r.assetsReady,false);assert.notEqual(staging,f.r.scene);if(staging.getObjectByName('raccoon-template'))wildlifeRendered++;else rendered++;
   if(fail)throw new Error('shadow preparation failed');
  }});
 await f.r.loadVisualAssets();assert.ok(rendered>0);assert.equal(f.r.assetsReady,!fail);assert.equal(f.r.assets.size,fail?0:rendered);assert.equal(wildlifeRendered,1);assert.equal(f.r.assetLoadFailures.length,fail?rendered+wildlifeRendered:0);
});


test('world readiness includes the shared wildlife preparation gate and permits failed preparation retry',async()=>{
 const f=fixture();let release!:()=>void,entered!:()=>void,fail=false;
 const gate=new Promise<void>(resolve=>{release=resolve;});const started=new Promise<void>(resolve=>{entered=resolve;});
 f.r.renderer.compileAsync=async(scene:THREE.Object3D)=>{if(scene.getObjectByName('raccoon-template')){entered();await gate;if(fail)throw Error('wildlife shader unavailable');}return scene;};
 const first=f.r.loadVisualAssets();await started;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.r.assets.size,35);assert.equal(f.r.assetsReady,false);assert.equal(f.r.wildlifeVisualRuntime.getState('raccoon').status,'loading');
 fail=true;release();await first;assert.equal(f.r.assetsReady,false);assert.deepEqual(f.r.assetLoadFailures,['raccoon']);
 fail=false;await f.r.loadVisualAssets();assert.equal(f.r.assetsReady,true);assert.deepEqual(f.r.assetLoadFailures,[]);assert.equal(f.r.wildlifeVisualRuntime.getState('raccoon').status,'ready');
});
