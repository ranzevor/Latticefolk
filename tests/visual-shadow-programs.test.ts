import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {prepareVisualShadows} from '../src/scene/visualPrograms.js';
import {sourceGltf} from './helpers/source-gltf.js';
function renderer(render:(scene:THREE.Object3D,camera:THREE.Camera)=>void){
 const original=new THREE.WebGLRenderTarget(4,4),viewport=new THREE.Vector4(1,2,3,4),scissor=new THREE.Vector4(5,6,7,8);
 let target:THREE.WebGLRenderTarget|null=original,cube=2,mip=3,scissorTest=true;
 const api={shadowMap:{enabled:true,needsUpdate:false},render,
  getRenderTarget:()=>target,setRenderTarget:(value:THREE.WebGLRenderTarget|null,face=0,level=0)=>{target=value;cube=face;mip=level;},
  getActiveCubeFace:()=>cube,getActiveMipmapLevel:()=>mip,
  getViewport:(value:THREE.Vector4)=>value.copy(viewport),setViewport:(value:THREE.Vector4)=>viewport.copy(value),
  getScissor:(value:THREE.Vector4)=>value.copy(scissor),setScissor:(value:THREE.Vector4)=>scissor.copy(value),
  getScissorTest:()=>scissorTest,setScissorTest:(value:boolean)=>{scissorTest=value;}};
 return{api:api as Parameters<typeof prepareVisualShadows>[0],check:()=>{assert.equal(target,original);assert.equal(cube,2);assert.equal(mip,3);assert.equal(scissorTest,true);assert.deepEqual(viewport.toArray(),[1,2,3,4]);assert.deepEqual(scissor.toArray(),[5,6,7,8]);assert.equal(api.shadowMap.needsUpdate,false);}};
}
for(const fail of [false,true])test(`shadow preparation renders detached casts and restores state on ${fail?'failure':'success'}`,()=>{
 const scene=new THREE.Scene(),parent=new THREE.Group(),sun=new THREE.DirectionalLight();parent.position.set(3,4,5);sun.position.set(1,2,3);sun.castShadow=true;parent.add(sun);scene.add(parent);sun.target.position.set(6,7,8);scene.add(sun.target);
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()),camera=new THREE.PerspectiveCamera();scene.add(mesh);
 let staged!:THREE.Object3D,rendered=0,disposed=0,shadowDisposed=0;
 mesh.geometry.addEventListener('dispose',()=>disposed++);mesh.material.addEventListener('dispose',()=>disposed++);
 const r=renderer((object,c)=>{staged=object;rendered++;assert.equal(c,camera);assert.notEqual(object,scene);
  const copy=object.children.find(o=>(o as THREE.Light).isLight) as THREE.DirectionalLight;assert.notEqual(copy,sun);assert.equal(copy.castShadow,true);assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(copy.matrix).toArray(),[4,6,8]);assert.notEqual(copy.target,sun.target);assert.deepEqual(copy.shadow.mapSize.toArray(),[1,1]);copy.shadow.dispose=()=>shadowDisposed++;
  const model=object.children.find(o=>(o as THREE.Mesh).isMesh) as THREE.Mesh;assert.notEqual(model,mesh);assert.equal(model.material,mesh.material);assert.equal(model.geometry,mesh.geometry);assert.equal(model.castShadow,true);assert.equal(model.receiveShadow,true);assert.equal(model.frustumCulled,false);
  const target=r.api.getRenderTarget()!;assert.equal(target.width,4);assert.equal(target.height,4);assert.deepEqual(r.api.getViewport(new THREE.Vector4()).toArray(),[0,0,1,1]);assert.deepEqual(r.api.getScissor(new THREE.Vector4()).toArray(),[0,0,1,1]);assert.equal(r.api.getScissorTest(),true);assert.equal(r.api.shadowMap.needsUpdate,true);
  if(fail)throw new Error('shadow render failed');
 });
 if(fail)assert.throws(()=>prepareVisualShadows(r.api,camera,scene,[mesh]),/shadow render failed/);else prepareVisualShadows(r.api,camera,scene,[mesh]);
 r.check();assert.equal(rendered,1);assert.equal(shadowDisposed,1);assert.equal(staged.children.length,0);assert.equal(disposed,0);assert.equal(mesh.parent,scene);assert.equal(mesh.castShadow,false);assert.equal(mesh.frustumCulled,true);assert.deepEqual(sun.shadow.mapSize.toArray(),[512,512]);
});
test('disabled shadows and scenes without lights do not render',()=>{
 const r=renderer(()=>assert.fail('unexpected render')),scene=new THREE.Scene();prepareVisualShadows(r.api,new THREE.Camera(),scene,[new THREE.Group()]);scene.add(new THREE.DirectionalLight());r.api.shadowMap.enabled=false;prepareVisualShadows(r.api,new THREE.Camera(),scene,[new THREE.Group()]);r.check();
});
test('shadow warmup disposes only cloned skeletons of real skinned assets',async()=>{
 const asset=await sourceGltf('quaternius/cube-world/Character_Female_1.gltf'),scene=new THREE.Scene();scene.add(new THREE.DirectionalLight());const originals=new Set<THREE.Skeleton>();asset.scene.traverse(o=>{if((o as THREE.SkinnedMesh).isSkinnedMesh)originals.add((o as THREE.SkinnedMesh).skeleton);});assert.ok(originals.size);let disposed=0,clones=0;
 const r=renderer(object=>object.traverse(o=>{const mesh=o as THREE.SkinnedMesh;if(mesh.isSkinnedMesh){clones++;assert.equal(originals.has(mesh.skeleton),false);mesh.skeleton.dispose=()=>disposed++;}}));
 prepareVisualShadows(r.api,new THREE.PerspectiveCamera(),scene,[asset.scene]);assert.equal(disposed,clones);assert.ok(clones);r.check();assert.equal(asset.scene.parent,null);
});

