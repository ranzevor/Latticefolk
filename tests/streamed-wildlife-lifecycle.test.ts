import * as npcContinuation from '../src/world/actorContinuation.js';
import * as worldRandom from '../src/world/worldRandom.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';
import {StreamedActors} from '../src/scene/streamedActors.js';
import * as migration from '../src/world/fineWildlifeMigration.js';
import {normalizeWildlifePhenotype,wildlifeFunctionalPhenotype} from '../src/world/wildlifePhenotype.js';
import {normalizeWildlifeOrganismGenome} from '../src/world/organismFamilies.js';
import {normalizeWildlifeDomestication} from '../src/world/domestication.js';
const ast=ts.createSourceFile('main.ts',fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const names=new Set(['spawnWildlife','createWildlifeVisual','completeFineWildlifeMigration','materializePendingWildlifeTransfers','removeWildlife']);
const members:string[]=[];for(const n of ast.statements)if(ts.isClassDeclaration(n)&&n.name?.text==='TownGame')for(const m of n.members)if(ts.isMethodDeclaration(m)&&names.has(m.name.getText(ast)))members.push(m.getText(ast));
assert.equal(members.length,names.size);
const code=ts.transpileModule(`return class Runtime {${members.join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const fine=(chunkId:string)=>({chunkId,wildlifeIds:[] as string[],initialWildlifeIds:new Set<string>(),fixedWildlifeWeights:new Map(),initialWildlifeCounts:{} as Record<string,number>,groups:[]});
function fixture(){
 const deps={...npcContinuation,...worldRandom,THREE,clamp:(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n)),...migration,normalizeWildlifePhenotype,wildlifeFunctionalPhenotype,normalizeWildlifeOrganismGenome,normalizeWildlifeDomestication,now:()=>1000,i18n:{t:(x:string)=>x}};
 const Runtime=new Function(...Object.keys(deps),code)(...Object.values(deps)),r=new Runtime();
 const source={id:'chunk_2_0',cx:2,cz:0,biome:'plains',wildlife:[{species:'sheep',count:10,carryingCapacity:20,diseaseLoad:0}]};
 const target={id:'chunk_3_0',cx:3,cz:0,biome:'plains',wildlife:[{species:'sheep',count:2,carryingCapacity:20,diseaseLoad:0}]};
 const releases:string[]=[],bindings=new Map();
 Object.assign(r,{randomness:worldRandom.readWorldRandomness(undefined),scene:new THREE.Scene(),day:1,minuteOfDay:495,lineageEpoch:0,wildlife:new Map(),wildlifeTransfers:new Map(),wildlifeLineage:new Map(),materializedChunks:new Map([[source.id,fine(source.id)]]),
  coarseWorld:{chunks:new Map([[source.id,source],[target.id,target]])},groundHeightAt:()=>0,makeProceduralAnimal:()=>new THREE.Group(),
  beginWildlifeHabitatObservation(){},endWildlifeHabitatObservation(){},recordWildlifeHabitatExposure(){},wildlifeHabitatSnapshot:()=>({}),
  ensureWildlifeLineage(s:any){let record=this.wildlifeLineage.get(s.id);if(!record){record={entityId:s.id,species:s.species};this.wildlifeLineage.set(s.id,record);}return record;},
  randomPassableNear:(p:any)=>({...p}),wildlifeName:(s:string)=>s,event(){},log(){},wildlifePresentation:{register(a:any){bindings.set(a.state.id,a);},
   rebind(a:any,b:any){if(bindings.get(a.state.id)!==a||a.mesh!==b.mesh)return false;bindings.set(b.state.id,b);return true;},
   remove(a:any){if(bindings.get(a.state.id)!==a)return false;bindings.delete(a.state.id);releases.push(a.state.id);return true;}}});
 r.streamedWildlife=new StreamedActors<any>((a:any)=>{r.wildlifePresentation.remove(a);a.mesh.removeFromParent();});
 const state={id:'sheep-known',chunkId:source.id,species:'sheep',position:{x:58,z:0},ageDays:2,health:82,hunger:25,thirst:20,energy:85,diseaseLoad:0,sex:'female',generation:0,traits:{speed:1,size:.58,fertility:1,wariness:1},currentAction:'wander',lastDecisionAt:0,birthDay:1,domestication:{ownerId:'player',tameProgress:100,command:'follow',breedingAllowed:false}};
 assert.equal(r.spawnWildlife(state),true);const actor=r.wildlife.get(state.id),runtime=r.materializedChunks.get(source.id);
 runtime.wildlifeIds.push(state.id);runtime.initialWildlifeIds.add(state.id);runtime.initialWildlifeCounts.sheep=1;
 return {r,actor,source,target,releases,bindings};
}
test('deferred migration keeps one checkpoint and reuses its visual only after accepted entry',()=>{
 const {r,actor,source,target,releases}=fixture(),mesh=actor.mesh,total=source.wildlife[0].count+target.wildlife[0].count;
 assert.equal(r.completeFineWildlifeMigration(actor,target.id,'owner_follow',{x:60.5,z:0}),true);
 assert.equal(source.wildlife[0].count+target.wildlife[0].count,total);assert.equal(r.wildlife.has(actor.state.id),false);assert.equal(actor.removed,true);
 const transfer=r.wildlifeTransfers.get(actor.state.id),visual=r.streamedWildlife.get(actor.state.id);
 assert.equal(r.wildlifeTransfers.size,1);assert.equal(visual.mesh,mesh);assert.equal(mesh.visible,false);assert.equal(visual.state.chunkId,target.id);
 assert.equal(r.completeFineWildlifeMigration(actor,target.id),false);assert.equal(r.wildlifeLineage.get(actor.state.id).migrationHistory.length,1);
 r.materializedChunks.delete(source.id);const destination=fine(target.id);r.materializedChunks.set(target.id,destination);
 r.materializePendingWildlifeTransfers(target,destination,[transfer]);
 const current=r.wildlife.get(actor.state.id);assert.notEqual(current,actor);assert.equal(current.mesh,mesh);assert.equal(mesh.visible,true);
 assert.equal(current.state.chunkId,target.id);assert.equal(r.wildlifeTransfers.size,0);assert.equal(destination.wildlifeIds.length,1);
 r.materializePendingWildlifeTransfers(target,destination,[transfer]);assert.equal(destination.wildlifeIds.length,1);
 assert.equal(source.wildlife[0].count+target.wildlife[0].count,total);assert.deepEqual(releases,[]);
});
test('death releases the current visual once and cannot revive from a stale saved state',()=>{
 const {r,actor,releases}=fixture(),saved=structuredClone(actor.state);let removed=0;actor.mesh.addEventListener('removed',()=>removed++);
 r.removeWildlife(actor,'disease');r.removeWildlife(actor,'disease');
 assert.equal(r.wildlife.has(actor.state.id),false);assert.equal(r.streamedWildlife.get(actor.state.id),undefined);assert.equal(actor.mesh.parent,null);
 assert.equal(removed,1);assert.deepEqual(releases,[actor.state.id]);assert.ok(r.wildlifeLineage.get(actor.state.id).deathDay!==undefined);
 assert.equal(r.spawnWildlife(saved),false);assert.equal(r.streamedWildlife.get(actor.state.id),undefined);
});
test('a deferred visual leaving the visible owners releases once without removing the transfer',()=>{
 const {r,actor,target,releases}=fixture();r.completeFineWildlifeMigration(actor,target.id,'owner_follow',{x:60.5,z:0});
 const transfer=r.wildlifeTransfers.get(actor.state.id);r.streamedWildlife.retain(new Set(),r.wildlife);r.streamedWildlife.retain(new Set(),r.wildlife);
 assert.equal(actor.mesh.parent,null);assert.equal(r.wildlifeTransfers.get(actor.state.id),transfer);assert.deepEqual(releases,[actor.state.id]);
});

