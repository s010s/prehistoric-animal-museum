import { Matrix4, Quaternion, Vector3 } from '../vendor/tidewater/src/engine/index.js';
import { quadrupedActions } from './QuadrupedActions.js';
export { prepareQuadrupedStride, quadrupedExtraGpuBytes } from './QuadrupedStrideRig.js';

const one = new Vector3(1, 1, 1);

// Stream rows are signed shorts in little-endian order. The authoring file
// stores rotation vectors in radians and translations in neutral model units.
function unpack(text) {
  const bytes = Uint8Array.from(atob(text), c => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  return Int16Array.from({ length: bytes.length / 2 }, (_, i) => view.getInt16(i * 2, true));
}

const decoded = new Map();
function readAction(id) {
  if (!decoded.has(id)) {
    const action = quadrupedActions[id];
    if (!action) return null;
    decoded.set(id, { ...action, tracks: action.tracks.map(([name, flags, data]) => ({ name, flags, data: unpack(data) })),
      poles: action.poles.map(unpack) });
  }
  return decoded.get(id);
}

function transformRow(rows, at, matrix) {
  const m = matrix.elements;
  for (let i = at; i < at + 16; i += 4) {
    const x = rows[i], y = rows[i + 1], z = rows[i + 2], w = rows[i + 3];
    rows[i] = m[0] * x + m[4] * y + m[8] * z + m[12] * w;
    rows[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13] * w;
    rows[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14] * w;
  }
}

export function createQuadrupedPerformance(id, pose, metadata) {
  const action = readAction(id);
  if (!action) return null;
  const [fx, fz] = metadata.forward;
  const names = new Map(pose.gltf.nodes.map(({ name }, i) => [name, i]));
  const active = new Map(action.tracks.map(track => {
    const index = names.get(track.name);
    if (index === undefined) throw Error('Missing quadruped performance joint ' + id + '/' + track.name);
    return [index, { ...track, matrix: new Matrix4() }];
  }));
  const links = new Array(pose.gltf.nodes.length);
  for (const i of pose.order) links[i] = active.get(i)?.matrix ?? links[pose.parent[i]];
  const rows = pose.skin.joints.flatMap((i, row) => links[i] ? [[row * 16, links[i]]] : []);
  const changed = pose.order.filter(i => links[i]);
  const delta = new Vector3(), pivot = new Vector3(), axis = new Vector3(), rotation = new Quaternion();
  const pole = new Vector3(), value = new Float64Array(6);
  const sample = (data, phase, count) => {
    const t = (phase - Math.floor(phase)) * action.samples;
    const i = Math.floor(t) * count, next = (Math.floor(t) + 1) % action.samples * count;
    const fraction = t % 1;
    for (let j = 0; j < count; j++) value[j] = data[i + j] + (data[next + j] - data[i + j]) * fraction;
  };
  const modelVector = (out, offset, factor) => {
    const f = value[offset] * factor, lateral = value[offset + 1] * factor;
    return out.set(f * fx + lateral * fz, value[offset + 2] * factor, f * fz - lateral * fx);
  };
  return {
    apply(phase, weight) {
      if (!(weight > 0)) return;
      for (const i of changed) {
        const track = active.get(i);
        if (!track) continue;
        const { flags, data, matrix } = track;
        const hasRotation = flags.includes('r'), hasLocation = flags.includes('t');
        sample(data, phase, flags.length * 3);
        rotation.identity();
        if (hasRotation) {
          modelVector(axis, 0, 1 / 32767);
          const angle = axis.length();
          if (angle > 0) rotation.setFromAxisAngle(axis.divideScalar(angle), angle * weight);
        }
        if (hasLocation) modelVector(delta, hasRotation ? 3 : 0, weight * action.height / 32767);
        else delta.set(0, 0, 0);
        pivot.fromArray(pose.world, i * 16 + 12);
        delta.add(pivot);
        delta.sub(pivot.applyQuaternion(rotation));
        matrix.compose(delta, rotation, one);
        const parent = links[pose.parent[i]];
        if (parent) matrix.premultiply(parent);
      }
      for (const i of changed) transformRow(pose.world, i * 16, links[i]);
      for (const [offset, matrix] of rows) transformRow(pose.jointData, offset, matrix);
    },
    kneePole(index, phase, weight, neutral) {
      if (!(weight > 0)) return neutral;
      sample(action.poles[index], phase, 3);
      modelVector(pole, 0, 1 / 32767).normalize();
      return pole.lerp(neutral, 1 - weight).normalize();
    },
  };
}
