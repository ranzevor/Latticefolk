import * as THREE from 'three';
import type { WildlifeOrganismGenome, WildlifePhenotype } from '../types';

export interface RaccoonAppearance {
  phenotype: WildlifePhenotype;
  genome: WildlifeOrganismGenome;
}

// The pinned GLB has 2,240 vertices, each rigidly weighted to one of these
// authored regions. No triangle spans regions. Preserve its topology and UVs.
const REGIONS = ['Body', 'Head', 'Tail', 'FrontLegL', 'FrontLegR', 'BackLegL', 'BackLegR'] as const;

// Actual embedded Atlas.png swatches. COLOR_0 is white in the source. Roles
// distinguish head fur from torso fur while preserving eyes, feet and rings.
const SWATCHES = [
  { u: .6501554250717163, v: .8436211347579956, rgb: 0x674d3b, role: 'fur' },
  { u: .7190573215484619, v: .8417755961418152, rgb: 0x3c2815, role: 'feature' },
  { u: .7811921238899231, v: .8436211347579956, rgb: 0x45433b, role: 'accent' },
  { u: .8445572853088379, v: .842390775680542, rgb: 0x343434, role: 'feature' },
] as const;

function anchoredTransform(anchor: THREE.Vector3, target: THREE.Vector3, linear: THREE.Matrix4) {
  return new THREE.Matrix4().makeTranslation(target.x, target.y, target.z)
    .multiply(linear).multiply(new THREE.Matrix4().makeTranslation(-anchor.x, -anchor.y, -anchor.z));
}

function axialScale(direction: THREE.Vector3, scale: number) {
  const { x, y, z } = direction.clone().normalize();
  const d = scale - 1;
  return new THREE.Matrix4().set(
    1+d*x*x, d*x*y, d*x*z, 0,
    d*y*x, 1+d*y*y, d*y*z, 0,
    d*z*x, d*z*y, 1+d*z*z, 0,
    0, 0, 0, 1,
  );
}

/** Adapt only an instance. Source buffers, clips, palette texture and materials
 * remain shared and immutable. All vertex/joint work happens once, before the
 * animation mixer is constructed; ordinary animation retains its source tracks.
 */
export function applyRaccoonAppearance(
  root: THREE.Object3D, animations: THREE.AnimationClip[], appearance: RaccoonAppearance,
): { animations: THREE.AnimationClip[]; geometries: Set<THREE.BufferGeometry> } {
  const m = appearance.phenotype.morphology;
  const palette = appearance.genome.material;
  const morph = Object.values(m).some(value => value !== 1);
  const recolor = Object.values(palette).some(value => value !== 0);
  const geometries = new Set<THREE.BufferGeometry>();
  if (!morph && !recolor) return { animations, geometries };

  root.updateMatrixWorld(true);
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse(node => { if ((node as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(node as THREE.SkinnedMesh); });
  if (meshes.length !== 1) throw new Error('Raccoon appearance requires the pinned single-mesh rig');
  const mesh = meshes[0];
  const sourceBoneWorlds = mesh.skeleton.bones.map(bone => bone.matrixWorld.clone());
  const bones = new Map(mesh.skeleton.bones.map(bone => [bone.name, bone]));
  const point = (name: string) => {
    const bone = bones.get(name);
    if (!bone) throw new Error(`Raccoon appearance is missing authored bone ${name}`);
    return bone.getWorldPosition(new THREE.Vector3());
  };
  const sourceGeometry = mesh.geometry;
  const position = sourceGeometry.getAttribute('position');
  const indices = sourceGeometry.getAttribute('skinIndex');
  const weights = sourceGeometry.getAttribute('skinWeight');
  const regionAt = (index: number) => {
    if (weights.getX(index) !== 1 || weights.getY(index) !== 0 || weights.getZ(index) !== 0 || weights.getW(index) !== 0) {
      throw new Error('Raccoon appearance requires rigid authored skin regions');
    }
    const name = mesh.skeleton.bones[indices.getX(index)]?.name;
    if (!REGIONS.some(region => region === name)) throw new Error(`Unknown raccoon skin region ${name}`);
    return name;
  };
  const transforms = new Map<string, THREE.Matrix4>();
  if (morph) {
    const torso = new THREE.Box3();
    for (let i = 0; i < position.count; i++) {
      if (regionAt(i) === 'Body') torso.expandByPoint(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld));
    }
    const center = torso.getCenter(new THREE.Vector3());
    // Intentionally preserve effectiveWildlifeMorphology's existing axis
    // contract: bodyLength -> X, bodyHeight -> Y, sqrt(product) -> Z. This is
    // not a reinterpretation of the gene as the authored animal's +Z length.
    const body = anchoredTransform(center, center,
      new THREE.Matrix4().makeScale(m.bodyLength, m.bodyHeight, Math.sqrt(m.bodyLength*m.bodyHeight)));
    transforms.set('Body', body);
    for (const name of REGIONS.filter(name => name !== 'Body')) {
      const anchor = point(name);
      const target = anchor.clone().applyMatrix4(body);
      const linear = name === 'Head'
        ? new THREE.Matrix4().makeScale(m.headScale, m.headScale, m.headScale)
        : axialScale(point(`${name}_end`).sub(anchor), name === 'Tail' ? m.tailScale : m.legLength);
      transforms.set(name, anchoredTransform(anchor, target, linear));
    }
  }

  const geometry = sourceGeometry.clone();
  geometries.add(geometry);
  mesh.geometry = geometry;
  try {
    if (morph) {
      const toLocal = mesh.matrixWorld.clone().invert();
      const localTransforms = new Map([...transforms].map(([name, transform]) =>
        [name, toLocal.clone().multiply(transform).multiply(mesh.matrixWorld)]));
      const normalTransforms = new Map([...localTransforms].map(([name, transform]) =>
        [name, new THREE.Matrix3().getNormalMatrix(transform)]));
      const positions = geometry.getAttribute('position');
      const normals = geometry.getAttribute('normal');
      const value = new THREE.Vector3();
      for (let i = 0; i < positions.count; i++) {
        const region = regionAt(i);
        value.fromBufferAttribute(position, i).applyMatrix4(localTransforms.get(region)!);
        positions.setXYZ(i, value.x, value.y, value.z);
        value.fromBufferAttribute(sourceGeometry.getAttribute('normal'), i).applyMatrix3(normalTransforms.get(region)!).normalize();
        normals.setXYZ(i, value.x, value.y, value.z);
      }
      positions.needsUpdate = true;
      normals.needsUpdate = true;
    }

    if (recolor) {
      const uv = sourceGeometry.getAttribute('uv');
      const sourceColors = sourceGeometry.getAttribute('color');
      const colors = geometry.getAttribute('color');
      const multipliers = new Map<string, THREE.Color>();
      for (let i = 0; i < colors.count; i++) {
        const swatch = SWATCHES.find(s => Math.abs(s.u-uv.getX(i)) < 1e-6 && Math.abs(s.v-uv.getY(i)) < 1e-6);
        if (!swatch) throw new Error('Unknown raccoon source atlas swatch');
        const role = swatch.role === 'fur' ? (regionAt(i) === 'Head' ? 'accent' : 'body') : swatch.role;
        const key = `${swatch.rgb}:${role}`;
        let multiplier = multipliers.get(key);
        if (!multiplier) {
          const source = new THREE.Color(swatch.rgb);
          const hsl = source.getHSL({ h: 0, s: 0, l: 0 });
          const roleFactor = role === 'body' ? 0 : role === 'accent' ? 1 : .5;
          // Bounded relative lift/shade preserves neutral identity and ordering of
          // the dark details. An absolute .06 floor would erase source contrast.
          const s = palette.lightnessShift;
          const lightness = s >= 0 ? hsl.l+s*(1-hsl.l) : hsl.l*(1+s);
          multiplier = new THREE.Color().setHSL(
            (hsl.h+palette.hueShift+roleFactor*palette.accentShift+1)%1, hsl.s, lightness,
          );
          multiplier.r /= source.r; multiplier.g /= source.g; multiplier.b /= source.b;
          multipliers.set(key, multiplier);
        }
        colors.setXYZ(i, sourceColors.getX(i)*multiplier.r, sourceColors.getY(i)*multiplier.g, sourceColors.getZ(i)*multiplier.b);
      }
      colors.needsUpdate = true;
    }

    let adaptedAnimations = animations;
    if (morph) {
      const targets = new Map<THREE.Bone, THREE.Vector3>();
      for (const bone of mesh.skeleton.bones) {
        let region: THREE.Object3D | null = bone;
        while (region && !transforms.has(region.name)) region = region.parent;
        if (region) targets.set(bone, bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(transforms.get(region.name)!));
      }
      const offsets = new Map<string, THREE.Vector3>();
      // Parent-before-child traversal converts desired rest positions back into
      // authored local axes; animated rotations and scale remain untouched.
      root.traverse(node => {
        const target = targets.get(node as THREE.Bone);
        if (!target || !node.parent) return;
        node.parent.updateWorldMatrix(true, false);
        const next = node.parent.worldToLocal(target.clone());
        offsets.set(node.name, next.clone().sub(node.position));
        node.position.copy(next);
        node.updateMatrixWorld(true);
      });
      // Idle/eating also animate translations. Offset their copied keys so the
      // mixer cannot restore the original proportions on the following frame.
      adaptedAnimations = animations.map(clip => {
        const result = clip.clone();
        for (const track of result.tracks) {
          if (!track.name.endsWith('.position')) continue;
          const offset = offsets.get(track.name.slice(0, -'.position'.length));
          if (!offset) continue;
          for (let i = 0; i < track.values.length; i += 3) {
            track.values[i] += offset.x;
            track.values[i+1] += offset.y;
            track.values[i+2] += offset.z;
          }
        }
        return result;
      });
      root.updateMatrixWorld(true);
      // Preserve the original glTF bind basis (its bindMatrix is identity but
      // inverse bind matrices already contain the authored mesh transform).
      // Plain calculateInverses would discard that transform and shrink the rig.
      // Skeleton.clone shares the source inverse array: replace, never mutate it.
      mesh.skeleton.boneInverses = mesh.skeleton.boneInverses.map((matrix, i) =>
        mesh.skeleton.bones[i].matrixWorld.clone().invert().multiply(sourceBoneWorlds[i]).multiply(matrix));
      mesh.skeleton.update();
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    return { animations: adaptedAnimations, geometries };
  } catch (error) {
    mesh.geometry = sourceGeometry;
    try {
      geometry.dispose();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Raccoon appearance creation failed');
    }
    throw error;
  }
}
