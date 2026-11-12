/** One bounded 2D still, captured before moving the existing camera. No second renderer. */
export class ViewTransition {
  canvas: HTMLCanvasElement | null = null
  private fade: ReturnType<typeof setTimeout> | null = null
  private action: (() => void) | null = null
  constructor(private changed: () => void) {}
  get waiting() { return this.action !== null }
  request(action: () => void, reuse: boolean) {
    if(this.fade){clearTimeout(this.fade);this.fade=null}
    if (reuse) { this.action = null; action(); return }
    this.action = action; this.changed()
  }
  completedFrame(source: HTMLCanvasElement, settled: boolean) {
    if (this.action) {
      const action = this.action; this.action = null
      this.release()
      try {
        const scale = Math.min(1, 1280 / Math.max(source.width, source.height), Math.sqrt(1_500_000 / Math.max(1, source.width * source.height)))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.floor(source.width * scale)); canvas.height = Math.max(1, Math.floor(source.height * scale))
        const context = canvas.getContext('2d')
        if (context) { context.drawImage(source, 0, 0, canvas.width, canvas.height); this.canvas = canvas }
      } catch { /* Navigation remains available if a browser cannot copy the frame. */ }
      action(); this.changed()
    } else if (settled && this.canvas && !this.fade) {
      const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 170 : 320
      this.fade=setTimeout(()=>{this.fade=null;this.release();this.changed()},duration)
    }
  }
  cancelPending() { if (this.action) { this.action = null; this.changed() } }
  private release() { if(this.fade){clearTimeout(this.fade);this.fade=null} if (this.canvas) { this.canvas.width = 0; this.canvas.height = 0; this.canvas = null } }
  dispose() { this.action = null; this.release() }
}
