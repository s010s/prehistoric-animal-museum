import { GPU } from '../vendor/tidewater/src/engine/gpu/GPU.js';

// Adapted from pinned Tidewater core/Bench.js (MIT). Timestamp actual native
// passes with a reusable query/readback ring; preserve missing and invalid rows.
// No extra GPU passes, no per-frame GPU object allocation. A seven-frame cadence
// visits every phase of the native 1/2/4-frame shadow update schedule.
const MAX_PASSES = 512, SAMPLE_EVERY = 7;
export class FrameTimer {
  constructor() {
    this.active = false; this.rows = []; this.captureRow = null; this.pool = [];
    this.pending = new Set(); this.sequence = 0;
    const prototype = globalThis.GPUCommandEncoder?.prototype;
    if (!prototype) return;
    const begin = GPU.beginFrame.bind(GPU), submit = GPU.submit.bind(GPU);
    for (const method of ['beginComputePass', 'beginRenderPass']) {
      const original = prototype[method], self = this;
      prototype[method] = function(description = {}) {
        const row = self.captureRow;
        if (!row) return original.call(this, description);
        const i = row.labels.length;
        if (i >= MAX_PASSES) { row.overflow = true; return original.call(this, description); }
        row.labels.push(description.label ?? method);
        return original.call(this, { ...description, timestampWrites: { querySet: self.querySet, beginningOfPassWriteIndex: 2 * i, endOfPassWriteIndex: 2 * i + 1 } });
      };
    }
    GPU.beginFrame = (...args) => {
      const pendingEncoder = !!GPU.encoder;
      const encoder = begin(...args);
      if (!this.active) return encoder;
      const row = { frame: GPU.frame, status: 'not-sampled', ms: null, pendingEncoderAtStart: pendingEncoder };
      this.rows.push(row);
      if (!GPU.hasTimestamp) { row.status = 'unsupported'; return encoder; }
      if (this.sequence++ % SAMPLE_EVERY !== 0) return encoder;
      const slot = this.pool.find(s => !s.busy);
      if (!slot) { row.status = 'backpressure'; return encoder; }
      slot.busy = true; slot.row = row; row.labels = []; row.status = 'pending'; row.slot = slot;
      this.captureRow = row;
      return encoder;
    };
    GPU.submit = (...args) => {
      const row = this.captureRow;
      this.captureRow = null;
      if (row) {
        const slot = row.slot; delete row.slot;
        const count = row.labels.length;
        if (!count || row.overflow) { row.status = row.overflow ? 'pass-overflow' : 'scope-not-run'; slot.busy = false; }
        else {
          GPU.encoder.resolveQuerySet(this.querySet, 0, count * 2, this.resolve, 0);
          GPU.encoder.copyBufferToBuffer(this.resolve, 0, slot.buffer, 0, count * 16);
          this.pending.add(slot);
          GPU.onSubmit(null, () => this.read(slot, count));
        }
      }
      const start = performance.now();
      const result = submit(...args);
      if (row) row.cpuSubmitMs = performance.now() - start;
      return result;
    };
  }
  allocate() {
    if (this.querySet || !GPU.hasTimestamp) return;
    this.querySet = GPU.device.createQuerySet({ type: 'timestamp', count: MAX_PASSES * 2 });
    this.resolve = GPU.device.createBuffer({ label: 'native review resolve', size: MAX_PASSES * 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    this.pool = Array.from({ length: 3 }, () => ({ busy: false, buffer: GPU.device.createBuffer({ label: 'native review read', size: MAX_PASSES * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }) }));
  }
  async read(slot, count) {
    const row = slot.row;
    const timeout = setTimeout(() => { if (row.status === 'pending') row.status = 'timeout'; }, 5000);
    try {
      await slot.buffer.mapAsync(GPUMapMode.READ);
      const t = new BigUint64Array(slot.buffer.getMappedRange().slice(0, count * 16));
      slot.buffer.unmap();
      row.passes = row.labels.map((label, i) => ({ ordinal: i, label, start: t[2 * i].toString(), end: t[2 * i + 1].toString(), valid: t[2 * i + 1] >= t[2 * i] && t[2 * i + 1] > 0n }));
      if (row.status === 'pending') {
        const valid = row.passes.every(p => p.valid);
        const begins = row.passes.map(p => BigInt(p.start)), ends = row.passes.map(p => BigInt(p.end));
        const first = begins.reduce((a, b) => a < b ? a : b), last = ends.reduce((a, b) => a > b ? a : b);
        row.status = valid && last > first ? 'valid' : 'invalid';
        row.ms = row.status === 'valid' ? Number(last - first) / 1e6 : null;
      }
    } catch (error) { row.status = 'device-or-map-error'; row.reason = String(error); }
    finally { clearTimeout(timeout); slot.busy = false; this.pending.delete(slot); }
  }
  start() {
    if (this.pending.size) throw Error('Previous GPU queries still pending');
    this.allocate(); this.rows = []; this.sequence = 0; this.active = true;
  }
  async stop() {
    this.active = false;
    const limit = performance.now() + 5500;
    while (this.pending.size && performance.now() < limit) await new Promise(r => setTimeout(r, 25));
    return {
      scope: 'First actual compute/render pass begin through last actual pass end in the native submitted encoder. Excludes queue.writeBuffer/writeTexture uploads before command-buffer execution, copies outside this pass interval and browser presentation.',
      supported: GPU.hasTimestamp, sampleEverySubmittedFrames: SAMPLE_EVERY, reusedQuerySets: this.querySet ? 1 : 0, readbackRingSlots: this.pool.length,
      rows: this.rows.map(({ slot, ...row }) => row),
    };
  }
}
