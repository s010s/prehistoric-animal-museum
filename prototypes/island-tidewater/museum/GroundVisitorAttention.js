// An approach draws a single glance. Remaining beside the animal lets it
// resume its routine. Leaving the encounter arms the next approach.
export function groundVisitorAttention(state, dt, distance, radius, duration = 2.2) {
  state.watchSeconds = Math.max(0, (state.watchSeconds ?? 0) - dt);
  if (distance > radius * 1.35) state.visitorNoticed = false;
  if (distance < radius && !state.visitorNoticed) {
    state.visitorNoticed = true;
    state.watchSeconds = duration;
  }
  return state.watchSeconds;
}

// A visitor behind the shoulder is out of the comfortable gaze arc. Fade
// the response there so crossing the rear axis never flips the neck.
export function groundLookAngle(direction, heading, limit) {
  const delta = Math.atan2(Math.sin(direction - heading), Math.cos(direction - heading));
  const behind = Math.max(0, Math.min(1, (2.5 - Math.abs(delta)) / .9));
  return Math.max(-limit, Math.min(limit, delta)) * behind;
}
