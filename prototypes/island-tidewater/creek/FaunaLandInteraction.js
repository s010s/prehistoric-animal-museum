import { Vector3 } from '../vendor/tidewater/src/engine/index.js';
import { WALK_CAPSULE } from './MuseumColliders.js';

// Inner torso boxes measured against horizontal sections of each visible Idle
// pose. Entries are metres: side, height above the foot plane, forward, and
// three half extents. Narrow ends leave heads, tails, legs and trunks free.
const TORSOS = {
  dimetrodon: [0, .38, .45, .12, .10, .27],
  dilophosaurus: [0, 1.35, .94, .11, .13, .22],
  apatosaurus: [0, 3.14, 3.30, .67, .63, 1.09],
  stegosaurus: [0, 2.05, -.66, .34, .49, .86],
  'allosaurus-pandras': [0, 2.12, .22, .37, .24, .65],
  baryonyx: [0, 2.21, .36, .35, .26, .70],
  sauropelta: [0, .99, .64, .30, .19, .47],
  spinosaurus: [-.38, 2.55, .23, .21, .38, .71],
  maiasaura: [0, 1.79, .26, .27, .24, .66],
  parasaurolophus: [0, 2.20, 1.42, .31, .31, .72],
  regaliceratops: [0, 1.03, -.30, .24, .25, .77],
  ankylosaurus: [0, 2.02, .67, .75, .50, .96],
  pachycephalosaurus: [0, 1.39, .12, .15, .19, .29],
  triceratops: [0, 2.11, -.27, .66, .51, .83],
  'tyrannosaurus-rex': [0, 2.67, .86, .42, .29, .59],
  therizinosaurus: [-.06, 3.72, 1.08, .41, .36, .41],
  gallimimus: [0, 1.68, .98, .23, .23, .46],
  gigantoraptor: [-1.23, 3.50, .86, .30, .38, .69],
  carnotaurus: [0, 2.56, -.42, .31, .32, .69],
  phorusrhacos: [0, 1.73, -.53, .26, .13, .29],
  mammoth: [1.06, 1.78, -.45, .43, .32, .59],
};

export function faunaTorso(id, metadata) {
  const definition = TORSOS[id];
  if (!definition) return null;
  const [x, y, z, hx, hy, hz] = definition;
  return { offset: new Vector3(x, y + metadata.bounds.min[1] * metadata.scale, z), half: new Vector3(hx, hy, hz) };
}

export function torsoOverlapsCapsule(point, radius, height, box) {
  const { center, half, cos, sin, bottom, top } = box;
  if (point.y + height < bottom || point.y > top) return false;
  const x = point.x - center.x, z = point.z - center.z;
  const dx = Math.max(0, Math.abs(x * cos - z * sin) - half.x);
  const dz = Math.max(0, Math.abs(x * sin + z * cos) - half.z);
  return dx * dx + dz * dz < radius * radius;
}

export function placeFaunaTorso(app, actor, x, y, z, yaw, advancing) {
  const torso = actor.torso;
  if (!torso) return true;
  const { offset, half } = torso;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const center = actor.torsoCenter.set(x + offset.x * cos + offset.z * sin, y + offset.y, z - offset.x * sin + offset.z * cos);
  const bottom = center.y - half.y, top = center.y + half.y;
  // Stop a patrol before its moving torso intersects a standing visitor. The
  // regular Tidewater solver handles the visitor's own approach to the body.
  if (advancing && !app.freeCam && app.player.mode === 'walk' &&
      torsoOverlapsCapsule(app.player.position, WALK_CAPSULE.radius, WALK_CAPSULE.height, { center, half, cos, sin, bottom, top })) return false;
  const collider = actor.collider ??= app.colliders.addBox(center, half, yaw, { tag: 'museum animal torso' });
  collider.center.copy(center);
  collider.rotY = yaw;
  collider.cos = cos;
  collider.sin = sin;
  collider.bottom = bottom;
  collider.top = top;
  collider.solid = true;
  return true;
}
