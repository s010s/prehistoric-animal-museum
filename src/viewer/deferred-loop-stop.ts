/**
 * Three's WebGLAnimation schedules its next RAF after invoking the application.
 * Stopping inside that invocation cancels the already-fired id; a new RAF then
 * escapes cancellation. Stop in a microtask, after the next id has been stored.
 * Recheck ownership/state because a user action may already have resumed it.
 */
export function stopAfterAnimationFrame(stillPaused: () => boolean, stop: () => void): void {
  queueMicrotask(() => { if (stillPaused()) stop() })
}
