// Evaluate the same morph-followed-by-skin order as the museum vertex shader.
import {floatAttribute, islandMorphWeights} from '../museum/IslandMuseumModelData.js';

export function visitAquaticSkin(piece, model, visit) {
  const weights = new Float32Array(piece.defaultWeights.length);
  islandMorphWeights(piece, model.layers, weights);
  const source = floatAttribute(piece.primitive.attributes.POSITION);
  const targets = piece.primitive.targets;
  const point = new Float64Array(3);
  for (let offset = 0, vertex = 0; offset < source.length; offset += 3, vertex += 4) {
    let x = source[offset], y = source[offset + 1], z = source[offset + 2];
    for (let j = 0; j < weights.length; j++) {
      const delta = targets[j].position;
      if (!delta || !weights[j]) continue;
      x += delta[offset] * weights[j];
      y += delta[offset + 1] * weights[j];
      z += delta[offset + 2] * weights[j];
    }
    point.fill(0);
    if (piece.influences.length) {
      const rows = model.jointData;
      for (const skin of piece.influences) {
        for (let i = vertex; i < vertex + 4; i++) {
          const weight = skin.weights[i] / 65535;
          if (!weight) continue;
          const j = skin.joints[i] * 16;
          for (let axis = 0; axis < 3; axis++) {
            const k = j + axis;
            point[axis] += weight * (rows[k] * x + rows[k + 4] * y + rows[k + 8] * z + rows[k + 12]);
          }
        }
      }
    } else {
      const rows = model.world, node = piece.nodeIndex * 16;
      for (let axis = 0; axis < 3; axis++) {
        const k = node + axis;
        point[axis] = rows[k] * x + rows[k + 4] * y + rows[k + 8] * z + rows[k + 12];
      }
    }
    visit(point, offset / 3);
  }
}
