import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { sourceGltf } from './helpers/source-gltf';
import { WildlifeVisualRuntime } from '../src/scene/wildlifeVisualRuntime';
import { WildlifePresentation } from '../src/scene/wildlifePresentation';

const makeOwner = (id: string) => ({
  state: {
    id,
    species: 'raccoon' as const,
    traits: { speed: 1, size: .58, fertility: 1, wariness: 1 },
  },
  mesh: new THREE.Group(),
});

test('real raccoon lifecycle keeps owner mesh and disposes presentation container', async () => {
  const source = await sourceGltf('quaternius/wildlife/Raccoon.glb');
  let release!: (value: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }) => void;
  const runtime = new WildlifeVisualRuntime({
    load: () => new Promise(resolve => { release = resolve; }),
  });
  const presentation = new WildlifePresentation(runtime);
  const scene = new THREE.Scene();
  const owner = makeOwner('r1');
  scene.add(owner.mesh);

  presentation.register(owner);
  release({ scene: source.scene, animations: source.animations });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(owner.mesh.parent, scene);
  assert.equal(owner.mesh.children.length, 1);
  assert.ok(presentation.remove(owner));
  assert.equal(owner.mesh.parent, scene);
  assert.equal(owner.mesh.children.length, 0);
  assert.equal(presentation.remove(owner), false);
});

test('replacement and non target isolation', async () => {
  const source = await sourceGltf('quaternius/wildlife/Raccoon.glb');
  const runtime = new WildlifeVisualRuntime({
    load: async () => ({ scene: source.scene, animations: source.animations }),
  });
  const presentation = new WildlifePresentation(runtime);
  const first = makeOwner('same');
  const second = makeOwner('same');
  const rabbit = { state: { id: 'rabbit', species: 'rabbit' as const, traits: { speed: 1, size: 1, fertility: 1, wariness: 1 } }, mesh: new THREE.Group() };

  presentation.register(first);
  presentation.register(second);
  presentation.register(rabbit);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(presentation.update(first, { speed: 3, deltaSeconds: .1 }), false);
  assert.equal(second.mesh.children.length, 1);
  assert.equal(rabbit.mesh.children.length, 0);
});


test('raccoon calibrated scale keeps measured asset envelope contract', async () => {
  const source = await sourceGltf('quaternius/wildlife/Raccoon.glb');
  const runtime = new WildlifeVisualRuntime({
    load: async () => ({ scene: source.scene, animations: source.animations }),
  });
  const presentation = new WildlifePresentation(runtime);
  const owner = makeOwner('scale');
  presentation.register(owner);
  await new Promise(resolve => setImmediate(resolve));
  const container = presentation.getObject('scale');
  assert.ok(container);
  assert.equal(container?.name, 'wildlife-presentation-ground0');
  assert.ok(container?.children.length === 1);

  const visual = container!.children[0];
  const box = new THREE.Box3().setFromObject(visual);
  const measuredHeight = box.max.y - box.min.y;
  const measuredWidth = box.max.x - box.min.x;
  const measuredDepth = box.max.z - box.min.z;

  assert.ok(Math.abs(measuredHeight - 0.474208) < 0.02);
  assert.ok(Math.abs(box.min.y) < 0.02);
  assert.ok(Math.abs(measuredWidth / measuredDepth - 1.4245696583670537 / 3.2407263765388796) < 0.05);

  const larger = makeOwner('scale-large');
  larger.state.traits.size = 1.16;
  presentation.register(larger);
  await new Promise(resolve => setImmediate(resolve));
  const largerBox = new THREE.Box3().setFromObject(presentation.getObject('scale-large')!.children[0]);
  const largerHeight = largerBox.max.y - largerBox.min.y;
  assert.ok(Math.abs(largerHeight / measuredHeight - 2) < 0.1);

  const shadowMeshes: THREE.Mesh[] = [];
  visual.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) {
      shadowMeshes.push(node as THREE.Mesh);
    }
  });
  assert.ok(shadowMeshes.length > 0);
  for (const mesh of shadowMeshes) {
    assert.equal(mesh.castShadow, true);
    assert.equal(mesh.receiveShadow, true);
  }
});



test('real owner replacement cleanup preserves external mesh and exact skeleton disposal', async () => {
  const source = await sourceGltf('quaternius/wildlife/Raccoon.glb');
  const parentScene = new THREE.Scene();
  const runtime = new WildlifeVisualRuntime({
    load: async () => ({
      scene: source.scene,
      animations: source.animations,
    }),
  });

  const presentation = new WildlifePresentation(runtime);
  const oldOwner = makeOwner('replace');
  const newOwner = makeOwner('replace');
  const sibling = makeOwner('sibling');

  const sentinel = new THREE.Object3D();
  oldOwner.mesh.add(sentinel);
  parentScene.add(oldOwner.mesh, newOwner.mesh, sibling.mesh);

  presentation.register(oldOwner);
  await new Promise(resolve => setImmediate(resolve));

  const oldContainer = oldOwner.mesh.children.find(
    child => child.name === 'wildlife-presentation-ground0',
  );
  assert.ok(oldContainer);
  const oldVisual = oldContainer!.children[0];
  assert.ok(oldVisual);

  let disposeCount = 0;
  oldContainer!.traverse(node => {
    if ((node as THREE.SkinnedMesh).isSkinnedMesh) {
      const skinned = node as THREE.SkinnedMesh;
      skinned.skeleton.computeBoneTexture();
      const boneTexture = skinned.skeleton.boneTexture;
      assert.ok(boneTexture);
      boneTexture.addEventListener('dispose', () => {
        disposeCount += 1;
      });
    }
  });

  presentation.register(newOwner);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(disposeCount, 1);
  assert.equal(oldOwner.mesh.parent, parentScene);
  assert.equal(oldOwner.mesh.children.includes(sentinel), true);
  assert.equal(newOwner.mesh.parent, parentScene);

  assert.equal(oldVisual.parent, null);
  assert.equal(runtime.play(oldVisual, 'walk'), false);

  presentation.register(sibling);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sibling.mesh.parent, parentScene);
  assert.ok(sibling.mesh.children.length > 0);

  presentation.remove(newOwner);
  presentation.remove(newOwner);
  presentation.register(newOwner);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(
    newOwner.mesh.children.filter(
      child => child.name === 'wildlife-presentation-ground0',
    ).length,
    1,
  );
});

test('real raccoon animation continuity uses bones and action mapping', async () => {
  const source = await sourceGltf('quaternius/wildlife/Raccoon.glb');
  const runtime = new WildlifeVisualRuntime({
    load: async () => ({
      scene: source.scene,
      animations: source.animations,
    }),
  });

  const played: string[] = [];
  const originalPlay = runtime.play.bind(runtime);
  runtime.play = (visual, action) => {
    played.push(action);
    return originalPlay(visual, action);
  };

  const presentation = new WildlifePresentation(runtime);
  const a = makeOwner('animation-a');
  const b = makeOwner('animation-b');

  presentation.register(a);
  presentation.register(b);
  await new Promise(resolve => setImmediate(resolve));

  const collectBones = (owner: ReturnType<typeof makeOwner>) => {
    const values: number[] = [];
    owner.mesh.traverse(node => {
      if ((node as THREE.Bone).isBone) {
        const bone = node as THREE.Bone;
        values.push(
          ...bone.position.toArray(),
          ...bone.quaternion.toArray(),
          ...bone.scale.toArray(),
        );
      }
    });
    return values;
  };

  presentation.update(a, { speed: .5, action: 'wander', deltaSeconds: .1 });
  const first = collectBones(a);
  presentation.update(a, { speed: .5, action: 'wander', deltaSeconds: .1 });
  const second = collectBones(a);

  presentation.update(b, { speed: .5, action: 'wander', deltaSeconds: .2 });
  const combined = collectBones(b);

  assert.ok(first.length > 0);
  assert.notDeepEqual(first, second);
  assert.equal(second.length, combined.length);
  second.forEach((value, index) => {
    assert.ok(Math.abs(value - combined[index]) < 1e-5);
  });

  presentation.update(a, { speed: 0, action: 'idle', deltaSeconds: .1 });
  presentation.update(a, { speed: 0, blocked: true, action: 'idle', deltaSeconds: .1 });
  presentation.update(a, { speed: 0, action: 'forage', deltaSeconds: .1 });
  presentation.update(a, { speed: .5, action: 'wander', deltaSeconds: .1 });
  presentation.update(a, { speed: 3, action: 'wander', deltaSeconds: .1 });

  assert.ok(played.includes('idle'));
  assert.ok(played.includes('eat'));
  assert.ok(played.includes('walk'));
  assert.ok(played.includes('run'));

  const before = played.length;
  presentation.update(a, { speed: 3, action: 'wander', deltaSeconds: .1 });
  assert.equal(played.length, before);
});
