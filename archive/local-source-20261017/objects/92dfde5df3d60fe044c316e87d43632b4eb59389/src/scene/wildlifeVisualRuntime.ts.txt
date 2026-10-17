import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { resolveWildlifeAsset } from './wildlifeAssetResolver';

export type WildlifeVisualAction = 'idle' | 'walk' | 'run' | 'eat' | 'death';

export interface WildlifeVisualState {
  status: 'loading' | 'ready' | 'failed';
  reason?: string;
}

export interface WildlifeAssetLoader {
  load(url: string): Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>;
}

class DefaultWildlifeAssetLoader implements WildlifeAssetLoader {
  private readonly loader = new GLTFLoader();
  load(url: string) {
    return this.loader.loadAsync(url).then(gltf => ({ scene: gltf.scene, animations: gltf.animations }));
  }
}

interface CachedAsset {
  scene?: THREE.Object3D;
  animations?: THREE.AnimationClip[];
  loading?: Promise<void>;
}

interface InstanceState {
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  current?: string;
  death: boolean;
  ownedSkeletons: Set<THREE.Skeleton>;
}

const REQUIRED_ACTIONS: WildlifeVisualAction[] = ['idle', 'walk', 'run', 'eat', 'death'];

export class WildlifeVisualRuntime {
  private readonly cache = new Map<string, CachedAsset>();
  private readonly instances = new Map<THREE.Object3D, InstanceState>();
  private readonly state = new Map<string, WildlifeVisualState>();
  private readonly loader: WildlifeAssetLoader;

  constructor(loader: WildlifeAssetLoader = new DefaultWildlifeAssetLoader()) {
    this.loader = loader;
  }

  getState(species: string): WildlifeVisualState | undefined {
    return this.state.get(species);
  }

  async load(species: string): Promise<void> {
    const resolved = resolveWildlifeAsset(species);
    if (!resolved.definition) {
      this.state.set(species, { status: 'failed', reason: resolved.reason });
      return;
    }
    const existing = this.cache.get(species);
    if (existing?.loading) return existing.loading;
    if (existing?.scene) {
      this.state.set(species, { status: 'ready' });
      return;
    }
    const entry: CachedAsset = {};
    this.cache.set(species, entry);
    this.state.set(species, { status: 'loading' });
    entry.loading = this.loader.load(resolved.definition.asset).then(asset => {
      const missing = REQUIRED_ACTIONS.filter(action => {
        const clipName = resolved.definition?.clips[action];
        return !clipName || asset.animations.filter(clip => clip.name === clipName).length !== 1;
      });
      if (missing.length > 0) {
        throw new Error(`invalid wildlife clips for ${species}: ${missing.join(', ')}`);
      }
      entry.scene = asset.scene;
      entry.animations = asset.animations;
      this.state.set(species, { status: 'ready' });
    }).catch(error => {
      this.cache.delete(species);
      this.state.set(species, { status: 'failed', reason: error instanceof Error ? error.message : String(error) });
    }).finally(() => {
      delete entry.loading;
    });
    return entry.loading;
  }

  createInstance(species: string, groundHeight: number, scale = 1): THREE.Object3D | undefined {
    const asset = this.cache.get(species);
    if (!asset?.scene || this.state.get(species)?.status !== 'ready') return undefined;
    const root = cloneSkeleton(asset.scene);
    root.scale.setScalar(scale);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    root.position.y = groundHeight - box.min.y;
    const mixer = new THREE.AnimationMixer(root);
    const actions = new Map<string, THREE.AnimationAction>();
    const clips = resolveWildlifeAsset(species).definition?.clips ?? {};
    for (const [key, name] of Object.entries(clips)) {
      const clip = asset.animations?.find(item => item.name === name);
      if (clip) actions.set(key, mixer.clipAction(clip));
    }
    const ownedSkeletons = new Set<THREE.Skeleton>();
    root.traverse(object => {
      const mesh = object as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh && mesh.skeleton) ownedSkeletons.add(mesh.skeleton);
    });
    this.instances.set(root, { mixer, actions, death: false, ownedSkeletons });
    return root;
  }

  play(root: THREE.Object3D, action: WildlifeVisualAction): boolean {
    const instance = this.instances.get(root);
    if (!instance) return false;
    const next = instance.actions.get(action);
    if (!next) return false;
    if (instance.current === action) return true;
    const previous = instance.current ? instance.actions.get(instance.current) : undefined;
    previous?.fadeOut(.15);
    if (action === 'death') {
      next.reset().setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
      instance.death = true;
    } else {
      next.reset();
    }
    next.fadeIn(.15).play();
    instance.current = action;
    return true;
  }

  update(root: THREE.Object3D, deltaSeconds: number): void {
    this.instances.get(root)?.mixer.update(deltaSeconds);
  }

  dispose(root: THREE.Object3D): void {
    const instance = this.instances.get(root);
    if (!instance) return;
    for (const action of instance.actions.values()) action.stop();
    instance.mixer.stopAllAction();
    instance.mixer.uncacheRoot(root);
    for (const skeleton of instance.ownedSkeletons) skeleton.dispose();
    this.instances.delete(root);
    root.removeFromParent();
  }
}
