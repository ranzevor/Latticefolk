import type {BufferGeometry,Material,Mesh,Object3D} from 'three';
import {retireResources} from './retireResources.js';

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
  retireResources([
    ...[...resources.geometries].map(geometry=>()=>{geometry.dispose();}),
    ...[...resources.materials].map(material=>()=>{material.dispose();})
  ]);
  return true;
}
