// Choose a real underwater eye point near the living school. The school
// continues its own route and the visitor remains in the ordinary swim mode.
export function schoolObservation(terrain, query, group) {
  if (!group) return null;
  const { x, z, h, floor, radius } = group;
  const gaze = [x, h - (h - floor) * .54, z];
  const close = Math.max(2.6, radius * .88);
  let best = null;
  for (const factor of [1, 1.24, .8, 1.6, 2.05, 2.4]) {
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      const eyeX = x + Math.cos(a) * close * factor;
      const eyeZ = z + Math.sin(a) * close * factor;
      const water = query.height(eyeX, eyeZ);
      const bed = terrain.heightAt(eyeX, eyeZ);
      if (Math.abs(water - h) > .12 || water - bed < 1.23) continue;
      const eyeY = Math.min(water - .4, Math.max(bed + .55, gaze[1] + .13));
      let visible = true;
      for (let j = 1; j < 8; j++) {
        const t = j / 8, px = eyeX + (x - eyeX) * t, pz = eyeZ + (z - eyeZ) * t;
        const py = eyeY + (gaze[1] - eyeY) * t;
        if (terrain.heightAt(px, pz) > py - .18 || query.height(px, pz) < py + .24) {
          visible = false;
          break;
        }
      }
      if (!visible) continue;
      const score = Math.abs(factor - 1) + Math.abs(eyeY - gaze[1] - .13);
      if (!best || score < best.score) best = { eye: [eyeX, eyeY, eyeZ], gaze, score };
    }
  }
  return best;
}
