import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import {farmCropRows,disposeFarmCropRows} from '../src/scene/farmCrops.js';
import {StreamedPresentation} from '../src/scene/streamedPresentation.js';
import {retireResources} from '../src/scene/retireResources.js';
import {sourceGltf} from './helpers/source-gltf.js';

const sourceText=fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.ts',sourceText,ts.ScriptTarget.Latest,true);
const game=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='TownGame') as ts.ClassDeclaration;
const method=(name:string)=>game.members.find(n=>n.name?.getText(ast)===name)!.getText(ast);
const Runtime=new Function('THREE','farmCropRows','disposeFarmCropRows','StreamedPresentation','retireResources',ts.transpileModule(
  `return class Runtime {objects=new Map();${['streamedPresentation','normalizeModel','pickEntity','applyVisualTarget','attachVisualTarget','addFarmPlotObject'].map(method).join('\n')}}`,
  {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(THREE,farmCropRows,disposeFarmCropRows,StreamedPresentation,retireResources);
const originalRows=(source:THREE.Object3D)=>{
  const group=new THREE.Group();
  for(const x of [-1.25,-.42,.42,1.25])for(const z of [-.72,0,.72]){
    const row=new THREE.Group();row.position.set(x,0,z);row.add(source.clone(true));group.add(row);
  }
  return group;
};
const meshes=(root:THREE.Object3D)=>{const result:THREE.Mesh[]=[];root.traverse(n=>{if(n instanceof THREE.Mesh)result.push(n);});return result;};
function vertices(root:THREE.Object3D){
  root.updateMatrixWorld(true);
  const result:string[]=[];
  for(const mesh of meshes(root)){
    const count=mesh instanceof THREE.InstancedMesh?mesh.count:1;
    for(let i=0;i<count;i++){
      const world=mesh.matrixWorld.clone();
      if(mesh instanceof THREE.InstancedMesh){const instance=new THREE.Matrix4();mesh.getMatrixAt(i,instance);world.multiply(instance);}
      const positions=mesh.geometry.getAttribute('position');
      for(let v=0;v<positions.count;v++)result.push(new THREE.Vector3().fromBufferAttribute(positions,v).applyMatrix4(world).toArray().map(n=>n.toFixed(5)).join(','));
    }
  }
  return result.sort();
}
function transforms(root:THREE.Object3D){
  root.updateMatrixWorld(true);
  const result=new Map<string,THREE.Matrix4[]>();
  for(const mesh of meshes(root)){
    const list=result.get(mesh.geometry.uuid)??[];result.set(mesh.geometry.uuid,list);
    for(let i=0;i<(mesh instanceof THREE.InstancedMesh?mesh.count:1);i++){
      const matrix=mesh.matrixWorld.clone();
      if(mesh instanceof THREE.InstancedMesh){const local=new THREE.Matrix4();mesh.getMatrixAt(i,local);matrix.multiply(local);}
      list.push(matrix);
    }
  }
  for(const list of result.values())list.sort((a,b)=>a.elements[12]!-b.elements[12]!||a.elements[14]!-b.elements[14]!);
  return result;
}
function equalTransforms(before:THREE.Object3D,after:THREE.Object3D){
  const expected=transforms(before),actual=transforms(after);
  assert.deepEqual([...actual.keys()].sort(),[...expected.keys()].sort());
  for(const [key,list] of expected){
    const values=actual.get(key)!;assert.equal(values.length,list.length);
    list.forEach((matrix,index)=>matrix.elements.forEach((value,element)=>
      assert.ok(Math.abs(values[index]!.elements[element]!-value)<1e-6,'instance float32 transform retains the sourced geometry placement')));
  }
}
async function wheat(){
  const source=(await sourceGltf('kenney/nature/crops_wheatStageB.glb')).scene;
  new Runtime().normalizeModel(source,.72);return source;
}

for(const mirrored of [false,true])test(`all twelve sourced crops retain world vertices, materials and shadows (mirrored plot=${mirrored})`,async()=>{
  const source=await wheat(),before=originalRows(source),after=farmCropRows(source);
  for(const root of [before,after]){root.position.set(37,.12,-21);root.rotation.y=.6;root.scale.set(mirrored?-1:1,1.4,.8);}
  equalTransforms(before,after);
  assert.equal(meshes(before).length,24);assert.equal(meshes(after).length,2);
  for(const mesh of meshes(after)){
    assert.ok(mesh instanceof THREE.InstancedMesh);assert.equal(mesh.count,12);
    assert.equal(mesh.castShadow,true);assert.equal(mesh.receiveShadow,true);
    assert.ok(meshes(source).some(original=>original.geometry===mesh.geometry&&original.material===mesh.material));
  }
  const oldBox=new THREE.Box3().setFromObject(before),newBox=new THREE.Box3().setFromObject(after);
  assert.ok(oldBox.min.distanceTo(newBox.min)<1e-5);assert.ok(oldBox.max.distanceTo(newBox.max)<1e-5);
});

test('a reflected source mesh keeps ordinary mesh winding instead of an unsupported negative instance matrix',async()=>{
  const source=await wheat();source.scale.x*=-1;
  const before=originalRows(source),after=farmCropRows(source);
  assert.deepEqual(vertices(after),vertices(before));
  assert.equal(meshes(after).length,24);assert.ok(meshes(after).every(mesh=>!(mesh instanceof THREE.InstancedMesh)));
});

test('the real picker resolves an instanced wheat hit to the same farm interaction root',async()=>{
  const source=await wheat();
  const original=originalRows(source);original.updateMatrixWorld(true);
  const first=meshes(original)[0]!,positions=first.geometry.getAttribute('position'),indices=first.geometry.index;
  const points=[0,1,2].map(i=>new THREE.Vector3().fromBufferAttribute(positions,indices?indices.getX(i):i).applyMatrix4(first.matrixWorld));
  const center=points[0]!.clone().add(points[1]!).add(points[2]!).divideScalar(3);
  const normal=new THREE.Vector3().subVectors(points[1]!,points[0]!).cross(new THREE.Vector3().subVectors(points[2]!,points[0]!)).normalize();
  assert.ok(normal.length()>.99);
  for(const rows of [original,farmCropRows(source)]){
    const farm=new THREE.Group();farm.userData={entityType:'object',entityId:'field'};farm.add(rows);farm.updateMatrixWorld(true);
    const camera=new THREE.PerspectiveCamera(70,1,.05,180);camera.position.copy(center).addScaledVector(normal,2);camera.lookAt(center);camera.updateMatrixWorld(true);
    const runtime=Object.assign(new Runtime(),{camera,raycaster:new THREE.Raycaster(),npcs:new Map(),wildlife:new Map(),objects:new Map([['field',{mesh:farm}]])});
    assert.deepEqual(runtime.pickEntity(new THREE.Vector2(),4),{type:'object',id:'field'});
    farm.visible=false;
    assert.equal(runtime.pickEntity(new THREE.Vector2(),4),undefined);
  }
});

test('releasing one plot disposes only instance buffers and leaves shared sourced assets and other plots usable',async()=>{
  const source=await wheat(),first=farmCropRows(source),second=farmCropRows(source);
  let instances=0,geometry=0,materials=0;
  for(const mesh of meshes(first))if(mesh instanceof THREE.InstancedMesh)mesh.addEventListener('dispose',()=>instances++);
  for(const mesh of meshes(source)){
    mesh.geometry.addEventListener('dispose',()=>geometry++);
    for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])material.addEventListener('dispose',()=>materials++);
  }
  const before=vertices(second);disposeFarmCropRows(first);first.clear();
  assert.equal(instances,2);assert.equal(geometry,0);assert.equal(materials,0);
  assert.deepEqual(vertices(second),before);assert.deepEqual(vertices(farmCropRows(source)),before);
});

test('real late asset replacement and streamed unload preserve the farm state and release only owned instance buffers',async()=>{
  const runtime=Object.assign(new Runtime(),{scene:new THREE.Scene(),assets:new Map(),visualTargets:[],npcs:new Map(),materializedChunks:new Map(),
    registerWorldObjectPhysics(){},physics:{clearChunk(){}},staticPhysicsOwner:undefined});
  const state={id:'field',chunkId:'chunk_2_0',kind:'farm_plot',name:'Field',position:{x:48,z:-5},tags:['farm'],resourceAmount:3,capabilities:['inspect','harvest']};
  const group=runtime.addFarmPlotObject(state),stored=runtime.objects.get('field');
  assert.equal(runtime.visualTargets.length,2);assert.equal(meshes(group).length,0);
  runtime.assets.set('farmWheat',await sourceGltf('kenney/nature/crops_wheatStageB.glb'));
  runtime.assets.set('farmSoil',await sourceGltf('kenney/nature/crops_dirtDoubleRow.glb'));
  for(const target of runtime.visualTargets)runtime.applyVisualTarget(target);
  assert.equal(runtime.objects.get('field'),stored);assert.equal(stored.state,state);assert.equal(state.resourceAmount,3);
  assert.equal(meshes(group).length,4);assert.equal(meshes(group).filter(mesh=>mesh instanceof THREE.InstancedMesh).length,2);
  const cropTarget=runtime.visualTargets.find((target:any)=>target.asset==='farmWheat');
  let disposed=0;for(const mesh of meshes(group))if(mesh instanceof THREE.InstancedMesh)mesh.addEventListener('dispose',()=>disposed++);
  runtime.applyVisualTarget(cropTarget);assert.equal(disposed,2);assert.equal(meshes(group).length,4);
  let released=0;for(const mesh of meshes(group))if(mesh instanceof THREE.InstancedMesh)mesh.addEventListener('dispose',()=>released++);
  runtime.createStreamedObject=()=>stored;
  runtime.streamedPresentation.present({unit:{id:'unit_1_0'},ownerCellIds:['chunk_2_0'],buildings:[],roads:[],objects:[{id:'field',ownerCellId:'chunk_2_0'}]},[state]);
  runtime.streamedPresentation.retainVisible(new Set());
  assert.equal(released,2);assert.equal(group.parent,null);assert.equal(runtime.visualTargets.length,0);
  assert.equal(state.resourceAmount,3);assert.deepEqual(state.position,{x:48,z:-5});
});
