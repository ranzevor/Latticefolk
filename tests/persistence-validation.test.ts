import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

import Database from 'better-sqlite3';
import * as THREE from 'three';
import {CoarseWorldRuntime} from '../src/world/coarseWorld.js';
import {createStreamedLayout,layoutIdentity} from '../src/world/streamedLayouts.js';
import {streamedUnitOwnerCells} from '../src/world/streamedUnits.js';
import express from 'express';
import { WorldPersistence, WorldPersistenceConflictError } from '../server/worldPersistence.js';
import { registerWorldStateRoutes } from '../server/worldStateRoutes.js';
import { validateWorldPersistenceSnapshot, WorldSnapshotValidationError, WORLD_SNAPSHOT_LIMITS } from '../server/worldSnapshotValidation.js';
import type { WorldPersistenceSnapshot } from '../src/types.js';

const saveCurrent=(store:WorldPersistence,snapshot:WorldPersistenceSnapshot)=>store.save(snapshot,store.revision());

const inventory={apple:1,bread:1,wood:2,coin:8,flower:0,grain:0,flour:0,water:1,stone:0,plank:0,tool:1};

function validSnapshot():WorldPersistenceSnapshot {
  return {
    version:1,
    meta:{day:8,minuteOfDay:615,weather:'cloudy',playerPosition:{x:48,z:0},playerInventory:{...inventory}},
    coarseChunks:[
      {
        id:'chunk_2_0',cx:2,cz:0,biome:'plains',settlementLevel:1,population:12.25,
        food:62.5,wood:58.25,water:71.75,ecology:69.5,danger:18,prosperity:55,
        strategy:'sustain',migrationPolicy:'retain',ecologyPolicy:'balance',lastDecisionAt:100,decisionVersion:2,
        wildlife:[{species:'rabbit',count:6.5,carryingCapacity:18,health:82,diseaseLoad:3}]
      },
      {
        id:'chunk_3_0',cx:3,cz:0,biome:'forest',settlementLevel:0,population:3,
        food:72,wood:83,water:66,ecology:84,danger:22,prosperity:28,
        strategy:'conserve',migrationPolicy:'attract',ecologyPolicy:'protect',lastDecisionAt:0,decisionVersion:0
      }
    ],
    fineChunks:[{
      chunkId:'chunk_2_0',
      npcStates:[{
        id:'npc_fine',chunkId:'chunk_2_0',name:'Fine',role:'farmer',position:{x:48,z:1},home:{x:47,z:1},
        mood:'calm',hunger:20,energy:80,social:55,money:4,inventory:[],relationships:{},memories:[],
        currentAction:'work',goal:'farm',lastDecisionAt:10
      }],
      objectStates:[{
        id:'fine_crate',chunkId:'chunk_2_0',kind:'crate',name:'Fine crate',position:{x:49,z:1},tags:['storage'],
        usable:true,pickupable:false,capabilities:['inspect','store','take'],storage:[]
      }],
      wildlifeStates:[{
        id:'fine_rabbit',chunkId:'chunk_2_0',species:'rabbit',position:{x:47,z:2},ageDays:45,
        health:90,hunger:20,thirst:18,energy:75,sex:'female',generation:1,
        traits:{speed:2.1,size:.55,fertility:.8,wariness:.7},currentAction:'forage',lastDecisionAt:9,birthDay:4
      }]
    }],
    homeNpcs:[{
      id:'npc_home',name:'Home',role:'resident',position:{x:0,z:2},home:{x:0,z:2},mood:'neutral',
      hunger:15,energy:90,social:60,money:10,inventory:[{kind:'bread',count:1}],relationships:{},memories:[],
      currentAction:'idle',goal:'live',lastDecisionAt:5
    }],
    homeObjects:[{
      id:'home_cart',kind:'cart',name:'Cart',position:{x:0,z:4},tags:['transport'],usable:true,pickupable:false,
      rigidBodyArchetype:'cart',capabilities:['inspect','load','unload'],storage:[]
    }],
    wildlifeLineage:[{
      entityId:'ancestor_rabbit',species:'rabbit',birthDay:1,generation:0,birthChunk:'chunk_2_0',
      traitsAtBirth:{speed:2,size:.5,fertility:.75,wariness:.65},origin:'founder',offspringCount:1,reproductiveSuccess:true
    }],
    wildlifeTransfers:[{
      entityId:'migrant_rabbit',
      state:{
        id:'migrant_rabbit',chunkId:'chunk_3_0',species:'rabbit',position:{x:72,z:1},ageDays:60,
        health:88,hunger:30,thirst:24,energy:68,sex:'male',generation:1,
        traits:{speed:2.2,size:.57,fertility:.78,wariness:.72},currentAction:'migrate',lastDecisionAt:11,birthDay:3,
        representedPopulation:1.25
      },
      fromChunkId:'chunk_2_0',toChunkId:'chunk_3_0',representedPopulation:1.25,transferredDay:8.2
    }]
  };
}

function logicalTables(file:string){
  const db=new Database(file,{readonly:true});
  try{
    return {
      world_control:db.prepare('SELECT * FROM world_control ORDER BY slot').all(),
      world_meta:db.prepare('SELECT * FROM world_meta ORDER BY slot').all(),
      coarse_chunks:db.prepare('SELECT * FROM coarse_chunks ORDER BY id').all(),
      fine_chunks:db.prepare('SELECT * FROM fine_chunks ORDER BY chunk_id').all(),
      home_state:db.prepare('SELECT * FROM home_state ORDER BY slot').all(),
      streamed_layouts:db.prepare('SELECT * FROM streamed_layouts ORDER BY unit_id').all(),
      wildlife_lineage:db.prepare('SELECT * FROM wildlife_lineage ORDER BY entity_id').all(),
      wildlife_transfers:db.prepare('SELECT * FROM wildlife_transfers ORDER BY entity_id').all()
    };
  }finally{db.close();}
}

function invalidCases(){
  return [
    ['missing required homeObjects',(s:any)=>{delete s.homeObjects;}],
    ['nonfinite meta day',(s:any)=>{s.meta.day=Number.NaN;}],
    ['unsupported weather',(s:any)=>{s.meta.weather='hail';}],
    ['negative inventory',(s:any)=>{s.meta.playerInventory.coin=-1;}],
    ['duplicate coarse coordinate',(s:any)=>{s.coarseChunks[1].cx=s.coarseChunks[0].cx;s.coarseChunks[1].cz=s.coarseChunks[0].cz;}],
    ['unsupported coarse enum',(s:any)=>{s.coarseChunks[0].strategy='teleport';}],
    ['out-of-range coarse resource',(s:any)=>{s.coarseChunks[0].food=101;}],
    ['fine entity chunk mismatch',(s:any)=>{s.fineChunks[0].npcStates[0].chunkId='chunk_9_9';}],
    ['invalid NPC role',(s:any)=>{s.fineChunks[0].npcStates[0].role='wizard';}],
    ['invalid object kind',(s:any)=>{s.homeObjects[0].kind='portal';}],
    ['invalid wildlife species',(s:any)=>{s.fineChunks[0].wildlifeStates[0].species='dragon';}],
    ['lineage self-parent',(s:any)=>{s.wildlifeLineage[0].motherId=s.wildlifeLineage[0].entityId;}],
    ['lineage death before birth',(s:any)=>{s.wildlifeLineage[0].deathDay=.5;}],
    ['transfer state id mismatch',(s:any)=>{s.wildlifeTransfers[0].state.id='other';}],
    ['transfer destination mismatch',(s:any)=>{s.wildlifeTransfers[0].state.chunkId='chunk_2_0';}],
    ['transfer same endpoint',(s:any)=>{s.wildlifeTransfers[0].toChunkId=s.wildlifeTransfers[0].fromChunkId;s.wildlifeTransfers[0].state.chunkId=s.wildlifeTransfers[0].fromChunkId;}],
    ['duplicate wildlife identity',(s:any)=>{s.wildlifeTransfers[0].entityId='fine_rabbit';s.wildlifeTransfers[0].state.id='fine_rabbit';}]
  ] as Array<[string,(snapshot:any)=>void]>;
}

test('validator accepts current snapshots and additive legacy omissions',()=>{
  const current=validSnapshot();
  assert.equal(validateWorldPersistenceSnapshot(current),current);

  const legacy=structuredClone(current) as any;
  delete legacy.wildlifeLineage;
  delete legacy.wildlifeTransfers;
  delete legacy.fineChunks[0].wildlifeStates;
  delete legacy.homeObjects[0].rigidBodyArchetype;
  legacy.homeObjects[0].movable=true;
  legacy.homeObjects[0].physicsRadius=.8;
  assert.equal(validateWorldPersistenceSnapshot(legacy),legacy);
});

test('additive legacy version-1 omissions still persist and load without reset',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'latticefolk-validation-legacy-'));
  const file=path.join(dir,'world.sqlite');
  const store=new WorldPersistence(file);
  try{
    const legacy=structuredClone(validSnapshot()) as any;
    delete legacy.wildlifeLineage;
    delete legacy.wildlifeTransfers;
    delete legacy.fineChunks[0].wildlifeStates;
    delete legacy.homeObjects[0].rigidBodyArchetype;
    legacy.homeObjects[0].movable=true;
    legacy.homeObjects[0].physicsRadius=.8;
    saveCurrent(store,legacy);
    const loaded=store.load();
    assert.ok(loaded);
    assert.equal(loaded.version,1);
    assert.equal(loaded.fineChunks[0]?.wildlifeStates?.length,0);
    assert.deepEqual(loaded.wildlifeLineage,[]);
    assert.deepEqual(loaded.wildlifeTransfers,[]);
    assert.equal(loaded.homeObjects[0]?.movable,true);
    assert.equal(loaded.homeObjects[0]?.physicsRadius,.8);
  }finally{
    store.close();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('validator reports actionable failures across authoritative snapshot domains',()=>{
  for(const [name,mutate] of invalidCases()){
    const candidate=structuredClone(validSnapshot()) as any;
    mutate(candidate);
    assert.throws(
      ()=>validateWorldPersistenceSnapshot(candidate),
      error=>error instanceof WorldSnapshotValidationError&&error.issues.length>0,
      name
    );
  }
});

test('oversized snapshot collections are rejected before per-entry traversal',()=>{
  const candidate=validSnapshot() as any;
  candidate.homeNpcs=new Array(WORLD_SNAPSHOT_LIMITS.homeNpcs+1).fill(null);
  assert.throws(
    ()=>validateWorldPersistenceSnapshot(candidate),
    error=>error instanceof WorldSnapshotValidationError&&error.issues.some(issue=>issue.includes('too many entries'))
  );
});

test('WorldPersistence rejects malformed direct writes without changing any logical table',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'latticefolk-validation-store-'));
  const file=path.join(dir,'world.sqlite');
  const store=new WorldPersistence(file);
  try{
    saveCurrent(store,validSnapshot());
    const before=logicalTables(file);
    for(const [name,mutate] of invalidCases()){
      const candidate=structuredClone(validSnapshot()) as any;
      mutate(candidate);
      assert.throws(()=>saveCurrent(store,candidate),WorldSnapshotValidationError,name);
      assert.deepEqual(logicalTables(file),before,`${name} mutated SQLite state`);
    }
  }finally{
    store.close();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('HTTP world-state route accepts valid writes and rejects malformed writes without mutation',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'latticefolk-validation-http-'));
  const file=path.join(dir,'world.sqlite');
  const store=new WorldPersistence(file);
  const app=express();
  app.use(express.json({limit:'2mb'}));
  registerWorldStateRoutes(app,store);
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>((resolve,reject)=>{server.once('listening',()=>resolve());server.once('error',reject);});
  const address=server.address() as AddressInfo;
  const base=`http://127.0.0.1:${address.port}`;

  try{
    const valid=validSnapshot();
    const saved=await fetch(`${base}/api/world/state`,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({snapshot:valid,expectedRevision:store.revision()})
    });
    assert.equal(saved.status,200);
    const before=logicalTables(file);

    const malformed=structuredClone(valid) as any;
    malformed.coarseChunks[0].biome='ocean';
    malformed.homeObjects[0].position.x=null;
    const rejected=await fetch(`${base}/api/world/state`,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({snapshot:malformed,expectedRevision:store.revision()})
    });
    assert.equal(rejected.status,400);
    const body=await rejected.json() as {error?:string;details?:string[]};
    assert.equal(body.error,'Invalid world persistence payload');
    assert.ok(body.details?.some(detail=>detail.includes('coarseChunks[0].biome')));
    assert.ok(body.details?.some(detail=>detail.includes('homeObjects[0].position.x')));
    assert.deepEqual(logicalTables(file),before);

    const missingRevision=await fetch(`${base}/api/world/state`,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({snapshot:valid})
    });
    assert.equal(missingRevision.status,400);

    const stale=structuredClone(valid);
    stale.meta.day=99;
    const staleWrite=await fetch(`${base}/api/world/state`,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({snapshot:stale,expectedRevision:0})
    });
    assert.equal(staleWrite.status,409);
    const conflict=await staleWrite.json() as {expectedRevision?:number;currentRevision?:number};
    assert.equal(conflict.expectedRevision,0);
    assert.equal(conflict.currentRevision,1);
    assert.deepEqual(logicalTables(file),before);

    const loaded=await fetch(`${base}/api/world/state`);
    assert.equal(loaded.status,200);
    const response=await loaded.json() as {snapshot?:WorldPersistenceSnapshot|null;revision?:number};
    assert.equal(response.revision,1);
    assert.equal(response.snapshot?.coarseChunks[0]?.id,'chunk_2_0');
    assert.equal(response.snapshot?.homeObjects[0]?.id,'home_cart');
  }finally{
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    store.close();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});


test('revision CAS rejects stale snapshots atomically and survives explicit reset without ABA',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'latticefolk-revision-cas-'));
  const file=path.join(dir,'world.sqlite');
  const store=new WorldPersistence(file);
  try{
    const initial=validSnapshot();
    const first=store.save(initial,0);
    assert.equal(first.revision,1);

    const newer=structuredClone(initial);
    newer.meta.day=9;
    newer.coarseChunks[0]!.food=77.25;
    newer.fineChunks[0]!.objectStates[0]!.name='Newer crate';
    newer.wildlifeLineage![0]!.habitatExposure={
      observedDays:4,
      habitatMean:{ecology:70,food:64,water:72,danger:17,settlementLevel:1,plantBiomass:68},
      biomeDays:{plains:4},
      chunkDays:{chunk_2_0:4},
      observedTransitions:0
    };
    newer.wildlifeTransfers![0]!.state.health=93;
    const second=store.save(newer,1);
    assert.equal(second.revision,2);

    const beforeStale=logicalTables(file);
    const stale=structuredClone(initial);
    stale.meta.day=3;
    stale.coarseChunks.splice(1,1);
    stale.fineChunks[0]!.objectStates[0]!.name='Stale crate';
    stale.wildlifeLineage![0]!.habitatExposure={
      observedDays:1,
      habitatMean:{ecology:20,food:10,water:20,danger:90,settlementLevel:1,plantBiomass:15},
      biomeDays:{plains:1},
      chunkDays:{chunk_2_0:1},
      observedTransitions:0
    };
    stale.wildlifeTransfers=[];
    assert.throws(
      ()=>store.save(stale,1),
      error=>error instanceof WorldPersistenceConflictError
        &&error.expectedRevision===1&&error.currentRevision===2
    );
    assert.deepEqual(logicalTables(file),beforeStale,'stale conflict mutated authoritative SQLite tables');
    assert.equal(store.load()?.meta.day,9);
    assert.equal(store.load()?.coarseChunks.some(chunk=>chunk.id==='chunk_3_0'),true);
    assert.equal(store.load()?.fineChunks[0]?.objectStates[0]?.name,'Newer crate');
    assert.equal(store.load()?.wildlifeLineage?.[0]?.habitatExposure?.observedDays,4);
    assert.equal(store.load()?.wildlifeTransfers?.[0]?.state.health,93);

    const cleared=store.clear();
    assert.equal(cleared.revision,3);
    assert.equal(store.load(),null);
    assert.throws(
      ()=>store.save(newer,2),
      error=>error instanceof WorldPersistenceConflictError
        &&error.expectedRevision===2&&error.currentRevision===3
    );
    assert.equal(store.load(),null,'pre-reset writer resurrected a cleared world');
    assert.equal(store.revision(),3);
  }finally{
    store.close();
  }

  const reopened=new WorldPersistence(file);
  try{
    assert.equal(reopened.revision(),3,'revision must survive process/store reopen');
    assert.equal(reopened.load(),null);
  }finally{
    reopened.close();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('pre-revision version-1 SQLite data gains revision zero without resetting the save',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'latticefolk-revision-upgrade-'));
  const file=path.join(dir,'world.sqlite');
  const legacy=new Database(file);
  const meta=validSnapshot().meta;
  legacy.exec(`
    CREATE TABLE world_meta (
      slot TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      meta_json TEXT NOT NULL,
      saved_at INTEGER NOT NULL
    );
  `);
  legacy.prepare('INSERT INTO world_meta(slot,version,meta_json,saved_at) VALUES(?,?,?,?)')
    .run('default',1,JSON.stringify(meta),123456);
  legacy.close();

  const store=new WorldPersistence(file);
  try{
    assert.equal(store.revision(),0);
    const loaded=store.load();
    assert.ok(loaded);
    assert.equal(loaded.meta.day,meta.day);
    assert.equal(loaded.savedAt,123456);
    const saved=store.save(loaded,0);
    assert.equal(saved.revision,1);
    assert.equal(store.load()?.meta.day,meta.day);
  }finally{
    store.close();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});


test('additive NPC heading persists for home/fine characters and rejects nonfinite orientation',()=>{
  const store=new WorldPersistence(':memory:');
  try {
    const legacy=validSnapshot();saveCurrent(store,legacy);
    assert.equal(store.load()!.homeNpcs![0].heading,undefined);
    const current=validSnapshot();current.homeNpcs![0].heading=-1.83;current.fineChunks[0].npcStates[0].heading=2.1;
    saveCurrent(store,current);
    assert.equal(store.load()!.homeNpcs![0].heading,-1.83);
    assert.equal(store.load()!.fineChunks[0].npcStates[0].heading,2.1);
    const revision=store.revision();
    for(const heading of [NaN,Infinity,-Infinity,'east',null]) {
      const invalid=structuredClone(current);(invalid.homeNpcs![0] as unknown as {heading:unknown}).heading=heading;
      assert.throws(()=>saveCurrent(store,invalid),WorldSnapshotValidationError);
      assert.equal(store.revision(),revision);assert.equal(store.load()!.homeNpcs![0].heading,-1.83);
    }
  } finally {store.close();}
});

for(const value of [null,{},[],{version:2,seed:'s'},{version:'1',seed:'s'},{version:1,seed:17},{version:1,seed:''},{version:1,seed:' '},{version:1,seed:'x'.repeat(257)}])test(`reject invalid randomness metadata ${JSON.stringify(value)}`,()=>{
  const snapshot=validSnapshot();Object.assign(snapshot.meta,{randomness:value});
  assert.throws(()=>validateWorldPersistenceSnapshot(snapshot),WorldSnapshotValidationError);
});
for(const where of ['home','fine-npc','fine-wildlife','transfer'])for(const value of [null,'0',-1,.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])test(`${where} rejects invalid random cursor ${String(value)}`,()=>{
  const snapshot=validSnapshot();const state=where==='home'?snapshot.homeNpcs[0]:where==='fine-npc'?snapshot.fineChunks[0].npcStates[0]:where==='fine-wildlife'?snapshot.fineChunks[0].wildlifeStates![0]:snapshot.wildlifeTransfers![0].state;
  Object.assign(state,{randomEventCursor:value});assert.throws(()=>validateWorldPersistenceSnapshot(snapshot),WorldSnapshotValidationError);
});
test('legacy fields and safe integer cursor bounds remain valid',()=>{
  const snapshot=validSnapshot();validateWorldPersistenceSnapshot(snapshot);
  snapshot.meta.randomness={version:1,seed:'saved-seed'};
  snapshot.homeNpcs[0].randomEventCursor=Number.MAX_SAFE_INTEGER;snapshot.fineChunks[0].npcStates[0].randomEventCursor=0;
  snapshot.fineChunks[0].wildlifeStates![0].randomEventCursor=13;snapshot.wildlifeTransfers![0].state.randomEventCursor=28;
  assert.equal(validateWorldPersistenceSnapshot(snapshot),snapshot);
});
test('seeded SQLite rows preserve random authority, CAS priority and rejected-write atomicity',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'latticefolk-random-authority-')),file=path.join(dir,'world.sqlite');let store:WorldPersistence|undefined;
  try{
    store=new WorldPersistence(file);const snapshot=validSnapshot();
    snapshot.meta.randomness={version:1,seed:'saved-seed'};
    snapshot.homeNpcs[0].randomEventCursor=7;snapshot.fineChunks[0].npcStates[0].randomEventCursor=13;
    snapshot.fineChunks[0].wildlifeStates![0].randomEventCursor=17;snapshot.wildlifeTransfers![0].state.randomEventCursor=29;
    saveCurrent(store,snapshot);const revision=store.revision();const before=logicalTables(file);
    for(const mutation of [(s:WorldPersistenceSnapshot)=>{delete s.meta.randomness;},(s:WorldPersistenceSnapshot)=>{s.meta.randomness!.seed='other';}]){
      const bad=structuredClone(snapshot);mutation(bad);
      assert.throws(()=>store!.save(bad,revision-1),WorldPersistenceConflictError);
      assert.deepEqual(logicalTables(file),before);
      assert.throws(()=>store!.save(bad,revision),WorldSnapshotValidationError);
      assert.deepEqual(logicalTables(file),before);
    }
    for(const mutation of [(s:WorldPersistenceSnapshot)=>Object.assign(s.meta.randomness!,{version:2}),(s:WorldPersistenceSnapshot)=>{s.homeNpcs[0].randomEventCursor=-1;}]){
      const bad=structuredClone(snapshot);mutation(bad);assert.throws(()=>saveCurrent(store!,bad),WorldSnapshotValidationError);assert.deepEqual(logicalTables(file),before);
    }
    const final=structuredClone(snapshot);final.coarseChunks=[];final.fineChunks=[];final.homeNpcs[0].randomEventCursor=11;
    saveCurrent(store,final);store.close();store=new WorldPersistence(file);const loaded=store.load()!;
    assert.deepEqual(loaded.meta.randomness,snapshot.meta.randomness);assert.equal(loaded.homeNpcs[0].randomEventCursor,11);
    assert.equal(loaded.fineChunks[0].npcStates[0].randomEventCursor,13);assert.equal(loaded.fineChunks[0].wildlifeStates![0].randomEventCursor,17);
    assert.equal(loaded.wildlifeTransfers![0].state.randomEventCursor,29);assert.deepEqual(loaded.fineChunks,snapshot.fineChunks);
    store.clear();const legacy=validSnapshot();saveCurrent(store,legacy);legacy.meta.randomness={version:1,seed:'different'};
    assert.throws(()=>saveCurrent(store!,legacy),WorldSnapshotValidationError);
    legacy.meta.randomness.seed='latticefolk-default';saveCurrent(store,legacy);assert.deepEqual(store.load()!.meta.randomness,legacy.meta.randomness);
  }finally{store?.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('custom seed, 72m layouts and all actor cursors survive reopen and compact checkpoints atomically',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lattice-random-layout-')),file=path.join(directory,'world.sqlite');
 let store=new WorldPersistence(file);
 try{
  const snapshot=validSnapshot(),seed='world-2',world=new CoarseWorldRuntime(new THREE.Scene(),seed);
  const cells=streamedUnitOwnerCells(1,0).map(c=>world.ensureChunk(c.cx,c.cz)!);
  const generated=createStreamedLayout(1,0,cells,[],seed),initialActors=snapshot.fineChunks[0];
  for(const b of generated.layout.buildings)generated.objectStates.push({id:b.id,chunkId:b.ownerCellId,kind:'building',name:b.name,position:b.frontage,tags:['building'],usable:true,pickupable:false});
  for(const road of generated.layout.roads)generated.objectStates.push({id:road.id,chunkId:road.ownerCellId,kind:'road',name:road.name,position:{x:road.x,z:road.z},tags:road.tags,usable:true,pickupable:false});
  initialActors.npcStates[0].randomEventCursor=17;initialActors.wildlifeStates![0].randomEventCursor=23;
  snapshot.homeNpcs[0].randomEventCursor=19;snapshot.wildlifeTransfers![0].state.randomEventCursor=29;
  snapshot.meta.randomness={version:1,seed};snapshot.meta.streamedLayoutVersion=1;snapshot.streamedLayouts=[generated.layout];snapshot.coarseChunks=cells;
  snapshot.fineChunks=cells.map(cell=>({chunkId:cell.id,dynamicActivated:cell.id===initialActors.chunkId,
   npcStates:cell.id===initialActors.chunkId?initialActors.npcStates:[],wildlifeStates:cell.id===initialActors.chunkId?initialActors.wildlifeStates:[],
   objectStates:generated.objectStates.filter(state=>state.chunkId===cell.id)}));
  store.save(snapshot,0);store.close();store=new WorldPersistence(file);const loaded=store.load()!;
  assert.deepEqual(loaded.meta.randomness,{version:1,seed});assert.equal(layoutIdentity(loaded.streamedLayouts),layoutIdentity(snapshot.streamedLayouts));
  const compact=structuredClone(loaded);delete compact.streamedLayouts;compact.fineChunks=[];compact.coarseChunks=[];delete compact.wildlifeLineage;
  compact.homeNpcs[0].randomEventCursor=20;compact.wildlifeTransfers![0].state.randomEventCursor=30;store.save(compact,store.revision());
  store.close();store=new WorldPersistence(file);const durable=store.load()!,revision=store.revision(),before=logicalTables(file);
  assert.deepEqual(durable.fineChunks,loaded.fineChunks);assert.equal(layoutIdentity(durable.streamedLayouts),layoutIdentity(loaded.streamedLayouts));
  const row=durable.fineChunks.find(row=>row.chunkId===initialActors.chunkId)!;assert.equal(row.dynamicActivated,true);
  assert.equal(row.npcStates[0].randomEventCursor,17);assert.equal(row.wildlifeStates![0].randomEventCursor,23);
  assert.equal(durable.homeNpcs[0].randomEventCursor,20);assert.equal(durable.wildlifeTransfers![0].state.randomEventCursor,30);
  const reject=(bad:WorldPersistenceSnapshot)=>{assert.throws(()=>store.save(bad,revision-1),WorldPersistenceConflictError);assert.throws(()=>store.save(bad,revision),WorldSnapshotValidationError);assert.deepEqual(logicalTables(file),before);};
  for(const field of ['randomness','streamedLayoutVersion'] as const){const bad=structuredClone(compact);delete bad.meta[field];reject(bad);}
  const changedSeed=structuredClone(compact);changedSeed.meta.randomness!.seed='another';reject(changedSeed);
  const geometry=structuredClone(durable);geometry.streamedLayouts![0].roads[0].w-=.1;reject(geometry);
  const lostState=structuredClone(durable);const staticId=lostState.streamedLayouts![0].objects[0].id;
  for(const row of lostState.fineChunks)row.objectStates=row.objectStates.filter(s=>s.id!==staticId);reject(lostState);
  const deactivated=structuredClone(durable),changed=deactivated.fineChunks.find(row=>row.chunkId===initialActors.chunkId)!;changed.dynamicActivated=false;changed.npcStates=[];changed.wildlifeStates=[];reject(deactivated);
  const inserted=structuredClone(durable),other=streamedUnitOwnerCells(2,0).map(c=>world.ensureChunk(c.cx,c.cz)!);inserted.streamedLayouts!.push(createStreamedLayout(2,0,other,[],seed).layout);reject(inserted);
  for(const mutate of [(s:WorldPersistenceSnapshot)=>{s.streamedLayouts![0].seed='mismatch';},(s:WorldPersistenceSnapshot)=>{s.homeNpcs[0].randomEventCursor=-1;}]){
   const invalid=structuredClone(durable);mutate(invalid);assert.throws(()=>store.save(invalid,revision),WorldSnapshotValidationError);assert.deepEqual(logicalTables(file),before);
  }
 }finally{store.close();fs.rmSync(directory,{recursive:true,force:true});}
});

for(const field of ['npc_json','object_json','wildlife_json'])for(const payload of ['{broken','null','{}']){
  test(`corrupt fine ${field} ${payload} blocks load and later save`,()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'latticefolk-corrupt-fine-'));
    const file=path.join(dir,'world.sqlite'),store=new WorldPersistence(file),db=new Database(file);
    try{
      const snapshot=validSnapshot();store.save(snapshot,0);
      db.prepare(`UPDATE fine_chunks SET ${field}=? WHERE chunk_id=?`).run(payload,'chunk_2_0');
      const before=logicalTables(file);
      assert.throws(()=>store.load(),error=>error instanceof Error&&error.message.includes('fine_chunks')&&error.message.includes(field));
      assert.throws(()=>store.save({...snapshot,wildlifeTransfers:[]},1));
      assert.deepEqual(logicalTables(file),before);
    }finally{db.close();store.close();fs.rmSync(dir,{recursive:true,force:true});}
  });
}
for(const payload of ['{broken','null','[]'])test(`corrupt transfer ${payload} cannot be pruned by later save`,()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'latticefolk-corrupt-transfer-'));
  const file=path.join(dir,'world.sqlite'),store=new WorldPersistence(file),db=new Database(file);
  try{
    const snapshot=validSnapshot();store.save(snapshot,0);
    db.prepare('UPDATE wildlife_transfers SET transfer_json=? WHERE entity_id=?').run(payload,'migrant_rabbit');
    const before=logicalTables(file);
    assert.throws(()=>store.load(),error=>error instanceof Error&&error.message.includes('wildlife_transfers')&&error.message.includes('transfer_json'));
    assert.throws(()=>store.save({...snapshot,wildlifeTransfers:[]},1));
    assert.deepEqual(logicalTables(file),before);
  }finally{db.close();store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('repaired persisted JSON permits a fresh load and the unchanged CAS save',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'latticefolk-corrupt-repair-'));
  const file=path.join(dir,'world.sqlite'),store=new WorldPersistence(file),db=new Database(file);
  try{
    const snapshot=validSnapshot();store.save(snapshot,0);
    db.prepare('UPDATE fine_chunks SET npc_json=? WHERE chunk_id=?').run('{broken','chunk_2_0');
    assert.throws(()=>store.save(snapshot,1));
    assert.equal(store.revision(),1);
    db.prepare('UPDATE fine_chunks SET npc_json=? WHERE chunk_id=?').run(JSON.stringify(snapshot.fineChunks[0].npcStates),'chunk_2_0');
    assert.equal(store.load()!.fineChunks[0].npcStates[0].id,'npc_fine');
    assert.equal(store.save(snapshot,1).revision,2);
  }finally{db.close();store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('world-state handlers return bounded corruption failures for load and write',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'latticefolk-corrupt-route-'));
  const file=path.join(dir,'world.sqlite'),store=new WorldPersistence(file),db=new Database(file);
  const handlers=new Map<string,Function>();
  const app={get:(_path:string,fn:Function)=>handlers.set('get',fn),post:(_path:string,fn:Function)=>handlers.set('post',fn),delete:()=>{}};
  registerWorldStateRoutes(app as unknown as express.Express,store);
  try{
    const snapshot=validSnapshot();store.save(snapshot,0);
    const privateValue='{private-row-content';
    db.prepare('UPDATE wildlife_transfers SET transfer_json=?').run(privateValue);
    const before=logicalTables(file);
    for(const method of ['get','post']){
      let status=200,body:any;
      const res={status:(value:number)=>{status=value;return res;},json:(value:unknown)=>{body=value;return res;}};
      handlers.get(method)!({body:{snapshot:{...snapshot,wildlifeTransfers:[]},expectedRevision:1}},res);
      assert.equal(status,500);assert.equal(body.snapshot,undefined);
      assert.match(body.error,/wildlife_transfers\[migrant_rabbit\]\.transfer_json/);
      assert.equal(body.error.includes(privateValue),false);
      assert.deepEqual(logicalTables(file),before);
    }
  }finally{db.close();store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

const otherStoredFields:Array<[string,string,string,string]>=[
  ['world_meta','slot','default','meta_json'],['coarse_chunks','id','chunk_2_0','state_json'],
  ['home_state','slot','default','npc_json'],['home_state','slot','default','object_json'],
  ...['traits_at_birth_json','traits_at_death_json','phenotype_at_birth_json','phenotype_at_death_json',
    'organism_genome_at_birth_json','organism_genome_at_death_json','domestication_at_birth_json','domestication_at_death_json',
    'birth_habitat_json','death_habitat_json','habitat_exposure_json','migration_history_json','predation_outcomes_json']
    .map(field=>['wildlife_lineage','entity_id','ancestor_rabbit',field] as [string,string,string,string])
];
for(const [table,key,id,field] of otherStoredFields)test(`corrupt ${table}.${field} fails closed`,()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'latticefolk-corrupt-json-'));
  const file=path.join(dir,'world.sqlite'),store=new WorldPersistence(file),db=new Database(file);
  try{
    const snapshot=validSnapshot();store.save(snapshot,0);
    db.prepare(`UPDATE ${table} SET ${field}=? WHERE ${key}=?`).run('{private-invalid-json',id);
    const before=logicalTables(file);
    assert.throws(()=>store.load(),error=>error instanceof Error&&error.message.includes(table)&&error.message.includes(field)&&!error.message.includes('private-invalid'));
    assert.throws(()=>store.save({...snapshot,wildlifeTransfers:[]},1));
    assert.deepEqual(logicalTables(file),before);
  }finally{db.close();store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('corrupt streamed layout identifies its stored row and cannot be overwritten',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'latticefolk-corrupt-layout-'));
  const file=path.join(dir,'world.sqlite'),store=new WorldPersistence(file),db=new Database(file);
  try{
    const snapshot=validSnapshot();store.save(snapshot,0);
    db.prepare('INSERT INTO streamed_layouts(unit_id,layout_json) VALUES(?,?)').run('bad-unit','{private-invalid-json');
    const before=logicalTables(file);
    assert.throws(()=>store.load(),/streamed_layouts\[bad-unit\]\.layout_json/);
    assert.throws(()=>store.save(snapshot,1));assert.deepEqual(logicalTables(file),before);
  }finally{db.close();store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
