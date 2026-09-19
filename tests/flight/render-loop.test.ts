import { expect, it, vi } from 'vitest'
import { stopAfterAnimationFrame } from '../../src/viewer/deferred-loop-stop'
it('cancels the next frame scheduled by Three after the callback returns', async () => {
  const scheduled = new Set<number>()
  let current = 1
  const stop = () => { scheduled.delete(current) }
  for (let cycle = 0; cycle < 20; cycle++) {
    const callback = () => {
      stopAfterAnimationFrame(() => true, stop)
      // This is the scheduling order in WebGLAnimation.onAnimationFrame.
      current++; scheduled.add(current)
    }
    callback()
    await Promise.resolve()
    expect(scheduled.size).toBe(0)
  }
})
it('does not stop a session resumed or replaced before the microtask runs', async () => {
  let paused = true
  const stop = vi.fn()
  stopAfterAnimationFrame(() => paused, stop)
  paused = false
  await Promise.resolve()
  expect(stop).not.toHaveBeenCalled()
})
