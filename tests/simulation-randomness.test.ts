import {SimulationClock,isPlayerMovementKey} from '../src/world/simulationClock.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';
import * as random from '../src/world/worldRandom.js';
import * as phenotype from '../src/world/wildlifePhenotype.js';
import * as organisms from '../src/world/organismFamilies.js';
import * as domestication from '../src/world/domestication.js';
import * as migration from '../src/world/fineWildlifeMigration.js';
import * as species from '../src/world/wildlifeSpecies.js';
import {CoarseWorldRuntime} from '../src/world/coarseWorld.js';
import {FinePhysicsAuthority} from '../src/world/finePhysics.js';
import {registerFineTerrainForChunk} from '../src/world/fineTerrain.js';
import {planFineChunk} from '../src/world/materialization.js';
import {restoredPlayerPosition} from '../src/world/portableObjects.js';
import {restoreBuildingForLayout} from '../src/world/buildingRestore.js';
import * as layouts from '../src/world/streamedLayouts.js';
import {StreamedActors} from '../src/scene/streamedActors.js';
import {playerHeadClearance,NPC_BODY_RADIUS} from '../src/world/characterContact.js';
import {isGodCameraInputKey} from '../src/scene/godCameraInput.js';
import {isBakingOven} from '../src/scene/bakingOven.js';
import type {DecisionResponse,NpcState,WildlifeState,WorldPersistenceSnapshot} from '../src/types.js';

// Run the production methods; presentation and external IO are the only stubs.
const source=fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const wanted=new Set(['createFineNpcVisual','createWildlifeVisual','fineSpawnPosition','fineWorkplaceForRole','clearMovablePersistenceQueue','resetPlayerInput','resetSimulationClock','playerInputAllowed','playerMovementKey','recordPlayerInput','bindInput','initializePersistence','initializeWorld','setupNpcs','materializeFineChunk','spawnFineNpc','spawnWildlife','restoreWorldState','buildWorldSnapshot','buildFinalWorldSnapshot','flushWorldBeacon','saveWorldState','cancelPlayerTargeting','requestDecision','applyDecision','applyStateShift','npcWork','npcHarvest','completeTask','randomPassableNear','requestWildlifeBatch','applyWildlifeDecision','completeWildlifeAction','applyOwnedWildlifeCommand','materializePendingWildlifeTransfers','collapseFineChunk','completeFineWildlifeMigration','updateTime']);
const members:string[]=[];
for(const node of ast.statements)if(ts.isClassDeclaration(node)&&node.name?.text==='TownGame')for(const member of node.members)if(ts.isMethodDeclaration(member)&&wanted.has(member.name.getText(ast)))members.push(member.getText(ast));
assert.equal(members.length,wanted.size);
const code=ts.transpileModule(`return class Runtime {${members.join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const metrics=()=>({food:0,wood:0,ecology:0,prosperity:0,shrub:0,fruit:0,crop:0});
const npc=(patch:Partial<NpcState>={}):NpcState=>({id:'n',name:'N',role:'maker',position:{x:0,z:0},home:{x:0,z:0},mood:'calm',hunger:20,energy:80,social:50,money:8,inventory:[],relationships:{},memories:[],currentAction:'idle',goal:'live',lastDecisionAt:0,randomEventCursor:11,...patch});
const wildlife=(patch:Partial<WildlifeState>={}):WildlifeState=>({id:'w',chunkId:'chunk_2_0',species:'rabbit',position:{x:48,z:0},ageDays:60,health:90,hunger:20,thirst:20,energy:80,sex:'female',generation:0,traits:{speed:2,size:.6,fertility:.8,wariness:.7},currentAction:'rest',lastDecisionAt:0,birthDay:1,randomEventCursor:17,...patch});
const decision=(action:DecisionResponse['action']):DecisionResponse=>({action,commitment:2,confidence:1,source:'fallback',stateShift:'stable',reasonCode:'routine'});
const npcRuntime=(state=npc())=>({state,mesh:new THREE.Group(),characterAsset:'female1',path:[],pathIndex:0,nextDecisionAt:0,pendingDecision:false,speechEl:{remove(){},classList:{add(){}}},nameEl:{remove(){},classList:{add(){}}}});
const animalRuntime=(state=wildlife())=>({state,mesh:new THREE.Group(),path:[],pathIndex:0,nextDecisionAt:0,actionResolved:false});
const chunkRuntime=(chunkId:string)=>({chunkId,npcIds:[] as string[],objectIds:[] as string[],wildlifeIds:[] as string[],initialWildlifeCounts:{},initialWildlifeIds:new Set(),fixedWildlifeWeights:new Map(),groups:[],initialMetrics:metrics()});
function fixture(seed=random.DEFAULT_WORLD_SEED){
  const io={clock:1000,snapshot:null as WorldPersistenceSnapshot|null,requests:[] as string[],beacons:[] as Blob[],reply:null as any,wait:undefined as Promise<any>|undefined,failed:false,logs:[] as string[],signals:[] as AbortSignal[],timers:new Map<number,{callback:()=>void;delay:number}>(),nextTimer:0};
  const input=new EventTarget(),elements=new Map<string,EventTarget>();
  const element=(selector:string)=>{let target=elements.get(selector);if(!target){target=new EventTarget();elements.set(selector,target);}return target;};
  const hidden=new Set<string>();const overlay={classList:{contains:(name:string)=>hidden.has(name),add:(name:string)=>hidden.add(name),remove:(name:string)=>hidden.delete(name)}};
  const controls=Object.assign(new EventTarget(),{isLocked:false,lock(this:EventTarget&{isLocked:boolean}){this.isLocked=true;this.dispatchEvent(new Event('lock'));}});
  const math=Object.create(Math);math.random=()=>{throw new Error('ambient Math.random');};
  const fetch=async(url:string,init?:RequestInit)=>{io.requests.push(url);if(init?.signal)io.signals.push(init.signal);if(io.failed)throw Error('offline');if(io.wait)return io.wait;return {ok:true,json:async()=>url==='/api/world/state'?{snapshot:io.snapshot,revision:4}:io.reply};};
  const deps={isPlayerMovementKey,...layouts,StreamedActors,playerHeadClearance,NPC_BODY_RADIUS,isGodCameraInputKey,...random,...phenotype,...organisms,...domestication,...migration,...species,THREE,CoarseWorldRuntime,planFineChunk,registerFineTerrainForChunk,restoredPlayerPosition,restoreBuildingForLayout,isBakingOven,Math:math,
    setTimeout:(callback:()=>void,delay:number)=>{const id=++io.nextTimer;io.timers.set(id,{callback,delay});return id;},clearTimeout:(id:number)=>io.timers.delete(id),
    now:()=>io.clock,Date:{now:()=>2000},clamp:(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n)),dist:(a:any,b:any)=>Math.hypot(a.x-b.x,a.z-b.z),fetch,
    i18n:{t:(key:string,values?:{error?:string})=>values?.error?`${key}: ${values.error}`:key},navigator:{sendBeacon:(_url:string,body:Blob)=>{io.beacons.push(body);return true;}},
    window:{clearTimeout:(id:number)=>io.timers.delete(id)},document:{hidden:false,hasFocus:()=>true,addEventListener:input.addEventListener.bind(input),createElement:()=>({className:'',remove(){},classList:{add(){}}}),querySelector:element,querySelectorAll:()=>[]},addEventListener:input.addEventListener.bind(input),ui:{admin:{classList:{contains:()=>true}},speechLayer:{appendChild(){}},modeBtn:element('mode'),localeSelect:element('locale'),overlay}};
  const Runtime=new Function(...Object.keys(deps),code)(...Object.values(deps));const runtime=new Runtime() as Record<string,any>;
  Object.assign(runtime,{streamedLayouts:new layouts.StreamedLayoutRegistry(seed),streamedNpcs:new StreamedActors<any>(a=>a.mesh.removeFromParent()),streamedWildlife:new StreamedActors<any>(a=>a.mesh.removeFromParent()),
    streamedPresentation:{activate:()=>[],deactivate(){},has:()=>false},resetGodCameraInput(){},simulationClock:new SimulationClock(),keys:new Set(),controls,renderer:{domElement:element('canvas')},randomness:{version:1,seed},scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(),sun:{intensity:0},ambient:{intensity:0},day:4,minuteOfDay:800,weather:'cloudy',weatherEpoch:2,
    playerPosition:{x:0,z:7},playerInventory:{apple:0,bread:1,wood:0,coin:10,flower:0,grain:0,flour:0,water:0,stone:0,plank:0,tool:0},cameraMode:'firstPerson',perceptionEpoch:0,inFlight:0,
    npcs:new Map(),wildlife:new Map(),objects:new Map(),fineChunkCache:new Map(),materializedChunks:new Map(),wildlifeLineage:new Map(),wildlifeTransfers:new Map(),lineageEpoch:0,visualTargets:[],physics:new FinePhysicsAuthority(),
    coarseWorld:{chunks:new Map(),chunkSize:24,restoreKnownChunks(){},ensureWindowAround(){},setMaterialized(){},applyFineSummary(){},chunkAtWorld(){return undefined;}},
    persistenceReady:true,persistenceConflict:false,persistenceLoadBlocked:false,persistenceRevision:4,persistenceSaveInFlight:false,persistenceSaveQueued:false,
    portables:{checkpoint:{pending:false,capture:()=>0,acknowledge(){}},restoreHome:()=>false,restoreFine(){}},
    wildlifePresentation:{register(){},remove(){},rebind:()=>false},groundHeightAt:()=>0,setupWorld(){},updateFineChunkMaterialization(){},attachVisualTarget(){},alignNpcVisualToGround(){},reconcileLineageOffspring(){},fineMetrics:metrics,
    beginWildlifeHabitatObservation(){},endWildlifeHabitatObservation(){},flushWildlifeHabitatExposure(){},makeProceduralAnimal:()=>new THREE.Group(),
    event(){},log(text:string){io.logs.push(text);},say(){},toast(){},remember(){},playActivity(){},planNpcObjectPath(){},scheduleMovablePersistence(){},gameTimeText:()=>'',wildlifeName:(s:string)=>s,findPath:(_p:any,target:any)=>[{...target}],
    closestNpc:()=>undefined,objectForAction:()=>undefined,snapshot:()=>({}),allowedActions:()=>[],wildlifeSnapshot:()=>({}),findWildlifeResource:()=>undefined,findWildlifeTarget:()=>undefined,wildlifeMigrationCandidates:()=>({nearby:[]}),
    addInventory:(inventory:any[],kind:string,count:number)=>{const slot=inventory.find(x=>x.kind===kind);if(slot)slot.count+=count;else inventory.push({kind,count});},
    ensureWildlifeLineage(state:WildlifeState){let record=runtime.wildlifeLineage.get(state.id);if(!record){record={entityId:state.id,species:state.species};runtime.wildlifeLineage.set(state.id,record);}return record;},
    addBuilding(name:string,x:number,z:number,_w:number,_d:number,_color:number,_asset:string,_height:number,_rotation:number,identity:any){runtime.objects.set(identity.id,{state:{...identity,name,kind:'building',position:{x,z}},mesh:new THREE.Group()});},
    addObject(state:any){runtime.objects.set(state.id,{state,mesh:new THREE.Group()});}
  });
  return{runtime,io,input,elements,hidden};
}
const stableState=(state:any)=>JSON.parse(JSON.stringify(state));
test('home initialization, relationships and new fine residents/wildlife use stable identity keys without consuming cursors',()=>{
  const a=fixture(),b=fixture(),other=fixture('different');
  for(const f of [a,b,other])f.runtime.initializeWorld();
  assert.deepEqual([...a.runtime.npcs.values()].map(x=>x.state),[...b.runtime.npcs.values()].map(x=>x.state));
  assert.notDeepEqual([...a.runtime.npcs.values()].map(x=>x.state),[...other.runtime.npcs.values()].map(x=>x.state));
  const chunk=[...a.runtime.coarseWorld.chunks.values()].find((x:any)=>x.settlementLevel>0)!;
  for(const f of [a,b])f.runtime.materializeFineChunk(structuredClone(chunk));
  assert.deepEqual(a.runtime.buildWorldSnapshot(),b.runtime.buildWorldSnapshot());
  for(const actor of [...a.runtime.npcs.values(),...a.runtime.wildlife.values()])assert.equal(actor.state.randomEventCursor,undefined);
});
test('stored seed is selected before real coarse generation, home setup and state restoration',async()=>{
  const source=fixture('saved');source.runtime.initializeWorld();const saved=source.runtime.npcs.get('mina');saved.state.hunger=1;saved.state.money=987;saved.state.randomEventCursor=37;
  const snapshot=source.runtime.buildWorldSnapshot();snapshot.coarseChunks=[];snapshot.homeNpcs=[structuredClone(saved.state)];
  const restored=fixture();restored.io.snapshot=snapshot;await restored.runtime.initializePersistence();
  assert.equal(restored.runtime.coarseWorld.worldSeed,'saved');assert.deepEqual(restored.runtime.npcs.get('mina').state,{...saved.state,chunkId:undefined});
  const expected=fixture('saved');expected.runtime.initializeWorld();
  assert.deepEqual([...restored.runtime.coarseWorld.chunks.values()],[...expected.runtime.coarseWorld.chunks.values()]);
  assert.deepEqual(restored.runtime.npcs.get('ren').state,expected.runtime.npcs.get('ren').state);
  assert.equal(restored.runtime.npcs.get('mina').state.randomEventCursor,37);
});
for(const mutation of [(s:WorldPersistenceSnapshot)=>Object.assign(s.meta,{randomness:{version:2,seed:'s'}}),(s:WorldPersistenceSnapshot)=>Object.assign(s.meta,{randomness:{version:1,seed:''}}),(s:WorldPersistenceSnapshot)=>{s.homeNpcs[0].randomEventCursor=-1;}])test('invalid random authority does not restore or overwrite the saved world',async()=>{
  const source=fixture();source.runtime.setupNpcs();const snapshot=source.runtime.buildWorldSnapshot();mutation(snapshot);
  const f=fixture();delete f.runtime.coarseWorld;f.io.snapshot=snapshot;await f.runtime.initializePersistence();assert.equal(f.runtime.persistenceLoadBlocked,true);assert.equal(f.runtime.persistenceConflict,false);assert.equal(f.runtime.npcs.size,10);
  await f.runtime.saveWorldState();f.runtime.flushWorldBeacon();assert.deepEqual(f.io.requests,['/api/world/state']);assert.equal(f.io.beacons.length,0);
});
test('accepted NPC events repeat from nonzero cursors and isolate rejection sampling from subsequent events',()=>{
  const a=fixture(),b=fixture();const left=npcRuntime(),right=npcRuntime();
  for(const f of [a,b])f.runtime.coarseWorld.chunks.set('chunk_2_0',{cx:2,cz:0});
  for(const action of ['idle','wander','explore','patrol'] as const){a.runtime.applyDecision(left,decision(action));b.runtime.applyDecision(right,decision(action));assert.deepEqual({state:left.state,path:left.path,nextDecisionAt:left.nextDecisionAt},{state:right.state,path:right.path,nextDecisionAt:right.nextDecisionAt});}
  assert.equal(left.state.randomEventCursor,15);
  b.runtime.physics.isBlocked=()=>true;a.runtime.applyDecision(left,decision('wander'));b.runtime.applyDecision(right,decision('wander'));
  assert.notDeepEqual(left.path,right.path);a.runtime.applyDecision(left,decision('idle'));b.runtime.applyDecision(right,decision('idle'));assert.equal(left.nextDecisionAt,right.nextDecisionAt);
});
test('maker and farm outcomes vary across events, reproduce, and reject empty stock or cursor overflow before mutation',()=>{
  const a=fixture(),b=fixture(),left=npcRuntime(),right=npcRuntime();const outcomes:number[]=[];
  for(let i=0;i<50;i++){const before=left.state.inventory.find(x=>x.kind==='wood')?.count??0;a.runtime.npcWork(left);b.runtime.npcWork(right);outcomes.push((left.state.inventory.find(x=>x.kind==='wood')?.count??0)-before);}
  assert.deepEqual(left.state,right.state);assert.deepEqual(new Set(outcomes),new Set([0,1]));
  const farm=()=>({state:{id:'farm',kind:'farm_plot',tags:[],resourceAmount:50}});const fa=farm(),fb=farm();
  for(let i=0;i<50;i++){a.runtime.npcHarvest(left,fa);b.runtime.npcHarvest(right,fb);}assert.deepEqual(left.state,right.state);assert.deepEqual(fa,fb);
  const before=structuredClone(left.state);a.runtime.npcHarvest(left,fa);assert.deepEqual(left.state,before);
  left.state.randomEventCursor=Number.MAX_SAFE_INTEGER;const exhausted=structuredClone(left.state);fa.state.resourceAmount=1;
  assert.throws(()=>a.runtime.npcWork(left));assert.deepEqual(left.state,exhausted);assert.throws(()=>a.runtime.npcHarvest(left,fa));assert.equal(fa.state.resourceAmount,1);assert.deepEqual(left.state,exhausted);
});
test('path sampling keeps its rounding, chunk bounds and sixty-attempt limit',()=>{
  const f=fixture();let checks=0,draws=0;f.runtime.physics.isBlocked=()=>{checks++;return true;};f.runtime.coarseWorld.chunks.set('c',{cx:2,cz:-1});
  assert.deepEqual(f.runtime.randomPassableNear({x:48.25,z:-24.2},20,()=>{draws++;return .99;},'c'),{x:48.25,z:-24.2});assert.equal(checks,60);assert.equal(draws,120);
  f.runtime.physics.isBlocked=()=>false;assert.deepEqual(f.runtime.randomPassableNear({x:48,z:-24},20,()=>.999,'c'),{x:59,z:-13});
});
test('player-target cancellation only consumes accepted cancellations',()=>{
  const f=fixture(),a=npcRuntime();f.runtime.npcs.set(a.state.id,a);f.runtime.cancelPlayerTargeting();assert.equal(a.state.randomEventCursor,11);
  Object.assign(a,{task:{action:'talk',targetNpcId:'player'}});f.runtime.cancelPlayerTargeting();assert.equal(a.state.randomEventCursor,12);assert.equal(a.nextDecisionAt>=1500&&a.nextDecisionAt<2500,true);
  f.runtime.cancelPlayerTargeting();assert.equal(a.state.randomEventCursor,12);
  f.runtime.cameraMode='god';Object.assign(a,{task:{action:'talk',targetNpcId:'player'}});f.runtime.completeTask(a);assert.equal(a.state.randomEventCursor,13);
});
for(const mode of ['removed','stale','failed','accepted'] as const)test(`NPC ${mode} response preserves request guards and event cursor ownership`,async()=>{
  const f=fixture(),a=npcRuntime();let finish!:(value:any)=>void;f.io.wait=new Promise(resolve=>{finish=resolve;});const pending=f.runtime.requestDecision(a);
  if(mode==='removed')Object.assign(a,{removed:true});if(mode==='stale')f.runtime.perceptionEpoch++;
  const before=structuredClone(a.state);finish({ok:mode!=='failed',json:async()=>decision('idle')});await pending;
  assert.equal(a.state.randomEventCursor,mode==='accepted'?12:11);if(mode!=='accepted')assert.deepEqual(a.state,before);assert.equal(a.pendingDecision,false);assert.equal(f.runtime.inFlight,0);
});
test('wildlife retry jitter never consumes or rewrites removed/replaced actors',async()=>{
  const f=fixture(),a=animalRuntime(),b=animalRuntime(wildlife({id:'b'}));f.runtime.wildlife.set('w',a);f.runtime.wildlife.set('b',b);
  let finish!:(value:any)=>void;f.io.wait=new Promise(resolve=>{finish=resolve;});const pending=f.runtime.requestWildlifeBatch();Object.assign(a,{removed:true});finish({ok:false,json:async()=>({})});await pending;
  assert.equal(a.nextDecisionAt,0);assert.equal(a.state.randomEventCursor,17);assert.equal(b.state.randomEventCursor,17);assert.ok(b.nextDecisionAt>=6000&&b.nextDecisionAt<11000);
});
test('wildlife paths, accepted completions and owner-follow repaths repeat without ambient draws',()=>{
  const a=fixture(),b=fixture(),left=animalRuntime(),right=animalRuntime();
  for(const action of ['wander','flee','migrate'] as const){
    const d={wildlifeId:'w',action,source:'fallback',confidence:1,reasonCode:'test'};a.runtime.applyWildlifeDecision(left,d);b.runtime.applyWildlifeDecision(right,d);assert.deepEqual(left.state,right.state);assert.deepEqual(left.path,right.path);
  }
  left.state.currentAction=right.state.currentAction='rest';a.runtime.completeWildlifeAction(left);b.runtime.completeWildlifeAction(right);assert.deepEqual(left.state,right.state);assert.equal(left.nextDecisionAt,right.nextDecisionAt);
  left.state.species=right.state.species='sheep';left.state.domestication=right.state.domestication={ownerId:'player',command:'follow',tameProgress:100,breedingAllowed:false};
  left.path=[];right.path=[];a.runtime.applyOwnedWildlifeCommand(left);b.runtime.applyOwnedWildlifeCommand(right);assert.deepEqual(left.state,right.state);assert.deepEqual(left.path,right.path);
  const cursor=left.state.randomEventCursor;a.runtime.applyOwnedWildlifeCommand(left);assert.equal(left.state.randomEventCursor,cursor);
});
test('dropped-parcel completion guard rejects without advancing random authority',()=>{
  const f=fixture(),a=animalRuntime(wildlife({currentAction:'forage',targetObjectId:'parcel'}));f.runtime.objects.set('parcel',{state:{kind:'dropped_item'}});
  f.runtime.completeWildlifeAction(a);assert.equal(a.state.randomEventCursor,17);assert.equal(a.state.currentAction,'rest');assert.equal(a.state.hunger,20);
});
test('idle/completed states and cursors pass through full, final, cache and restored activation',()=>{
  const f=fixture();f.runtime.setupNpcs();const home=f.runtime.npcs.get('mina');home.state.randomEventCursor=31;
  const chunk={id:'chunk_2_0',cx:2,cz:0,settlementLevel:0,population:0,biome:'plains',ecology:70,prosperity:30,food:70,wood:50,water:70,danger:20,strategy:'sustain',migrationPolicy:'retain',ecologyPolicy:'balance',lastDecisionAt:0,decisionVersion:0};
  f.runtime.coarseWorld.chunks.set(chunk.id,chunk);const n=npcRuntime(npc({chunkId:chunk.id})),w=animalRuntime();f.runtime.npcs.set(n.state.id,n);f.runtime.wildlife.set(w.state.id,w);
  const live=chunkRuntime(chunk.id);live.npcIds.push(n.state.id);live.wildlifeIds.push(w.state.id);f.runtime.materializedChunks.set(chunk.id,live);
  const full=f.runtime.buildWorldSnapshot();assert.equal(full.homeNpcs[0].randomEventCursor,31);assert.equal(full.fineChunks[0].npcStates[0].randomEventCursor,11);assert.equal(full.fineChunks[0].wildlifeStates[0].randomEventCursor,17);
  const final=f.runtime.buildFinalWorldSnapshot();assert.equal(final.homeNpcs[0].randomEventCursor,31);assert.deepEqual(final.meta.randomness,full.meta.randomness);assert.deepEqual(final.fineChunks,[]);
  f.runtime.collapseFineChunk(chunk.id);const cached=f.runtime.buildWorldSnapshot();assert.deepEqual(cached.fineChunks,full.fineChunks);
  const restored=fixture();restored.runtime.setupNpcs();restored.runtime.restoreWorldState(cached);assert.equal(restored.runtime.npcs.get('mina').state.randomEventCursor,31);assert.deepEqual(restored.runtime.fineChunkCache.get(chunk.id),f.runtime.fineChunkCache.get(chunk.id));
  restored.runtime.spawnFineNpc(structuredClone(n.state),'female1');restored.runtime.spawnWildlife(structuredClone(w.state));assert.equal(restored.runtime.npcs.get('n').state.randomEventCursor,11);assert.equal(restored.runtime.wildlife.get('w').state.randomEventCursor,17);
});
test('transfer keeps its cursor, accepted deferred entry advances once and rejected entries do not mutate queued state',()=>{
  const f=fixture(),a=animalRuntime();a.mesh.position.set(60,0,0);const source={id:'chunk_2_0',cx:2,cz:0,biome:'plains',wildlife:[{species:'rabbit',count:4,carryingCapacity:10,health:80}]};const destination={...source,id:'chunk_3_0',cx:3,wildlife:[{species:'rabbit',count:1,carryingCapacity:10,health:80}]};
  f.runtime.coarseWorld.chunks.set(source.id,source);f.runtime.coarseWorld.chunks.set(destination.id,destination);const live=chunkRuntime(source.id);live.wildlifeIds=['w'];Object.assign(live.initialWildlifeCounts,{rabbit:1});f.runtime.materializedChunks.set(source.id,live);f.runtime.wildlife.set('w',a);
  assert.equal(f.runtime.completeFineWildlifeMigration(a,destination.id),true);const transfer=f.runtime.wildlifeTransfers.get('w');assert.equal(transfer.state.randomEventCursor,17);assert.equal(transfer.state.currentAction,'wander');
  assert.equal(f.runtime.buildFinalWorldSnapshot().wildlifeTransfers[0].state.randomEventCursor,17);
  const target=chunkRuntime(destination.id);destination.wildlife[0].count=0;const before=structuredClone(transfer);f.runtime.materializePendingWildlifeTransfers(destination,target,[transfer]);assert.deepEqual(transfer,before);assert.equal(target.wildlifeIds.length,0);
  destination.wildlife[0].count=4;f.runtime.materializePendingWildlifeTransfers(destination,target,[transfer]);assert.equal(f.runtime.wildlife.get('w').state.randomEventCursor,18);assert.deepEqual(transfer,before);assert.equal(f.runtime.wildlifeTransfers.has('w'),false);
});
test('settled weather uses the shared seed/day/phase and saves do not draw',()=>{
  const a=fixture(),b=fixture();for(const f of [a,b]){f.runtime.weatherEpoch=1;f.runtime.updateTime(0);}
  assert.equal(a.runtime.weather,b.runtime.weather);assert.deepEqual(a.runtime.buildFinalWorldSnapshot().meta,b.runtime.buildFinalWorldSnapshot().meta);
  const saved=a.runtime.buildWorldSnapshot();b.runtime.restoreWorldState(saved);const before=stableState(b.runtime.buildWorldSnapshot());b.runtime.updateTime(0);assert.deepEqual(stableState(b.runtime.buildWorldSnapshot()),before);
});

for(const failed of [false,true])test(`${failed?'failed load':'empty save'} starts the deterministic default world with existing readiness behavior`,async()=>{
  const f=fixture();delete f.runtime.coarseWorld;f.runtime.persistenceReady=false;f.io.failed=failed;
  await f.runtime.initializePersistence();assert.equal(f.runtime.persistenceReady,true);assert.equal(f.runtime.persistenceConflict,false);
  assert.equal(f.runtime.coarseWorld.worldSeed,random.DEFAULT_WORLD_SEED);assert.equal(f.runtime.npcs.size,10);assert.equal(f.runtime.lastPersistenceSaveAt,f.io.clock);
  assert.deepEqual(f.io.requests,['/api/world/state']);
});
for(const kind of ['buildWorldSnapshot','buildFinalWorldSnapshot'])test(`${kind}: completed maker events resume from the saved cursor at a different clock origin`,()=>{
  const live=fixture(),restored=fixture();live.runtime.setupNpcs();restored.runtime.setupNpcs();const actor=live.runtime.npcs.get('yui');actor.state.randomEventCursor=23;
  for(let i=0;i<5;i++)live.runtime.npcWork(actor);
  const snapshot=JSON.parse(JSON.stringify(live.runtime[kind]()));restored.io.clock=90_000;restored.runtime.restoreWorldState(snapshot);const again=restored.runtime.npcs.get('yui');
  for(let i=0;i<30;i++){live.runtime.npcWork(actor);restored.runtime.npcWork(again);assert.deepEqual(stableState(actor.state),stableState(again.state));}
  live.runtime.applyDecision(actor,decision('idle'));restored.runtime.applyDecision(again,decision('idle'));
  assert.equal(actor.nextDecisionAt-live.io.clock,again.nextDecisionAt-restored.io.clock);assert.equal(actor.state.randomEventCursor,59);assert.equal(snapshot.homeNpcs.find((x:NpcState)=>x.id==='yui').randomEventCursor,28);
});
test('fresh initialization and existing saved fine needs never consume an unrelated active actor cursor',()=>{
  const f=fixture();f.runtime.initializeWorld();const home=f.runtime.npcs.get('yui');home.state.randomEventCursor=42;
  const chunk=[...f.runtime.coarseWorld.chunks.values()].find((x:any)=>planFineChunk(x,24).residents.length>0)!;f.runtime.materializeFineChunk(chunk);
  assert.ok(f.runtime.wildlife.size>0);const id=f.runtime.materializedChunks.get(chunk.id).npcIds[0];const resident=f.runtime.npcs.get(id);resident.state.hunger=3;resident.state.money=123;resident.state.randomEventCursor=14;
  f.runtime.collapseFineChunk(chunk.id);f.runtime.materializeFineChunk(chunk);
  assert.equal(f.runtime.npcs.get(id).state.hunger,3);assert.equal(f.runtime.npcs.get(id).state.money,123);assert.equal(f.runtime.npcs.get(id).state.randomEventCursor,14);assert.equal(home.state.randomEventCursor,42);
});
test('wildlife flee with a live threat uses the same accepted event sequence',()=>{
  const a=fixture(),b=fixture(),left=animalRuntime(),right=animalRuntime();
  for(const f of [a,b])f.runtime.wildlife.set('wolf',animalRuntime(wildlife({id:'wolf',species:'wolf',position:{x:48,z:0}})));
  const intent={action:'flee',targetWildlifeId:'wolf',wildlifeId:'w',confidence:1,source:'fallback',reasonCode:'threat'};
  a.runtime.applyWildlifeDecision(left,intent);b.runtime.applyWildlifeDecision(right,intent);assert.equal(left.state.randomEventCursor,18);assert.deepEqual(left.path,right.path);
});
test('follow-path cursor overflow rejects before target and domestication changes',()=>{
  const f=fixture(),a=animalRuntime(wildlife({species:'sheep',randomEventCursor:Number.MAX_SAFE_INTEGER,targetObjectId:'old',domestication:{ownerId:'player',command:'follow',tameProgress:100,breedingAllowed:false}}));const before=structuredClone(a.state);
  assert.throws(()=>f.runtime.applyOwnedWildlifeCommand(a));assert.deepEqual(a.state,before);assert.deepEqual(a.path,[]);
});
test('all authoritative main random calls require explicit keyed sources',()=>assert.doesNotMatch(source,/Math\.random\s*\(/));

function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const flushAsync=()=>new Promise<void>(resolve=>setImmediate(resolve));
function expireLoad(f:ReturnType<typeof fixture>){
  assert.equal(f.io.timers.size,1);const [id,timer]=[...f.io.timers][0];assert.equal(timer.delay,8000);f.io.timers.delete(id);timer.callback();
}
async function assertProtectedFallback(f:ReturnType<typeof fixture>){
  assert.equal(f.runtime.persistenceReady,true);assert.equal(f.runtime.persistenceLoadBlocked,true);assert.equal(f.runtime.persistenceConflict,false);assert.equal(f.runtime.coarseWorld.worldSeed,random.DEFAULT_WORLD_SEED);assert.equal(f.runtime.npcs.size,10);
  assert.equal(f.io.signals.length,1);assert.equal(f.io.signals[0].aborted,true);assert.equal(f.io.timers.size,0);
  await f.runtime.saveWorldState();f.runtime.flushWorldBeacon();assert.deepEqual(f.io.requests,['/api/world/state']);assert.equal(f.io.beacons.length,0);
}
for(const stage of ['fetch','json'] as const)test(`a never-settling ${stage} load reaches ready default world at its deadline without writing`,async()=>{
  const f=fixture();delete f.runtime.coarseWorld;f.runtime.persistenceReady=false;
  let jsonCalls=0;f.io.wait=stage==='fetch'?new Promise(()=>{}):Promise.resolve({ok:true,json:()=>{jsonCalls++;return new Promise(()=>{});}});
  const loading=f.runtime.initializePersistence();await flushAsync();assert.equal(f.runtime.coarseWorld,undefined);assert.equal(f.runtime.persistenceReady,false);assert.equal(jsonCalls,stage==='json'?1:0);
  expireLoad(f);await loading;await assertProtectedFallback(f);
});
for(const stage of ['fetch','json'] as const)for(const outcome of ['success','failure'] as const)test(`late ${stage} ${outcome} cannot restore, rebuild or unlock a timed-out world`,async()=>{
  const source=fixture('late-seed');source.runtime.setupNpcs();const saved=source.runtime.buildWorldSnapshot();saved.meta.day=19;
  const f=fixture();delete f.runtime.coarseWorld;f.runtime.persistenceReady=false;const response=deferred<any>(),body=deferred<any>();let jsonCalls=0;
  const reply={ok:true,json:()=>{jsonCalls++;return body.promise;}};f.io.wait=stage==='fetch'?response.promise:Promise.resolve(reply);
  const loading=f.runtime.initializePersistence();await flushAsync();expireLoad(f);await loading;await assertProtectedFallback(f);
  const world=f.runtime.coarseWorld,home=f.runtime.npcs.get('mina'),before=stableState(f.runtime.buildWorldSnapshot());
  if(stage==='fetch'){
    if(outcome==='success'){body.resolve({snapshot:saved,revision:19});response.resolve(reply);}else response.reject(new Error('late network failure'));
  }else if(outcome==='success')body.resolve({snapshot:saved,revision:19});else body.reject(new Error('late JSON failure'));
  await flushAsync();assert.equal(f.runtime.coarseWorld,world);assert.equal(f.runtime.npcs.get('mina'),home);assert.deepEqual(stableState(f.runtime.buildWorldSnapshot()),before);
  assert.equal(jsonCalls,stage==='json'?1:0);assert.equal(f.runtime.persistenceRevision,4);await assertProtectedFallback(f);
});
test('load timeout aborts a cooperative transport and clears its timer',async()=>{
  const f=fixture();delete f.runtime.coarseWorld;const waiting=deferred<any>();f.io.wait=waiting.promise;
  const loading=f.runtime.initializePersistence();f.io.signals[0].addEventListener('abort',()=>waiting.reject(new DOMException('aborted','AbortError')),{once:true});
  expireLoad(f);await loading;await assertProtectedFallback(f);await flushAsync();assert.ok(f.io.logs.some(text=>text.includes('load')));assert.ok(f.io.logs.every(text=>!text.includes('conflict')));
});
for(const kind of ['saved','empty','invalid-rng','http-failure'] as const)test(`${kind} settled load clears its deadline and cannot receive a later timeout`,async()=>{
  const f=fixture();delete f.runtime.coarseWorld;f.runtime.persistenceReady=false;
  if(kind==='saved'||kind==='invalid-rng'){
    const source=fixture('selected-seed');source.runtime.setupNpcs();f.io.snapshot=source.runtime.buildWorldSnapshot();
    if(kind==='invalid-rng')Object.assign(f.io.snapshot!.meta.randomness!,{version:2});
  }
  if(kind==='http-failure')f.io.wait=Promise.resolve({ok:false,status:503});
  await f.runtime.initializePersistence();assert.equal(f.io.timers.size,0);assert.equal(f.io.signals[0].aborted,false);assert.equal(f.runtime.persistenceReady,true);assert.equal(f.runtime.npcs.size,10);
  assert.equal(f.runtime.persistenceLoadBlocked,kind==='invalid-rng'||kind==='http-failure');assert.equal(f.runtime.persistenceConflict,false);assert.equal(f.runtime.coarseWorld.worldSeed,kind==='saved'?'selected-seed':random.DEFAULT_WORLD_SEED);assert.deepEqual(f.io.requests,['/api/world/state']);
});

for(const result of ['success','timeout'] as const)test(`Start and held input survive the seed wait and ${result} startup`,async()=>{
  const f=fixture();delete f.runtime.coarseWorld;f.runtime.persistenceReady=false;const pending=deferred<any>();f.io.wait=pending.promise;
  // The constructor installs the actual input method synchronously before starting its GET.
  const declaration=ast.statements.find((node):node is ts.ClassDeclaration=>ts.isClassDeclaration(node)&&node.name?.text==='TownGame')!;
  const constructor=declaration.members.find(ts.isConstructorDeclaration)!.getText(ast);
  assert.ok(constructor.indexOf('this.bindInput()')<constructor.indexOf('this.initializePersistence()'));
  assert.equal(constructor.match(/this\.bindInput\(\)/g)?.length,1);
  f.runtime.bindInput();const loading=f.runtime.initializePersistence();
  f.elements.get('#startBtn')!.dispatchEvent(new Event('click'));
  f.input.dispatchEvent(Object.assign(new Event('keydown'),{code:'KeyW'}));
  assert.equal(f.runtime.controls.isLocked,true);assert.equal(f.hidden.has('hidden'),true);assert.equal(f.runtime.keys.has('KeyW'),true);assert.equal(f.runtime.coarseWorld,undefined);
  if(result==='timeout')expireLoad(f);else pending.resolve({ok:true,json:async()=>({snapshot:null,revision:6})});
  await loading;assert.equal(f.runtime.persistenceReady,true);assert.equal(f.runtime.controls.isLocked,true);assert.equal(f.runtime.keys.has('KeyW'),true);assert.equal(f.runtime.npcs.size,10);
  assert.equal(f.runtime.persistenceLoadBlocked,result==='timeout');assert.equal(f.io.timers.size,0);
  f.input.dispatchEvent(Object.assign(new Event('keyup'),{code:'KeyW'}));assert.equal(f.runtime.keys.size,0);
});

for(const change of ['removed','replaced','owner-command','accepted-event'] as const)for(const failed of [false,true])test(`wildlife ${failed?'failure':'success'} rejects ${change} request ownership without changing current state or deadlines`,async()=>{
  const f=fixture(),old=animalRuntime(wildlife({species:'sheep'}));f.runtime.wildlife.set('w',old);const reply=deferred<any>();f.io.wait=reply.promise;const waiting=f.runtime.requestWildlifeBatch();
  let current=old;
  if(change==='removed')Object.assign(old,{removed:true});
  if(change==='replaced'){Object.assign(old,{removed:true});current=animalRuntime(structuredClone(old.state));f.runtime.wildlife.set('w',current);}
  if(change==='owner-command')current.state.domestication={ownerId:'player',command:'stay',tameProgress:100,breedingAllowed:false};
  if(change==='accepted-event')f.runtime.applyWildlifeDecision(current,{wildlifeId:'w',action:'wander',source:'owner-command',confidence:1,reasonCode:'current'});
  const state=structuredClone(current.state),path=structuredClone(current.path),next=current.nextDecisionAt;
  reply.resolve({ok:!failed,json:async()=>({decisions:[{wildlifeId:'w',action:'wander',source:'fallback',confidence:1,reasonCode:'stale'}]})});await waiting;
  assert.deepEqual(current.state,state);assert.deepEqual(current.path,path);assert.equal(current.nextDecisionAt,next);assert.equal(f.runtime.wildlifeDecisionPending,false);
});
test('wildlife batch accepts each requested ID once and rejects unrequested IDs',async()=>{
  const f=fixture(),a=animalRuntime(),unrequested=animalRuntime(wildlife({id:'other'}));unrequested.nextDecisionAt=10_000;f.runtime.wildlife.set('w',a);f.runtime.wildlife.set('other',unrequested);
  const d={wildlifeId:'w',action:'wander',source:'fallback',confidence:1,reasonCode:'test'};f.io.reply={decisions:[{...d,wildlifeId:'other'},d,d]};
  await f.runtime.requestWildlifeBatch();assert.equal(a.state.randomEventCursor,18);assert.equal(unrequested.state.randomEventCursor,17);assert.deepEqual(unrequested.path,[]);
});
test('ordinary movement and need drift do not invalidate an otherwise current wildlife response',async()=>{
  const f=fixture(),a=animalRuntime();f.runtime.wildlife.set('w',a);const reply=deferred<any>();f.io.wait=reply.promise;const pending=f.runtime.requestWildlifeBatch();
  a.state.position.x+=.5;a.state.hunger+=.01;a.state.energy-=.01;
  reply.resolve({ok:true,json:async()=>({decisions:[{wildlifeId:'w',action:'wander',source:'fallback',confidence:1,reasonCode:'test'}]})});await pending;
  assert.equal(a.state.randomEventCursor,18);assert.equal(a.state.currentAction,'wander');
});

test('a concurrent wildlife batch call cannot issue or clear a newer pending request',async()=>{
  const f=fixture(),a=animalRuntime();f.runtime.wildlife.set('w',a);const reply=deferred<any>();f.io.wait=reply.promise;
  const first=f.runtime.requestWildlifeBatch();await f.runtime.requestWildlifeBatch();assert.equal(f.runtime.wildlifeDecisionPending,true);assert.deepEqual(f.io.requests,['/api/wildlife/decide']);
  reply.resolve({ok:true,json:async()=>({decisions:[{wildlifeId:'w',action:'wander',source:'fallback',confidence:1,reasonCode:'test'}]})});await first;
  assert.equal(f.runtime.wildlifeDecisionPending,false);assert.equal(a.state.randomEventCursor,18);
  f.io.wait=undefined;f.io.reply={decisions:[]};await f.runtime.requestWildlifeBatch();assert.equal(f.io.requests.length,2);assert.equal(f.runtime.wildlifeDecisionPending,false);
});

test('visual construction cannot shift an equivalent accepted authority event sequence',()=>{
 const a=fixture(),b=fixture(),left=npcRuntime(),right=npcRuntime();
 for(let i=0;i<20;i++){
  a.runtime.npcWork(left);
  for(let j=0;j<20;j++)new THREE.Group();
  b.runtime.npcWork(right);assert.deepEqual(left.state,right.state);
 }
 assert.equal(left.state.randomEventCursor,31);
});

test('inactive known visuals never initialize a wake or advance their saved cursor',()=>{
 const f=fixture(),n=npc(),w=wildlife(),before=[stableState(n),stableState(w)];
 const npcView=f.runtime.createFineNpcVisual(n,'female1'),animalView=f.runtime.createWildlifeVisual(w);
 for(const view of [npcView,animalView]){assert.equal(view.removed,true);assert.equal(view.nextDecisionAt,Infinity);}
 assert.deepEqual([n,w],before);assert.equal(f.runtime.npcs.size,0);assert.equal(f.runtime.wildlife.size,0);assert.equal(f.runtime.wildlifeLineage.size,0);
});
