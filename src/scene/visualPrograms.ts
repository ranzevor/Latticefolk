import * as THREE from 'three';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils.js';

function releaseStaging(root:THREE.Object3D){
  const skeletons=new Set<THREE.Skeleton>();
  root.traverse(object=>{
    if((object as THREE.SkinnedMesh).isSkinnedMesh)skeletons.add((object as THREE.SkinnedMesh).skeleton);
    if((object as THREE.InstancedMesh).isInstancedMesh)(object as THREE.InstancedMesh).dispose();
  });
  for(const skeleton of skeletons)skeleton.dispose();
  root.clear();
}

export async function prepareVisualPrograms(renderer:Pick<THREE.WebGLRenderer,'compileAsync'>,camera:THREE.Camera,scene:THREE.Scene,templates:Iterable<THREE.Object3D>){
  const staging=new THREE.Group();
  for(const template of templates){
    const model=clone(template);
    model.traverse(object=>{
      const mesh=object as THREE.Mesh;
      if(mesh.isMesh){mesh.castShadow=true;mesh.receiveShadow=true;}
    });
    staging.add(model);
  }
  try{await renderer.compileAsync(staging,camera,scene);}
  finally{releaseStaging(staging);}
}

type ShadowRenderer=Pick<THREE.WebGLRenderer,'compile'|'render'|'getRenderTarget'|'setRenderTarget'|'getActiveCubeFace'|'getActiveMipmapLevel'|'getViewport'|'setViewport'|'getScissor'|'setScissor'|'getScissorTest'|'setScissorTest'>&{shadowMap:Pick<THREE.WebGLRenderer['shadowMap'],'enabled'|'needsUpdate'>};
export function prepareVisualShadows(renderer:ShadowRenderer,camera:THREE.Camera,scene:THREE.Scene,templates:Iterable<THREE.Object3D>){
  if(!renderer.shadowMap.enabled)return;
  const staging=new THREE.Scene();
  staging.fog=scene.fog;staging.environment=scene.environment;
  const shadows:THREE.LightShadow[]=[];
  scene.traverseVisible(object=>{
    const light=object as THREE.Light&{shadow?:THREE.LightShadow;target?:THREE.Object3D};
    if(!light.isLight)return;
    const copy=light.clone(false) as typeof light;
    light.updateWorldMatrix(true,false);copy.matrix.copy(light.matrixWorld);copy.matrixAutoUpdate=false;
    if(copy.target&&light.target){light.target.updateWorldMatrix(true,false);copy.target.matrix.copy(light.target.matrixWorld);copy.target.matrixAutoUpdate=false;staging.add(copy.target);}
    if(copy.shadow){copy.shadow.mapSize.set(1,1);copy.shadow.autoUpdate=true;copy.shadow.needsUpdate=true;shadows.push(copy.shadow);}
    staging.add(copy);
  });
  if(!shadows.length){staging.clear();return;}
  for(const template of templates){
    const model=clone(template);
    model.traverse(object=>{
      const mesh=object as THREE.SkinnedMesh;
      if(mesh.isMesh){mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;}
    });
    staging.add(model);
  }
  const previous=renderer.getRenderTarget();
  const cubeFace=renderer.getActiveCubeFace(),mipLevel=renderer.getActiveMipmapLevel();
  const viewport=renderer.getViewport(new THREE.Vector4()),scissor=renderer.getScissor(new THREE.Vector4()),scissorTest=renderer.getScissorTest();
  const needsUpdate=renderer.shadowMap.needsUpdate;
  try{
    renderer.shadowMap.needsUpdate=true;
    renderer.setViewport(new THREE.Vector4(0,0,1,1));renderer.setScissor(new THREE.Vector4(0,0,1,1));renderer.setScissorTest(true);
    renderer.compile(staging,camera);
    renderer.render(staging,camera);
  }finally{
    renderer.setRenderTarget(previous,cubeFace,mipLevel);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
    renderer.shadowMap.needsUpdate=needsUpdate;
    for(const shadow of shadows)shadow.dispose();
    releaseStaging(staging);
  }
}

