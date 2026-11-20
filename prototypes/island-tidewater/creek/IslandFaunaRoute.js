const TAU = 2 * Math.PI;
const mix = (a, b, t) => a + (b - a) * t;
const signedAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

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
  }
  return { origin, segments, length, yaw: (site.yaw ?? 0) - body.forward };
}

export function routePoint(route, distance) {
  if (!route.length) return [...route.origin, route.yaw];
  const s = distance % route.length;
  const segment = route.segments.find(a => s < a.start + a.size) ?? route.segments.at(-1);
  const t = (s - segment.start) / segment.size;
  const yaw = segment.yaw + (t < .5 ? segment.entry * (1 - 2 * t) : segment.exit * (2 * t - 1));
  return [...segment.a.map((v, i) => mix(v, segment.b[i], t)), yaw];
}
