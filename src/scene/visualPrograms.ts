import * as THREE from 'three';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils.js';
import {retireResources} from './retireResources.js';

function releaseStaging(root:THREE.Object3D,failures:unknown[],before:Iterable<()=>void>=[]){
  const skeletons=new Set<THREE.Skeleton>(),instances=new Set<THREE.InstancedMesh>();
  root.traverse(object=>{
    if((object as THREE.SkinnedMesh).isSkinnedMesh)skeletons.add((object as THREE.SkinnedMesh).skeleton);
    if((object as THREE.InstancedMesh).isInstancedMesh)instances.add(object as THREE.InstancedMesh);
  });
  try{
    retireResources([
      ...before,
      ...[...instances].map(instance=>()=>{instance.dispose();}),
      ...[...skeletons].map(skeleton=>()=>{skeleton.dispose();}),
      ()=>{
        try{root.clear();}
        finally{
          for(const child of root.children)if(child.parent===root)child.parent=null;
          root.children.length=0;
        }
      }
    ]);
  }catch(error){failures.push(...(error as AggregateError).errors);}
  if(failures.length===1)throw failures[0];
  if(failures.length>1)throw new AggregateError(failures,'Visual preparation failed');
}

export async function prepareVisualPrograms(renderer:Pick<THREE.WebGLRenderer,'compileAsync'>,camera:THREE.Camera,scene:THREE.Scene,templates:Iterable<THREE.Object3D>){
  const staging=new THREE.Group(),failures:unknown[]=[];
  try{
    for(const template of templates){
      const model=clone(template);staging.add(model);
      model.traverse(object=>{
        const mesh=object as THREE.Mesh;
        if(mesh.isMesh){mesh.castShadow=true;mesh.receiveShadow=true;}
      });
    }
    await renderer.compileAsync(staging,camera,scene);
  }catch(error){failures.push(error);}
  finally{releaseStaging(staging,failures);}
}

type ShadowRenderer=Pick<THREE.WebGLRenderer,'compile'|'render'|'getRenderTarget'|'setRenderTarget'|'getActiveCubeFace'|'getActiveMipmapLevel'|'getViewport'|'setViewport'|'getScissor'|'setScissor'|'getScissorTest'|'setScissorTest'>&{shadowMap:Pick<THREE.WebGLRenderer['shadowMap'],'enabled'|'needsUpdate'>};
export function prepareVisualShadows(renderer:ShadowRenderer,camera:THREE.Camera,scene:THREE.Scene,templates:Iterable<THREE.Object3D>){
  if(!renderer.shadowMap.enabled)return;
  const staging=new THREE.Scene();
  staging.fog=scene.fog;staging.environment=scene.environment;
  const shadows=new Set<THREE.LightShadow>(),restore:(()=>void)[]=[],failures:unknown[]=[];
  try{
    scene.traverseVisible(object=>{
      const light=object as THREE.Light&{shadow?:THREE.LightShadow;target?:THREE.Object3D};
      if(!light.isLight)return;
      const copy=light.clone(false) as typeof light;
      if(copy.shadow)shadows.add(copy.shadow);
      staging.add(copy);
      light.updateWorldMatrix(true,false);copy.matrix.copy(light.matrixWorld);copy.matrixAutoUpdate=false;
      if(copy.target&&light.target){light.target.updateWorldMatrix(true,false);copy.target.matrix.copy(light.target.matrixWorld);copy.target.matrixAutoUpdate=false;staging.add(copy.target);}
      if(copy.shadow){copy.shadow.mapSize.set(1,1);copy.shadow.autoUpdate=true;copy.shadow.needsUpdate=true;}
    });
    if(!shadows.size)return;
    for(const template of templates){
      const model=clone(template);staging.add(model);
      model.traverse(object=>{
        const mesh=object as THREE.SkinnedMesh;
        if(mesh.isMesh){mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;}
      });
    }
    const previous=renderer.getRenderTarget();
    const cubeFace=renderer.getActiveCubeFace(),mipLevel=renderer.getActiveMipmapLevel();
    const viewport=renderer.getViewport(new THREE.Vector4()),scissor=renderer.getScissor(new THREE.Vector4()),scissorTest=renderer.getScissorTest();
    const needsUpdate=renderer.shadowMap.needsUpdate;
    restore.push(
      ()=>{renderer.setRenderTarget(previous,cubeFace,mipLevel);},
      ()=>{renderer.setViewport(viewport);},
      ()=>{renderer.setScissor(scissor);},
      ()=>{renderer.setScissorTest(scissorTest);},
      ()=>{renderer.shadowMap.needsUpdate=needsUpdate;}
    );
    renderer.shadowMap.needsUpdate=true;
    renderer.setViewport(new THREE.Vector4(0,0,1,1));renderer.setScissor(new THREE.Vector4(0,0,1,1));renderer.setScissorTest(true);
    renderer.compile(staging,camera);
    renderer.render(staging,camera);
  }catch(error){failures.push(error);}
  finally{
    releaseStaging(staging,failures,[...restore,...[...shadows].map(shadow=>()=>{shadow.dispose();})]);
  }
}

