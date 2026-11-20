// Travel stays on the validated habitat route. Ramp the actual distance and
// propulsion together so an animal does not drift at full speed on a rest pose.
export function aquaticTravel(speed, cruise, moving, alert, bottomCrawler, dt) {
  const target = moving ? cruise * (alert ? 1.32 : 1) : 0;
  const rate = cruise * (target > speed ? (bottomCrawler ? 2.4 : 1.62) : (bottomCrawler ? 4.8 : 2.65));
  const velocity = speed + Math.sign(target - speed) * Math.min(Math.abs(target - speed), rate * dt);
  const effort = cruise > 0 ? velocity / cruise : 0;
  return {
    velocity,
    travelled: .5 * (speed + velocity) * dt,
    propelling: moving || effort >= .42,
    cadence: bottomCrawler ? Math.min(1.32, effort) : .86 + .14 * Math.min(1.32, effort),
  };
}

export function aquaticYawAmount(dt, speed, cruise, bottomCrawler) {
  const effort = cruise > 0 ? Math.max(0, Math.min(1, speed / cruise)) : 0;
  // Hold the last bearing once the body has come to rest.
  return dt * (bottomCrawler ? 1.7 : 1.65) * Math.sqrt(effort);
}
