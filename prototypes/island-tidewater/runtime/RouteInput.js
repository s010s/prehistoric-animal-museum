// Keep the native player and its scripted keys active. Intercept physical events at the
// DOM boundary, before Tidewater's canvas and window listeners write to the same input.
// Window-targeted events can reach an earlier listener on that same target before a
// later capture listener. Install these before the app constructs the native Input.
export function installRouteInput(runtime) {
  const blockKey = event => {
    if (!runtime.routeOwnsInput || event.code === 'Escape') return;
    // Tidewater ignores keydown during native form editing; browser default actions still work.
    if (event.type === 'keydown' && event.target?.matches?.('input, select, textarea')) return;
    event.stopImmediatePropagation();
  };
  window.addEventListener('keydown', blockKey, true);
  window.addEventListener('keyup', blockKey, true);
  window.addEventListener('mousemove', event => {
    if (runtime.routeOwnsInput && (runtime.app.input.locked || document.pointerLockElement === runtime.app.engine.domElement)) event.stopImmediatePropagation();
  }, true);
}

export function takeRouteInput(runtime) {
  const {app} = runtime;
  const canvas = app.engine.domElement;
  const listeners = new AbortController();
  const capture = {capture:true, passive:false, signal:listeners.signal};
  const stop = event => { event.preventDefault(); event.stopImmediatePropagation(); };
  for (const type of ['mousedown','click','wheel']) canvas.addEventListener(type, stop, capture);
  const controls = [...document.querySelectorAll('[data-place], [data-animal], [data-water-view], [data-map-place], .map-key-item, #walk, #fly, #enter-scene, #flight-speed, #motion-route, #region-place, #coast-place, #sample-place, #sample-compare, #restore-scene-report')].filter(control => !control.disabled);
  for (const control of controls) control.disabled = true;
  runtime.routeOwnsInput = true;
  runtime.wasLocked = false;
  runtime.clearInput();
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  return () => {
    listeners.abort();
    for (const control of controls) control.disabled = false;
    runtime.clearInput();
    runtime.routeOwnsInput = false;
  };
}
