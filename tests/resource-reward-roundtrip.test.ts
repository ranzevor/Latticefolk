import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';
import type { CoarseChunkState, ItemKind, NpcState, WorldObjectState, WorldPersistenceSnapshot } from '../src/types.js';
import * as worldRandom from '../src/world/worldRandom.js';
import { planFineChunk } from '../src/world/materialization.js';
import { StreamedLayoutRegistry, StreamedLayoutValidationError, readStreamedLayout, assertStreamedLayoutStates } from '../src/world/streamedLayouts.js';
import { PortableObjectRuntime } from '../src/world/portableObjectRuntime.js';
import { restoredPlayerPosition } from '../src/world/portableObjects.js';
import { normalizeWorldObjectRigidBody, worldObjectRigidBody } from '../src/world/movablePhysics.js';
import { restoreBuildingForLayout } from '../src/world/buildingRestore.js';
import { isBakingOven } from '../src/scene/bakingOven.js';
import { WorldPersistence } from '../server/worldPersistence.js';

const source=ts.createSourceFile('main.ts',fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const cls=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='TownGame') as ts.ClassDeclaration;
const methods=['decorationState','defaultCapabilities','completeTask','npcHarvest','npcFetchWater','addInventory',
  'buildWorldSnapshot','buildFinalWorldSnapshot','flushWorldBeacon','restoreWorldState','saveWorldState'];
const body=methods.map(name=>{
  const method=cls.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(source)===name);
  assert.ok(method,`Missing real runtime method ${name}`);return method.getText(source);
}).join('\n');
const code=ts.transpileModule(`return class {${body}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const kinds:ItemKind[]=['apple','bread','wood','coin','flower','grain','flour','water','stone','plank','tool'];
const wire=(snapshot:WorldPersistenceSnapshot)=>JSON.parse(JSON.stringify(snapshot)) as WorldPersistenceSnapshot;
function fixture(){
  const beacons:Blob[]=[];
  let transport:((body:string)=>Promise<Response>)|undefined;
  const dependencies={...worldRandom,StreamedLayoutValidationError,readStreamedLayout,assertStreamedLayoutStates,
    restoredPlayerPosition,normalizeWorldObjectRigidBody,worldObjectRigidBody,restoreBuildingForLayout,isBakingOven,
    now:()=>1000,clamp:(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v)),
    dist:(a:{x:number;z:number},b:{x:number;z:number})=>Math.hypot(a.x-b.x,a.z-b.z),
    navigator:{sendBeacon:(_url:string,value:Blob)=>{beacons.push(value);return true;}},
    i18n:{t:(key:string)=>key},fetch:(_url:string,options:{body:string})=>{
      assert.ok(transport,'A test must connect its local SQLite transport before saving');return transport(options.body);
    }};
  const Runtime=new Function(...Object.keys(dependencies),code)(...Object.values(dependencies)),r=new Runtime();
  const chunks=new Map<string,CoarseChunkState>();
  Object.assign(r,{randomness:worldRandom.readWorldRandomness(undefined),day:1,minuteOfDay:495,weather:'clear',weatherEpoch:1,
    playerPosition:{x:0,z:7},playerInventory:Object.fromEntries(kinds.map(kind=>[kind,0])),camera:{position:new THREE.Vector3()},
    cameraMode:'firstPerson',npcs:new Map(),objects:new Map(),wildlife:new Map(),fineChunkCache:new Map(),materializedChunks:new Map(),
    wildlifeLineage:new Map(),wildlifeTransfers:new Map(),lineageEpoch:0,
    streamedLayouts:new StreamedLayoutRegistry(worldRandom.DEFAULT_WORLD_SEED),coarseWorld:{chunks,restoreKnownChunks:(states:CoarseChunkState[])=>{
      chunks.clear();for(const state of states)chunks.set(state.id,structuredClone(state));},ensureWindowAround(){},chunkAtWorld(){return undefined;}},
    groundHeightAt:()=>0,alignNpcVisualToGround(){},reconcileLineageOffspring(){},registerWorldObjectPhysics(){},
    event(){},say(){},log(){},playActivity(){},itemName:(kind:ItemKind)=>kind,
    findPath:()=>{throw Error('Fixture actor must be within the real completion range');},
    persistenceReady:true,persistenceConflict:false,persistenceLoadBlocked:false,persistenceRevision:0,
    movableDirty:false,schedules:0,scheduleMovablePersistence(){this.schedules++;},flushWildlifeHabitatExposure(){}});
  r.portables=new PortableObjectRuntime(r);
  return {r,beacons,connect:(store:()=>WorldPersistence)=>{transport=async body=>{
    const payload=JSON.parse(body),result=store().save(payload.snapshot,payload.expectedRevision);
    return new Response(JSON.stringify(result),{status:200,headers:{'content-type':'application/json'}});
  };}};
}
function coarse(cx:number):CoarseChunkState{
  return {id:`chunk_${cx}_0`,cx,cz:0,biome:'wetlands',settlementLevel:0,population:0,food:60,wood:50,
    water:72,ecology:60,danger:0,prosperity:30,strategy:'sustain',migrationPolicy:'retain',ecologyPolicy:'balance',lastDecisionAt:0,decisionVersion:0};
}
function native(kind:'bush'|'flower'|'water_patch'){
  for(let cx=2;cx<=16;cx++){
    const chunk=coarse(cx),state=planFineChunk(chunk).objects.find(object=>object.state.kind===kind)?.state;
    if(state)return {chunk,state};
  }
  throw Error(`No planned ${kind} source in the bounded native sample`);
}
function addSource(r:any,state:WorldObjectState){
  const object={state:structuredClone(state),mesh:new THREE.Group()};
  object.mesh.position.set(state.position.x,0,state.position.z);r.objects.set(state.id,object);return object;
}
function actor(r:any,state:WorldObjectState,owner?:string){
  const npc:NpcState={id:'collector',name:'Collector',chunkId:owner,role:'resident',position:{x:state.position.x-1,z:state.position.z},home:{x:0,z:0},
    mood:'neutral',hunger:20,energy:80,social:50,money:10,inventory:[],relationships:{},memories:[],
    currentAction:state.kind==='water_patch'?'fetch_water':'harvest',goal:'Collect',lastDecisionAt:0};
  const agent={state:npc,mesh:new THREE.Group(),task:undefined as {action:string;targetObjectId:string}|undefined};
  r.npcs.set(npc.id,agent);return agent;
}
function mountFine(r:any,chunk:CoarseChunkState,object:any,agent:any){
  r.coarseWorld.chunks.set(chunk.id,structuredClone(chunk));
  r.materializedChunks.set(chunk.id,{npcIds:agent.state.chunkId===chunk.id?[agent.state.id]:[],
    objectIds:object.state.chunkId===chunk.id?[object.state.id]:[],wildlifeIds:[]});
}
function collect(r:any,agent:any,object:any){
  agent.task={action:object.state.kind==='water_patch'?'fetch_water':'harvest',targetObjectId:object.state.id};
  r.completeTask(agent);assert.equal(agent.task,undefined);
}
function withStore(run:(store:()=>WorldPersistence,reopen:()=>void)=>void|Promise<void>){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lattice-resource-roundtrip-')),file=path.join(directory,'world.sqlite');
  let store=new WorldPersistence(file);
  const close=()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});};
  try{
    const result=run(()=>store,()=>{store.close();store=new WorldPersistence(file);});
    if(result instanceof Promise)return result.finally(close);close();
  }catch(error){close();throw error;}
}

for(const asset of ['bush','flowers'])test(`home NPC ${asset} reward and resource debit survive real SQLite reopen and game restore`,()=>withStore((get,reopen)=>{
  const live=fixture(),state=live.r.decorationState(asset,0,0),object=addSource(live.r,state),agent=actor(live.r,state);
  collect(live.r,agent,object);get().save(wire(live.r.buildWorldSnapshot()),0);reopen();
  const restored=fixture();addSource(restored.r,state);actor(restored.r,state);restored.r.restoreWorldState(get().load()!);
  const reward=restored.r.npcs.get('collector').state.inventory;
  assert.deepEqual(reward,[{kind:'flower',count:1}]);
  assert.equal(restored.r.objects.get(state.id).state.item,'flower');assert.equal(restored.r.objects.get(state.id).state.resourceAmount,2);
  collect(restored.r,restored.r.npcs.get('collector'),restored.r.objects.get(state.id));
  get().save(wire(restored.r.buildWorldSnapshot()),get().revision());reopen();
  assert.deepEqual(get().load()!.homeNpcs[0].inventory,[{kind:'flower',count:2}]);
  assert.equal(get().load()!.homeObjects[0].resourceAmount,1);
}));

for(const kind of ['bush','flower','water_patch'] as const)test(`native fine ${kind} reward and source state survive SQLite reopen and unloaded cache restore`,()=>withStore((get,reopen)=>{
  const live=fixture(),{chunk,state}=native(kind),object=addSource(live.r,state),agent=actor(live.r,state,chunk.id);
  mountFine(live.r,chunk,object,agent);const before=state.resourceAmount!;
  collect(live.r,agent,object);get().save(wire(live.r.buildWorldSnapshot()),0);reopen();
  const restored=fixture();restored.r.restoreWorldState(get().load()!);
  const row=restored.r.fineChunkCache.get(chunk.id),item=kind==='water_patch'?'water':'flower';
  assert.deepEqual(row.npcStates[0].inventory,[{kind:item,count:1}]);
  assert.equal(row.objectStates[0].item,state.item,'reload must not rewrite the native item type');
  assert.equal(row.objectStates[0].resourceAmount,kind==='water_patch'?before:before-1);
  assert.equal(row.npcStates[0].energy,kind==='water_patch'?79:74);
  get().save(wire(restored.r.buildWorldSnapshot()),get().revision());reopen();
  assert.deepEqual(get().load()!.fineChunks[0].npcStates[0].inventory,[{kind:item,count:1}]);
  assert.deepEqual(get().load()!.fineChunks[0].objectStates[0],row.objectStates[0]);
}));

for(const sourceOwner of ['home','fine'] as const)test(`cross-owner ${sourceOwner} forage cannot persist only one transfer side in the unload beacon`,()=>withStore(async(get,reopen)=>{
  const live=fixture(),{chunk,state:planned}=native('bush');
  const state={...planned,chunkId:sourceOwner==='fine'?chunk.id:undefined};
  const object=addSource(live.r,state),agent=actor(live.r,state,sourceOwner==='home'?chunk.id:undefined);
  mountFine(live.r,chunk,object,agent);const total=state.resourceAmount!;
  get().save(wire(live.r.buildWorldSnapshot()),0);live.r.persistenceRevision=get().revision();
  collect(live.r,agent,object);live.r.flushWorldBeacon();
  for(const request of live.beacons){const payload=JSON.parse(await request.text());get().save(payload.snapshot,payload.expectedRevision);}
  reopen();
  const loaded=get().load()!,npcs=[...loaded.homeNpcs,...loaded.fineChunks.flatMap(row=>row.npcStates)],objects=[...loaded.homeObjects,...loaded.fineChunks.flatMap(row=>row.objectStates)];
  const reward=npcs.find(npc=>npc.id===agent.state.id)!.inventory.find(slot=>slot.kind==='flower')?.count??0;
  const remaining=objects.find(source=>source.id===state.id)!.resourceAmount!;
  assert.equal(remaining+reward,total,'compact save must keep both old transfer sides or both new sides');
  assert.equal(live.r.portables.checkpoint.pending,true);
  assert.equal(live.beacons.length,0,'an unacknowledged cross-owner transfer requires the full save');
  assert.equal(live.r.movableDirty,true);assert.equal(live.r.schedules,1);
  // The production full-save method must acknowledge the exact transaction and
  // resume compact checkpoints only after both resource and inventory are durable.
  live.connect(get);await live.r.saveWorldState();
  assert.equal(live.r.persistenceRevision,get().revision());
  assert.equal(live.r.portables.checkpoint.pending,false);assert.equal(live.r.movableDirty,false);
  live.r.flushWorldBeacon();assert.equal(live.beacons.length,1);
  const payload=JSON.parse(await live.beacons[0].text());get().save(payload.snapshot,payload.expectedRevision);reopen();
  const committed=get().load()!,savedNpcs=[...committed.homeNpcs,...committed.fineChunks.flatMap(row=>row.npcStates)],savedObjects=[...committed.homeObjects,...committed.fineChunks.flatMap(row=>row.objectStates)];
  assert.equal(savedNpcs.find(npc=>npc.id===agent.state.id)!.inventory.find(slot=>slot.kind==='flower')?.count,1);
  assert.equal(savedObjects.find(source=>source.id===state.id)!.resourceAmount,total-1);
}));
