import { setIslandMotionClip } from './IslandMotionClips.js';
import { pachycephalosaurusStrideBase } from './PachycephalosaurusStrideBase.js';

export function prepareMuseumGroundPose(gltf, id) {
  if (id !== 'pachycephalosaurus') return;
  const { channels, morphs } = pachycephalosaurusStrideBase;
  const names = new Map(gltf.nodes.map((node, i) => [node.name, i]));
  const frame = new Float32Array(1);
  const nodeAt = name => {
    const index = names.get(name);
    if (index === undefined) throw Error('Missing StrideBase joint ' + name + ' for ' + id);
    return index;
  };
  setIslandMotionClip(gltf, {
    name: 'StrideBase',
    duration: 1,
    channels: channels.map(([name, path, values]) => ({ node: nodeAt(name), path, times: frame, values: Float32Array.from(values) })),
    morphChannels: new Map(morphs.map(([name, values]) => [nodeAt(name), { times: frame, values: Float32Array.from(values) }])),
  });
}
