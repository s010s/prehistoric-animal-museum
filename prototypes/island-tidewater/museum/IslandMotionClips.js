import { Matrix4, Quaternion, Vector3 } from '../vendor/tidewater/src/engine/index.js';

export const TAU = 2 * Math.PI;
export const positive = value => Math.max(0, value);
const paths = { translation: 't', rotation: 'r', scale: 's' };

export function setIslandMotionClip(gltf, clip) {
  const existing = gltf.animations.findIndex(source => source.name === clip.name);
  if (existing < 0) gltf.animations.push(clip);
  else gltf.animations[existing] = clip;
}

function clipTimes(duration, samples) {
  return Float32Array.from({ length: samples + 1 }, (_, i) => duration * i / samples);
}

function bake(values, width, samples, sample) {
  for (let i = 0; i < samples; i++) values.set(sample(i / samples * TAU), i * width);
  values.copyWithin(samples * width, 0, width);
  return values;
}

function morphChannels(channels, sample, times) {
  const result = new Map();
  for (const [node, original] of channels) {
    const count = original.values.length / original.times.length;
    const samples = times.length - 1;
    const values = bake(new Float32Array(times.length * count), count, samples, sample);
    result.set(node, { times, values, step: false });
  }
  return result;
}

// The real appendage displacement and normals come from the existing glTF targets.
export function addIslandMorphClip(gltf, name, duration, sample, samples = 48) {
  const idle = gltf.animations.find(clip => clip.name === 'Idle');
  setIslandMotionClip(gltf, { name, duration, channels: idle.channels,
    morphChannels: morphChannels(idle.morphChannels, sample, clipTimes(duration, samples)) });
}

export function retimeIslandClip(gltf, sourceName, name, duration) {
  const source = gltf.animations.find(clip => clip.name === sourceName);
  const timeScale = duration / source.duration;
  const scale = channel => ({ ...channel, _k: 0, times: Float32Array.from(channel.times, time => time * timeScale) });
  setIslandMotionClip(gltf, { name, duration, channels: source.channels.map(scale),
    morphChannels: new Map([...source.morphChannels].map(([node, channel]) => [node, scale(channel)])) });
}

// Build around the displayed source pose. Bind axes vary across the collection,
// so anatomical pitch, yaw and extension use that pose's actual parent frames.
export function islandMotionRig(gltf, metadata) {
  const idle = gltf.animations.find(clip => clip.name === 'Idle');
  const names = new Map(gltf.nodes.map((node, i) => [node.name, i]));
  const local = gltf.nodes.map(node => ({ t: node.t, r: node.r, s: node.s }));
  const constant = idle.channels.map(channel => {
    const width = channel.path === 'rotation' ? 4 : 3;
    const values = channel.values.slice(0, width);
    local[channel.node][paths[channel.path]] = values;
    return { ...channel, times: new Float32Array(1), values, _k: 0 };
  });
  const parent = new Int32Array(gltf.nodes.length).fill(-1);
  const world = [];
  function visit(node, ancestor) {
    parent[node] = ancestor;
    const { t, r, s } = local[node];
    const matrix = new Matrix4().compose(new Vector3(...t), new Quaternion(...r), new Vector3(...s));
    if (ancestor >= 0) matrix.premultiply(world[ancestor]);
    world[node] = matrix;
    for (const child of gltf.nodes[node].children) visit(child, node);
  }
  for (const root of gltf.roots) visit(root, -1);
  const [fx, fz] = metadata.forward;
  const axes = { pitch: new Vector3(fz, 0, -fx), yaw: new Vector3(0, 1, 0), roll: new Vector3(fx, 0, fz) };
  const find = name => {
    const index = typeof name === 'number' ? name : names.get(name);
    if (index === undefined || !world[index]) throw Error(`Missing motion joint ${name} in ${metadata.id}`);
    return index;
  };
  const position = node => new Vector3().setFromMatrixPosition(world[find(node)]);

  function add(name, duration, author, morph = null) {
    const samples = 48;
    const times = clipTimes(duration, samples);
    const rotations = new Map();
    const resolveAxis = (axis, inverse) => axes[axis].clone().transformDirection(inverse);
    function rotate(joint, sample) {
      const node = find(joint);
      if (rotations.has(node)) throw Error(`Duplicate rotation for ${joint} in ${metadata.id}`);
      const inverse = (world[parent[node]] ?? new Matrix4()).clone().invert();
      const ax = Object.fromEntries(Object.keys(axes).map(axis => [axis, resolveAxis(axis, inverse)]));
      const rest = new Quaternion(...local[node].r);
      const rotation = new Quaternion(), part = new Quaternion();
      const values = bake(new Float32Array(times.length * 4), 4, samples, phase => {
        rotation.copy(rest);
        for (const [axis, angle] of Object.entries(sample(phase))) {
          rotation.premultiply(part.setFromAxisAngle(ax[axis], angle));
        }
        return rotation.normalize().toArray();
      });
      rotations.set(node, { node, path: 'rotation', times, values });
    }
    author({ rotate });
    const channels = constant.filter(channel => channel.path !== 'rotation' || !rotations.has(channel.node));
    channels.push(...rotations.values());
    setIslandMotionClip(gltf, { name, duration, channels,
      morphChannels: morph ? morphChannels(idle.morphChannels, morph, times)
        : new Map([...idle.morphChannels].map(([node, source]) => [node, {
          times: new Float32Array(1), values: source.values.slice(0, source.values.length / source.times.length), step: false,
        }])) });
  }

  return { add, names, parent, position, rightOf: node => position(node).dot(axes.pitch),
    forwardOf: node => position(node).dot(axes.roll) };
}
