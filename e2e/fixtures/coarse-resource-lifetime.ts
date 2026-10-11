import * as THREE from 'three';
import {CoarseWorldRuntime} from '../../src/world/coarseWorld.js';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils.js';

export function measureCoarseResourceLifetime(source:THREE.Object3D){
 const renderer=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(512,384);document.body.append(renderer.domElement);
 const scene=new THREE.Scene();scene.background=new THREE.Color(0x223344);scene.add(new THREE.HemisphereLight(0xffffff,0x777777,3));
 const keeper=clone(source);keeper.scale.setScalar(12);keeper.position.y=2;scene.add(keeper);
 const world=new CoarseWorldRuntime(scene);
 const camera=new THREE.OrthographicCamera(-480,480,360,-360,.1,2000);camera.position.set(120,900,0);camera.up.set(0,0,-1);camera.lookAt(120,0,0);
 const draw=()=>{scene.updateMatrixWorld(true);renderer.render(scene,camera);return {...renderer.info.memory};};
 world.ensureWindowAround(240,0);draw();world.ensureWindowAround(0,0);draw();
 world.restoreKnownChunks([...world.chunks.values()].map(state=>structuredClone(state)));
 const states=[...world.chunks.values()].map(state=>structuredClone(state));
 const authoritativeBefore=JSON.stringify(states);
 const baseline=draw(),before=renderer.domElement.toDataURL(),homeIds=[...world.activeChunkIds].sort();
 const cycles=[];
 for(let cycle=0;cycle<8;cycle++){
  world.restoreKnownChunks(states);const refreshed=draw();
  world.ensureWindowAround(240,0);const away=draw(),awayChunks=world.activeChunkIds.size;
  world.ensureWindowAround(0,0);const returned=draw();
  cycles.push({refreshed,away,awayChunks,returned,homeIds:[...world.activeChunkIds].sort()});
 }
 const final=draw(),after=renderer.domElement.toDataURL();
 return {baseline,cycles,final,homeIds,homeChunks:world.activeChunkIds.size,
  authoritativeUnchanged:JSON.stringify([...world.chunks.values()])===authoritativeBefore,
  pixelsIdentical:before===after,materialized:world.materialized.size,triangles:renderer.info.render.triangles};
}
