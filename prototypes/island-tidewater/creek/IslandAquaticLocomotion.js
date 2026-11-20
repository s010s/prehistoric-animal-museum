import strokes from '../museum/aquatic-motion/strokes.json' with { type: 'json' };

export function aquaticDrive(id) {
  const stroke = strokes[id];
  if (!stroke) throw Error('Missing museum propulsion stroke for ' + id);
  return { stroke, speed: 0, loading: 0 };
}

function pressure(stroke, phase) {
  const at = (phase - Math.floor(phase)) * stroke.shape.length;
  const i = Math.floor(at), a = stroke.shape[i], b = stroke.shape[(i+1) % stroke.shape.length];
  return (a + (b-a) * (at-i)) / stroke.mean;
}

// Sample the actual playing layer, after it has evaluated the skin. A swimmer
// accelerates only after its tail or paddles begin their first loaded stroke.
// Momentum carries it across a reversal. A stationary or missing clip adds
// no propulsion, including when an individual is first attached to the scene.
export function aquaticTravel(drive, layer, previousTime, cruise, moving, dt) {
  if (!(dt > 0)) return 0;
  const {stroke} = drive;
  const crawler = stroke.mode === 'legs', jet = stroke.mode === 'jet';
  const duration = layer?.clip.duration || 1;
  const oldSpeed = drive.speed;
  let target = 0;
  let advance = layer ? layer.time - previousTime : 0;
  if (advance < 0) advance += duration;
  if (moving && layer && advance > 0 && layer.weight > 0) {
    const dPhase = advance / duration;
    const mid = (previousTime + .5 * advance) / duration;
    const thrust = pressure(stroke, mid);
    // Integrate part of a visible stroke before taking off from rest. At
    // a flipper reversal or during jet refill this loading takes longer.
    const oldLoad = drive.loading;
    drive.loading = Math.min(1, oldLoad + dPhase * thrust * layer.weight / (crawler ? .07 : .14));
    const engagement = Math.max(0, 2 * (.5 * (oldLoad + drive.loading) - .5));
    target = cruise * (advance / dt) * layer.weight * engagement * thrust;
  } else {
    drive.loading = 0;
  }
  const response = moving
    ? duration * (crawler ? .085 : jet ? .17 : .26)
    : (crawler ? .025 : jet ? .32 : .48);
  const blend = -Math.expm1(-dt / response);
  drive.speed = oldSpeed + (target - oldSpeed) * blend;
  const travelled = target * dt + (oldSpeed - target) * response * blend;
  if (drive.speed < cruise * .001 && target === 0) drive.speed = 0;
  return travelled;
}

export function aquaticYawAmount(dt, speed, cruise, bottomCrawler) {
  const effort = cruise > 0 ? Math.max(0, Math.min(1, speed / cruise)) : 0;
  return dt * (bottomCrawler ? 1.7 : 1.65) * Math.sqrt(effort);
}
