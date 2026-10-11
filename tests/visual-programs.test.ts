import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {prepareVisualPrograms} from '../src/scene/visualPrograms.js';
import {sourceGltf} from './helpers/source-gltf.js';
test('precompilation uses detached clones with actual receiving-shadow variants',async()=>{
 const original=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());original.add(mesh);
 const owner=new THREE.Scene();owner.add(original);const target=new THREE.Scene(),camera=new THREE.PerspectiveCamera();let staging!:THREE.Object3D,release!:()=>void,done=false,disposed=0;
 mesh.geometry.addEventListener('dispose',()=>disposed++);mesh.material.addEventListener('dispose',()=>disposed++);
 const pending=prepareVisualPrograms({compileAsync:async(object,c,s)=>{staging=object;assert.equal(c,camera);assert.equal(s,target);assert.equal(object.parent,null);assert.equal(object.children.length,1);const cloned=object.children[0]!.children[0] as THREE.Mesh;assert.notEqual(cloned,mesh);assert.equal(cloned.material,mesh.material);assert.equal(cloned.geometry,mesh.geometry);assert.equal(cloned.castShadow,true);assert.equal(cloned.receiveShadow,true);await new Promise<void>(r=>release=r);return object;}},camera,target,[original]).then(()=>{done=true;});
 assert.equal(done,false);assert.equal(mesh.castShadow,false);assert.equal(mesh.receiveShadow,false);assert.equal(original.parent,owner);assert.equal(target.children.length,0);
 release();await pending;assert.equal(staging.children.length,0);assert.equal(disposed,0);
});
test('failed shader preparation remains visible to caller and removes staging children',async()=>{
 let staging!:THREE.Object3D;const template=new THREE.Group();
 await assert.rejects(prepareVisualPrograms({compileAsync:async(object)=>{staging=object;throw new Error('compile failed');}},new THREE.PerspectiveCamera(),new THREE.Scene(),[template]),/compile failed/);
 assert.equal(staging.children.length,0);assert.equal(template.parent,null);
});
test('real skinned asset precompilation preserves original skeleton and animation data',async()=>{
 const asset=await sourceGltf('quaternius/cube-world/Character_Female_1.gltf');const originals:THREE.SkinnedMesh[]=[];asset.scene.traverse(o=>{if((o as THREE.SkinnedMesh).isSkinnedMesh)originals.push(o as THREE.SkinnedMesh);});assert.ok(originals.length);
 await prepareVisualPrograms({compileAsync:async(object)=>{const clones:THREE.SkinnedMesh[]=[];object.traverse(o=>{if((o as THREE.SkinnedMesh).isSkinnedMesh)clones.push(o as THREE.SkinnedMesh);});assert.equal(clones.length,originals.length);for(let i=0;i<clones.length;i++){assert.notEqual(clones[i]!.skeleton,originals[i]!.skeleton);assert.notEqual(clones[i]!.skeleton.bones[0],originals[i]!.skeleton.bones[0]);assert.equal(clones[i]!.material,originals[i]!.material);}return object;}},new THREE.PerspectiveCamera(),new THREE.Scene(),[asset.scene]);
 assert.equal(asset.scene.parent,null);assert.ok(asset.animations.length);
});
