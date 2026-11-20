const MiB = 1024 ** 2;
const RETRY_DELAY = [800, 2400];

// Distances are measured to a habitat's occupied volume, including its route.
export function distanceToFauna(camera, site) {
  const horizontal = Math.max(0, Math.hypot(camera.x - site.x, camera.z - site.z) - (site.radius ?? 0));
  return Math.hypot(horizontal, Math.max(0, (site.minY ?? site.y) - camera.y, camera.y - (site.maxY ?? site.y)));
}

export class FaunaResidency {
  constructor({ concurrency = 2, residentLimit = 8, byteLimit = 128 * MiB } = {}) {
    this.limits = { concurrency, residentLimit, byteLimit };
    this.entries = new Map();
    this.pending = new Set();
    this.camera = null;
    this.disposed = false;
    this.counters = { requested: 0, loaded: 0, evicted: 0, aborted: 0, failed: 0, peakResidentBytes: 0, peakInFlight: 0 };
  }

  add(definition) {
    const { id, bytes } = definition;
    if (this.entries.has(id) || !Number.isFinite(bytes) || bytes <= 0 || bytes > this.limits.byteLimit) {
      throw Error(`Invalid fauna residency entry ${id} (${bytes} bytes)`);
    }
    this.entries.set(id, { definition, status: 'outside', distance: Infinity, wanted: false, errors: 0, waiters: [] });
  }

  scan(camera, focus = this.focus) {
    if (this.disposed) return;
    this.focus = focus;
    this.camera = { x: camera.x, y: camera.y, z: camera.z };
    const candidates = [];
    for (const entry of this.entries.values()) {
      const { definition, wanted } = entry;
      entry.distance = distanceToFauna(camera, definition);
      entry.inRange = entry.distance <= definition.range + (wanted ? (definition.hysteresis ?? 28) : 0);
      if (entry.inRange) candidates.push(entry);
      else if (entry.errors) {
        this.clearRetry(entry);
        entry.error = null;
        entry.errors = 0;
      }
      if (!entry.inRange && definition.id === this.focus) this.focus = null;
    }
    candidates.sort((a, b) => this.priority(a) - this.priority(b) || a.definition.id.localeCompare(b.definition.id));
    const wanted = new Set();
    let bytes = 0;
    for (const entry of candidates) {
      if (wanted.size >= this.limits.residentLimit) break;
      if (entry.errors > RETRY_DELAY.length || bytes + entry.definition.bytes > this.limits.byteLimit) continue;
      wanted.add(entry);
      bytes += entry.definition.bytes;
    }
    for (const entry of this.entries.values()) {
      entry.wanted = wanted.has(entry);
      if (!entry.wanted) {
        this.release(entry);
        entry.status = entry.error && entry.inRange ? 'failed' : 'outside';
      } else if (!entry.request && !entry.retry && (entry.status === 'outside' || entry.status === 'failed')) entry.status = 'queued';
    }
    this.pump();
  }

  priority(entry) {
    return entry.distance - (entry.model ? 12 : 0) - (entry.definition.priority ?? 0)
      - (entry.definition.id === this.focus ? 10000 : 0);
  }

  pump() {
    if (this.disposed) return;
    let bytes = 0;
    for (const entry of this.entries.values()) if (entry.model) bytes += entry.definition.bytes;
    this.counters.peakResidentBytes = Math.max(bytes, this.counters.peakResidentBytes);
    for (const entry of this.pending) bytes += entry.definition.bytes;
    const queued = [...this.entries.values()].filter(e => e.wanted && !e.request && e.status === 'queued');
    queued.sort((a, b) => this.priority(a) - this.priority(b));
    for (const entry of queued) {
      if (this.pending.size >= this.limits.concurrency) break;
      if (bytes + entry.definition.bytes > this.limits.byteLimit) continue;
      bytes += entry.definition.bytes;
      this.start(entry);
    }
  }

  start(entry) {
    const definition = entry.definition;
    const request = new AbortController();
    entry.request = request;
    entry.status = 'loading';
    this.pending.add(entry);
    this.counters.requested++;
    this.counters.peakInFlight = Math.max(this.pending.size, this.counters.peakInFlight);
    void Promise.resolve().then(async () => {
      request.signal.throwIfAborted();
      const model = await definition.load(request.signal);
      let attaching = false;
      try {
        request.signal.throwIfAborted();
        if (definition.prepare) await definition.prepare(model, request.signal);
        request.signal.throwIfAborted();
        attaching = true;
        definition.attach(model);
      } catch (error) {
        try { if (attaching) definition.detach(model); } finally { definition.dispose(model); }
        throw error;
      }
      entry.model = model;
      entry.status = 'resident';
      entry.errors = 0;
      entry.error = null;
      this.counters.loaded++;
    }).catch(error => {
      if (request.signal.aborted) return;
      this.counters.failed++;
      entry.status = 'failed';
      entry.error = error instanceof Error ? error.message : String(error);
      const delay = RETRY_DELAY[entry.errors++];
      if (delay !== undefined) entry.retry = setTimeout(() => {
        entry.retry = null;
        if (entry.wanted && !this.disposed) {
          entry.status = 'queued';
          this.pump();
        }
      }, delay);
    }).finally(() => {
      this.pending.delete(entry);
      entry.request = null;
      if (request.signal.aborted && entry.wanted && !this.disposed) entry.status = 'queued';
      if (entry.model) this.settle(entry, entry.model);
      // Give the next nearest animal a slot when a permanent failure occurred.
      if (entry.errors > RETRY_DELAY.length && this.camera) this.scan(this.camera);
      else this.pump();
    });
  }

  clearRetry(entry) {
    clearTimeout(entry.retry);
    entry.retry = null;
  }

  settle(entry, model) {
    for (const resolve of entry.waiters.splice(0)) resolve(model);
  }

  release(entry) {
    const { model, definition, request } = entry;
    this.clearRetry(entry);
    this.settle(entry, null);
    if (request && !request.signal.aborted) {
      request.abort();
      this.counters.aborted++;
    }
    if (model) {
      entry.model = null;
      try { definition.detach(model); } finally { definition.dispose(model); }
      this.counters.evicted++;
    }
  }

  ready(id) {
    const entry = this.entries.get(id);
    if (!entry?.wanted || this.disposed || entry.errors > RETRY_DELAY.length) return Promise.resolve(null);
    if (entry.model) return Promise.resolve(entry.model);
    return new Promise(resolve => entry.waiters.push(resolve));
  }

  retry(id) {
    const entry = this.entries.get(id);
    if (!entry || entry.errors <= RETRY_DELAY.length) return;
    entry.errors = 0;
    entry.error = null;
  }

  state(id) {
    const entry = this.entries.get(id);
    if (!entry) return null;
    return { id, status: entry.status, distance: Number.isFinite(entry.distance) ? entry.distance : null,
      wanted: entry.wanted, inRange: !!entry.inRange, bytes: entry.definition.bytes, attemptsFailed: entry.errors,
      error: entry.error ?? null };
  }

  stats() {
    const entries = [...this.entries.values()];
    const resident = entries.filter(e => e.model);
    return { limits: this.limits, ...this.counters, total: entries.length, resident: resident.length,
      residentBytes: resident.reduce((sum, entry) => sum + entry.definition.bytes, 0),
      inFlight: this.pending.size, queued: entries.filter(e => e.status === 'queued').length,
      disposed: this.disposed };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.values()) {
      entry.wanted = false;
      this.release(entry);
      entry.status = 'outside';
    }
  }
}
