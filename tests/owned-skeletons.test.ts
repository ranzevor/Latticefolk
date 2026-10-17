import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils.js';
import {disposeOwnedSkeletons} from '../src/scene/ownedSkeletons.js';
const template=()=>{
 const root=new THREE.Group(),bone=new THREE.Bone();root.add(bone);
 const mesh=new THREE.SkinnedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());
 root.add(mesh);mesh.bind(new THREE.Skeleton([bone]));return {root,mesh};
};
const skin=(root:THREE.Object3D)=>{let found:THREE.SkinnedMesh|undefined;root.traverse(n=>{if((n as THREE.SkinnedMesh).isSkinnedMesh)found=n as THREE.SkinnedMesh;});return found!;};
test('released cloned skeleton disposes its texture without disposing shared source or sibling assets',()=>{
 const source=template(),a=clone(source.root),b=clone(source.root),ma=skin(a),mb=skin(b);
 for(const mesh of [source.mesh,ma,mb])mesh.skeleton.computeBoneTexture();
 const events={a:0,b:0,source:0,geometry:0,material:0};
 ma.skeleton.boneTexture!.addEventListener('dispose',()=>events.a++);
 mb.skeleton.boneTexture!.addEventListener('dispose',()=>events.b++);
 source.mesh.skeleton.boneTexture!.addEventListener('dispose',()=>events.source++);
 source.mesh.geometry.addEventListener('dispose',()=>events.geometry++);
 (source.mesh.material as THREE.Material).addEventListener('dispose',()=>events.material++);
 disposeOwnedSkeletons(a);disposeOwnedSkeletons(a);
 assert.equal(ma.skeleton.boneTexture,null);assert.notEqual(mb.skeleton.boneTexture,null);
 assert.deepEqual(events,{a:1,b:0,source:0,geometry:0,material:0});
 assert.equal(ma.geometry,source.mesh.geometry);assert.equal(mb.material,source.mesh.material);
});
test('NPC release callback disposes cloned bone textures after uncaching animation',()=>{
 const text=fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
 const body=text.split('new StreamedActors<NpcRuntime>(agent=>{')[1].split('\n  });')[0];
 const release=new Function('agent','disposeOwnedSkeletons',body);
 const {root,mesh}=template();mesh.skeleton.computeBoneTexture();let disposed=0;
 mesh.skeleton.boneTexture!.addEventListener('dispose',()=>disposed++);
 const dom=()=>({parentNode:true,remove(){this.parentNode=false;}});
 const agent={mesh:root,speechEl:dom(),nameEl:dom()};const host={visualTargets:[{group:root}]};
 release.call(host,agent,disposeOwnedSkeletons);
 assert.equal(mesh.skeleton.boneTexture,null);assert.equal(disposed,1);assert.equal(host.visualTargets.length,0);
});
