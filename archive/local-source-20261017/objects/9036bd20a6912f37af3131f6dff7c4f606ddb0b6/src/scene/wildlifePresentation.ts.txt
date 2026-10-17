import * as THREE from 'three';
import { WildlifeVisualRuntime, type WildlifeVisualAction } from './wildlifeVisualRuntime';
import type { WildlifeState } from '../types';

type WildlifeOwnerState = Pick<WildlifeState, 'id' | 'species' | 'traits'>;

export interface WildlifePresentationOwner {
  readonly state: WildlifeOwnerState;
  readonly mesh: THREE.Group;
}

export interface WildlifePresentationUpdate {
  speed: number;
  blocked?: boolean;
  action?: WildlifeState['currentAction'] | 'idle';
  deltaSeconds: number;
}

export interface WildlifePresentationDiagnostics {
  id: string;
  status: 'pending' | 'ready' | 'failed';
  reason?: string;
}

interface Binding {
  owner: WildlifePresentationOwner;
  token: object;
  container?: THREE.Group;
  visual?: THREE.Object3D;
  status: 'pending' | 'ready' | 'failed';
  reason?: string;
  lastAction?: WildlifeVisualAction;
}

/**
 * The procedural raccoon archetype uses smallMaskedForager morphology:
 * bodyX=1.08, bodyY=.56, bodyZ=.52, headSize=.44, legHeight=.40.
 * The GLB asset is authored in its own unit space, so traits.size must map
 * through the same approximate organism envelope instead of being passed as
 * a raw mesh scale. This keeps physics/state size authoritative.
 */
// Measured from the unscaled Quaternius Raccoon.glb CPU probe.
// Do not use the presentation-scaled dimensions here.
const RACCOON_GLB_HEIGHT = 1.4020539130878025;

// smallMaskedForager makeProceduralAnimal overlap-aware vertical reference:
// bodyCenter=(legHeight*.5+bodyY*.45)*size
// headY=bodyCenter+bodyY*.26*size
// headTop=headY+headSize*.5*size
const RACCOON_PROCEDURAL_REFERENCE_HEIGHT_AT_SIZE_058 = 0.474208;

function raccoonScale(state: WildlifeOwnerState): number {
  const size = Number.isFinite(state.traits.size) ? state.traits.size : 0.58;
  const targetHeight = RACCOON_PROCEDURAL_REFERENCE_HEIGHT_AT_SIZE_058 * (size / 0.58);
  return targetHeight / RACCOON_GLB_HEIGHT;
}

function actionFor(input: WildlifePresentationUpdate): WildlifeVisualAction {
  if (input.blocked || input.speed <= 0.01) {
    return input.action === 'graze' || input.action === 'forage' ? 'eat' : 'idle';
  }
  return input.speed > 2 ? 'run' : 'walk';
}

export class WildlifePresentation {
  private readonly bindings = new Map<string, Binding>();

  constructor(private readonly runtime: WildlifeVisualRuntime) {}

  register(owner: WildlifePresentationOwner): void {
    if (owner.state.species !== 'raccoon') return;

    const current = this.bindings.get(owner.state.id);
    if (current?.owner === owner) return;
    if (current) this.disposeBinding(current);

    const binding: Binding = { owner, token: {}, status: 'pending' };
    this.bindings.set(owner.state.id, binding);
    void this.attach(binding);
  }

  remove(owner: WildlifePresentationOwner): boolean {
    const binding = this.bindings.get(owner.state.id);
    if (!binding || binding.owner !== owner) return false;
    this.bindings.delete(owner.state.id);
    this.disposeBinding(binding);
    return true;
  }

  update(owner: WildlifePresentationOwner, input: WildlifePresentationUpdate): boolean {
    const binding = this.bindings.get(owner.state.id);
    if (!binding || binding.owner !== owner || !binding.visual) return false;
    const action = actionFor(input);
    if (binding.lastAction !== action) {
      this.runtime.play(binding.visual, action);
      binding.lastAction = action;
    }
    this.runtime.update(binding.visual, Math.max(0, input.deltaSeconds));
    return true;
  }

  getDiagnostics(): WildlifePresentationDiagnostics[] {
    return [...this.bindings].map(([id, binding]) => ({ id, status: binding.status, reason: binding.reason }));
  }

  getDiagnosticsSummary(): {pending:number;ready:number;failed:number;count:number} {
    const diagnostics=this.getDiagnostics();
    return {
      pending:diagnostics.filter(x=>x.status==='pending').length,
      ready:diagnostics.filter(x=>x.status==='ready').length,
      failed:diagnostics.filter(x=>x.status==='failed').length,
      count:diagnostics.length,
    };
  }

  getObject(id: string): THREE.Object3D | undefined {
    return this.bindings.get(id)?.container;
  }

  private disposeBinding(binding: Binding): void {
    if (binding.visual) {
      this.runtime.dispose(binding.visual);
      binding.visual = undefined;
    }
    if (binding.container) {
      binding.container.removeFromParent();
      binding.container = undefined;
    }
  }

  private async attach(binding: Binding): Promise<void> {
    await this.runtime.load(binding.owner.state.species);
    const current = this.bindings.get(binding.owner.state.id);
    if (!current || current !== binding || current.owner !== binding.owner) return;

    const runtimeState = this.runtime.getState(binding.owner.state.species);
    if (runtimeState?.status === 'failed') {
      binding.status = 'failed';
      binding.reason = runtimeState.reason;
      return;
    }

    const visual = this.runtime.createInstance(binding.owner.state.species, 0, raccoonScale(binding.owner.state));
    if (!visual) {
      binding.status = 'failed';
      binding.reason = `unable to create ${binding.owner.state.species} visual`;
      return;
    }

    visual.traverse(node => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });

    const presentationRoot = new THREE.Group();
    presentationRoot.name = 'wildlife-presentation-ground0';
    presentationRoot.add(visual);
    binding.owner.mesh.add(presentationRoot);

    binding.visual = visual;
    binding.container = presentationRoot;
    binding.status = 'ready';
  }
}
