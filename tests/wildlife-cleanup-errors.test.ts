import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';
import { WildlifeVisualRuntime } from '../src/scene/wildlifeVisualRuntime.js';
import { WildlifePresentation } from '../src/scene/wildlifePresentation.js';
import { applyRaccoonAppearance, type RaccoonAppearance } from '../src/scene/raccoonAppearance.js';
import { rememberOwnedMeshResources, disposeOwnedMeshResources } from '../src/scene/ownedMeshResources.js';
import { StreamedActors } from '../src/scene/streamedActors.js';
import { SimulationClock } from '../src/world/simulationClock.js';
import { normalizeWildlifePhenotype, wildlifeFunctionalPhenotype } from '../src/world/wildlifePhenotype.js';
import { normalizeWildlifeOrganismGenome } from '../src/world/organismFamilies.js';
import { retireResources } from '../src/scene/retireResources.js';

const appearance = {
  phenotype: { morphology: { bodyLength: 1, bodyHeight: 1, headScale: 1, tailScale: 1, legLength: 1 } },
  genome: { material: { hueShift: .1, lightnessShift: 0, accentShift: 0 } },
} as unknown as RaccoonAppearance;

function asset(meshCount = 1) {
  const scene = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1, 0, 1, 0], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Array(12).fill(0), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(Array(3).fill([.6501554250717163, .8436211347579956]).flat(), 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(Array(9).fill(1), 3));
  const material = new THREE.MeshBasicMaterial();
  const skeletons: THREE.Skeleton[] = [];
  for (let i = 0; i < meshCount; i++) {
    const bone = new THREE.Bone(); bone.name = 'Body';
    const mesh = new THREE.SkinnedMesh(geometry, material); mesh.add(bone);
    const skeleton = new THREE.Skeleton([bone]); mesh.bind(skeleton); skeletons.push(skeleton); scene.add(mesh);
  }
  const animations = ['Idle', 'Walk', 'Run', 'Idle_Eating', 'Death'].map(name =>
    new THREE.AnimationClip(`AnimalArmature|AnimalArmature|AnimalArmature|${name}`, 1, [
      new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [0, 4]),
    ]));
  return { scene, geometry, material, skeletons, animations };
}

function failures(error: unknown): unknown[] {
  return error instanceof AggregateError ? error.errors.flatMap(failures) : [error];
}

function thrown(action: () => void): unknown {
  try { action(); } catch (error) { return error; }
  assert.fail('expected cleanup failure');
}

test('runtime retirement attempts all real resources in order, detaches, and is reentrant and identity-safe', async () => {
  const source = asset(2), runtime = new WildlifeVisualRuntime({ load: async () => source });
  await runtime.load('raccoon');
  const root = runtime.createInstance('raccoon', 0)!, sibling = runtime.createInstance('raccoon', 0)!;
  const parent = new THREE.Group(); parent.add(root, sibling);
  const state = (runtime as unknown as { instances: Map<THREE.Object3D, {
    actions: Map<string, THREE.AnimationAction>; mixer: THREE.AnimationMixer; ownedSkeletons: Set<THREE.Skeleton>;
  }> }).instances.get(root)!;
  const calls: string[] = [], expected: unknown[] = [];
  let reentered = false;
  for (const [name, action] of state.actions) {
    const stop = action.stop.bind(action), error = { action: name }; expected.push(error);
    action.stop = () => {
      calls.push(name);
      if (!reentered) { reentered = true; runtime.dispose(root); }
      stop(); throw error;
    };
  }
  const stopAll = state.mixer.stopAllAction.bind(state.mixer), uncache = state.mixer.uncacheRoot.bind(state.mixer);
  const stopError = { mixer: 'stop' }, uncacheError = { mixer: 'uncache' };
  expected.push(stopError, uncacheError);
  state.mixer.stopAllAction = () => { calls.push('mixer-stop'); stopAll(); throw stopError; };
  state.mixer.uncacheRoot = value => { calls.push('uncache'); uncache(value); throw uncacheError; };
  for (const [index, skeleton] of [...state.ownedSkeletons].entries()) {
    skeleton.computeBoneTexture(); const error = { skeleton: index }; expected.push(error);
    skeleton.boneTexture!.addEventListener('dispose', () => { calls.push(`skeleton-${index}`); throw error; });
  }
  let sharedDisposed = 0;
  source.geometry.addEventListener('dispose', () => sharedDisposed++);
  source.material.addEventListener('dispose', () => sharedDisposed++);
  for (const skeleton of source.skeletons) { skeleton.computeBoneTexture(); skeleton.boneTexture!.addEventListener('dispose', () => sharedDisposed++); }
  const stale = new THREE.Group(); stale.uuid = root.uuid; runtime.dispose(stale);
  assert.equal(root.parent, parent);
  assert.deepEqual(failures(thrown(() => runtime.dispose(root))), expected);
  assert.deepEqual(calls, ['idle', 'walk', 'run', 'eat', 'death', 'mixer-stop', 'uncache', 'skeleton-0', 'skeleton-1']);
  assert.equal(root.parent, null); assert.equal(sharedDisposed, 0); assert.equal(runtime.play(root, 'walk'), false);
  const count = calls.length; runtime.dispose(root); assert.equal(calls.length, count);
  assert.equal(runtime.play(sibling, 'walk'), true); runtime.update(sibling, .25); assert.equal(sibling.position.x, 1);
  runtime.dispose(sibling);
});

test('runtime skeleton failure still retires instance-owned appearance geometry and leaves template and sibling intact', async () => {
  const source = asset(), runtime = new WildlifeVisualRuntime({ load: async () => source }); await runtime.load('raccoon');
  const root = runtime.createInstance('raccoon', 0, 1, appearance)!, sibling = runtime.createInstance('raccoon', 0, 1, appearance)!;
  const mesh = root.children[0] as THREE.SkinnedMesh, other = sibling.children[0] as THREE.SkinnedMesh;
  assert.notEqual(mesh.geometry, source.geometry); assert.notEqual(mesh.geometry, other.geometry);
  mesh.skeleton.computeBoneTexture(); const first = { skeleton: true }, second = { geometry: true }; const calls: string[] = [];
  mesh.skeleton.boneTexture!.addEventListener('dispose', () => { calls.push('skeleton'); throw first; });
  mesh.geometry.addEventListener('dispose', () => { calls.push('geometry'); throw second; });
  let shared = 0; source.geometry.addEventListener('dispose', () => shared++); other.geometry.addEventListener('dispose', () => shared++);
  const parent = new THREE.Group(); parent.add(root);
  assert.deepEqual(failures(thrown(() => runtime.dispose(root))), [first, second]);
  assert.deepEqual(calls, ['skeleton', 'geometry']); assert.equal(root.parent, null); assert.equal(shared, 0);
  runtime.dispose(root); assert.equal(calls.length, 2); runtime.dispose(sibling);
});

test('owned mesh disposal continues after throwing listeners and only releases recorded identities once', () => {
  const root = new THREE.Group(), geometry = new THREE.BoxGeometry(), otherGeometry = new THREE.BoxGeometry();
  const material = new THREE.MeshBasicMaterial(), otherMaterial = new THREE.MeshBasicMaterial();
  root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(otherGeometry, material));
  rememberOwnedMeshResources(root, [material, otherMaterial, material]);
  const foreign = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); root.add(foreign);
  const calls: string[] = [], first = { geometry: true }, second = { material: true };
  geometry.addEventListener('dispose', () => { calls.push('geometry'); assert.equal(disposeOwnedMeshResources(root), false); throw first; });
  otherGeometry.addEventListener('dispose', () => calls.push('other-geometry'));
  material.addEventListener('dispose', () => { calls.push('material'); throw second; });
  otherMaterial.addEventListener('dispose', () => calls.push('other-material'));
  foreign.geometry.addEventListener('dispose', () => assert.fail('foreign geometry disposed'));
  assert.deepEqual(failures(thrown(() => disposeOwnedMeshResources(root))), [first, second]);
  assert.deepEqual(calls, ['geometry', 'other-geometry', 'material', 'other-material']);
  assert.equal(disposeOwnedMeshResources(root), false);
});

test('failed appearance restores shared geometry even when disposing the clone throws, preserving both errors', () => {
  const source = asset(), mesh = source.scene.children[0] as THREE.SkinnedMesh;
  source.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(Array(6).fill(0), 2));
  const clone = source.geometry.clone.bind(source.geometry), cleanup = { cleanup: true }; let disposed = 0;
  source.geometry.clone = () => { const geometry = clone(); geometry.addEventListener('dispose', () => { disposed++; throw cleanup; }); return geometry; };
  const error = thrown(() => applyRaccoonAppearance(source.scene, source.animations, appearance));
  const list = failures(error); assert.ok(list[0] instanceof Error); assert.match((list[0] as Error).message, /Unknown raccoon source atlas swatch/);
  assert.equal(list[1], cleanup); assert.equal(mesh.geometry, source.geometry); assert.equal(disposed, 1);
});

test('bounds failure after successful adaptation releases clones and preserves construction error before cleanup errors', async () => {
  const source = asset(), runtime = new WildlifeVisualRuntime({ load: async () => source }); await runtime.load('raccoon');
  const primary = { bounds: true }, cleanup = { cleanup: true }; let geometryDisposed = 0, skeletonDisposed = 0;
  const clone = source.geometry.clone.bind(source.geometry);
  source.geometry.clone = () => { const geometry = clone(); geometry.addEventListener('dispose', () => { geometryDisposed++; throw cleanup; }); return geometry; };
  const bounds = THREE.Box3.prototype.setFromObject, dispose = THREE.Skeleton.prototype.dispose;
  THREE.Box3.prototype.setFromObject = () => { throw primary; };
  THREE.Skeleton.prototype.dispose = function () { assert.notEqual(this, source.skeletons[0]); skeletonDisposed++; dispose.call(this); };
  try {
    assert.deepEqual(failures(thrown(() => runtime.createInstance('raccoon', 0, 1, appearance))), [primary, cleanup]);
    assert.equal(geometryDisposed, 1); assert.equal(skeletonDisposed, 1);
  } finally { THREE.Box3.prototype.setFromObject = bounds; THREE.Skeleton.prototype.dispose = dispose; }
  assert.equal(runtime.getState('raccoon')?.status, 'ready');
  const recreated = runtime.createInstance('raccoon', 0)!; assert.ok(recreated); runtime.dispose(recreated);
});

test('partial mixer setup failure uncaches real actions and releases every cloned skeleton', async () => {
  const source = asset(2), runtime = new WildlifeVisualRuntime({ load: async () => source }); await runtime.load('raccoon');
  const primary = { mixer: 'create' }, cleanup = { skeleton: 'cleanup' };
  const clipAction = THREE.AnimationMixer.prototype.clipAction, uncache = THREE.AnimationMixer.prototype.uncacheRoot, dispose = THREE.Skeleton.prototype.dispose;
  let actions = 0, uncached = 0, disposed = 0;
  THREE.AnimationMixer.prototype.clipAction = function (...args: Parameters<typeof clipAction>) { if (++actions === 2) throw primary; return clipAction.apply(this, args)!; };
  THREE.AnimationMixer.prototype.uncacheRoot = function (root) { uncached++; uncache.call(this, root); };
  THREE.Skeleton.prototype.dispose = function () { disposed++; dispose.call(this); if (disposed === 1) throw cleanup; };
  try {
    assert.deepEqual(failures(thrown(() => runtime.createInstance('raccoon', 0))), [primary, cleanup]);
    assert.equal(uncached, 1); assert.equal(disposed, 2);
  } finally { THREE.AnimationMixer.prototype.clipAction = clipAction; THREE.AnimationMixer.prototype.uncacheRoot = uncache; THREE.Skeleton.prototype.dispose = dispose; }
});

const sourceText = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('main.ts', sourceText, ts.ScriptTarget.Latest, true);
function gameMembers(names: string[], dependencies: Record<string, unknown>) {
  const members: string[] = [];
  for (const node of ast.statements) if (ts.isClassDeclaration(node) && node.name?.text === 'TownGame') {
    for (const member of node.members) if (member.name && names.includes(member.name.getText(ast))) members.push(member.getText(ast));
  }
  assert.equal(members.length, names.length);
  return new Function(...Object.keys(dependencies), ts.transpileModule(`return class Runtime {${members.join('\n')}}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText)(...Object.values(dependencies));
}

for (const retained of [true, false]) test(`death continues all resource cleanup and active retirement with retained=${retained}`, () => {
  const Runtime = gameMembers(['streamedWildlife', 'wildlifeRetirementErrors', 'removeWildlife'], { StreamedActors, retireResources, disposeOwnedMeshResources, i18n: { t: (s: string) => s } });
  const runtime = new Runtime(), root = new THREE.Group(), geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial();
  root.add(new THREE.Mesh(geometry, material)); new THREE.Scene().add(root); rememberOwnedMeshResources(root, [material]);
  const actor = { state: { id: 'dead', species: 'raccoon', traits: {} }, mesh: root, removed: false };
  const first = { presentation: true }, second = { geometry: true }, calls: string[] = [], record: Record<string, unknown> = {};
  Object.assign(runtime, { wildlife: new Map([['dead', actor]]), wildlifePresentation: { remove() { calls.push('presentation'); runtime.removeWildlife(actor, 'disease'); throw first; } },
    recordWildlifeHabitatExposure() {}, day: 1, minuteOfDay: 0, ensureWildlifeLineage: () => record, wildlifeHabitatSnapshot: () => ({}), lineageEpoch: 0,
    event() { calls.push('event'); }, wildlifeName: () => '', clearMovablePersistenceQueue() { calls.push('clear-queue'); }, log() { calls.push('log'); } });
  geometry.addEventListener('dispose', () => { calls.push('geometry'); throw second; }); material.addEventListener('dispose', () => calls.push('material'));
  if (retained) runtime.streamedWildlife.remember(actor);
  runtime.removeWildlife(actor, 'disease');
  assert.deepEqual(failures(runtime.wildlifeRetirementErrors[0]), [first, second]);
  assert.equal(runtime.persistenceLoadBlocked, true);
  assert.deepEqual(calls, ['presentation', 'geometry', 'material', 'clear-queue', 'log', 'event']); assert.equal(root.parent, null);
  assert.equal(runtime.wildlife.has('dead'), false); assert.equal(runtime.streamedWildlife.get('dead'), undefined); assert.equal(record.deathDay, 1);
  runtime.removeWildlife(actor, 'disease'); assert.equal(calls.length, 6);
});

test('stale death owner cannot delete or dispose a same-id replacement', () => {
  const Runtime = gameMembers(['streamedWildlife', 'wildlifeRetirementErrors', 'removeWildlife'], { StreamedActors, retireResources, disposeOwnedMeshResources, i18n: { t: (s: string) => s } });
  const runtime = new Runtime(), stale = { state: { id: 'shared-id' }, mesh: new THREE.Group() }, replacement = { state: { id: 'shared-id' }, mesh: new THREE.Group() };
  Object.assign(runtime, { wildlife: new Map([['shared-id', replacement]]), recordWildlifeHabitatExposure() { assert.fail('stale death was applied'); } });
  runtime.streamedWildlife.remember(replacement); runtime.removeWildlife(stale, 'disease');
  assert.equal(runtime.wildlife.get('shared-id'), replacement); assert.equal(runtime.streamedWildlife.get('shared-id'), replacement);
});

test('presentation retirement releases container even after runtime failure and does not retry retired visual', async () => {
  const source = asset(), runtime = new WildlifeVisualRuntime({ load: async () => source }), presentation = new WildlifePresentation(runtime);
  const owner = presentationOwner('visual');
  presentation.register(owner); await new Promise(resolve => setImmediate(resolve));
  assert.equal(presentation.getDiagnostics()[0]?.status, 'ready');
  const binding = (presentation as unknown as { bindings: Map<string, { visual?: THREE.Object3D; container?: THREE.Group }> }).bindings.get('visual')!;
  const visual = binding.visual!, container = binding.container!, skeleton = (visual.children[0] as THREE.SkinnedMesh).skeleton;
  skeleton.computeBoneTexture(); const error = { texture: true }; let disposed = 0;
  skeleton.boneTexture!.addEventListener('dispose', () => { disposed++; throw error; });
  assert.deepEqual(failures(thrown(() => presentation.remove(owner))), [error]);
  assert.equal(container.parent, null); assert.equal(visual.parent, null); assert.equal(binding.visual, undefined); assert.equal(binding.container, undefined);
  assert.equal(presentation.remove(owner), false); assert.equal(disposed, 1);
});

function presentationOwner(id: string): Parameters<WildlifePresentation['register']>[0] {
  const phenotype = normalizeWildlifePhenotype(undefined, id);
  phenotype.morphology = { bodyLength: 1, bodyHeight: 1, headScale: 1, tailScale: 1, legLength: 1 };
  const organismGenome = normalizeWildlifeOrganismGenome('raccoon', undefined, id);
  organismGenome.material = { hueShift: 0, lightnessShift: 0, accentShift: 0 };
  return { state: { id, species: 'raccoon', traits: { size: .58, speed: 1, fertility: 1, wariness: 1 }, phenotype, organismGenome }, mesh: new THREE.Group() };
}

test('asynchronous attachment failure retains both original errors, retires its objects and publishes failed diagnostics', async () => {
  const source = asset(), runtime = new WildlifeVisualRuntime({ load: async () => source }), presentation = new WildlifePresentation(runtime);
  const owner = presentationOwner('attach-failure'), primary = { attach: true }, cleanup = { texture: true };
  let container: THREE.Object3D | undefined, visual: THREE.Object3D | undefined, disposed = 0;
  owner.mesh.addEventListener('childadded', event => {
    container = event.child; visual = container.children[0];
    const skeleton = (visual.children[0] as THREE.SkinnedMesh).skeleton; skeleton.computeBoneTexture();
    skeleton.boneTexture!.addEventListener('dispose', () => { disposed++; throw cleanup; }); throw primary;
  });
  presentation.register(owner); await new Promise(resolve => setImmediate(resolve));
  const diagnostic = presentation.getDiagnostics()[0];
  assert.equal(diagnostic.status, 'failed');
  const actual = failures(diagnostic.error); assert.equal(actual.length, 2); assert.equal(actual[0], primary); assert.equal(actual[1], cleanup);
  assert.equal(container?.parent, null); assert.equal(visual?.parent, null); assert.equal(disposed, 1);
  assert.equal(presentation.remove(owner), true); assert.equal(disposed, 1);
});

test('reentrant registration while retiring a same-id presentation preserves the newest owner', async () => {
  const source = asset(), runtime = new WildlifeVisualRuntime({ load: async () => source }), presentation = new WildlifePresentation(runtime);
  const first = presentationOwner('same-id'), requested = presentationOwner('same-id'), newest = presentationOwner('same-id');
  presentation.register(first); await new Promise(resolve => setImmediate(resolve));
  const visual = presentation.getObject('same-id')!.children[0], skeleton = (visual.children[0] as THREE.SkinnedMesh).skeleton;
  skeleton.computeBoneTexture(); skeleton.boneTexture!.addEventListener('dispose', () => presentation.register(newest));
  presentation.register(requested); await new Promise(resolve => setImmediate(resolve));
  assert.equal(presentation.getObject('same-id')?.parent, newest.mesh);
  assert.equal(presentation.remove(first), false); assert.equal(presentation.remove(requested), false);
  assert.equal(presentation.remove(newest), true);
});

test('construction failure with successful cleanup rethrows the exact original error', async () => {
  const source = asset(), runtime = new WildlifeVisualRuntime({ load: async () => source }); await runtime.load('raccoon');
  const primary = { bounds: true }, bounds = THREE.Box3.prototype.setFromObject;
  THREE.Box3.prototype.setFromObject = () => { throw primary; };
  try { assert.equal(thrown(() => runtime.createInstance('raccoon', 0)), primary); }
  finally { THREE.Box3.prototype.setFromObject = bounds; }
});

function frameFixture() {
  let frameAt = 0, rendered = 0, scheduled = 0, cancelled = 0, writes = 0;
  const Runtime = gameMembers(['streamedWildlife', 'wildlifeRetirementErrors', 'removeWildlife', 'updateWildlife', 'simulateStep', 'animate', 'clearMovablePersistenceQueue', 'saveWorldState'], {
    StreamedActors, retireResources, disposeOwnedMeshResources, normalizeWildlifePhenotype, wildlifeFunctionalPhenotype,
    clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    dist: (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z),
    wildlifeDiseaseContactCoefficient: () => 1, now: () => frameAt, i18n: { t: (s: string) => s },
    requestAnimationFrame: () => { scheduled++; }, navigator: {}, document: { hidden: false, hasFocus: () => true },
    window: { clearTimeout: () => { cancelled++; } }, fetch: () => { writes++; assert.fail('blocked persistence wrote'); },
  });
  const runtime = new Runtime(), scene = new THREE.Scene(), source = asset();
  const makeActor = (id: string, dying: boolean) => ({ state: { id, species: 'raccoon', chunkId: 'chunk', traits: { size: 1 }, position: { x: 0, z: 0 },
    ageDays: 1, hunger: dying ? 100 : 50, thirst: dying ? 100 : 50, health: dying ? 0 : 100, energy: 80, diseaseLoad: 0, currentAction: 'wander' },
    mesh: new THREE.Group(), path: [], actionResolved: true });
  const dead = makeActor('dead', true), alive = makeActor('alive', false); dead.mesh.add(new THREE.Mesh(source.geometry, source.material)); scene.add(dead.mesh, alive.mesh);
  rememberOwnedMeshResources(dead.mesh, [source.material]);
  const cleanup = { geometry: true }; source.geometry.addEventListener('dispose', () => { throw cleanup; });
  Object.assign(runtime, {
    wildlife: new Map([['dead', dead], ['alive', alive]]), npcs: new Map(), playerBlockedNpcs: new Set(), wildlifePresentation: { remove() {}, update() {} },
    simulationClock: new SimulationClock(), persistenceReady: true, persistenceSaveQueued: true, movableSaveTimer: 7,
    cameraMode: 'firstPerson', gameTimeText: () => '00:00', playerX: 0, day: 1, minuteOfDay: 0, weather: 'clear', lineageEpoch: 0, aiPaused: true,
    lastPersistenceSaveAt: 0, lastHealthPoll: 0, coarseWorld: { chunks: new Map(), update() {} },
    recordWildlifeHabitatExposure() {}, ensureWildlifeLineage: () => ({}), wildlifeHabitatSnapshot: () => ({}), event() {}, wildlifeName: () => '', log() {},
    maybeCompleteWildlifePregnancy() {}, wildlifeLifeHistory: () => ({ maxAge: 1000 }), classifyWildlifeDeath: () => 'starvation', applyOwnedWildlifeCommand() {},
    moveWildlife(animal: typeof alive, dt: number) { animal.mesh.position.x += dt; }, groundHeightAt: () => 0,
    playerInputAllowed: () => true, resetPlayerInput() { assert.fail('input unexpectedly reset'); },
    updatePlayer(dt: number, input: { forward: number }) { this.playerX += dt * input.forward; }, updateFineChunkMaterialization() {}, updateTime(dt: number) { this.minuteOfDay += dt; },
    updateObjects() {}, updateNpcs() {}, updateCameraShadow() {}, updateRaycast() {}, updateUi() {}, updateSpeech() {}, updateSelectionVisuals() {},
    renderer: { render() { rendered++; } }, scene, camera: new THREE.PerspectiveCamera(),
  });
  runtime.streamedWildlife.remember(dead); runtime.streamedWildlife.remember(alive);
  runtime.simulationClock.record(0, { forward: 1, right: 0, sprint: false, directionX: 0, directionZ: -1 });
  return { runtime, dead, alive, cleanup, frame(at: number) { frameAt = at; runtime.animate(at); }, counts: () => ({ rendered, scheduled, cancelled, writes }) };
}

test('death cleanup failure blocks actual persistence but finishes wildlife updates, clock steps, movement and rendering', async () => {
  const fixture = frameFixture(), { runtime, dead, alive, cleanup } = fixture;
  fixture.frame(0); fixture.frame(100);
  assert.equal(runtime.persistenceLoadBlocked, true); assert.equal(runtime.persistenceSaveQueued, false); assert.equal(runtime.movableSaveTimer, undefined);
  assert.equal(failures(runtime.wildlifeRetirementErrors[0])[0], cleanup);
  assert.equal(dead.mesh.parent, null); assert.equal(runtime.wildlife.has('dead'), false);
  assert.equal(alive.state.position.x, .1); assert.equal(runtime.playerX, .1); assert.equal(runtime.minuteOfDay, .1);
  assert.equal(runtime.simulationClock.consumedThroughMs, 100); assert.equal(runtime.simulationClock.diagnostics.steps, 2);
  await runtime.saveWorldState(); fixture.frame(150);
  assert.ok(Math.abs(alive.state.position.x - .15) < 1e-12); assert.ok(Math.abs(runtime.playerX - .15) < 1e-12);
  assert.equal(runtime.simulationClock.consumedThroughMs, 150); assert.equal(runtime.wildlifeRetirementErrors.length, 1);
  assert.deepEqual(fixture.counts(), { rendered: 3, scheduled: 3, cancelled: 1, writes: 0 });
});

test('unrelated simulation error is not swallowed and the real clock does not commit an incomplete frame', () => {
  const fixture = frameFixture(), fatal = { simulation: true }; fixture.frame(0);
  fixture.runtime.updateWildlife = () => { throw fatal; };
  assert.equal(thrown(() => fixture.frame(50)), fatal);
  assert.equal(fixture.runtime.simulationClock.consumedThroughMs, 0); assert.equal(fixture.runtime.simulationClock.diagnostics.steps, 0);
  assert.equal(fixture.counts().rendered, 1); assert.equal(fixture.runtime.wildlifeRetirementErrors.length, 0);
});

test('death notification failure remains fatal rather than becoming a recoverable resource error', () => {
  const fixture = frameFixture(), fatal = { notification: true }; fixture.frame(0);
  fixture.runtime.event = () => { throw fatal; };
  assert.equal(thrown(() => fixture.frame(50)), fatal);
  assert.equal(fixture.runtime.persistenceLoadBlocked, true); assert.equal(fixture.runtime.simulationClock.consumedThroughMs, 0);
  assert.equal(fixture.counts().rendered, 1);
});

test('streamed retirement finishes every animal after presentation and procedural resource failures', () => {
  const Runtime = gameMembers(['streamedWildlife'], { StreamedActors, retireResources, disposeOwnedMeshResources });
  const runtime = new Runtime(), scene = new THREE.Scene(), errors = [{ animal: 'first' }, { animal: 'second' }], calls: string[] = [];
  runtime.wildlifePresentation = { remove(actor: { state: { id: string } }) { calls.push(`presentation-${actor.state.id}`); } };
  for (const [index, error] of errors.entries()) {
    const root = new THREE.Group(), geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial();
    root.add(new THREE.Mesh(geometry, material)); scene.add(root); rememberOwnedMeshResources(root, [material]);
    geometry.addEventListener('dispose', () => { calls.push(`geometry-${index}`); throw error; });
    material.addEventListener('dispose', () => calls.push(`material-${index}`));
    runtime.streamedWildlife.remember({ state: { id: String(index), chunkId: 'gone' }, mesh: root });
  }
  const actual = failures(thrown(() => runtime.streamedWildlife.retain(new Set(), new Map())));
  assert.equal(actual.length, 2); assert.equal(actual[0], errors[0]); assert.equal(actual[1], errors[1]);
  assert.deepEqual(calls, ['presentation-0', 'geometry-0', 'material-0', 'presentation-1', 'geometry-1', 'material-1']);
  assert.equal(scene.children.length, 0); assert.equal([...runtime.streamedWildlife.values()].length, 0);
  runtime.streamedWildlife.retain(new Set(), new Map()); assert.equal(calls.length, 6);
});

test('death cleanup reentry cannot delete a replacement installed by a disposal listener', () => {
  const fixture = frameFixture(), { runtime, dead } = fixture, replacement = { ...dead, mesh: new THREE.Group(), removed: false };
  runtime.wildlifePresentation.remove = () => {
    runtime.wildlife.set(dead.state.id, replacement);
    runtime.streamedWildlife.remember(replacement);
  };
  runtime.removeWildlife(dead, 'disease');
  assert.equal(runtime.wildlife.get(dead.state.id), replacement); assert.equal(runtime.streamedWildlife.get(dead.state.id), replacement);
  runtime.removeWildlife(dead, 'disease'); assert.equal(runtime.wildlife.get(dead.state.id), replacement);
});

for (const stage of ['create', 'visual-added', 'container-added'] as const) {
  for (const operation of ['remove', 'replace'] as const) {
    for (const eventThrows of stage === 'create' ? [false] : [false, true]) {
      test(`attachment ${stage} reentry ${operation} cannot revive a retired owner (throws=${eventThrows})`, async () => {
        const source = asset(), runtime = new WildlifeVisualRuntime({ load: async () => source }), presentation = new WildlifePresentation(runtime);
        const first = presentationOwner('attachment-id'), next = presentationOwner('attachment-id'), primary = { stage, operation };
        const create = runtime.createInstance.bind(runtime); let firstVisual: THREE.Object3D | undefined, retiredTextures = 0, reentries = 0, sharedDisposed = 0;
        source.geometry.addEventListener('dispose', () => sharedDisposed++); source.material.addEventListener('dispose', () => sharedDisposed++);
        const reenter = () => {
          reentries++;
          if (operation === 'remove') assert.equal(presentation.remove(first), true);
          else presentation.register(next);
          if (eventThrows) throw primary;
        };
        runtime.createInstance = (...args) => {
          const visual = create(...args);
          if (!firstVisual && visual) {
            firstVisual = visual;
            const skeleton = (visual.children[0] as THREE.SkinnedMesh).skeleton; skeleton.computeBoneTexture();
            skeleton.boneTexture!.addEventListener('dispose', () => retiredTextures++);
            if (stage === 'create') reenter();
            else if (stage === 'visual-added') visual.addEventListener('added', reenter);
            else visual.addEventListener('added', () => visual.parent!.addEventListener('added', reenter));
          }
          return visual;
        };
        presentation.register(first); await new Promise(resolve => setImmediate(resolve));
        assert.equal(reentries, 1); assert.equal(firstVisual?.parent, null); assert.equal(first.mesh.children.length, 0);
        assert.equal(retiredTextures, 1); assert.equal(sharedDisposed, 0); assert.equal(runtime.play(firstVisual!, 'idle'), false);
        const failures = presentation.getAttachmentFailures();
        assert.equal(failures.length, eventThrows ? 1 : 0);
        if (eventThrows) { assert.equal(failures[0].error, primary); assert.equal(failures[0].status, 'failed'); }
        if (operation === 'replace') {
          assert.equal(presentation.getDiagnostics()[0].status, 'ready'); assert.equal(presentation.getDiagnostics()[0].error, undefined);
          assert.equal(presentation.getObject(next.state.id)?.parent, next.mesh); assert.equal(presentation.remove(next), true);
        } else assert.equal(presentation.getObject(first.state.id), undefined);
        assert.equal(presentation.remove(first), false); assert.equal(retiredTextures, 1);
      });
    }
  }
}

for (const stage of ['visual-added', 'container-added'] as const) test(`same-mesh owner rebind during ${stage} retains the live attachment`, async () => {
  const source = asset(), runtime = new WildlifeVisualRuntime({ load: async () => source }), presentation = new WildlifePresentation(runtime);
  const first = presentationOwner('rebind-id'), next = { ...presentationOwner('rebind-id'), mesh: first.mesh };
  const create = runtime.createInstance.bind(runtime); let reentries = 0;
  runtime.createInstance = (...args) => {
    const visual = create(...args)!;
    const rebind = () => { reentries++; assert.equal(presentation.rebind(first, next), true); };
    if (stage === 'visual-added') visual.addEventListener('added', rebind);
    else visual.addEventListener('added', () => visual.parent!.addEventListener('added', rebind));
    return visual;
  };
  presentation.register(first); await new Promise(resolve => setImmediate(resolve));
  assert.equal(reentries, 1); assert.equal(presentation.getDiagnostics()[0].status, 'ready');
  assert.equal(presentation.getObject(first.state.id)?.parent, first.mesh); assert.equal(first.mesh.children.length, 1);
  assert.equal(presentation.remove(first), false); assert.equal(presentation.remove(next), true); assert.equal(first.mesh.children.length, 0);
  assert.deepEqual(presentation.getAttachmentFailures(), []);
});
