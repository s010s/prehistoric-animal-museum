import { Vector3 } from '../vendor/tidewater/src/engine/index.js';

// Support points from the museum model's hydrated, skinned Hover loop in its
// neutral body frame. A rectangular box joins the fin tips to the snout and
// tail, so it substantially overstates the width of a diagonal view.
const megalodonProfile = [
  [-.05,1.8,-8.03],[-.8,2.01,-7.91],[.94,1.82,-7.88],[-1.39,1.94,-7.88],
  [-1.27,1.99,-7.88],[-1.4,1.94,-7.87],[.5,1.97,-7.84],[1.11,1.86,-7.79],
  [-.08,-1.65,-7.24],[-1.03,-1.58,-7.23],[-1.25,-1.53,-7.22],[-1.27,-1.52,-7.21],
  [.39,-1.65,-7.19],[.83,-1.59,-7.09],[.85,-1.59,-7.08],[0,3.04,.48],
  [2.87,-2.46,2.29],[2.86,-2.48,2.33],[2.76,-2.6,2.34],[-2.86,-2.5,2.34],
  [-2.74,-2.63,2.36],[-2.85,-2.51,2.38],[-2.75,-2.63,2.39],
  [-1.16,.48,5.64],[.92,.48,6.1],[-.03,-.75,6.59],[-.59,.6,6.96],
  [-.34,.73,6.97],[.27,.66,7.15],[.35,.44,7.5],[0,-.18,7.59],
  [.35,.23,7.63],[-.35,.23,7.65],[.19,.13,7.87],[-.18,.13,7.88],
  [.11,.39,7.88],[-.1,.39,7.89],[.14,.34,7.92],[-.13,.34,7.93],
  [.01,.37,7.95],[.01,.18,8],[.01,.31,8.01],[.01,.24,8.02],
];

const worldUp = new Vector3(0, 1, 0);
const referenceLength = 16;

function project(points, eye, gaze, tanX, tanY) {
  const forward = gaze.clone().sub(eye).normalize();
  const right = new Vector3().crossVectors(forward, worldUp).normalize();
  const up = new Vector3().crossVectors(right, forward);
  const flat = new Vector3();
  const pixels = [];
  let left = Infinity, rightmost = -Infinity, bottom = Infinity, top = -Infinity;
  for (const point of points) {
    flat.copy(point).sub(eye);
    const depth = flat.dot(forward);
    if (depth < 1) return null;
    const x = flat.dot(right) / (depth * tanX), y = flat.dot(up) / (depth * tanY);
    left = Math.min(left, x); rightmost = Math.max(rightmost, x);
    bottom = Math.min(bottom, y); top = Math.max(top, y);
    pixels.push([x, y]);
  }
  return { left, rightmost, bottom, top, pixels, right, up };
}

/** Pick a near, elevated three-quarter composition at the validated route origin. */
export function megalodonPortrait(center, yaw, length, tanX, tanY, surface, isClear) {
  const target = new Vector3(...center), scale = length / referenceLength;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const parts = megalodonProfile.map(([x, y, z]) => new Vector3(x*c + z*s, y, z*c - x*s)
    .multiplyScalar(scale).add(target));

  let best = null;
  for (const side of [-1, 1]) for (const angle of [20, 24, 28, 32, 36, 40, 45, 51, 58, 65]) {
    const radians = angle * Math.PI / 180;
    const bearing = yaw + radians * side;
    for (const factor of [.43, .48, .53, .58, .63, .68, .73, .78, .83, .89, .95, 1.04, 1.13]) {
      const distance = length * factor;
      const eye = new Vector3(target.x + Math.sin(bearing) * distance,
        surface - 1.8, target.z + Math.cos(bearing) * distance);
      const approximate = project(parts, eye, target, tanX, tanY);
      if (!approximate) continue;

      // Recenter the perspective silhouette. The near end takes up more room
      // than the far end even though both lie on the same body axis.
      const depth = eye.distanceTo(target);
      const gaze = target.clone()
        .addScaledVector(approximate.right, (approximate.left + approximate.rightmost) * .5 * depth * tanX)
        .addScaledVector(approximate.up, (approximate.bottom + approximate.top) * .5 * depth * tanY);
      const frame = project(parts, eye, gaze, tanX, tanY);
      if (!frame) continue;
      const { left, rightmost, bottom, top, pixels } = frame;
      if (Math.max(-left, rightmost) > .81 || Math.max(-bottom, top) > .75) continue;
      const [tx, ty] = pixels[0], [nx, ny] = pixels.at(-1);
      const lengthOnScreen = Math.hypot((tx - nx) * tanX / tanY, ty - ny);
      const width = rightmost - left;
      const score = factor * 2.6 + Math.abs(.48 - lengthOnScreen) * 3
        + Math.abs(1.40 - width) * .55 + Math.abs(38 - angle) * .016;
      if (best && score >= best.score) continue;
      if (!isClear(eye.toArray(), gaze.toArray())) continue;
      best = { eye: eye.toArray(), gaze: gaze.toArray(), score };
    }
  }
  return best;
}
