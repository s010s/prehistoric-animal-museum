import airspeed from '../museum/flight-motion/airspeed.json' with { type: 'json' };

// Look up flight effort at the middle of the simulation step. Glide carries
// the animal forward between loaded strokes.
export function flightSpeed(id, layer, cruise, timeOffset = 0) {
  const curve = airspeed[id];
  if (!layer || !curve || !(layer.clip.duration > 0)) return cruise;
  const cycle = (layer.time + timeOffset * layer.speed) / layer.clip.duration;
  const at = (cycle - Math.floor(cycle)) * curve.length;
  const i = Math.floor(at);
  const power = curve[i] + (curve[(i + 1) % curve.length] - curve[i]) * (at - i);
  return cruise * (1 + power * .001);
}
