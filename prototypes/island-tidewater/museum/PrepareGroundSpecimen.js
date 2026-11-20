import { augmentIslandLegRig } from './IslandMuseumLegRig.js';
import { prepareMuseumGroundPose } from './MuseumGroundPose.js';
import { prepareBipedBodyRig } from './ground-motion/BipedSkin.js';
import { prepareGroundRestingJaws } from './ground-motion/GroundRestingJaws.js';
import { prepareQuadrupedStride } from './QuadrupedStrideRig.js';

// The two small sample herbivores already have native leg chains. Elsewhere
// upper-body weights must be fitted to the very same pieces as the leg rig.
export function prepareGroundSpecimen(id, gltf, pieces, skin, metadata, { sample = false } = {}) {
  prepareMuseumGroundPose(gltf, id);
  const legRig = sample ? null : augmentIslandLegRig(id, gltf, pieces, skin);
  prepareBipedBodyRig(id, gltf, pieces, skin, legRig);
  prepareQuadrupedStride(id, gltf, pieces, skin, metadata, legRig);
  if (!sample) prepareGroundRestingJaws(id, gltf, pieces, skin);
  return legRig;
}
