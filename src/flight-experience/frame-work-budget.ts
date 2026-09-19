/** One cooperative preparation budget shared by terrain, props and bathymetry.
 * A running JS operation cannot be preempted: overruns remain visible evidence.
 * Rendering and safety queries must never be skipped to satisfy this budget.
 */
export class FrameWorkBudget {
  frameId = 0
  private started = 0
  private limit = 2
  private bytes = 0
  private objects = 0
  private spent = 0
  private activeStarted: number | null = null
  readonly metrics: Record<string, number> = {}
  constructor(private readonly now: () => number = () => performance.now(), readonly byteLimit = 512 * 1024, readonly objectLimit = 64) {}
  begin(frameId: number, limitMs = 2) {
    this.frameId = frameId; this.started = this.now(); this.limit = limitMs
    this.spent = 0; this.bytes = 0; this.objects = 0
    for (const key of Object.keys(this.metrics)) delete this.metrics[key]
  }
  remainingMs() { return Math.max(0, this.limit - this.spent - (this.activeStarted===null?0:this.now()-this.activeStarted)) }
  canStart(estimatedMs = 0, bytes = 0, objects = 0) {
    return this.remainingMs() > estimatedMs && this.bytes + bytes <= this.byteLimit && this.objects + objects <= this.objectLimit
  }
  measure<T>(label: string, fn: () => T, bytes = 0, objects = 0): T {
    const start = this.now(), outer=this.activeStarted===null
    if(outer)this.activeStarted=start
    try { return fn() } finally {
      const ms = Math.max(0, this.now() - start)
      if(outer){this.spent += ms;this.activeStarted=null}
      this.bytes += bytes; this.objects += objects
      this.metrics[label] = (this.metrics[label] ?? 0) + ms
      this.metrics.totalMs = this.spent; this.metrics.bytes = this.bytes; this.metrics.objects = this.objects
      this.metrics.overrunMs = Math.max(0, this.spent - this.limit)
      this.metrics.frameElapsedMs = this.now() - this.started
    }
  }
}

export interface FrameWorkTask {
  id: string; epoch: number; priority: number
  /** A bounded resumable step, true when complete. */
  step: (budget: FrameWorkBudget) => boolean
  cancel?: () => void
}
/** Bounded queue with aging; callers submit small resumable steps, not whole worlds. */
export class FrameWorkQueue {
  private tasks = new Map<string, FrameWorkTask & { enqueued: number }>()
  constructor(readonly capacity = 128) {}
  enqueue(task: FrameWorkTask, frameId: number) {
    const previous = this.tasks.get(task.id)
    if (previous?.epoch === task.epoch) return true
    if (!previous && this.tasks.size >= this.capacity) return false
    previous?.cancel?.(); this.tasks.set(task.id, { ...task, enqueued: frameId }); return true
  }
  run(budget: FrameWorkBudget) {
    const ordered = [...this.tasks.values()].sort((a,b) =>
      (b.priority + (budget.frameId-b.enqueued)*.1) - (a.priority + (budget.frameId-a.enqueued)*.1))
    for (const task of ordered) {
      if (!budget.canStart()) break
      if (task.step(budget)) this.tasks.delete(task.id)
    }
  }
  cancel(id: string) { const task = this.tasks.get(id); task?.cancel?.(); this.tasks.delete(id) }
  dispose() { for (const task of this.tasks.values()) task.cancel?.(); this.tasks.clear() }
  get size() { return this.tasks.size }
}
