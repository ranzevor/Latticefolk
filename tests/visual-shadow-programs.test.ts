import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {prepareVisualShadows} from '../src/scene/visualPrograms.js';
import {sourceGltf} from './helpers/source-gltf.js';
function renderer(render:(scene:THREE.Object3D,camera:THREE.Camera)=>void){
 const original=new THREE.WebGLRenderTarget(4,4),viewport=new THREE.Vector4(1,2,3,4),scissor=new THREE.Vector4(5,6,7,8);
 let target:THREE.WebGLRenderTarget|null=original,cube=2,mip=3,scissorTest=true;
 const api={shadowMap:{enabled:true,needsUpdate:false},render,compile:()=>new Set<THREE.Material>(),
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


for(const fail of [false,true])test(`program preparation releases owned instancing buffers on ${fail?'failure':'success'}`,async()=>{
 const {prepareVisualPrograms}=await import('../src/scene/visualPrograms.js');
 const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial(),12);
 let cloned=0,disposed=0,shared=0;mesh.addEventListener('dispose',()=>shared++);mesh.geometry.addEventListener('dispose',()=>shared++);mesh.material.addEventListener('dispose',()=>shared++);
 const renderer={compileAsync:async(root:THREE.Object3D)=>{root.traverse(node=>{if(node instanceof THREE.InstancedMesh){assert.notEqual(node,mesh);cloned++;node.addEventListener('dispose',()=>disposed++);}});if(fail)throw new Error('compile failure');return root;}};
 const run=prepareVisualPrograms(renderer,new THREE.PerspectiveCamera(),new THREE.Scene(),[mesh]);
 if(fail)await assert.rejects(run,/compile failure/);else await run;
 assert.equal(cloned,1);assert.equal(disposed,1);assert.equal(shared,0);
});
for(const fail of [false,true])test(`shadow preparation releases owned instancing buffers on ${fail?'failure':'success'}`,()=>{
 const scene=new THREE.Scene();scene.add(new THREE.DirectionalLight());
 const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial(),12);let disposed=0,shared=0;
 mesh.addEventListener('dispose',()=>shared++);mesh.geometry.addEventListener('dispose',()=>shared++);mesh.material.addEventListener('dispose',()=>shared++);
 const r=renderer(root=>{root.traverse(node=>{if(node instanceof THREE.InstancedMesh){assert.notEqual(node,mesh);node.addEventListener('dispose',()=>disposed++);}});if(fail)throw new Error('render failure');});
 const run=()=>prepareVisualShadows(r.api,new THREE.PerspectiveCamera(),scene,[mesh]);if(fail)assert.throws(run,/render failure/);else run();
 assert.equal(disposed,1);assert.equal(shared,0);r.check();
});

test('program preparation releases cloned skeletons without disposing the source',async()=>{
 const {prepareVisualPrograms}=await import('../src/scene/visualPrograms.js');
 const asset=await sourceGltf('quaternius/cube-world/Character_Female_1.gltf');const originals=new Set<THREE.Skeleton>();
 asset.scene.traverse(object=>{if((object as THREE.SkinnedMesh).isSkinnedMesh)originals.add((object as THREE.SkinnedMesh).skeleton);});
 let clones=0,disposed=0;
 await prepareVisualPrograms({compileAsync:async(root:THREE.Object3D)=>{root.traverse(object=>{const mesh=object as THREE.SkinnedMesh;if(mesh.isSkinnedMesh){clones++;assert.equal(originals.has(mesh.skeleton),false);mesh.skeleton.dispose=()=>disposed++;}});return root;}},new THREE.PerspectiveCamera(),new THREE.Scene(),[asset.scene]);
 assert.ok(clones);assert.equal(disposed,clones);assert.equal(asset.scene.parent,null);
});


test('shadow warmup initializes the detached scene light state before its first depth pass',async()=>{
 const {WebGLRenderStates}=await import(new URL('../node_modules/three/src/renderers/webgl/WebGLRenderStates.js',import.meta.url).href);
 const states=new WebGLRenderStates({has:()=>false}),scene=new THREE.Scene(),sun=new THREE.DirectionalLight();sun.castShadow=true;
 scene.add(sun,new THREE.HemisphereLight());const camera=new THREE.PerspectiveCamera(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());
 let prepared=0,rendered=0;
 const r=renderer(root=>{
  const state=states.get(root);state.init(camera);
  root.traverseVisible(object=>{const light=object as THREE.Light;if(light.isLight){state.pushLight(light);if(light.castShadow)state.pushShadow(light);}});
  assert.equal(state.state.lights.state.directional.length,1);
  assert.equal(state.state.lights.state.directionalShadowMap.length,1);
  assert.equal(state.state.lights.state.hemi.length,1);
  rendered++;state.setupLights();
 });
 r.api.compile=(root,c)=>{
  assert.equal(c,camera);const state=states.get(root);state.init(c);
  root.traverseVisible(object=>{const light=object as THREE.Light;if(light.isLight){state.pushLight(light);if(light.castShadow)state.pushShadow(light);}});
  state.setupLights();prepared++;return new Set<THREE.Material>();
 };
 prepareVisualShadows(r.api,camera,scene,[mesh]);assert.equal(prepared,1);assert.equal(rendered,1);r.check();
});

test('shadow light-state preparation failure restores renderer state and releases cloned resources',()=>{
 const scene=new THREE.Scene(),sun=new THREE.DirectionalLight();sun.castShadow=true;scene.add(sun);
 const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial(),2);let released=0,shared=0;
 mesh.addEventListener('dispose',()=>shared++);mesh.geometry.addEventListener('dispose',()=>shared++);mesh.material.addEventListener('dispose',()=>shared++);
 const r=renderer(()=>assert.fail('depth render must not run after compilation failure'));
 r.api.compile=root=>{root.traverse(object=>{if(object instanceof THREE.InstancedMesh)object.addEventListener('dispose',()=>released++);});throw new Error('light state preparation failed');};
 assert.throws(()=>prepareVisualShadows(r.api,new THREE.PerspectiveCamera(),scene,[mesh]),/light state preparation failed/);
 assert.equal(released,1);assert.equal(shared,0);r.check();
});

const restorationSteps=['target','viewport','scissor','scissorTest','needsUpdate'] as const;
function failingRestoration(r:ReturnType<typeof renderer>,calls:string[],failures:Map<string,unknown>){
 const target=r.api.setRenderTarget.bind(r.api),viewport=r.api.setViewport.bind(r.api),scissor=r.api.setScissor.bind(r.api),scissorTest=r.api.setScissorTest.bind(r.api);
 const finish=(name:string)=>{calls.push(name);if(failures.has(name))throw failures.get(name);};
 r.api.setRenderTarget=(...args)=>{target(...args);finish('target');};
 let viewCalls=0,scissorCalls=0,testCalls=0,update=false;
 r.api.setViewport=((value:THREE.Vector4)=>{viewport(value);if(++viewCalls===2)finish('viewport');}) as typeof r.api.setViewport;
 r.api.setScissor=((value:THREE.Vector4)=>{scissor(value);if(++scissorCalls===2)finish('scissor');}) as typeof r.api.setScissor;
 r.api.setScissorTest=value=>{scissorTest(value);if(++testCalls===2)finish('scissorTest');};
 Object.defineProperty(r.api.shadowMap,'needsUpdate',{get:()=>update,set:(value:boolean)=>{update=value;if(!value)finish('needsUpdate');}});
}

function shadowModels(){
 const root=new THREE.Group(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial();
 root.add(new THREE.InstancedMesh(geometry,material,1),new THREE.InstancedMesh(geometry,material,1));
 for(let i=0;i<2;i++){
  const bone=new THREE.Bone(),skin=new THREE.SkinnedMesh(geometry,material);skin.add(bone);skin.bind(new THREE.Skeleton([bone]));skin.skeleton.computeBoneTexture();root.add(skin);
 }
 let shared=0;geometry.addEventListener('dispose',()=>shared++);material.addEventListener('dispose',()=>shared++);
 root.traverse(node=>{
  if(node instanceof THREE.InstancedMesh)node.addEventListener('dispose',()=>shared++);
  if(node instanceof THREE.SkinnedMesh)node.skeleton.boneTexture!.addEventListener('dispose',()=>shared++);
 });
 return{root,shared:()=>shared};
}

function observeOwnedShadowResources(staged:THREE.Object3D,calls:string[],failures:Map<string,unknown>){
 let lights=0,instances=0,skeletons=0;
 const disposed=(name:string)=>{calls.push(name);if(failures.has(name))throw failures.get(name);};
 staged.traverse(node=>{
  if(node instanceof THREE.DirectionalLight){
   const name=`shadow${lights++}`;node.shadow.map=new THREE.WebGLRenderTarget(1,1);node.shadow.map.addEventListener('dispose',()=>disposed(name));
  }
  if(node instanceof THREE.InstancedMesh){const name=`instance${instances++}`;node.addEventListener('dispose',()=>disposed(name));}
  if(node instanceof THREE.SkinnedMesh){const name=`skeleton${skeletons++}`;node.skeleton.computeBoneTexture();node.skeleton.boneTexture!.addEventListener('dispose',()=>disposed(name));}
 });
}

for(const phase of ['success','compile','render'] as const)test(`shadow ${phase} retains all failures and attempts every restoration and release`,()=>{
 const scene=new THREE.Scene(),firstLight=new THREE.DirectionalLight(),secondLight=new THREE.DirectionalLight();scene.add(firstLight,secondLight);
 const original=shadowModels(),calls:string[]=[],operationFailure=phase==='compile'?undefined:null;
 const failureNames=[...restorationSteps,'shadow0','shadow1','instance0','skeleton0','clear'];
 const failures=new Map<string,unknown>(failureNames.map(name=>[name,new AggregateError([name],name)]));
 let staged!:THREE.Object3D,held:THREE.Object3D[]=[],rendered=0,sharedShadows=0;
 for(const light of [firstLight,secondLight]){light.shadow.map=new THREE.WebGLRenderTarget(2,2);light.shadow.map.addEventListener('dispose',()=>sharedShadows++);}
 const r=renderer(()=>{rendered++;if(phase==='render')throw operationFailure;});
 r.api.compile=object=>{
  staged=object;held=[...object.children];observeOwnedShadowResources(object,calls,failures);
  object.children[0]!.addEventListener('removed',()=>{calls.push('clear');throw failures.get('clear');});
  if(phase==='compile')throw operationFailure;return new Set<THREE.Material>();
 };
 failingRestoration(r,calls,failures);
 assert.throws(()=>prepareVisualShadows(r.api,new THREE.Camera(),scene,[original.root]),error=>{
  assert.ok(error instanceof AggregateError);
  const expected=[...(phase==='success'?[]:[operationFailure]),...failureNames.map(name=>failures.get(name))];
  assert.deepEqual(error.errors,expected);for(let i=0;i<expected.length;i++)assert.equal(error.errors[i],expected[i]);return true;
 });
 assert.deepEqual(calls,[...restorationSteps,'shadow0','shadow1','instance0','instance1','skeleton0','skeleton1','clear']);
 assert.equal(rendered,phase==='compile'?0:1);assert.equal(staged.children.length,0);assert.equal(original.shared(),0);assert.equal(sharedShadows,0);r.check();
 for(const child of held)assert.equal(child.parent,null);
});

for(const origin of ['compile','render',...restorationSteps,'shadow0','instance0','skeleton0','clear'])test(`a single shadow ${origin} failure retains its original object`,()=>{
 const scene=new THREE.Scene();scene.add(new THREE.DirectionalLight(),new THREE.DirectionalLight());
 const original=shadowModels(),calls:string[]=[],failure=new AggregateError([{}],origin),failures=new Map([[origin,failure]]);
 let staged!:THREE.Object3D;
 const r=renderer(()=>{if(origin==='render')throw failure;});
 r.api.compile=object=>{
  staged=object;observeOwnedShadowResources(object,calls,failures);
  if(origin==='clear')object.children[0]!.addEventListener('removed',()=>{calls.push('clear');throw failure;});
  if(origin==='compile')throw failure;return new Set<THREE.Material>();
 };
 failingRestoration(r,calls,failures);
 let caught:unknown;try{prepareVisualShadows(r.api,new THREE.Camera(),scene,[original.root]);}catch(error){caught=error;}
 assert.equal(caught,failure);assert.equal(staged.children.length,0);assert.equal(original.shared(),0);
 assert.deepEqual(calls,[...restorationSteps,'shadow0','shadow1','instance0','instance1','skeleton0','skeleton1',...(origin==='clear'?['clear']:[])]);r.check();
});

test('shadow cleanup releases earlier clones when a template iterator fails',()=>{
 const scene=new THREE.Scene();scene.add(new THREE.DirectionalLight());
 const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),1),failure={iterator:true};let disposed=0;
 const clone=mesh.clone.bind(mesh);mesh.clone=()=>{const model=clone();model.addEventListener('dispose',()=>disposed++);return model;};
 const templates={*[Symbol.iterator](){yield mesh;throw failure;}},r=renderer(()=>assert.fail('unexpected render'));
 let caught:unknown;try{prepareVisualShadows(r.api,new THREE.Camera(),scene,templates);}catch(error){caught=error;}
 assert.equal(caught,failure);assert.equal(disposed,1);r.check();
});
