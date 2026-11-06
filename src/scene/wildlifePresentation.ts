import * as THREE from 'three';
import { WildlifeVisualRuntime, type WildlifeVisualAction } from './wildlifeVisualRuntime';
import type { WildlifeState } from '../types';
import { normalizeWildlifePhenotype } from '../world/wildlifePhenotype';
import { normalizeWildlifeOrganismGenome } from '../world/organismFamilies';
import { retireResources } from './retireResources.js';

type WildlifeOwnerState = Pick<WildlifeState, 'id' | 'species' | 'traits' | 'phenotype' | 'organismGenome'>;

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
  error?: unknown;
}

interface Binding {
  owner: WildlifePresentationOwner;
  token: object;
  container?: THREE.Group;
  visual?: THREE.Object3D;
  status: 'pending' | 'ready' | 'failed';
  reason?: string;
  error?: unknown;
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
  private readonly attachmentFailures: WildlifePresentationDiagnostics[] = [];

  constructor(private readonly runtime: WildlifeVisualRuntime) {}

  register(owner: WildlifePresentationOwner): void {
    if (owner.state.species !== 'raccoon') return;

    const current = this.bindings.get(owner.state.id);
    if (current?.owner === owner) return;
    if (current) {
      this.bindings.delete(owner.state.id);
      this.disposeBinding(current);
      if (this.bindings.has(owner.state.id)) return;
    }

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

  rebind(previous:WildlifePresentationOwner,next:WildlifePresentationOwner):boolean {
    const binding=this.bindings.get(previous.state.id);
    if(!binding||binding.status==='failed'||binding.owner!==previous||previous.mesh!==next.mesh||previous.state.id!==next.state.id||previous.state.species!==next.state.species)return false;
    binding.owner=next;
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
    return [...this.bindings].map(([id, binding]) => ({ id, status: binding.status, reason: binding.reason, error: binding.error }));
  }

  getAttachmentFailures(): WildlifePresentationDiagnostics[] {
    return this.attachmentFailures.map(failure => ({ ...failure }));
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
    const { visual, container } = binding;
    binding.visual = undefined;
    binding.container = undefined;
    retireResources([
      () => { if (visual) this.runtime.dispose(visual); },
      () => { container?.removeFromParent(); },
    ]);
  }

  private async attach(binding: Binding): Promise<void> {
    try {
      await this.runtime.load(binding.owner.state.species);
      const current = this.bindings.get(binding.owner.state.id);
      if (!current || current !== binding || current.owner !== binding.owner) return;

      const runtimeState = this.runtime.getState(binding.owner.state.species);
      if (runtimeState?.status === 'failed') {
        binding.status = 'failed';
        binding.reason = runtimeState.reason;
        return;
      }

      const state = binding.owner.state;
      const visual = this.runtime.createInstance(state.species, 0, raccoonScale(state), {
        phenotype: normalizeWildlifePhenotype(state.phenotype, state.id),
        genome: normalizeWildlifeOrganismGenome(state.species, state.organismGenome, state.id),
      });
      if (this.bindings.get(binding.owner.state.id) !== binding) {
        if (visual) this.runtime.dispose(visual);
        return;
      }
      if (!visual) {
        binding.status = 'failed';
        binding.reason = `unable to create ${binding.owner.state.species} visual`;
        return;
      }
      binding.visual = visual;

      visual.traverse(node => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });

      const presentationRoot = new THREE.Group();
      presentationRoot.name = 'wildlife-presentation-ground0';
      binding.container = presentationRoot;
      presentationRoot.add(visual);
      if (this.bindings.get(binding.owner.state.id) !== binding) return;
      binding.owner.mesh.add(presentationRoot);
      if (this.bindings.get(binding.owner.state.id) !== binding) return;

      binding.status = 'ready';
    } catch (error) {
      binding.status = 'failed';
      binding.error = error;
      binding.reason = error instanceof Error ? error.message : String(error);
      try {
        this.disposeBinding(binding);
      } catch (cleanupError) {
        binding.error = new AggregateError([error, cleanupError], 'Wildlife presentation creation failed');
        binding.reason += `; cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
      }
      if (this.bindings.get(binding.owner.state.id) !== binding) {
        this.attachmentFailures.push({ id: binding.owner.state.id, status: 'failed', reason: binding.reason, error: binding.error });
      }
    }
  }
}
