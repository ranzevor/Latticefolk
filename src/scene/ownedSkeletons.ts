import type {Object3D,SkinnedMesh,Skeleton} from 'three';

export function disposeOwnedSkeletons(root:Object3D){
  const skeletons=new Set<Skeleton>();
  root.traverse(node=>{const mesh=node as SkinnedMesh;if(mesh.isSkinnedMesh)skeletons.add(mesh.skeleton);});
  for(const skeleton of skeletons)skeleton.dispose();
}
