// Blades emerge along a short rhizome. Their lower halves rise with buoyancy,
// then twist and stream downstream. Adjacent ramets never share a single crown.
import {BufferAttribute, BufferGeometry} from '../vendor/tidewater/src/engine/index.js';
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';

export function freshwaterRibbons(seed, lod, trailing) {
  const random = mulberry32(seed), positions = [], data = [], faces = [];
  const runs = lod ? 5 : 8;
  const shoots = 5 + Math.floor(random() * 4);
  for (let i = 0; i < shoots; i++) {
    const rootX = (random() - .5) * .31, rootZ = (random() - .5) * .19;
    const length = .42 + random() * .87, width = .012 + random() * .024;
    const fan = (random() - .5) * (trailing ? 1.5 : 3.8);
    const lateral = (random() - .5) * .32, twist = (random() - .5) * 2.8;
    const angle = random() * 6.28, phase = random(), first = positions.length / 3;
    const color = [0x202b12, 0x2c3616, 0x182712, 0x303a1c][i % 4];
    for (let j = 0; j <= runs; j++) {
      const t = j / runs, bow = t * t * (trailing ? .85 : .56), curl = Math.sin(t * 5 + phase * 5) * t * .06;
      const x = rootX + length * (Math.cos(fan) * bow + curl);
      const y = length * (trailing ? .85 * t - .62 * t * t : 1.1 * t - .67 * t * t) + t * curl * .45;
      const z = rootZ + length * (Math.sin(fan) * bow + lateral * t + curl);
      const w = width * (.56 + .44 * Math.sin(t * Math.PI)) * Math.max(.025, 1 - t ** 3);
      const a = angle + t * twist;
      for (const side of [-1, 1]) {
        positions.push(x + Math.cos(a) * w * side, y + Math.sin(t * 3) * w * side * .48, z + Math.sin(a) * w * side);
        data.push(t, color, .68 + .32 * Math.min(1,t * 4), phase);
      }
      if (j) {
        const k = first + 2 * j;
        faces.push(k-2, k-1, k, k-1, k+1, k);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('aData', new BufferAttribute(new Float32Array(data), 4));
  g.setIndex(faces);
  g.computeVertexNormals();
  return g;
}
