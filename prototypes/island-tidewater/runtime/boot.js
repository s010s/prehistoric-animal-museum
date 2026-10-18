import { NativeRuntime } from './NativeRuntime.js';
export async function boot(App, kind) {
  const app = new App();
  const runtime = new NativeRuntime(app, kind);
  window.__nativeReview = runtime;
  try {
    await app.init((p, text) => runtime.progress(p, text));
    const pendingScans = !!app.debris && !app.debris.scanned?.ready;
    await app.debris?.scanned.promise;
    if (app.debris && !app.debris.scanned.ready) throw Error('Native scanned scenery did not finish loading');
    if (pendingScans) await app.precompile();
    runtime.ready();
  }
  catch (error) { runtime.fail(error); }
}
