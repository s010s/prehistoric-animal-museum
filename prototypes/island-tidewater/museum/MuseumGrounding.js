import { Vector3, Quaternion } from '../vendor/tidewater/src/engine/index.js';

const up = new Vector3(0, 1, 0);
export const museumXZ = (x, z, yaw) => [Math.cos(yaw) * x + Math.sin(yaw) * z, -Math.sin(yaw) * x + Math.cos(yaw) * z];

// A support plane aligns all four contact regions with a gentle piece of the
// existing bed. It never flattens the terrain or buries the feet to hide a gap.
export function museumGroundSupport(terrain, field, x, z, yaw, half) {
  const samples = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const lx = sx * half[0], lz = sz * half[1], [dx, dz] = museumXZ(lx, lz, yaw), px = x + dx, pz = z + dz;
    const y = terrain.heightAt(px, pz), f = field.sample(px, pz);
    samples.push({ x: lx, z: lz, y, clear: y - f[0], edge: f[1] });
  }
  const y = samples.reduce((sum, p) => sum + p.y, 0) / 4;
  const gx = samples.reduce((sum, p) => sum + p.x * (p.y - y), 0) / (4 * half[0] ** 2);
  const gz = samples.reduce((sum, p) => sum + p.z * (p.y - y), 0) / (4 * half[1] ** 2);
  const residual = Math.max(...samples.map(p => Math.abs(p.y - y - gx * p.x - gz * p.z)));
  const [wx, wz] = museumXZ(gx, gz, yaw), normal = new Vector3(-wx, 1, -wz).normalize();
  const quaternion = new Quaternion().setFromUnitVectors(up, normal).multiply(new Quaternion().setFromAxisAngle(up, yaw));
  return { x, z, y, yaw, gx, gz, slope: Math.hypot(gx, gz), residual, clear: Math.min(...samples.map(p => p.clear)), edge: Math.min(...samples.map(p => p.edge)), quaternion };
}

export function seatMuseumModel(model, metadata, site, contactCenter = [0, 0], minY = metadata.bounds.min[1]) {
  const offset = new Vector3(contactCenter[0], minY, contactCenter[1]).multiplyScalar(metadata.scale).applyQuaternion(site.quaternion);
  model.group.quaternion.copy(site.quaternion);
  model.group.position.set(site.x - offset.x, site.y - offset.y, site.z - offset.z);
}

export function museumTrunkClear(app, site, metadata, contactCenter, pad = .65) {
  const half = [metadata.dimensions[0] * metadata.scale / 2, metadata.dimensions[2] * metadata.scale / 2];
  const center = [(metadata.bounds.min[0] + metadata.bounds.max[0]) * metadata.scale / 2 - contactCenter[0] * metadata.scale, (metadata.bounds.min[2] + metadata.bounds.max[2]) * metadata.scale / 2 - contactCenter[1] * metadata.scale];
  for (const r of app.vegetation?.records ?? []) {
    if (Math.hypot(r.x - site.x, r.z - site.z) > Math.hypot(...half) + Math.hypot(...center) + 6) continue;
    const [lx, lz] = museumXZ(r.x - site.x, r.z - site.z, -site.yaw), trunk = .12 + (r.H ?? 10) * (r.variant === 4 ? .033 : .011);
    if (Math.abs(lx - center[0]) < half[0] + trunk + pad && Math.abs(lz - center[1]) < half[1] + trunk + pad) return false;
  }
  return true;
}

export function findMuseumGround(app, metadata, { preferred, yaw = 0, supportHalf, contactCenter = [0, 0], radius = 32, maxSlope = .27, maxResidual = .07 }) {
  let best = null;
  for (let dz = -radius; dz <= radius; dz += 2) for (let dx = -radius; dx <= radius; dx += 2) {
    if (Math.hypot(dx, dz) > radius) continue;
    for (const turn of [0, -.4, .4, -.8, .8, -1.2, 1.2, 1.6]) {
      const site = museumGroundSupport(app.terrainData, app.creekData.field, preferred[0] + dx, preferred[1] + dz, yaw + turn, supportHalf);
      if (site.clear < .22 || site.edge < .3 || site.slope > maxSlope || site.residual > maxResidual) continue;
      const score = Math.hypot(dx, dz) + site.slope * 24 + site.residual * 45 + Math.abs(turn) * .8;
      if (best && score >= best.score || !museumTrunkClear(app, site, metadata, contactCenter)) continue;
      best = { ...site, score, contactCenter, supportHalf, available: true };
    }
  }
  if (!best) throw Error(`No dry, supported, trunk-free site for ${metadata.id}`);
  return best;
}

export function museumGroundVisit(app, id, title, site, height, distance = 8, bodyTarget = null) {
  let best = null;
  const target=bodyTarget??[site.x,site.y+height,site.z];
  const trees=(app.vegetation?.records??[]).filter(r=>Math.hypot(r.x-site.x,r.z-site.z)<distance+12);
  for (let i = 0; i < 32; i++) {
    const a = i * Math.PI / 16, x = site.x + Math.cos(a) * distance, z = site.z + Math.sin(a) * distance;
    const h = app.terrainData.heightAt(x, z), f = app.creekData.field.sample(x, z);
    const slope = Math.hypot(app.terrainData.heightAt(x + .5, z) - app.terrainData.heightAt(x - .5, z), app.terrainData.heightAt(x, z + .5) - app.terrainData.heightAt(x, z - .5));
    if (h < f[0] + .18 || slope > .48) continue;
    if (trees.some(r => Math.hypot(r.x - x, r.z - z) < 1.5 + (r.H ?? 10) * .02)) continue;
    const dx=target[0]-x,dz=target[2]-z,length2=dx*dx+dz*dz;
    const blocked=trees.some(r=>{
      const u=((r.x-x)*dx+(r.z-z)*dz)/Math.max(.001,length2);
      if(u<=.015||u>=.985)return false;
      const eyeHeight=h+1.62+(target[1]-h-1.62)*u-r.y,H=r.H??10;
      if(eyeHeight<-.2||eyeHeight>H*.85)return false;
      let radius=.35+H*(r.variant===4?.033:r.variant>=2?.023:.012)*(1-.45*Math.max(0,eyeHeight/H));
      // Root contact raises the flared collar over sloping terrain. Its
      // silhouette can be wider than the stem's section at this world Y.
      if(eyeHeight<8)radius=Math.max(radius,.3+(r.variant===4?1.1:.8)*(r.s??H/17));
      return Math.hypot(r.x-x-dx*u,r.z-z-dz*u)<radius;
    });
    if(blocked)continue;
    const score = slope * 6 + Math.abs(h - site.y) + (x < site.x ? 1 : 0);
    if (!best || score < best.score) best = { p: [x, z], score, ground: h, slope, trunkClear:true };
  }
  if (!best) throw Error(`No walkable observation entry for ${id}`);
  return { id, title, p: best.p, gaze: target, time: 12.6, note: '', footing: best };
}
