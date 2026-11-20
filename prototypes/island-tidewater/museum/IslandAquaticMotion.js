import { setIslandMotionClip } from './IslandMotionClips.js';

const species = {
  ammonite: () => import('./aquatic-motion/ammonite.js'),
  anomalocaris: () => import('./aquatic-motion/anomalocaris.js'),
  dakosaurus: () => import('./aquatic-motion/dakosaurus.js'),
  dallasaurus: () => import('./aquatic-motion/dallasaurus.js'),
  hallucigenia: () => import('./aquatic-motion/hallucigenia.js'),
  ichthyosaur: () => import('./aquatic-motion/ichthyosaur.js'),
  livyatan: () => import('./aquatic-motion/livyatan.js'),
  megalodon: () => import('./aquatic-motion/megalodon.js'),
  mosasaurus: () => import('./aquatic-motion/mosasaurus.js'),
  opabinia: () => import('./aquatic-motion/opabinia.js'),
  plesiosaurus: () => import('./aquatic-motion/plesiosaurus.js'),
  sarcosuchus: () => import('./aquatic-motion/sarcosuchus.js'),
  styxosaurus: () => import('./aquatic-motion/styxosaurus.js'),
  tullimonstrum: () => import('./aquatic-motion/tullimonstrum.js'),
  xiphactinus: () => import('./aquatic-motion/xiphactinus.js'),
};

const transformQuantization = {
  rotation: ['rotations', 4, 32767],
  translation: ['translations', 3, 100000],
  scale: ['scales', 3, 100000],
};

function referenceChannel(channel, width) {
  return { ...channel, times: new Float32Array(1), values: channel.values.slice(0, width), _k: 0 };
}

function decodeAquaticChannel(packed, width, quantization, times) {
  const count = (times.length - 1) * width;
  const values = new Float32Array(times.length * width);
  if (typeof packed === 'string') {
    const bytes = atob(packed);
    if (bytes.length !== count * 2) throw Error('Invalid packed island aquatic rotation');
    for (let i = 0; i < count; i++) {
      const sample = bytes.charCodeAt(i * 2) | (bytes.charCodeAt(i * 2 + 1) << 8);
      values[i] = ((sample << 16) >> 16) / quantization;
    }
  } else {
    if (packed.length !== count) throw Error('Invalid island aquatic clip');
    for (let i = 0; i < count; i++) values[i] = packed[i] / quantization;
  }
  values.copyWithin(count, 0, width);
  return { times, values, step: false };
}

// Blender pose bones and shape keys were baked onto the original island node indices.
// Preserve the displayed Idle pose on every channel the new action leaves alone.
export function applyIslandAquaticMotion(gltf, clips) {
  const idle = gltf.animations.find(clip => clip.name === 'Idle');
  for (const [name, source] of Object.entries(clips)) {
    const { duration, frames } = source;
    const times = Float32Array.from({ length: frames + 1 }, (_, i) => i * duration / frames);
    const aquaticAuxiliary = source.auxiliary && new Map(Object.entries(source.auxiliary)
      .map(([joint, packed]) => [joint, decodeAquaticChannel(packed, 4, 32767, times)]));
    if (name === 'Idle') {
      // Keep the source flipper morph animation beneath the neutral neck.
      idle.aquaticAuxiliary = aquaticAuxiliary;
      continue;
    }
    const channels = idle.channels.flatMap(channel => {
      const [kind, width] = transformQuantization[channel.path];
      return source[kind]?.[channel.node] ? [] : [referenceChannel(channel, width)];
    });
    for (const [path, [kind, width, quantization]] of Object.entries(transformQuantization)) {
      for (const [node, packed] of Object.entries(source[kind] ?? {})) {
        if (!gltf.nodes[node]) throw Error('Invalid island aquatic joint ' + node);
        channels.push({ node: Number(node), path, ...decodeAquaticChannel(packed, width, quantization, times) });
      }
    }
    const morphChannels = new Map();
    for (const [node, idleChannel] of idle.morphChannels ?? []) {
      const width = idleChannel.values.length / idleChannel.times.length;
      const packed = source.weights?.[node];
      morphChannels.set(node, packed ? decodeAquaticChannel(packed, width, 10000, times)
        : referenceChannel(idleChannel, width));
    }
    setIslandMotionClip(gltf, { name, duration, channels, morphChannels, aquaticAuxiliary });
  }
}

export function loadIslandAquaticClips(id) {
  return Object.hasOwn(species, id) ? species[id]() : undefined;
}

export async function prepareIslandAquaticMotion(gltf, id) {
  const clips = await loadIslandAquaticClips(id);
  if (clips) applyIslandAquaticMotion(gltf, clips.default);
}
