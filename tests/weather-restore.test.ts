import * as npcContinuation from '../src/world/actorContinuation.js';
import * as worldRandom from '../src/world/worldRandom.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';
import {StreamedLayoutRegistry,StreamedLayoutValidationError,readStreamedLayout,assertStreamedLayoutStates} from '../src/world/streamedLayouts.js';
import {restoredPlayerPosition} from '../src/world/portableObjects.js';
import type {WorldPersistenceSnapshot,WorldObjectState,InteractionCapability} from '../src/types.js';
import {validateWorldPersistenceSnapshot,WorldSnapshotValidationError} from '../server/worldSnapshotValidation.js';

// Execute production methods, including interaction, startup and beacon paths.
// Stubs replace only presentation and external IO, not weather or time behavior.
const source=fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const methods=new Set(['buildWorldSnapshot','buildFinalWorldSnapshot','flushWorldBeacon','initializePersistence','restoreWorldState','updateTime','executePlayerInteraction']);
const fields=new Set(['day','minuteOfDay','weather','weatherEpoch','playerPosition','playerInventory','randomness']);
const selected:string[]=[];
for(const node of ast.statements)if(ts.isClassDeclaration(node)&&node.name?.text==='TownGame')for(const member of node.members){
  if((ts.isMethodDeclaration(member)&&methods.has(member.name.getText(ast)))||(ts.isPropertyDeclaration(member)&&fields.has(member.name.getText(ast))))selected.push(member.getText(ast));
}
assert.equal(selected.length,methods.size+fields.size);
const code=ts.transpileModule(`return class Runtime {${selected.join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
type ObjectRuntime={state:WorldObjectState;mesh:THREE.Group};
type Runtime={day:number;minuteOfDay:number;weather:string;weatherEpoch:number;persistenceReady:boolean;persistenceRevision:number;objects:Map<string,ObjectRuntime>;buildWorldSnapshot():WorldPersistenceSnapshot;buildFinalWorldSnapshot():WorldPersistenceSnapshot;flushWorldBeacon():void;initializePersistence():Promise<void>;restoreWorldState(snapshot:WorldPersistenceSnapshot):void;updateTime(dt:number):void;executePlayerInteraction(object:ObjectRuntime,action:InteractionCapability):void};
function fixture(roll=.95){
  let draws=0;
  const io={snapshot:null as WorldPersistenceSnapshot|null,beacons:[] as {url:string;body:Blob}[]};
  const math=Object.create(Math) as Math;math.random=()=>{throw new Error('ambient randomness');};
  const randomDependencies={...npcContinuation,...worldRandom,keyedRandom:()=>()=>{draws++;return roll;}};
  const navigator={sendBeacon:(url:string,body:Blob)=>{io.beacons.push({url,body});return true;}};
  const fetch=async(url:string)=>{assert.equal(url,'/api/world/state');return{ok:true,json:async()=>({snapshot:io.snapshot,revision:6})};};
  const RuntimeClass=new Function(...Object.keys(randomDependencies),'Math','THREE','clamp','restoredPlayerPosition','navigator','fetch','i18n','now','StreamedLayoutValidationError','readStreamedLayout','assertStreamedLayoutStates',code)(...Object.values(randomDependencies),math,THREE,(x:number,min:number,max:number)=>Math.max(min,Math.min(max,x)),restoredPlayerPosition,navigator,fetch,{t:(key:string)=>key},()=>5000,StreamedLayoutValidationError,readStreamedLayout,assertStreamedLayoutStates);
  const runtime:Runtime=new RuntimeClass();
  Object.assign(runtime,{initializeWorld(){},streamedLayouts:new StreamedLayoutRegistry('latticefolk-default'),camera:new THREE.PerspectiveCamera(),sun:{intensity:0},ambient:{intensity:0},scene:new THREE.Scene(),coarseWorld:{chunks:new Map(),restoreKnownChunks(){},ensureWindowAround(){}},groundHeightAt(){return 0},npcs:new Map(),objects:new Map(),fineChunkCache:new Map(),materializedChunks:new Map(),wildlifeLineage:new Map(),wildlifeTransfers:new Map(),lineageEpoch:0,reconcileLineageOffspring(){},event(){},log(){},toast(){},updateFineChunkMaterialization(){},persistenceReady:true,persistenceConflict:false,persistenceRevision:6,portables:{checkpoint:{pending:false},restoreHome(){return false}},cameraMode:'firstPerson',playerOverlapsObjectTrigger(){return true}});
  return{runtime,io,draws:()=>draws};
}
const snapshotKinds=['full','final','beacon'] as const;
async function capture(f:ReturnType<typeof fixture>,kind:typeof snapshotKinds[number]){
  const before={day:f.runtime.day,minute:f.runtime.minuteOfDay,weather:f.runtime.weather,epoch:f.runtime.weatherEpoch,draws:f.draws()};
  let snapshot:WorldPersistenceSnapshot;
  if(kind==='beacon'){
    const count=f.io.beacons.length;f.runtime.flushWorldBeacon();assert.equal(f.io.beacons.length,count+1);
    const beacon=f.io.beacons[count];assert.equal(beacon.url,'/api/world/state');assert.equal(beacon.body.type,'application/json');
    const envelope=JSON.parse(await beacon.body.text());assert.equal(envelope.expectedRevision,6);snapshot=envelope.snapshot;
  }else snapshot=JSON.parse(JSON.stringify(f.runtime[kind==='full'?'buildWorldSnapshot':'buildFinalWorldSnapshot']()));
  assert.deepEqual({day:f.runtime.day,minute:f.runtime.minuteOfDay,weather:f.runtime.weather,epoch:f.runtime.weatherEpoch,draws:f.draws()},before,'capturing a snapshot must not advance simulation or consume randomness');
  return snapshot;
}
async function load(f:ReturnType<typeof fixture>,snapshot:WorldPersistenceSnapshot){f.io.snapshot=snapshot;await f.runtime.initializePersistence();assert.equal(f.runtime.persistenceReady,true);assert.equal(f.runtime.persistenceRevision,6);}
for(const kind of snapshotKinds)for(const minute of [0,359,360,495,719,720,800,1079,1080,1439])for(const weather of ['clear','cloudy','rain']){
  test(`${kind}: saved ${weather} at minute ${minute} survives same-block ticks`,async()=>{
    const live=fixture(),restored=fixture();Object.assign(live.runtime,{day:4,minuteOfDay:minute,weather,weatherEpoch:Math.floor(minute/360)});
    const snapshot=await capture(live,kind),before=structuredClone(snapshot);validateWorldPersistenceSnapshot(snapshot);
    assert.equal(snapshot.meta.weatherEpoch,live.runtime.weatherEpoch);await load(restored,snapshot);
    for(const dt of [0,.05,0,.05]){live.runtime.updateTime(dt);restored.runtime.updateTime(dt);}
    assert.equal(restored.runtime.weather,weather);assert.equal(restored.runtime.weather,live.runtime.weather);assert.equal(restored.runtime.minuteOfDay,live.runtime.minuteOfDay);assert.equal(restored.draws(),0);assert.deepEqual(snapshot,before);
  });
}
for(const kind of snapshotKinds)for(const boundary of [360,720,1080,1440])for(const [roll,weather] of [[.679999,'clear'],[.68,'cloudy'],[.879999,'cloudy'],[.88,'rain']] as const){
  test(`${kind}: crossing ${boundary} with roll ${roll} selects ${weather} once`,async()=>{
    const live=fixture(roll),restored=fixture(roll);Object.assign(live.runtime,{day:4,minuteOfDay:boundary-.01,weather:'clear',weatherEpoch:Math.floor((boundary-.01)/360)});
    await load(restored,await capture(live,kind));live.runtime.updateTime(.05);restored.runtime.updateTime(.05);
    assert.equal(restored.draws(),1);assert.equal(live.draws(),1);assert.equal(restored.runtime.weather,weather);assert.equal(restored.runtime.weather,live.runtime.weather);assert.equal(restored.runtime.day,boundary===1440?5:4);assert.equal(restored.runtime.weatherEpoch,boundary===1440?0:boundary/360);assert.equal(restored.runtime.minuteOfDay,live.runtime.minuteOfDay);
    for(let i=0;i<4;i++)restored.runtime.updateTime(.05);assert.equal(restored.draws(),1);
  });
}
for(const kind of snapshotKinds)for(const [action,minutes] of [['work',12],['rest',15],['sit',15],['sleep',60]] as const){
  test(`${kind}: ${action} across 720 preserves the pending transition before the next frame`,async()=>{
    const live=fixture(),restored=fixture();Object.assign(live.runtime,{day:4,minuteOfDay:719,weather:'clear',weatherEpoch:1});
    const object:ObjectRuntime={state:{id:'time_action',name:'Time action',kind:action==='sleep'?'bed':action==='work'?'workstation':'bench',position:{x:0,z:7},tags:[],usable:true,pickupable:false,capabilities:[action]},mesh:new THREE.Group()};live.runtime.objects.set(object.state.id,object);
    live.runtime.executePlayerInteraction(object,action);assert.equal(live.runtime.minuteOfDay,719+minutes);assert.equal(live.runtime.weatherEpoch,1);
    const snapshot=await capture(live,kind);validateWorldPersistenceSnapshot(snapshot);assert.equal(snapshot.meta.weatherEpoch,1);
    await load(restored,snapshot);assert.equal(restored.runtime.weatherEpoch,1);
    live.runtime.updateTime(0);restored.runtime.updateTime(0);assert.equal(live.draws(),1);assert.equal(restored.draws(),1);assert.equal(restored.runtime.weather,live.runtime.weather);assert.equal(restored.runtime.weather,'rain');assert.equal(restored.runtime.weatherEpoch,2);
    restored.runtime.updateTime(0);assert.equal(restored.draws(),1);
  });
}
for(const kind of snapshotKinds)for(const minute of [0,360,800,1080]){
  test(`${kind}: legacy missing epoch adopts its legal saved weather and current block`,async()=>{
    const saved=fixture(),restored=fixture();Object.assign(saved.runtime,{day:4,minuteOfDay:minute,weather:'cloudy'});
    const snapshot=await capture(saved,kind);delete snapshot.meta.weatherEpoch;delete snapshot.wildlifeLineage;delete snapshot.wildlifeTransfers;validateWorldPersistenceSnapshot(snapshot);
    await load(restored,snapshot);restored.runtime.updateTime(0);assert.equal(restored.runtime.weather,'cloudy');assert.equal(restored.runtime.weatherEpoch,Math.floor(minute/360));assert.equal(restored.draws(),0);assert.equal(restored.runtime.buildWorldSnapshot().meta.weatherEpoch,Math.floor(minute/360));
  });
}
for(const value of [undefined,null,'','storm',17])for(const minute of [0,800]){
  test(`invalid historical weather ${String(value)} at ${minute} is legal before and after its next tick`,async()=>{
    const snapshot=fixture().runtime.buildWorldSnapshot();Object.assign(snapshot.meta,{minuteOfDay:minute,weather:value,weatherEpoch:Math.floor(minute/360)});
    const f=fixture();await load(f,snapshot);assert.equal(f.runtime.weather,'clear');assert.equal(f.runtime.weatherEpoch,-1);assert.equal(f.draws(),0);
    validateWorldPersistenceSnapshot(f.runtime.buildWorldSnapshot());const checkpoint=await capture(f,'beacon');validateWorldPersistenceSnapshot(checkpoint);
    const again=fixture();await load(again,checkpoint);assert.equal(again.runtime.weatherEpoch,-1);
    f.runtime.updateTime(0);again.runtime.updateTime(0);assert.equal(f.runtime.weather,'rain');assert.equal(again.runtime.weather,'rain');assert.equal(f.draws(),1);assert.equal(again.draws(),1);validateWorldPersistenceSnapshot(f.runtime.buildWorldSnapshot());
    f.runtime.updateTime(0);assert.equal(f.draws(),1);
  });
}
for(const value of [null,'2',NaN,Infinity,-Infinity,-2,4,1.5]){
  test(`write validation rejects invalid supplied weatherEpoch ${String(value)}`,()=>{
    const snapshot=fixture().runtime.buildWorldSnapshot();Object.assign(snapshot.meta,{weatherEpoch:value});
    assert.throws(()=>validateWorldPersistenceSnapshot(snapshot),(error:unknown)=>error instanceof WorldSnapshotValidationError&&error.issues.some(issue=>issue.startsWith('snapshot.meta.weatherEpoch:')));
  });
  test(`invalid historical epoch ${String(value)} falls back to its legal saved weather`,()=>{
    const snapshot=fixture().runtime.buildWorldSnapshot();Object.assign(snapshot.meta,{minuteOfDay:800,weather:'cloudy',weatherEpoch:value});
    const f=fixture();f.runtime.restoreWorldState(snapshot);f.runtime.updateTime(0);assert.equal(f.runtime.weather,'cloudy');assert.equal(f.runtime.weatherEpoch,2);assert.equal(f.draws(),0);
  });
}
for(const value of [-1,0,1,2,3])test(`valid supplied epoch ${value} is preserved, even when different from minute block`,()=>{
  const snapshot=fixture().runtime.buildWorldSnapshot();Object.assign(snapshot.meta,{minuteOfDay:800,weather:'cloudy',weatherEpoch:value});validateWorldPersistenceSnapshot(snapshot);
  const f=fixture();f.runtime.restoreWorldState(snapshot);assert.equal(f.runtime.weatherEpoch,value);f.runtime.updateTime(0);assert.equal(f.draws(),value===2?0:1);
});
for(const value of [undefined,null,'800',NaN,Infinity,-Infinity,-1,1440])test(`write validation still rejects invalid minute ${String(value)}`,()=>{
  const snapshot=fixture().runtime.buildWorldSnapshot();Object.assign(snapshot.meta,{minuteOfDay:value});
  assert.throws(()=>validateWorldPersistenceSnapshot(snapshot),(error:unknown)=>error instanceof WorldSnapshotValidationError&&error.issues.some(issue=>issue.startsWith('snapshot.meta.minuteOfDay:')));
});
for(const value of [undefined,null,'','storm',17])test(`write validation still rejects invalid weather ${String(value)}`,()=>{
  const snapshot=fixture().runtime.buildWorldSnapshot();Object.assign(snapshot.meta,{weather:value});
  assert.throws(()=>validateWorldPersistenceSnapshot(snapshot),(error:unknown)=>error instanceof WorldSnapshotValidationError&&error.issues.some(issue=>issue.startsWith('snapshot.meta.weather:')));
});
for(const [value,minute] of [[undefined,0],[null,0],[NaN,0],['not-a-number',0],[-1,0],['800',800]] as const)test(`direct legacy restore retains minute normalization for ${String(value)}`,()=>{
  const snapshot=fixture().runtime.buildWorldSnapshot();Object.assign(snapshot.meta,{minuteOfDay:value,weather:'clear'});delete snapshot.meta.weatherEpoch;
  const f=fixture();f.runtime.restoreWorldState(snapshot);assert.equal(f.runtime.minuteOfDay,minute);assert.equal(f.runtime.weatherEpoch,Math.floor(minute/360));f.runtime.updateTime(0);assert.equal(f.runtime.weather,'clear');assert.equal(f.draws(),0);
});
test('no-save initialization retains original first-tick weather selection',async()=>{
  const f=fixture();await f.runtime.initializePersistence();assert.equal(f.runtime.minuteOfDay,495);assert.equal(f.runtime.weatherEpoch,0);f.runtime.updateTime(0);assert.equal(f.runtime.weather,'rain');assert.equal(f.runtime.weatherEpoch,1);assert.equal(f.draws(),1);f.runtime.updateTime(.05);assert.equal(f.draws(),1);
});
test('unsupported snapshot version retains existing early-return behavior',()=>{
  const f=fixture();Object.assign(f.runtime,{day:9,minuteOfDay:1000,weather:'cloudy',weatherEpoch:2});const snapshot=fixture().runtime.buildWorldSnapshot();Object.assign(snapshot,{version:2});f.runtime.restoreWorldState(snapshot);assert.equal(f.runtime.day,9);assert.equal(f.runtime.minuteOfDay,1000);assert.equal(f.runtime.weather,'cloudy');assert.equal(f.runtime.weatherEpoch,2);assert.equal(f.draws(),0);
});

