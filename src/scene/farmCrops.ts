import {retireResources} from './retireResources.js';
import * as THREE from 'three';

const rows=[-1.25,-.42,.42,1.25];
const offsets=rows.flatMap(x=>[-.72,0,.72].map(z=>new THREE.Matrix4().makeTranslation(x,0,z)));

/** Repeat the normalized sourced wheat inside one plot without duplicating draw calls. */
export function farmCropRows(source:THREE.Object3D):THREE.Group {
  const group=new THREE.Group();
  source.updateMatrixWorld(true);
  source.traverseVisible(node=>{
    if(!(node instanceof THREE.Mesh))return;
    const materials=Array.isArray(node.material)?node.material:[node.material];
    // Per-instance reflection is unsupported by Three's instanced renderer. Preserve
    // mirrored or blended source surfaces as ordinary meshes with their exact matrices.
    if(node.matrixWorld.determinant()<0||materials.some(material=>material.transparent)||node instanceof THREE.SkinnedMesh){
      for(const offset of offsets){
        const mesh=node.clone(false);mesh.matrixAutoUpdate=false;
        mesh.matrix.multiplyMatrices(offset,node.matrixWorld);group.add(mesh);
      }
      return;
    }
    const mesh=new THREE.InstancedMesh(node.geometry,node.material,offsets.length);
    mesh.castShadow=node.castShadow;mesh.receiveShadow=node.receiveShadow;
    mesh.renderOrder=node.renderOrder;mesh.layers.mask=node.layers.mask;
    mesh.userData.farmCropRows=true;
    offsets.forEach((offset,index)=>mesh.setMatrixAt(index,new THREE.Matrix4().multiplyMatrices(offset,node.matrixWorld)));
    mesh.instanceMatrix.needsUpdate=true;
    mesh.computeBoundingBox();mesh.computeBoundingSphere();group.add(mesh);
  });
  return group;
}

/** Plot-owned instance buffers are terminally retired after one best-effort attempt. */
const retiredRows=new WeakSet<THREE.InstancedMesh>();
export function disposeFarmCropRows(root:THREE.Object3D){
  const meshes:THREE.InstancedMesh[]=[];
  root.traverse(node=>{
    if(node instanceof THREE.InstancedMesh&&node.userData.farmCropRows&&!retiredRows.has(node)){
      retiredRows.add(node);
      meshes.push(node);
    }
  });
  retireResources(meshes.map(mesh=>()=>mesh.dispose()));
}
