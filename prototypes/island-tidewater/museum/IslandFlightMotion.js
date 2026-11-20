import { setIslandMotionClip } from './IslandMotionClips.js';

const flightClips = {
  anurognathus: () => import('./flight-motion/anurognathus.js'),
  sordes: () => import('./flight-motion/sordes.js'),
  archaeopteryx: () => import('./flight-motion/archaeopteryx.js'),
  quetzalcoatlus: () => import('./flight-motion/quetzalcoatlus.js'),
  meganeura: () => import('./flight-motion/meganeura.js'),
  rhamphorhynchus: () => import('./flight-motion/rhamphorhynchus.js'),
  tupandactylus: () => import('./flight-motion/tupandactylus.js'),
};

export function loadIslandFlightClip(id) {
  // Pteranodon uses the source flap-and-soar performance.
  return Object.hasOwn(flightClips, id) ? flightClips[id]() : undefined;
}

export function applyIslandFlightMotion(gltf, id, flight) {
  const { seconds, samples, rotations, morph } = flight;
  const times = Float32Array.from({ length: samples + 1 }, (_, i) => seconds * i / samples);
  const idle = gltf.animations.find(clip => clip.name === 'Idle');
  const joints = new Map(gltf.nodes.map((joint, i) => [joint.name, i]));
  const animated = new Map();
  const still = new Float32Array(1);
  for (const [name, values] of Object.entries(rotations)) {
    const node = joints.get(name);
    if (node === undefined) throw Error(`Missing flight joint ${name} in ${id}`);
    if (values.length !== 4 && values.length !== times.length * 4) throw Error(`Invalid flight rotation ${name} in ${id}`);
    animated.set(node, { node, path: 'rotation', times: values.length === 4 ? still : times, values: Float32Array.from(values) });
  }
  const channels = idle.channels.filter(channel => channel.path !== 'rotation' || !animated.has(channel.node))
    .map(channel => ({
      ...channel, times: still, values: channel.values.slice(0, channel.path === 'rotation' ? 4 : 3), _k: 0,
    }));
  channels.push(...animated.values());
  const morphChannels = new Map();
  for (const [node, source] of idle.morphChannels) {
    const count = source.values.length / source.times.length;
    if (morph.length && morph.length !== times.length * count) throw Error(`Invalid flight shape tracks in ${id}`);
    morphChannels.set(node, {
      times: morph.length ? times : still,
      values: morph.length ? Float32Array.from(morph) : source.values.slice(0, count),
      step: false,
    });
  }
  setIslandMotionClip(gltf, { name: 'Fly', duration: seconds, channels, morphChannels });
}
