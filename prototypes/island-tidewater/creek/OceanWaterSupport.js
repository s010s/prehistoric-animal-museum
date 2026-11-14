// The ocean only needs the inland registry near a potential water owner.
// Store up to two inclusive X intervals per latitude band in the unused
// last row of the existing inland atlas. Joining intervals is conservative.
const noExclusion = 'fn museumMayHaveInlandWater(p:vec2f)->bool{return true;}';
const wetEdge = 9; // native inland lighting reaches 8 m
const padding = 1; // covers the four half-metre gradient neighbours and fp32 rounding

export function packOceanWaterSupport(field, world, packed, width, firstFreeTexel) {
  const sample = field.continuousSample;
  const remaining = packed.length / 4 - firstFreeTexel;
  const firstColumn = firstFreeTexel % width;
  if (!sample || remaining < 16 || firstColumn + remaining > width) return noExclusion;

  const boxes = [];
  function include(x0, z0, x1, z1) {
    boxes.push([x0 - padding, z0 - padding, x1 + padding, z1 + padding]);
  }
  function ellipse(x, z, rx, rz, outer) {
    const scale = outer + wetEdge / Math.min(rx, rz);
    include(x - rx * scale, z - rz * scale, x + rx * scale, z + rz * scale);
  }
  // A raster cell or river segment can only mix its corners/endpoints.
  // Mark both banks over the entire segment, including the larger width.
  function riverSegment(ax, az, aw, bx, bz, bw) {
    if (aw <= 0 && bw <= 0) return;
    aw = Math.max(0, aw);
    bw = Math.max(0, bw);
    include(Math.min(ax - aw, bx - bw) - wetEdge, Math.min(az, bz),
      Math.max(ax + aw, bx + bw) + wetEdge, Math.max(az, bz));
  }

  const half = field.g.waterSize / 2;
  include(-half, -half, half, half);
  const [sx, sz] = world.source.center;
  include(sx - 128, sz - 128, sx + 128, sz + 128);
  for (const lake of world.lakes) ellipse(...lake.center, lake.rx, lake.rz, 1.06);
  const marsh = world.marsh;
  ellipse(marsh.x, marsh.z, marsh.rx, marsh.rz, 1.04);

  const profile = field.riverProfile;
  const {riverStart, riverStep} = field.riverLayout;
  for (let i = 1; i < profile.length / 4; i++) {
    const b = i * 4, a = b - 4, z = riverStart + i * riverStep;
    riverSegment(profile[a], z - riverStep, profile[a + 2], profile[b], z, profile[b + 2]);
  }
  const tributary = world.tributary;
  for (let i = 1; i < tributary.length; i++) {
    const a = tributary[i - 1], b = tributary[i];
    riverSegment(a[0], a[3], a[2], b[0], b[3], b[2]);
  }

  const {center, size, res, bytes} = sample;
  const texel = size / res, x0 = center[0] - size / 2, z0 = center[1] - size / 2;
  for (let row = 0; row < res; row++) {
    let first = res, last = -1;
    for (let col = 0; col < res; col++) {
      if (bytes[(row * res + col) * 4 + 1] < wetEdge) {
        first = Math.min(first, col);
        last = col;
      }
    }
    if (last >= 0) include(x0 + (first - .5) * texel, z0 + (row - .5) * texel,
      x0 + (last + 1.5) * texel, z0 + (row + 1.5) * texel);
  }
  // The first eight sample controls override the raster analytically.
  include(x0, sample.sections[0][1], x0 + size, sample.sections[7][1]);

  const minZ = Math.floor(Math.min(...boxes.map(b => b[1])) / 32) * 32;
  const maxZ = Math.ceil(Math.max(...boxes.map(b => b[3])) / 32) * 32;
  const step = Math.ceil((maxZ - minZ + 1) / remaining);
  const rowCount = Math.ceil((maxZ - minZ + 1) / step);
  const bands = Array.from({length: rowCount}, () => []);
  for (const [left, bottom, right, top] of boxes) {
    const last = Math.floor((top - minZ) / step);
    for (let j = Math.floor((bottom - minZ) / step); j <= last; j++) bands[j].push([left, right]);
  }
  bands.forEach((band, row) => {
    const merged = [];
    for (const [left, right] of band.sort((a, b) => a[0] - b[0])) {
      const prev = merged.at(-1);
      if (prev && left <= prev[1]) prev[1] = Math.max(prev[1], right);
      else merged.push([left, right]);
    }
    while (merged.length > 2) {
      let closest = 0;
      for (let i = 1; i < merged.length - 1; i++) {
        if (merged[i + 1][0] - merged[i][1] < merged[closest + 1][0] - merged[closest][1]) closest = i;
      }
      merged[closest][1] = merged[closest + 1][1];
      merged.splice(closest + 1, 1);
    }
    const [a = [1, -1], b = [1, -1]] = merged;
    packed.set([Math.floor(a[0]), Math.ceil(a[1]), Math.floor(b[0]), Math.ceil(b[1])],
      (firstFreeTexel + row) * 4);
  });

  // Keep the complete native field for the eastern tributary's cubic reach.
  const points = field.tributarySource.points;
  const south = points[0].z - padding, north = points.at(-1).z + padding;
  const atlasRow = Math.floor(firstFreeTexel / width);
  return `fn museumMayHaveInlandWater(p:vec2f)->bool{
 if(p.y>=${south.toFixed(1)}&&p.y<=${north.toFixed(1)}){return true;}
 let row=i32(floor((p.y-(${minZ}.0))/${step}.0));
 if(row<0||row>=${rowCount}){return false;}
 let w=textureLoad(creekFieldTex,vec2i(${firstColumn}+row,${atlasRow}),0);
 return (p.x>=w.x&&p.x<=w.y)||(p.x>=w.z&&p.x<=w.w);
}`;
}
