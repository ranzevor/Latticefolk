import {retireResources} from './retireResources.js';
import type {Object3D,SkinnedMesh,Skeleton} from 'three';

export function disposeOwnedSkeletons(root:Object3D){
  const skeletons=new Set<Skeleton>();
  root.traverse(node=>{const mesh=node as SkinnedMesh;if(mesh.isSkinnedMesh)skeletons.add(mesh.skeleton);});
  retireResources([...skeletons].map(skeleton=>()=>skeleton.dispose()));
}
