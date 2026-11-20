const TAU = 2 * Math.PI;
const mix = (a, b, t) => a + (b - a) * t;
const signedAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
export const landTurnRate = .6;

export function makeRoute(site, body) {
  const origin = site.path?.[0] ?? [site.x, site.y, site.z];
  const radius = site.radius ?? 0;
  // Habitat placement can supply a checked loop. The fallback starts on the
  // habitat anchor so the animal lines up with the authored observation view.
  const points = site.path?.length > 1 ? site.path : radius > .05 ? Array.from({ length: 24 }, (_, i) => {
    const a = i / 24 * TAU;
    return [origin[0] + (Math.cos(a) - 1) * radius * .45, origin[1], origin[2] + Math.sin(a) * radius * .39];
  }) : [origin];
  const segments = [];
  let length = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const size = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (size < .0001) continue;
    segments.push({ a, b, start: length, size, yaw: Math.atan2(b[0] - a[0], b[2] - a[2]) - body.forward });
    length += size;
  }
  for (let i = 0; i < segments.length; i++) {
    const current = segments[i];
    const previous = segments[(i + segments.length - 1) % segments.length];
    const next = segments[(i + 1) % segments.length];
    current.entry = .5 * signedAngle(previous.yaw - current.yaw);
    current.exit = .5 * signedAngle(next.yaw - current.yaw);
    if ((site.medium === 'air' || site.medium === 'ground') && segments.length >= 3) {
      // Feet and airborne bodies both need to travel along their facing
      // direction. Share a tangent at each surveyed path knot.
      const start = current.yaw + body.forward + current.entry;
      const end = current.yaw + body.forward + current.exit;
      current.bend = [Math.sin(start), Math.cos(start), Math.sin(end), Math.cos(end)];
    }
  }
  return { origin, segments, length, forward: body.forward, yaw: (site.yaw ?? 0) - body.forward };
}

export function routePoint(route, distance) {
  if (!route.length) return [...route.origin, route.yaw];
  const s = distance % route.length;
  const segment = route.segments.find(a => s < a.start + a.size) ?? route.segments.at(-1);
  const t = (s - segment.start) / segment.size;
  if (segment.bend) {
    const { a, b, size, bend } = segment;
    const u = 1 - t, ease = t * t * (3 - 2 * t);
    const lead = size * t * u * u, trail = -size * t * t * u;
    const x = mix(a[0], b[0], ease) + lead * bend[0] + trail * bend[2];
    const z = mix(a[2], b[2], ease) + lead * bend[1] + trail * bend[3];
    const change = 6 * t * u / size, out = u * (1 - 3 * t), into = t * (3 * t - 2);
    const dx = (b[0] - a[0]) * change + out * bend[0] + into * bend[2];
    const dz = (b[2] - a[2]) * change + out * bend[1] + into * bend[3];
    return [x, mix(a[1], b[1], t), z, Math.atan2(dx, dz) - route.forward];
  }
  const yaw = segment.yaw + (t < .5 ? segment.entry * (1 - 2 * t) : segment.exit * (2 * t - 1));
  return [...segment.a.map((v, i) => mix(v, segment.b[i], t)), yaw];
}
