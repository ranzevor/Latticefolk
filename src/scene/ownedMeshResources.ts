import type {BufferGeometry,Material,Mesh,Object3D} from 'three';

const owned=new WeakMap<Object3D,{geometries:Set<BufferGeometry>;materials:Set<Material>}>();

export function rememberOwnedMeshResources(root:Object3D,materials:Iterable<Material>):void {
  if(owned.has(root))throw new Error('Mesh resources already have an owner');
  const geometries=new Set<BufferGeometry>();
  root.traverse(node=>{const mesh=node as Mesh;if(mesh.isMesh)geometries.add(mesh.geometry);});
  owned.set(root,{geometries,materials:new Set(materials)});
}

export function disposeOwnedMeshResources(root:Object3D):boolean {
  const resources=owned.get(root);if(!resources)return false;
  owned.delete(root);
  for(const geometry of resources.geometries)geometry.dispose();
  for(const material of resources.materials)material.dispose();
  return true;
}
