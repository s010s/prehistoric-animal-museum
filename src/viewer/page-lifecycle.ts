interface VisibilitySource {
  readonly hidden: boolean
  addEventListener(type: 'visibilitychange', listener: () => void): void
  removeEventListener(type: 'visibilitychange', listener: () => void): void
}

/** Pauses the viewer's presentation clock without resetting its scene state. */
export class ViewerPageLifecycle {
  private hiddenAt: number | null
  private hiddenDuration = 0
  private disposed = false

  constructor(
    private readonly source: VisibilitySource,
    private readonly actions: { pause(): void; resume(): void },
    private readonly readTime: () => number = () => performance.now(),
  ) {
    this.hiddenAt = source.hidden ? readTime() : null
    source.addEventListener('visibilitychange', this.handleVisibilityChange)
  }

  get paused(): boolean {
    return this.disposed || this.source.hidden
  }

  // RAF timestamps and UI-created transition deadlines share this clock. Using
  // only a fresh delta on return would still jump absolute-time wave shaders,
  // avatar idle and camera/model transitions across the hidden interval.
  now(frameTime = this.readTime()): number {
    return (this.hiddenAt ?? frameTime) - this.hiddenDuration
  }

  private readonly handleVisibilityChange = () => {
    if (this.disposed) return
    if (this.source.hidden) {
      if (this.hiddenAt !== null) return
      this.hiddenAt = this.readTime()
      this.actions.pause()
    } else {
      if (this.hiddenAt === null) return
      this.hiddenDuration += this.readTime() - this.hiddenAt
      this.hiddenAt = null
      this.actions.resume()
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.source.removeEventListener('visibilitychange', this.handleVisibilityChange)
  }
}
