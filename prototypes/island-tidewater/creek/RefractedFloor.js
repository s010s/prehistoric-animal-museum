import {BufferAttribute, InstancedBufferGeometry} from '../vendor/tidewater/src/engine/geometry/index.js';

// The guarded refraction camera sees the same terrain nodes at half resolution.
// Share their live positions and morph data. Preserve every perimeter vertex
// where a neighbour may be at a different LOD, and decimate only the interior.
export function makeRefractedFloor(lod) {
  const grid = lod.G;
  if (grid !== 64) return null;
  const base = lod.geometry;
  const indices = [];
  const vertex = (x, z) => z * (grid + 1) + x;
  for (let strip = 0; strip < grid; strip += 16) {
    for (let z = 0; z < grid; z += 2) {
      for (let x = strip; x < strip + 16; x += 2) {
        const a = vertex(x,z), b = vertex(x+2,z);
        const c = vertex(x,z+2), d = vertex(x+2,z+2);
        if (x > 0 && z > 0 && x+2 < grid && z+2 < grid) {
          if ((x+z)%4) indices.push(a,c,d,a,d,b);
          else indices.push(a,c,b,b,c,d);
          continue;
        }
        const edge = [a];
        if (x === 0) edge.push(vertex(x,z+1));
        edge.push(c);
        if (z+2 === grid) edge.push(vertex(x+1,z+2));
        edge.push(d);
        if (x+2 === grid) edge.push(vertex(x+2,z+1));
        edge.push(b);
        if (z === 0) edge.push(vertex(x+1,z));
        const centre = vertex(x+1,z+1);
        edge.forEach((v,i) => indices.push(centre,v,edge[(i+1)%edge.length]));
      }
    }
  }
  const floor = new InstancedBufferGeometry();
  floor.setAttribute('position',base.attributes.position);
  floor.setAttribute('nodeData',base.attributes.nodeData);
  floor.setIndex(new BufferAttribute(Uint16Array.from(indices),1));
  return floor;
}
