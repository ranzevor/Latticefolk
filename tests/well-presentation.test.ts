import {prepareVisualPrograms} from '../src/scene/visualPrograms.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import {FBXLoader} from 'three/examples/jsm/loaders/FBXLoader.js';
import {normalizeLegacyWell} from '../scripts/lib/well-materials.mjs';
import {prepareWellGeometry} from '../src/scene/wellPresentation.js';
import {StreamedPresentation} from '../src/scene/streamedPresentation.js';
import {farmCropRows,disposeFarmCropRows} from '../src/scene/farmCrops.js';

const well=()=>new FBXLoader().parse(Uint8Array.from(normalizeLegacyWell(fs.readFileSync(
  new URL('../public/assets/quaternius/medieval-village/Well.source.fbx',import.meta.url)))).buffer,'');
const mesh=(root:THREE.Object3D)=>root.getObjectByName('Well') as THREE.Mesh;
const source=fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const game=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='TownGame') as ts.ClassDeclaration;
const method=(name:string)=>game.members.find(n=>n.name?.getText(ast)===name)!.getText(ast);
const Runtime=new Function('prepareVisualPrograms','THREE','prepareWellGeometry','StreamedPresentation','farmCropRows','disposeFarmCropRows',
  'WATER_PATCH_ASSET','BAKING_OVEN_ASSET',ts.transpileModule(`return class Runtime {objects=new Map();${[
    'streamedPresentation','loadVisualAssets','normalizeModel','pickEntity','applyVisualTarget','attachVisualTarget'].map(method).join('\n')}}`,
  {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(prepareVisualPrograms,THREE,prepareWellGeometry,StreamedPresentation,farmCropRows,disposeFarmCropRows,'waterPatch','bakingOven');

function triangles(geometry:THREE.BufferGeometry){
  const rows:string[]=[];
  for(const group of geometry.groups)for(let i=group.start;i<group.start+group.count;i+=3){
    const vertices=[0,1,2].map(offset=>{
      const index=geometry.index?.getX(i+offset)??i+offset;
      return Object.entries(geometry.attributes).map(([name,attribute])=>[name,
        Array.from({length:attribute.itemSize},(_,component)=>attribute.getComponent(index,component))]);
    });
    rows.push(JSON.stringify([group.materialIndex,vertices]));
  }
  return rows.sort();
}

test('the sourced opaque well submits five material groups with every oriented triangle and attribute unchanged',()=>{
  const scene=well(),m=mesh(scene),geometry=m.geometry,attributes={...geometry.attributes},materials=m.material;
  assert.equal(geometry.groups.length,102);assert.equal(geometry.index,null);
  const before=triangles(geometry),bounds=new THREE.Box3().setFromObject(scene);
  prepareWellGeometry(scene);
  assert.equal(m.geometry,geometry);assert.equal(m.material,materials);
  assert.equal(geometry.groups.length,5);assert.equal(geometry.index!.count,5610);
  assert.equal(before.length,1870);assert.deepEqual(triangles(geometry),before);
  for(const [name,attribute] of Object.entries(attributes))assert.equal(geometry.getAttribute(name),attribute);
  assert.deepEqual(new THREE.Box3().setFromObject(scene),bounds);
  const index=geometry.index,groups=structuredClone(geometry.groups);prepareWellGeometry(scene);
  assert.equal(geometry.index,index);assert.deepEqual(geometry.groups,groups);
});

for(const mirrored of [false,true])test(`well ray hits retain distance, surface attributes and interaction identity (mirrored=${mirrored})`,()=>{
  const before=well(),after=well();prepareWellGeometry(after);
  const roots=[before,after].map(model=>{
    const runtime=new Runtime();runtime.normalizeModel(model,2.1);
    const root=new THREE.Group();root.userData={entityType:'object',entityId:'well'};
    root.position.set(46,.1,-12);root.rotation.y=.4;root.scale.set(mirrored?-1:1,1.2,.8);root.add(model);root.updateMatrixWorld(true);return root;
  });
  const original=mesh(before),geometry=original.geometry;
  for(const materialIndex of [0,1,2,3,4]){
    const group=geometry.groups.find(group=>group.materialIndex===materialIndex)!;
    const points=[0,1,2].map(i=>new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('position'),group.start+i).applyMatrix4(original.matrixWorld));
    const normal=new THREE.Vector3().subVectors(points[1]!,points[0]!).cross(new THREE.Vector3().subVectors(points[2]!,points[0]!)).normalize().multiplyScalar(mirrored?-1:1);
    const center=points[0]!.clone().add(points[1]!).add(points[2]!).divideScalar(3);
    const camera=new THREE.PerspectiveCamera(70,1,.01,180);camera.position.copy(center).addScaledVector(normal,.2);camera.lookAt(center);camera.updateMatrixWorld(true);
    const raycaster=new THREE.Raycaster();raycaster.setFromCamera(new THREE.Vector2(),camera);
    const hits=roots.map(root=>raycaster.intersectObject(root,true)[0]!);assert.ok(hits.every(Boolean));
    assert.ok(Math.abs(hits[0]!.distance-hits[1]!.distance)<1e-9);
    assert.equal(hits[0]!.face!.materialIndex,hits[1]!.face!.materialIndex);
    assert.ok(hits[0]!.point.distanceTo(hits[1]!.point)<1e-9);assert.ok(hits[0]!.uv!.distanceTo(hits[1]!.uv!)<1e-9);
    assert.ok(hits[0]!.normal!.distanceTo(hits[1]!.normal!)<1e-9);
    for(const root of roots){
      const runtime=Object.assign(new Runtime(),{camera,raycaster,npcs:new Map(),wildlife:new Map(),objects:new Map([['well',{mesh:root}]])});
      assert.deepEqual(runtime.pickEntity(new THREE.Vector2(),1),{type:'object',id:'well'});
    }
  }
});

test('unsupported material, animation and geometry inputs remain unmodified',()=>{
  const mutations:((scene:THREE.Group,m:THREE.Mesh)=>void)[]=[
    (_s,m)=>{(m.material as THREE.Material[])[0]!.transparent=true;},
    (_s,m)=>{(m.material as THREE.Material[])[0]!.opacity=.5;},
    (_s,m)=>{(m.material as THREE.Material[])[0]!.name='Other asset';},
    (s)=>{s.animations.push(new THREE.AnimationClip('Move',1,[]));},
    (_s,m)=>{Object.assign(m,{isSkinnedMesh:true});},
    (_s,m)=>{m.geometry.morphAttributes.position=[m.geometry.getAttribute('position').clone() as THREE.BufferAttribute];},
    (_s,m)=>{m.geometry.groups[1]!.start++;},
    (_s,m)=>{m.geometry.groups[1]!.materialIndex=5;},
    (_s,m)=>{m.geometry.setDrawRange(0,3);}
  ];
  for(const mutate of mutations){const scene=well(),m=mesh(scene);mutate(scene,m);const groups=structuredClone(m.geometry.groups);
    prepareWellGeometry(scene);assert.equal(m.geometry.index,null);assert.deepEqual(m.geometry.groups,groups);}
});

test('real asset loading groups the well before attaching any visual clone',async()=>{
  const scene=well(),seen:number[]=[];
  const runtime=Object.assign(new Runtime(),{renderer:{compileAsync:async(scene:THREE.Object3D)=>scene},camera:new THREE.PerspectiveCamera(),scene:new THREE.Scene(),assets:new Map(),assetRoot:'/assets/quaternius',visualTargets:[{asset:'wellAsset'}],
    fbxLoader:{loadAsync:async()=>scene},gltfLoader:{loadAsync:async()=>({scene:new THREE.Group(),animations:[]})},
    applyVisualTarget(){seen.push(mesh(this.assets.get('wellAsset').scene).geometry.groups.length);},log(){}});
  await runtime.loadVisualAssets();assert.deepEqual(runtime.assetLoadFailures,[]);assert.deepEqual(seen,[5]);assert.equal(runtime.assetsReady,true);
});

test('replacing and unloading well visuals preserve shared geometry, materials and the other well',()=>{
  const scene=well();prepareWellGeometry(scene);let disposed=0;
  mesh(scene).geometry.addEventListener('dispose',()=>disposed++);
  for(const material of mesh(scene).material as THREE.Material[])material.addEventListener('dispose',()=>disposed++);
  const runtime=Object.assign(new Runtime(),{scene:new THREE.Scene(),assets:new Map([['wellAsset',{scene,animations:[]}]]),
    visualTargets:[],npcs:new Map(),physics:{clearChunk(){}}});
  const targets=[0,1].map(i=>{const group=new THREE.Group();runtime.scene.add(group);const target={asset:'wellAsset',group,height:2.1,rotationY:i};runtime.attachVisualTarget(target);return target;});
  const shared=mesh(scene).geometry,index=shared.index;assert.equal(mesh(targets[0]!.group).geometry,shared);assert.equal(mesh(targets[1]!.group).geometry,shared);
  runtime.applyVisualTarget(targets[0]);assert.equal(mesh(targets[0]!.group).geometry,shared);assert.equal(disposed,0);
  const state={id:'well',chunkId:'chunk_2_0',kind:'well',position:{x:48,z:0},resourceAmount:7};
  const object={state,mesh:targets[0]!.group};runtime.createStreamedObject=()=>object;
  runtime.streamedPresentation.present({unit:{id:'unit_1_0'},ownerCellIds:['chunk_2_0'],buildings:[],roads:[],objects:[{id:'well',ownerCellId:'chunk_2_0'}]},[state]);
  runtime.streamedPresentation.retainVisible(new Set());
  assert.equal(targets[0]!.group.parent,null);assert.equal(disposed,0);assert.equal(shared.index,index);
  assert.equal(mesh(targets[1]!.group).geometry,shared);assert.equal(state.resourceAmount,7);
});
