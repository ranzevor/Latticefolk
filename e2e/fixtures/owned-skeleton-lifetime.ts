import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils.js';
import {disposeOwnedSkeletons} from '../../src/scene/ownedSkeletons.js';

declare global {interface Window {skeletonLifetime:Promise<unknown>;}}
window.skeletonLifetime=(async()=>{
 const renderer=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(512,384);document.body.append(renderer.domElement);
 const scene=new THREE.Scene();scene.background=new THREE.Color(0x223344);scene.add(new THREE.HemisphereLight(0xffffff,0x777777,3));
 const source=(await new GLTFLoader().loadAsync('/assets/quaternius/cube-world/Character_Female_1.gltf')).scene;
 const keeper=clone(source);scene.add(keeper);
 const box=new THREE.Box3().setFromObject(keeper),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
 const camera=new THREE.PerspectiveCamera(35,512/384,.01,1000);camera.position.copy(center).add(new THREE.Vector3(size.y*.2,size.y*.1,size.y*2.3));camera.lookAt(center);
 const draw=()=>{scene.updateMatrixWorld(true);renderer.render(scene,camera);return {...renderer.info.memory};};
 const baseline=draw(),before=renderer.domElement.toDataURL();const cycles:unknown[]=[];let owned=0;
 for(let cycle=0;cycle<8;cycle++){
  const instances=[clone(source),clone(source)];for(const instance of instances){instance.traverse(node=>{if((node as THREE.SkinnedMesh).isSkinnedMesh)owned++;});scene.add(instance);}
  const allocated=draw();for(const instance of instances){disposeOwnedSkeletons(instance);instance.removeFromParent();}
  const released=draw();cycles.push({allocated,released});
 }
 const unreleased=clone(source);scene.add(unreleased);const controlAllocated=draw();unreleased.removeFromParent();const controlDetached=draw();disposeOwnedSkeletons(unreleased);const controlDisposed=draw();
 const final=draw(),after=renderer.domElement.toDataURL(),triangles=renderer.info.render.triangles;
 return {baseline,cycles,control:{allocated:controlAllocated,detached:controlDetached,disposed:controlDisposed},final,owned,triangles,pixelsIdentical:before===after};
})();
