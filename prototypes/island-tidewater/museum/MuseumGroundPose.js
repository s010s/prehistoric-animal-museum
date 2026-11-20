import { Quaternion } from '../vendor/tidewater/src/engine/index.js';
import { setIslandMotionClip } from './IslandMotionClips.js';
import { pachycephalosaurusStrideBase } from './PachycephalosaurusStrideBase.js';

// These museum exhibits supply a display Idle, some with a dramatic neck or
// arm gesture. For walking, the locomotor controls own those same joints.
const bipedReferences = new Set([
  'allosaurus-pandras', 'baryonyx', 'carnotaurus', 'dilophosaurus', 'gallimimus',
  'gigantoraptor', 'phorusrhacos', 'spinosaurus', 'therizinosaurus', 'tyrannosaurus-rex',
]);

export function prepareMuseumGroundPose(gltf, id) {
  const frame = new Float32Array(1);
  if (bipedReferences.has(id)) {
    const idle = gltf.animations.find(clip => clip.name === 'Idle');
    const firstKey = channel => ({
      ...channel, times: frame, values: channel.values.subarray(0, channel.values.length / channel.times.length),
    });
    setIslandMotionClip(gltf, {
      name: 'StrideBase', duration: 1,
      channels: idle.channels.map(firstKey),
      morphChannels: new Map([...idle.morphChannels].map(([node, channel]) => [node, firstKey(channel)])),
    });
    return;
  }
  if (id !== 'pachycephalosaurus') return;
  const { channels, morphs } = pachycephalosaurusStrideBase;
  const names = new Map(gltf.nodes.map((node, i) => [node.name, i]));
  const nodeAt = name => {
    const index = names.get(name);
    if (index === undefined) throw Error('Missing StrideBase joint ' + name + ' for ' + id);
    return index;
  };
  const strideChannels = channels.map(([name, path, values]) => ({
    node: nodeAt(name), path, times: frame, values: Float32Array.from(values),
  }));
  // The display idle turns its head sharply over one shoulder and hooks
  // the tail. Blend those authored rotations toward the load-bearing
  // Blender pose for the island's stationary and stopping phases as well.
  const reference = new Map(strideChannels.filter(channel => channel.path === 'rotation')
    .map(channel => [channel.node, new Quaternion(...channel.values).normalize()]));
  const idle = gltf.animations.find(clip => clip.name === 'Idle');
  const key = new Quaternion();
  for (const channel of idle.channels) {
    const name = gltf.nodes[channel.node].name;
    if (channel.path !== 'rotation' || !/^(?:Neck|Head_|SpineTail_|Tail\d|Spine\d)/.test(name)) continue;
    const neutral = reference.get(channel.node);
    if (!neutral) continue;
    const values = channel.values.slice();
    for (let i = 0; i < values.length; i += 4) {
      key.fromArray(values, i).normalize().slerp(neutral, .85).toArray(values, i);
    }
    channel.values = values;
  }
  setIslandMotionClip(gltf, {
    name: 'StrideBase',
    duration: 1,
    channels: strideChannels,
    morphChannels: new Map(morphs.map(([name, values]) => [nodeAt(name), { times: frame, values: Float32Array.from(values) }])),
  });
}
