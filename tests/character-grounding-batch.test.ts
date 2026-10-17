import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils.js';
import {CharacterSoles} from '../src/scene/characterSoles.js';
import {sourceGltf} from './helpers/source-gltf.js';

for(const file of ['Character_Female_1','Character_Female_2','Character_Male_1','Character_Male_2']){
  test(`${file} preserves final foot support when grounding once per presented frame`,async()=>{
    const loaded=await sourceGltf(`quaternius/cube-world/${file}.gltf`);
    let poses=0;
    for(const name of ['Idle','Walk','Run','Wave','Yes','Punch']){
      const clip=loaded.animations.find(candidate=>candidate.name===name);
      assert.ok(clip,`${file} is missing ${name}`);
      const pair=[0,1].map(()=>{
        const model=clone(loaded.scene),anchor=new THREE.Group();
        anchor.add(model);model.updateMatrixWorld(true);
        const bounds=new THREE.Box3().setFromObject(model,true);
        model.scale.multiplyScalar(1.82/(bounds.max.y-bounds.min.y));
        model.updateMatrixWorld(true);
        const fit=new THREE.Box3().setFromObject(model,true),center=fit.getCenter(new THREE.Vector3());
        model.position.set(-center.x,-fit.min.y,-center.z);
        const mixer=new THREE.AnimationMixer(model);
        mixer.clipAction(clip).play();
        return {model,anchor,mixer,soles:new CharacterSoles(model)};
      });
      for(const [frame,substeps] of [1,4,10,20,40].entries()){
        for(const [index,{anchor,mixer,soles}] of pair.entries()){
          for(let step=0;step<substeps;step++){
            anchor.position.set(frame*.3+step*.01,frame*.2,step*.02);
            anchor.rotation.y=step*.03;
            mixer.update(.05);
            if(index===0)assert.equal(soles.ground(anchor.position.y),true);
          }
          if(index===1)assert.equal(soles.ground(anchor.position.y),true);
        }
        assert.deepEqual(pair[0].anchor.position,pair[1].anchor.position);
        assert.equal(pair[0].mixer.time,pair[1].mixer.time);
        const before=pair[0].soles.minimumWorldY(),after=pair[1].soles.minimumWorldY();
        assert.notEqual(before,undefined);assert.notEqual(after,undefined);
        assert.ok(Math.abs(before!-after!)<1e-8,`${file} ${name} ${substeps}: ${before} != ${after}`);
        assert.ok(Math.abs(after!-pair[1].anchor.position.y)<1e-8);
        poses++;
      }
    }
    assert.equal(poses,30);
  });
}
