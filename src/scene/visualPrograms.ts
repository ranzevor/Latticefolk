import * as THREE from 'three';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils.js';

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
  finally{staging.clear();}
}
