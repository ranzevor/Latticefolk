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

function ownedModels(){
 const root=new THREE.Group(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial();
 const instances=[new THREE.InstancedMesh(geometry,material,1),new THREE.InstancedMesh(geometry,material,1)];
 const skins=[0,1].map(()=>{
  const bone=new THREE.Bone(),mesh=new THREE.SkinnedMesh(geometry,material);
  mesh.add(bone);mesh.bind(new THREE.Skeleton([bone]));mesh.skeleton.computeBoneTexture();return mesh;
 });
 root.add(...instances,...skins);
 let sharedDisposals=0;
 geometry.addEventListener('dispose',()=>sharedDisposals++);material.addEventListener('dispose',()=>sharedDisposals++);
 for(const instance of instances)instance.addEventListener('dispose',()=>sharedDisposals++);
 for(const mesh of skins)mesh.skeleton.boneTexture!.addEventListener('dispose',()=>sharedDisposals++);
 return{root,sharedDisposals:()=>sharedDisposals};
}

for(const phase of ['resolve','throw','reject'] as const)test(`program cleanup attempts every owned resource after ${phase}`,async()=>{
 const original=ownedModels(),calls:string[]=[],compileFailure=undefined,instanceFailure={instance:true},skeletonFailure=new AggregateError([null],'texture failure'),clearFailure={clear:true};
 let staged!:THREE.Object3D;
 const run=prepareVisualPrograms({compileAsync:object=>{
  staged=object;let instances=0,skeletons=0;
  object.traverse(node=>{
   if(node instanceof THREE.InstancedMesh){
    const index=instances++;node.addEventListener('dispose',()=>{calls.push(`instance${index}`);if(index===0){node.removeFromParent();throw instanceFailure;}});
   }
   if(node instanceof THREE.SkinnedMesh){
    const index=skeletons++;node.skeleton.computeBoneTexture();
    node.skeleton.boneTexture!.addEventListener('dispose',()=>{calls.push(`skeleton${index}`);if(index===0)throw skeletonFailure;});
   }
  });
  object.children[0]!.addEventListener('removed',()=>{calls.push('clear');throw clearFailure;});
  if(phase==='throw')throw compileFailure;
  return phase==='reject'?Promise.reject(compileFailure):Promise.resolve(object);
 }},new THREE.Camera(),new THREE.Scene(),[original.root]);
 await assert.rejects(run,error=>{
  assert.ok(error instanceof AggregateError);
  const expected=[...(phase==='resolve'?[]:[compileFailure]),instanceFailure,skeletonFailure,clearFailure];
  assert.deepEqual(error.errors,expected);for(let i=0;i<expected.length;i++)assert.equal(error.errors[i],expected[i]);return true;
 });
 assert.deepEqual(calls,['instance0','instance1','skeleton0','skeleton1','clear']);
 assert.equal(staged.children.length,0);assert.equal(original.sharedDisposals(),0);assert.equal(original.root.parent,null);
});

for(const origin of ['throw','reject','instance','skeleton','clear'] as const)test(`a lone ${origin} failure retains its exact value`,async()=>{
 const failure=origin==='throw'?null:origin==='reject'?undefined:new AggregateError([{}],origin);
 const original=ownedModels();let staged!:THREE.Object3D,clearCalls=0;
 const run=prepareVisualPrograms({compileAsync:object=>{
  staged=object;let armed=false;
  object.traverse(node=>{
   if(!armed&&origin==='instance'&&node instanceof THREE.InstancedMesh){armed=true;node.addEventListener('dispose',()=>{throw failure;});}
   if(!armed&&origin==='skeleton'&&node instanceof THREE.SkinnedMesh){armed=true;node.skeleton.computeBoneTexture();node.skeleton.boneTexture!.addEventListener('dispose',()=>{throw failure;});}
  });
  if(origin==='clear')object.children[0]!.addEventListener('removed',()=>{clearCalls++;throw failure;});
  if(origin==='throw')throw failure;
  return origin==='reject'?Promise.reject(failure):Promise.resolve(object);
 }},new THREE.Camera(),new THREE.Scene(),[original.root]);
 let rejected=false;
 await run.catch(error=>{rejected=true;assert.equal(error,failure);});
 assert.equal(rejected,true);assert.equal(staged.children.length,0);assert.equal(original.sharedDisposals(),0);
 if(origin==='clear')assert.equal(clearCalls,1);
});

test('program cleanup snapshots resources before callbacks mutate or revisit staging',async()=>{
 const original=ownedModels(),calls=new Map<THREE.Object3D|THREE.Skeleton,number>();
 let staged!:THREE.Object3D,nested:Promise<void>|undefined,first=true;
 await prepareVisualPrograms({compileAsync:async object=>{
  staged=object;const nodes:THREE.Object3D[]=[];object.traverse(node=>nodes.push(node));
  const instance=nodes.find(node=>node instanceof THREE.InstancedMesh)!;
  const skin=nodes.find(node=>node instanceof THREE.SkinnedMesh) as THREE.SkinnedMesh;
  const sameSkeleton=new THREE.SkinnedMesh(skin.geometry,skin.material);sameSkeleton.skeleton=skin.skeleton;object.add(sameSkeleton);
  object.traverse(node=>{
   if(node instanceof THREE.InstancedMesh)node.addEventListener('dispose',()=>{
    calls.set(node,(calls.get(node)??0)+1);
    if(first){first=false;object.children[0]!.clear();nested=prepareVisualPrograms({compileAsync:async nestedRoot=>nestedRoot},new THREE.Camera(),new THREE.Scene(),[original.root]);}
   });
   if(node instanceof THREE.SkinnedMesh&&!calls.has(node.skeleton)){
    const skeleton=node.skeleton;calls.set(skeleton,0);skeleton.computeBoneTexture();skeleton.boneTexture!.addEventListener('dispose',()=>calls.set(skeleton,calls.get(skeleton)!+1));
   }
  });
  object.children.push(instance);return object;
 }},new THREE.Camera(),new THREE.Scene(),[original.root]);
 await nested;
 assert.equal(calls.size,4);assert.deepEqual([...calls.values()],[1,1,1,1]);assert.equal(staged.children.length,0);assert.equal(original.sharedDisposals(),0);
});

test('a template iterator failure also releases earlier program clones',async()=>{
 const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),1),failure={iterator:true};let disposed=0;
 const clone=mesh.clone.bind(mesh);mesh.clone=()=>{const model=clone();model.addEventListener('dispose',()=>disposed++);return model;};
 const templates={*[Symbol.iterator](){yield mesh;throw failure;}};
 let caught:unknown;try{await prepareVisualPrograms({compileAsync:async root=>root},new THREE.Camera(),new THREE.Scene(),templates);}catch(error){caught=error;}
 assert.equal(caught,failure);assert.equal(disposed,1);
});
