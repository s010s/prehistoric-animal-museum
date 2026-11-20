import { BufferAttribute, BufferGeometry, InterleavedBuffer, InterleavedBufferAttribute } from '../vendor/tidewater/src/engine/index.js';
import { floatAttribute } from './IslandMuseumModelData.js';

export function makeGeometry(piece) {
  const { primitive, influences } = piece;
  const geometry = new BufferGeometry();
  for (const [key, a] of Object.entries(primitive.attributes)) {
    const name = { POSITION: 'position', NORMAL: 'normal', TANGENT: 'museumTangent', COLOR_0: 'color', TEXCOORD_0: 'uv' }[key]
      ?? (key.startsWith('TEXCOORD_') ? 'islandUv' + key.slice(9) : null);
    if (name) geometry.setAttribute(name, new BufferAttribute(floatAttribute(a), a.itemSize));
  }
  if (influences.length) {
    // Pack the two uint16 values without reducing their precision. All
    // influence sets share one vertex buffer slot, even on 12-weight meshes.
    const stride = influences.length * 4;
    const packed = new Uint32Array(geometry.attributes.position.count * stride);
    const skin = new InterleavedBuffer(packed, stride);
    for (const [i, { joints, weights }] of influences.entries()) {
      const offset = i * 4;
      for (let at = 0, vertex = 0; at < joints.length; at += 4, vertex += stride) {
        for (let k = 0; k < 4; k++) packed[vertex + offset + k] = joints[at + k] | (weights[at + k] << 16);
      }
      geometry.setAttribute('museumSkin' + i, new InterleavedBufferAttribute(skin, 4, offset));
    }
  }
  if (piece.groundMorphMask) geometry.setAttribute('museumGroundMorph', new BufferAttribute(piece.groundMorphMask, 1));
  if (primitive.indices) {
    const indices = primitive.indices instanceof Uint8Array ? Uint16Array.from(primitive.indices) : primitive.indices;
    geometry.setIndex(new BufferAttribute(indices, 1));
  }
  geometry.computeBoundingSphere();
  return geometry;
}

export function makeVertex(pose, piece, morph, uvChannels) {
  const attributes = {}, varyings = {}, storage = {};
  const vertex = [];
  for (const channel of uvChannels) {
    if (channel === 0) continue;
    const name = 'islandUv' + channel;
    attributes[name] = varyings[name] = 'vec2f';
    vertex.push('o.' + name + ' = v.' + name + ';');
  }
  const hasTangent = !!piece.primitive.attributes.TANGENT;
  if (hasTangent) attributes.museumTangent = varyings.museumTangent = 'vec4f';
  if (!morph && !piece.influences.length && !hasTangent) return { attributes, varyings, storage, vertex: vertex.join('\n') };
  vertex.push('var point = v.position;', 'var previousPoint = v.position;', 'var normal = v.normal;');
  if (morph) {
    storage.museumMorph = morph.buffer;
    if (morph.groundMorph) attributes.museumGroundMorph = 'f32';
    vertex.push(morph.vertex);
  }
  const sets = piece.influences.length;
  let matrix = 'v.model', previousMatrix = 'v.prevModel';
  if (sets) {
    storage.museumPalette = pose.jointBuffer;
    const weighted = frameOffset => Array.from({ length: sets }, (_, i) => [...'xyzw'].map(c =>
      `museumPalette[joints${i}.${c}${frameOffset}] * weights${i}.${c}`).join(' + ')).join(' + ');
    for (let i = 0; i < sets; i++) {
      attributes['museumSkin' + i] = 'vec4u';
      vertex.push(
        `let joints${i} = v.museumSkin${i} & vec4u(65535u);`,
        `let weights${i} = vec4f(v.museumSkin${i} >> vec4u(16u)) / 65535.0;`,
      );
    }
    vertex.push('let joint = ' + weighted('') + ';', 'let previousJoint = ' + weighted(' + ' + pose.joints + 'u') + ';');
    matrix += ' * joint';
    previousMatrix += ' * previousJoint';
  }
  vertex.push(
    'let localToWorld = ' + matrix + ';',
    'v.useWorld = true;',
    'v.worldPos = (localToWorld * vec4f(point, 1.0)).xyz;',
    'v.worldNormal = cofactor3(localToWorld) * normal;',
    'v.prevWorldPos = (' + previousMatrix + ' * vec4f(previousPoint, 1.0)).xyz;',
  );
  if (hasTangent) vertex.push(
    'o.museumTangent = vec4f((localToWorld * vec4f(v.museumTangent.xyz, 0.0)).xyz, v.museumTangent.w);',
  );
  return { attributes, varyings, storage, vertex: vertex.join('\n') };
}
