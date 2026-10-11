import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';
import {StreamedActors} from '../src/scene/streamedActors.js';
import {effectiveWildlifeMorphology,normalizeWildlifePhenotype} from '../src/world/wildlifePhenotype.js';
import {normalizeWildlifeOrganismGenome} from '../src/world/organismFamilies.js';
import {rememberOwnedMeshResources,disposeOwnedMeshResources} from '../src/scene/ownedMeshResources.js';

function fixture(){
  const source=fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
  const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true),members:string[]=[];
  for(const node of ast.statements)if(ts.isClassDeclaration(node)&&node.name?.text==='TownGame')for(const member of node.members)
    if(member.name&&['makeProceduralAnimal','streamedWildlife','removeWildlife'].includes(member.name.getText(ast)))members.push(member.getText(ast));
  assert.equal(members.length,3);
  const code=ts.transpileModule(`return class Runtime {${members.join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const deps={i18n:{t:(s:string)=>s},rememberOwnedMeshResources,disposeOwnedMeshResources,THREE,StreamedActors,effectiveWildlifeMorphology,normalizeWildlifePhenotype,normalizeWildlifeOrganismGenome,clamp:(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n))};
  const Runtime=new Function(...Object.keys(deps),code)(...Object.values(deps));
  const runtime=new Runtime();runtime.wildlifePresentation={remove:()=>false};
  const state={id:'sheep-1',species:'sheep',traits:{speed:1,size:.58,fertility:1,wariness:1}};
  const mesh=runtime.makeProceduralAnimal(state) as THREE.Group;
  const actor={state,mesh},scene=new THREE.Scene();scene.add(mesh);runtime.streamedWildlife.remember(actor);
  return{runtime,actor,mesh};
}

test('real procedural animal unload disposes each owned geometry and material once',()=>{
  const {runtime,actor,mesh}=fixture(),resources=new Map<THREE.BufferGeometry|THREE.Material,number>();
  mesh.traverse(node=>{if((node as THREE.Mesh).isMesh){const m=node as THREE.Mesh;resources.set(m.geometry,0);for(const material of Array.isArray(m.material)?m.material:[m.material])resources.set(material,0);}});
  for(const resource of resources.keys())resource.addEventListener('dispose',()=>resources.set(resource,resources.get(resource)!+1));
  assert.ok(resources.size>5);runtime.streamedWildlife.remove(actor);runtime.streamedWildlife.remove(actor);
  assert.equal(mesh.parent,null);assert.ok([...resources.values()].every(count=>count===1),JSON.stringify([...resources.values()]));
});

test('inactive retained wildlife keeps its resources until its owner leaves the visible window',()=>{
  const {runtime,actor,mesh}=fixture();let disposed=0;
  mesh.traverse(node=>{if((node as THREE.Mesh).isMesh)(node as THREE.Mesh).geometry.addEventListener('dispose',()=>disposed++);});
  Object.assign(actor.state,{chunkId:'chunk_2_0'});
  runtime.streamedWildlife.retain(new Set(['chunk_2_0']),new Map());assert.equal(disposed,0);
  runtime.streamedWildlife.retain(new Set(),new Map([[actor.state.id,actor]]));assert.equal(disposed,0);
  runtime.streamedWildlife.retain(new Set(),new Map());assert.ok(disposed>0);
});

test('owned disposal leaves siblings and later shared attachments intact and releases unused material',()=>{
  const a=fixture(),b=fixture();let siblingDisposals=0;
  b.mesh.traverse(node=>{if((node as THREE.Mesh).isMesh)(node as THREE.Mesh).geometry.addEventListener('dispose',()=>siblingDisposals++);});
  const foreign=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());let foreignDisposals=0;
  foreign.geometry.addEventListener('dispose',()=>foreignDisposals++);foreign.material.addEventListener('dispose',()=>foreignDisposals++);a.mesh.add(foreign);
  a.runtime.streamedWildlife.remove(a.actor);assert.equal(siblingDisposals,0);assert.equal(foreignDisposals,0);
  const empty=new THREE.Group(),unused=new THREE.MeshBasicMaterial();let unusedDisposals=0;
  unused.addEventListener('dispose',()=>unusedDisposals++);rememberOwnedMeshResources(empty,[unused,unused]);
  assert.equal(disposeOwnedMeshResources(empty),true);assert.equal(disposeOwnedMeshResources(empty),false);assert.equal(unusedDisposals,1);
  assert.equal(disposeOwnedMeshResources(foreign),false);
});

for(const retained of [true,false])test(`actual death releases procedural ownership once with retained=${retained}`,()=>{
 const {runtime,actor,mesh}=fixture();let disposed=0;
 mesh.traverse(node=>{if((node as THREE.Mesh).isMesh)(node as THREE.Mesh).geometry.addEventListener('dispose',()=>disposed++);});
 const record:{}={};Object.assign(runtime,{recordWildlifeHabitatExposure(){},day:1,minuteOfDay:0,ensureWildlifeLineage:()=>record,wildlifeHabitatSnapshot:()=>({}),lineageEpoch:0,wildlife:new Map([[actor.state.id,actor]]),event(){},wildlifeName:()=>''});
 if(!retained)runtime.streamedWildlife={remove:()=>false};
 runtime.removeWildlife(actor,'disease');const first=disposed;runtime.removeWildlife(actor,'disease');
 assert.ok(first>0);assert.equal(disposed,first);assert.equal(mesh.parent,null);assert.equal(runtime.wildlife.size,0);
});
