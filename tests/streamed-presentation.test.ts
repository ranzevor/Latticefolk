import * as worldRandom from '../src/world/worldRandom.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';
import {disposeOwnedSkeletons} from '../src/scene/ownedSkeletons.js';
import * as layouts from '../src/world/streamedLayouts.js';
import * as units from '../src/world/streamedUnits.js';
import * as movable from '../src/world/movablePhysics.js';
import * as portable from '../src/world/portableObjects.js';
import * as baking from '../src/scene/bakingOven.js';
import * as water from '../src/scene/waterPatch.js';
import * as trees from '../src/scene/treePresentation.js';
import * as crops from '../src/scene/farmCrops.js';
import {playerHeadClearance,NPC_BODY_RADIUS} from '../src/world/characterContact.js';
import {StreamedPresentation} from '../src/scene/streamedPresentation.js';
import {StreamedActors} from '../src/scene/streamedActors.js';
import {CoarseWorldRuntime} from '../src/world/coarseWorld.js';
import {FinePhysicsAuthority} from '../src/world/finePhysics.js';
import {planFineChunk} from '../src/world/materialization.js';
import {registerHomeTerrain,registerFineTerrainForChunk} from '../src/world/fineTerrain.js';
import {restoreBuildingForLayout} from '../src/world/buildingRestore.js';
import {PortableObjectRuntime} from '../src/world/portableObjectRuntime.js';
import {droppedParcelSpec} from '../src/scene/droppedParcel.js';
import {WorldPersistence} from '../server/worldPersistence.js';
import {validateWorldPersistenceSnapshot} from '../server/worldSnapshotValidation.js';
import type {NpcState,WorldPersistenceSnapshot,WorldObjectState} from '../src/types.js';

// Execute the real layout/scene/activation/snapshot paths. External asset transport
// and decisions are omitted from this component fixture.
const {JSDOM}=createRequire(import.meta.url)('jsdom');
const source=fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const names=new Set(['createFineNpcVisual','spawnFineNpc','syncKnownActorPresentation','tryPushMovableObject','createStreamedObject','syncStreamedPresentation','updateFineChunkMaterialization','materializeFineChunk','collapseFineChunk',
  'updateObjects','saveWorldState','clearMovablePersistenceQueue','flushWorldBeacon','fineWorkplaceForRole','fineSpawnPosition','fineMetrics','buildWorldSnapshot','buildFinalWorldSnapshot','restoreWorldState','initializePersistence',
  'addBuilding','buildingInteractionProfile','addObject','addAssetObject','addFarmPlotObject','semanticAssetSpec','registerWorldObjectPhysics','defaultCapabilities']);
const members:string[]=[];
for(const n of ast.statements)if(ts.isClassDeclaration(n)&&n.name?.text==='TownGame')for(const m of n.members){
  if(ts.isMethodDeclaration(m)&&names.has(m.name.getText(ast))||ts.isPropertyDeclaration(m)&&['streamedPresentation','streamedNpcs','streamedWildlife'].includes(m.name.getText(ast)))members.push(m.getText(ast));
}
assert.equal(members.length,names.size+3);
const code=ts.transpileModule(`return class Runtime {objects=new Map();${members.join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(snapshot:WorldPersistenceSnapshot|null=null,realActors=false){
  const io={snapshot,gets:0,writes:0,beacons:0,epoch:Date.now(),store:undefined as WorldPersistence|undefined,writeGate:undefined as Promise<void>|undefined};
  const document=new JSDOM('<div id="speech"></div>').window.document;
  const deps={disposeOwnedSkeletons,...worldRandom,document,ui:{speechLayer:document.querySelector('#speech')},StreamedActors,Date:{now:()=>io.epoch},navigator:{sendBeacon(){io.beacons++;return true;}},THREE,...layouts,...units,...movable,...portable,...baking,...water,...trees,...crops,playerHeadClearance,NPC_BODY_RADIUS,StreamedPresentation,planFineChunk,registerFineTerrainForChunk,restoreBuildingForLayout,droppedParcelSpec,
    clamp:(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x)),now:()=>1000,i18n:{t:(key:string)=>key},fetch:async(_url:string,init?:{method?:string;body?:string})=>{
      if(init?.method==='POST'){io.writes++;const data=JSON.parse(init.body!);if(io.writeGate)await io.writeGate;const saved=io.store!.save(data.snapshot,data.expectedRevision);return{ok:true,status:200,json:async()=>saved};}
      io.gets++;return{ok:true,json:async()=>({revision:io.store?.revision()??3,snapshot:io.store?.load()??io.snapshot})};
    }};
  const Runtime=new Function(...Object.keys(deps),code)(...Object.values(deps)),r=new Runtime();
  const scene=new THREE.Scene(),coarseWorld=new CoarseWorldRuntime(scene),physics=new FinePhysicsAuthority();registerHomeTerrain(physics,72);
  for(const c of coarseWorld.chunks.values())c.wildlife=[];
  Object.assign(r,{randomness:worldRandom.readWorldRandomness(undefined),initializeWorld(){},scene,physics,coarseWorld,streamedLayouts:new layouts.StreamedLayoutRegistry(coarseWorld.seed),visualTargets:[] as any[],materializedChunks:new Map(),fineChunkCache:new Map(),npcs:new Map(),wildlife:new Map(),wildlifeLineage:new Map(),wildlifeTransfers:new Map(),lineageEpoch:0,
    day:1,minuteOfDay:495,weather:'clear',weatherEpoch:1,cameraMode:'firstPerson',camera:{position:new THREE.Vector3()},playerPosition:{x:0,z:7},
    playerInventory:{apple:0,bread:1,wood:0,coin:10,flower:0,grain:0,flour:0,water:0,stone:0,plank:0,tool:0},
    worldSeason:()=> 'spring',physicsDynamicColliders:()=>[],groundHeightAt:()=>0,attachVisualTarget(target:any){this.visualTargets.push(target);},event(){},log(){},reconcileLineageOffspring(){},
    flushWildlifeHabitatExposure(){},transferOwnedFollowersToChunk(){},materializePendingWildlifeTransfers(){},endWildlifeHabitatObservation(){},wildlifePresentation:{remove(){}},
    spawnWildlife(){throw Error('Fixture must not seed wildlife');},
    scheduleMovablePersistence(){},itemName:(x:string)=>x,parcelLabel:(x:string,n:number)=>`${x} ${n}`});
  if(!realActors)r.spawnFineNpc=function(state:NpcState,characterAsset:string){
    const visual=this.streamedNpcs.get(state.id)||this.createFineNpcVisual(state,characterAsset);
    const agent={...visual,state,characterAsset,removed:false,path:[],pathIndex:0,nextDecisionAt:1000};
    this.streamedNpcs.remember(agent);this.npcs.set(state.id,agent);
    this.materializedChunks.get(state.chunkId)?.groups.push(agent.mesh);
  };
  r.portables=new PortableObjectRuntime(r);return{r,io};
}
const json=(value:any)=>JSON.parse(JSON.stringify(value));

 test('72m previews become the same fine objects and physics, survive owner changes and save/reload',async()=>{
  const {r}=fixture();await r.initializePersistence();
  assert.equal(r.streamedPresentation.unitIds().length,8);assert.equal(r.materializedChunks.size,0);assert.equal(r.coarseWorld.materialized.size,0);
  const layout=r.streamedLayouts.get('unit_1_0'),building=layout.buildings[0],object=r.streamedPresentation.object(building.id),mesh=object.mesh;
  assert.ok(r.physics.isBlocked(building.x,building.z,.3));assert.equal(r.objects.has(building.id),false);
  const [cx,cz]=building.ownerCellId.slice(6).split('_').map(Number);r.playerPosition={x:cx*24,z:cz*24};r.updateFineChunkMaterialization();
  assert.equal(r.objects.get(building.id),object);assert.equal(object.mesh,mesh);assert.ok(r.physics.isBlocked(building.x,building.z,.3));assert.equal(r.coarseWorld.materialized.size,1);
  object.state.storage=[{kind:'wood',count:7}];
  const target=r.visualTargets.find((t:any)=>t.group===mesh);r.playerPosition={x:0,z:7};r.updateFineChunkMaterialization();
  assert.equal(r.streamedPresentation.object(building.id),object);assert.equal(mesh.parent,r.scene);assert.equal(r.objects.has(building.id),false);assert.equal(r.visualTargets.find((t:any)=>t.group===mesh),target);assert.ok(r.physics.isBlocked(building.x,building.z,.3));
  const store=new WorldPersistence(':memory:');try{
    const snapshot=json(r.buildWorldSnapshot());store.save(snapshot,0);const loaded=store.load()!;
    assert.equal(loaded.fineChunks.find(row=>row.chunkId===building.ownerCellId)!.objectStates.find(s=>s.id===building.id)!.storage![0].count,7);
    const next=fixture(loaded).r;await next.initializePersistence();
    assert.equal(layouts.layoutIdentity(next.streamedLayouts.get(layout.unit.id)),layouts.layoutIdentity(layout));
    assert.deepEqual(next.streamedPresentation.object(building.id).state.storage,[{kind:'wood',count:7}]);
    assert.deepEqual(next.streamedPresentation.object(building.id).mesh.position.toArray(),mesh.position.toArray());
  }finally{store.close();}
});

test('legacy saved lists drive restoration after current coarse layout drops every resident and building',async()=>{
  const f=fixture(),r=f.r,cell=r.coarseWorld.chunks.get('chunk_2_-1');Object.assign(cell,{settlementLevel:2,population:23,strategy:'trade_route',prosperity:80,danger:10});
  const plan=planFineChunk(cell),oldBuilding=plan.buildings[0],frontage={x:oldBuilding.x,z:oldBuilding.z+oldBuilding.d/2+1.15};
  const npcs=plan.residents.map(p=>({id:p.id,chunkId:cell.id,name:p.name,role:p.role,position:{x:p.x,z:p.z},home:{x:p.x,z:p.z},workAt:p.workAt,mood:p.mood,hunger:30,energy:70,social:50,money:8,inventory:p.inventory,relationships:{},memories:[],currentAction:'idle',goal:'live',lastDecisionAt:0}));
  const objects:WorldObjectState[]=[{id:oldBuilding.id,chunkId:cell.id,kind:'building',name:oldBuilding.name,position:frontage,tags:['building','market'],usable:true,pickupable:false,storage:[{kind:'wood',count:7}]},...plan.objects.map(o=>o.state)];
  const cart=objects.find(o=>o.kind==='cart')!;cart.position={x:44,z:-18};cart.storage=[{kind:'stone',count:2}];
  r.fineChunkCache.set(cell.id,{npcStates:npcs,objectStates:objects,wildlifeStates:[]});
  Object.assign(cell,{settlementLevel:0,population:0,strategy:'fortify',danger:82});assert.equal(planFineChunk(cell).residents.length,0);
  r.syncStreamedPresentation();r.playerPosition={x:48,z:-24};r.updateFineChunkMaterialization();
  assert.equal(r.npcs.size,npcs.length);for(const npc of npcs)assert.deepEqual(r.npcs.get(npc.id).state,npc);
  for(const state of objects)assert.ok(r.objects.has(state.id),state.id);
  assert.deepEqual(r.objects.get(oldBuilding.id).state.position,frontage);assert.deepEqual(r.objects.get(oldBuilding.id).state.storage,[{kind:'wood',count:7}]);
  assert.deepEqual(r.objects.get(cart.id).state.position,cart.position);assert.deepEqual(r.objects.get(cart.id).state.storage,cart.storage);
  assert.equal(r.wildlife.size,0,'saved empty wildlife list must remain empty');
});

test('static-only rows never suppress first dynamic activation and later empty resident state is preserved',async()=>{
  const {r}=fixture();await r.initializePersistence();const cell=[...r.coarseWorld.chunks.values()].find((c:any)=>c.population>0&&c.settlementLevel>0) as any;
  assert.equal(r.fineChunkCache.get(cell.id).dynamicActivated,false);r.playerPosition={x:cell.cx*24,z:cell.cz*24};r.updateFineChunkMaterialization();
  assert.ok(r.materializedChunks.get(cell.id).npcIds.length>0);
  for(const id of r.materializedChunks.get(cell.id).npcIds){r.npcs.get(id).mesh.removeFromParent();r.npcs.delete(id);}r.materializedChunks.get(cell.id).npcIds=[];
  r.playerPosition={x:0,z:7};r.updateFineChunkMaterialization();assert.equal(r.fineChunkCache.get(cell.id).dynamicActivated,true);
  r.playerPosition={x:cell.cx*24,z:cell.cz*24};r.updateFineChunkMaterialization();assert.equal(r.materializedChunks.get(cell.id).npcIds.length,0);
});

test('god camera observation cannot discover more units or seize coarse ownership',async()=>{
  const {r}=fixture();await r.initializePersistence();const layoutsBefore=layouts.layoutIdentity(r.streamedLayouts.snapshot()),count=r.coarseWorld.chunks.size;
  r.cameraMode='god';r.camera.position.set(480,100,480);r.updateFineChunkMaterialization();
  assert.equal(r.coarseWorld.chunks.size,count);assert.equal(layouts.layoutIdentity(r.streamedLayouts.snapshot()),layoutsBefore);assert.equal(r.coarseWorld.materialized.size,0);
});

test('crossing beyond the visible window releases visuals and recreates only the saved layout on return',async()=>{
  const {r}=fixture();await r.initializePersistence();const original=json(r.streamedLayouts.get('unit_1_0'));
  const item=original.objects.find((o:any)=>o.kind==='crate'),view=r.streamedPresentation.object(item.id);view.state.storage=[{kind:'wood',count:4}];
  // Activate and leave through the normal boundary method to capture mutable state.
  const owner=r.coarseWorld.chunks.get(item.ownerCellId);r.playerPosition={x:owner.cx*24,z:owner.cz*24};r.updateFineChunkMaterialization();
  r.playerPosition={x:480,z:0};r.coarseWorld.ensureWindowAround(480,0);for(const cell of r.coarseWorld.chunks.values())cell.wildlife=[];r.updateFineChunkMaterialization();
  // Ownership retention protects the departing unit until the fine owner collapses.
  r.syncStreamedPresentation();assert.equal(r.streamedPresentation.object(item.id),undefined);assert.equal(view.mesh.parent,null);
  for(const id of original.ownerCellIds){const cell=r.coarseWorld.chunks.get(id);Object.assign(cell,{population:0,settlementLevel:0,strategy:'fortify',danger:90});}
  r.playerPosition={x:0,z:7};r.updateFineChunkMaterialization();
  assert.deepEqual(json(r.streamedLayouts.get(original.unit.id)),original);const returned=r.streamedPresentation.object(item.id);
  assert.notEqual(returned.mesh,view.mesh);assert.deepEqual(returned.state.storage,[{kind:'wood',count:4}]);assert.deepEqual(returned.mesh.position.toArray(),view.mesh.position.toArray());
});

test('invalid saved layouts reject before world mutation and leave writes blocked after ready fallback',async()=>{
  const live=fixture().r;await live.initializePersistence();const saved=json(live.buildWorldSnapshot());
  for(const mutate of [(s:any)=>{s.streamedLayouts[0].version=2;},(s:any)=>{s.fineChunks[0].objectStates=[];},(s:any)=>{s.fineChunks[0].dynamicActivated=2;},(s:any)=>{delete s.meta.streamedLayoutVersion;}]){
    const invalid=structuredClone(saved);invalid.meta.day=99;mutate(invalid);
    const {r}=fixture(invalid);await r.initializePersistence();
    assert.equal(r.day,1);assert.equal(r.persistenceReady,true);assert.equal(r.persistenceLoadBlocked,true);assert.equal(r.persistenceRevision,3);
  }
});


test('a visible cart can be pushed before its coarse owner activates without losing the cached position or trigger',async()=>{
  const {r}=fixture();
  r.fineChunkCache.set('chunk_2_0',{npcStates:[],wildlifeStates:[],objectStates:[{id:'legacy_movable_cart',chunkId:'chunk_2_0',kind:'cart',name:'Saved cart',
    position:{x:36,z:0},tags:['transport'],usable:true,pickupable:false,rigidBodyArchetype:'cart',storage:[{kind:'wood',count:2}],capabilities:['inspect','load','unload']}]});
  await r.initializePersistence();const layout=r.streamedLayouts.get('unit_1_0'),cart=layout.objects.find((o:any)=>o.id==='legacy_movable_cart');
  const view=r.streamedPresentation.object(cart.id),before={...view.state.position};
  assert.equal(r.persistenceLoadBlocked,false);assert.equal(r.streamedLayoutError,undefined);
  assert.equal(r.objects.has(cart.id),false);assert.equal(r.coarseWorld.materialized.size,0);
  assert.deepEqual(before,{x:36,z:0});assert.deepEqual(view.state.storage,[{kind:'wood',count:2}]);
  assert.equal(r.tryPushMovableObject(cart.id,{x:.15,z:0}),true);assert.ok(view.state.position.x>before.x);
  assert.deepEqual(r.fineChunkCache.get(cart.ownerCellId).objectStates.find((o:any)=>o.id===cart.id).position,view.state.position);
  const owner=r.coarseWorld.chunks.get(cart.ownerCellId);r.playerPosition={x:owner.cx*24,z:owner.cz*24};r.updateFineChunkMaterialization();
  r.tryPushMovableObject(cart.id,{x:.15,z:0});r.playerPosition={x:0,z:7};r.updateFineChunkMaterialization();
  assert.ok(r.physics.overlappingTriggers(view.state.position).some((trigger:any)=>trigger.id===`object-trigger:${cart.id}`));
  assert.equal(r.streamedPresentation.object(cart.id),view);
});


test('layout construction failure settles startup and blocks writes without retrying every frame',async()=>{
  const {r}=fixture();let attempts=0;r.syncStreamedPresentation=()=>{attempts++;throw new layouts.StreamedLayoutValidationError('Blocked saved layout');};
  await r.initializePersistence();assert.equal(r.persistenceReady,true);assert.equal(r.persistenceLoadBlocked,true);assert.equal(r.streamedLayoutError,'Blocked saved layout');
  for(let i=0;i<3;i++)r.updateFineChunkMaterialization();assert.equal(attempts,1);
});


test('a valid legacy static obstruction settles startup, retains loaded state and blocks full/beacon writes',async()=>{
  const saved=json(fixture().r.buildWorldSnapshot());delete saved.meta.streamedLayoutVersion;delete saved.streamedLayouts;saved.meta.day=8;
  const tree={id:'legacy_tree',chunkId:'chunk_2_0',kind:'tree',name:'Saved tree',position:{x:36,z:0},tags:['nature','wood'],usable:true,pickupable:false,resourceAmount:3,item:'wood',capabilities:['inspect','chop']};
  saved.fineChunks=[{chunkId:'chunk_2_0',npcStates:[],objectStates:[tree],wildlifeStates:[]}];validateWorldPersistenceSnapshot(saved);
  const {r,io}=fixture(saved);await r.initializePersistence();
  assert.equal(r.day,8);assert.equal(r.persistenceReady,true);assert.equal(r.persistenceLoadBlocked,true);assert.match(r.streamedLayoutError,/road connection/);
  assert.deepEqual(r.fineChunkCache.get('chunk_2_0').objectStates,[tree]);
  await r.saveWorldState();r.flushWorldBeacon();assert.equal(io.gets,1);assert.equal(io.beacons,0);
});


test('visible saved pickup timers expire before fine activation and checkpoint the same state',async()=>{
  const {r,io}=fixture();io.epoch=1000;
  r.fineChunkCache.set('chunk_2_0',{npcStates:[],wildlifeStates:[],objectStates:[{id:'legacy_tool',chunkId:'chunk_2_0',kind:'tool_prop',name:'Saved axe',
    position:{x:45,z:5},tags:['tool','wood'],usable:true,pickupable:false,item:'tool',respawnAt:2000,capabilities:['inspect','pickup']}]});
  await r.initializePersistence();const object=r.streamedPresentation.object('legacy_tool');
  assert.equal(object.mesh.visible,false);assert.equal(object.state.pickupable,false);assert.equal(r.coarseWorld.materialized.size,0);
  io.epoch=3000;r.updateObjects(0);
  assert.equal(object.mesh.visible,true);assert.equal(object.state.pickupable,true);assert.equal(object.state.respawnAt,undefined);assert.equal(r.coarseWorld.materialized.size,0);
  const cached=r.fineChunkCache.get('chunk_2_0').objectStates.find((s:any)=>s.id==='legacy_tool');assert.deepEqual(cached,object.state);
  const store=new WorldPersistence(':memory:');try{store.save(json(r.buildWorldSnapshot()),0);
    const saved=store.load()!.fineChunks.find(c=>c.chunkId==='chunk_2_0')!.objectStates.find(s=>s.id==='legacy_tool')!;assert.equal(saved.pickupable,true);assert.equal(saved.respawnAt,undefined);
  }finally{store.close();}
  r.playerPosition={x:48,z:0};r.updateFineChunkMaterialization();r.updateObjects(0);
  assert.equal(r.objects.get('legacy_tool'),object);assert.equal(object.mesh.visible,true);assert.equal(object.state.pickupable,true);
});


test('later exploration cannot materialize an empty failed unit or overwrite its saved objects',async()=>{
  const saved=json(fixture().r.buildWorldSnapshot());delete saved.meta.streamedLayoutVersion;delete saved.streamedLayouts;
  const tree={id:'far_legacy_tree',chunkId:'chunk_5_0',kind:'tree',name:'Saved tree',position:{x:108,z:0},tags:['nature','wood'],usable:true,pickupable:false,resourceAmount:4,item:'wood',capabilities:['inspect','chop']};
  saved.fineChunks=[{chunkId:'chunk_5_0',npcStates:[],objectStates:[tree],wildlifeStates:[]}];validateWorldPersistenceSnapshot(saved);
  const store=new WorldPersistence(':memory:');try{
    store.save(saved,0);const before=store.load(),{r,io}=fixture();io.store=store;await r.initializePersistence();
    assert.equal(r.streamedPresentation.unitIds().length,8);assert.equal(r.persistenceLoadBlocked,false);
    for(const x of [24,48,72,96,120]){r.playerPosition={x,z:0};r.updateFineChunkMaterialization();r.updateFineChunkMaterialization();}
    assert.equal(r.persistenceLoadBlocked,true);assert.match(r.streamedLayoutError,/road connection/);assert.equal(r.materializedChunks.has('chunk_5_0'),false);
    assert.deepEqual(r.fineChunkCache.get('chunk_5_0').objectStates,[tree]);
    await r.saveWorldState();r.flushWorldBeacon();assert.equal(io.writes,0);assert.equal(io.beacons,0);assert.equal(store.revision(),1);assert.deepEqual(store.load(),before);
  }finally{store.close();}
});


test('a full-save acknowledgement cannot start a queued write after a streaming failure',async()=>{
  const saved=json(fixture().r.buildWorldSnapshot());delete saved.meta.streamedLayoutVersion;delete saved.streamedLayouts;
  const tree={id:'far_legacy_tree',chunkId:'chunk_5_0',kind:'tree',name:'Saved tree',position:{x:108,z:0},tags:['nature','wood'],usable:true,pickupable:false,resourceAmount:4,item:'wood',capabilities:['inspect','chop']};
  saved.fineChunks=[{chunkId:'chunk_5_0',npcStates:[],objectStates:[tree],wildlifeStates:[]}];
  const store=new WorldPersistence(':memory:');try{
    store.save(saved,0);const {r,io}=fixture();io.store=store;await r.initializePersistence();
    let release!:()=>void;io.writeGate=new Promise<void>(resolve=>{release=resolve;});
    const saving=r.saveWorldState();assert.equal(io.writes,1);
    r.playerPosition={x:24,z:0};r.updateFineChunkMaterialization();assert.equal(r.persistenceLoadBlocked,true);
    r.persistenceSaveQueued=true; // A stale queued flag must also settle when the outstanding ACK arrives.
    release();await saving;
    assert.equal(io.writes,1);assert.equal(store.revision(),2);assert.deepEqual(store.load()!.fineChunks.find(c=>c.chunkId==='chunk_5_0')!.objectStates,[tree]);
    assert.equal(r.persistenceSaveQueued,false);assert.equal(r.persistenceSaveInFlight,false);
  }finally{store.close();}
});

test('fresh residents clear the saved player while cached residents retain their positions across return and reload',async()=>{
  for(const player of [{x:49.8,z:-1.9},{x:45.5,z:-4}]){
  const first=fixture(),snapshot=json(first.r.buildWorldSnapshot());
  snapshot.coarseChunks=units.streamedUnitOwnerCells(1,0).map(owner=>({...owner,biome:'plains',settlementLevel:2,population:23,
    food:68,wood:57,water:71,ecology:73,danger:18,prosperity:66,strategy:'trade_route',migrationPolicy:'attract',ecologyPolicy:'balance',lastDecisionAt:0,decisionVersion:3,wildlife:[]}));
  snapshot.meta.playerPosition=player;first.io.snapshot=snapshot;first.r.spawnWildlife=()=>false;
  await first.r.initializePersistence();assert.equal(first.r.streamedLayoutError,undefined);assert.equal(first.r.npcs.size,12);
  for(const npc of first.r.npcs.values())assert.ok(playerHeadClearance(npc.characterAsset,npc.state.position,0,first.r.playerPosition)>=0);
  const actors=[...first.r.npcs.values()] as any[];
  for(let i=0;i<actors.length;i++)for(let j=i+1;j<actors.length;j++){
    const a=actors[i].state.position,b=actors[j].state.position;
    assert.ok(Math.hypot(a.x-b.x,a.z-b.z)>=NPC_BODY_RADIUS*2,'new residents cannot reserve the same body space');
  }
  const positions=()=>[...first.r.npcs.values()].map((npc:any)=>({id:npc.state.id,position:{...npc.state.position}}));
  const expected=positions(),saved=json(first.r.buildWorldSnapshot());
  saved.meta.playerPosition={...first.r.npcs.get('chunk_2_0_npc_01').state.position};
  const next=fixture(saved);next.r.spawnWildlife=()=>false;await next.r.initializePersistence();
  const restored=()=>[...next.r.npcs.values()].map((npc:any)=>({id:npc.state.id,position:{...npc.state.position}}));
  assert.deepEqual(restored(),expected);
  next.r.playerPosition={x:56,z:6};next.r.updateFineChunkMaterialization();assert.deepEqual(restored(),expected);
  next.r.playerPosition={x:0,z:7};next.r.updateFineChunkMaterialization();assert.equal(next.r.npcs.size,0);
  next.r.playerPosition={...saved.meta.playerPosition};next.r.updateFineChunkMaterialization();assert.deepEqual(restored(),expected);
  }
});

test('a bounded new-resident spawn failure reaches the streaming write protection instead of persisting a missing population',async()=>{
  const f=fixture(),snapshot=json(f.r.buildWorldSnapshot());snapshot.meta.playerPosition={x:48,z:0};
  snapshot.coarseChunks=units.streamedUnitOwnerCells(1,0).map(owner=>({...owner,biome:'plains',settlementLevel:1,population:12,
    food:65,wood:50,water:60,ecology:55,danger:10,prosperity:65,strategy:'sustain',migrationPolicy:'retain',ecologyPolicy:'balance',lastDecisionAt:0,decisionVersion:0,wildlife:[]}));
  f.io.snapshot=snapshot;f.r.physics.isBlocked=()=>true;await f.r.initializePersistence();
  assert.match(f.r.streamedLayoutError,/No clear NPC spawn/);assert.equal(f.r.persistenceLoadBlocked,true);assert.equal(f.r.npcs.size,0);
  await f.r.saveWorldState();f.r.flushWorldBeacon();assert.equal(f.io.writes,0);assert.equal(f.io.beacons,0);
});

test('known NPC visuals remain across 24m ownership changes while fine simulation stays local',async()=>{
  const {r}=fixture(null,true);await r.initializePersistence();
  const cell=r.coarseWorld.chunks.get('chunk_2_0');Object.assign(cell,{settlementLevel:2,population:23,strategy:'trade_route',prosperity:65});
  r.playerPosition={x:48,z:0};r.updateFineChunkMaterialization();
  const first=r.npcs.get('chunk_2_0_npc_00'),mesh=first.mesh;
  const mixer=new THREE.AnimationMixer(mesh);first.mixer=mixer;first.actions=new Map();
  first.state.inventory=[{kind:'wood',count:7}];first.state.money=19;
  r.playerPosition={x:60.1,z:0};r.updateFineChunkMaterialization();
  assert.equal(mesh.parent,r.scene);assert.equal(first.removed,true);assert.equal(r.npcs.has(first.state.id),false);
  assert.equal(first.nameEl.classList.contains('hidden'),true);assert.equal(first.nameEl.isConnected,false);assert.deepEqual([...r.coarseWorld.materialized],['chunk_3_0']);
  const before=mixer.time;r.updateObjects(.5);assert.equal(mixer.time,before,'inactive pose must not advance through fine object updates');
  r.playerPosition={x:48,z:0};r.updateFineChunkMaterialization();
  const current=r.npcs.get(first.state.id);assert.notEqual(current,first);assert.equal(current.mesh,mesh);assert.equal(current.mixer,mixer);
  assert.equal(current.nameEl.isConnected,true);
  assert.equal(first.removed,true);assert.deepEqual(current.state.inventory,[{kind:'wood',count:7}]);assert.equal(current.state.money,19);
});

test('stored NPCs are presented before activation without adding fine actors or changing their checkpoint',async()=>{
  const {r}=fixture(null,true);await r.initializePersistence();
  const cell=r.coarseWorld.chunks.get('chunk_2_0');Object.assign(cell,{settlementLevel:2,population:23,strategy:'trade_route',prosperity:65});
  r.playerPosition={x:48,z:0};r.updateFineChunkMaterialization();
  const id='chunk_2_0_npc_00';r.npcs.get(id).state.money=27;
  r.playerPosition={x:0,z:7};r.updateFineChunkMaterialization();
  const store=new WorldPersistence(':memory:');try{
    store.save(json(r.buildWorldSnapshot()),0);const loaded=store.load()!,row=loaded.fineChunks.find(x=>x.chunkId===cell.id)!;
    const restored=fixture(loaded,true).r;await restored.initializePersistence();
    const presented=restored.streamedNpcs.get(id);assert.ok(presented);assert.equal(presented.mesh.parent,restored.scene);
    assert.equal(restored.npcs.has(id),false);assert.equal(restored.coarseWorld.materialized.size,0);
    assert.deepEqual(restored.fineChunkCache.get(cell.id).npcStates,row.npcStates);
    const snapshot=restored.buildWorldSnapshot();assert.deepEqual(snapshot.fineChunks.find((x:any)=>x.chunkId===cell.id).npcStates,row.npcStates);
    restored.playerPosition={x:48,z:0};restored.updateFineChunkMaterialization();assert.equal(restored.npcs.get(id).mesh,presented.mesh);assert.equal(restored.npcs.get(id).state.money,27);
  }finally{store.close();}
});

test('unvisited owners do not seed preview NPCs and departed units release only inactive visuals',async()=>{
  const {r}=fixture(null,true);await r.initializePersistence();assert.equal([...r.streamedNpcs.values()].length,0);
  const cell=r.coarseWorld.chunks.get('chunk_2_0');Object.assign(cell,{settlementLevel:2,population:23,strategy:'trade_route',prosperity:65});
  r.playerPosition={x:48,z:0};r.updateFineChunkMaterialization();const actor=r.npcs.get('chunk_2_0_npc_00');
  const skin=new THREE.SkinnedMesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial());
  skin.bind(new THREE.Skeleton([new THREE.Bone()]));skin.skeleton.computeBoneTexture();actor.mesh.add(skin);
  let disposed=0;skin.skeleton.boneTexture!.addEventListener('dispose',()=>disposed++);
  r.coarseWorld.ensureWindowAround(1000,0);for(const c of r.coarseWorld.chunks.values())c.wildlife=[];r.syncStreamedPresentation();
  r.playerPosition={x:1000,z:0};r.updateFineChunkMaterialization();assert.equal(r.streamedLayoutError,undefined);
  assert.equal(disposed,1);assert.equal(skin.skeleton.boneTexture,null);
  assert.equal(r.streamedNpcs.get(actor.state.id)===undefined,true);assert.equal(actor.mesh.parent,null);assert.equal(actor.nameEl.isConnected,false);
  assert.equal(r.visualTargets.some((x:any)=>x.group===actor.mesh),false);assert.ok(r.fineChunkCache.get(cell.id).npcStates.some((x:any)=>x.id===actor.state.id));
});
