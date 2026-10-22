export interface JourneyFrame {
  readonly wallMs: number
  readonly animationTime: number
  readonly paused: string
  readonly timeScale: string
  readonly clip: string
  readonly phase: string
  readonly distance: number
  readonly speed: number
  readonly elapsed: number
  readonly duration: number
  readonly terrainError: number
}

/** The duration comes from the loaded action on the client and the hash-locked
 * GLB on the collector. Retain both checks; metadata cannot choose its clock. */
export function validateLoopingMotion(frames: readonly Pick<JourneyFrame, 'wallMs' | 'animationTime' | 'paused' | 'timeScale' | 'clip'>[], duration: number, clip: string) {
  if (!clip || !Number.isFinite(duration) || duration <= 0 || duration > 60 || frames.length < 100) throw new Error('完整动作时长或帧数无效')
  let progress = 0, wraps = 0, maxGapMs = 0
  for (let i = 0; i < frames.length; i++) {
    const current = frames[i]!
    if (!Number.isFinite(current.animationTime) || current.animationTime < 0 || current.animationTime > duration + .001 ||
        !Number.isFinite(current.wallMs) || current.clip !== clip || current.paused !== 'false' || current.timeScale !== '1.0000') throw new Error('动作暂停或时间序列无效')
    if (i === 0) continue
    const previous = frames[i - 1]!, gap = current.wallMs - previous.wallMs
    let step = current.animationTime - previous.animationTime
    if (step < -duration / 2) { step += duration; wraps++ }
    if (step < -.0002 || gap <= 0 || step > gap / 1000 + .1) throw new Error('动作时钟跳跃或倒退')
    progress += Math.max(0, step)
    maxGapMs = Math.max(maxGapMs, gap)
  }
  const wallSeconds = (frames[frames.length - 1]!.wallMs - frames[0]!.wallMs) / 1000
  if (progress < duration * 2 || wallSeconds < duration * 2 || Math.abs(progress - wallSeconds) > Math.max(.25, wallSeconds * .02) ||
      wraps < 2 || maxGapMs > 250) throw new Error('未取得按真实时间播放的两个完整动作循环')
  return { duration, progress, wallSeconds, wraps, maxGapMs }
}

/** Validates one complete local walking journey. It is distinct from the
 * constant-speed loop validator and never substitutes for visual review. */
export function validateWalkingJourney(frames: readonly JourneyFrame[]) {
  if (frames.length < 300) throw new Error('完整行走记录不足')
  const first = frames[0]!, last = frames[frames.length - 1]!
  if (first.phase !== 'walking' || first.clip !== 'Walk' || first.elapsed > 4 || first.elapsed < 0 ||
      last.phase !== 'idle' || last.clip !== 'Idle' || last.wallMs - first.wallMs < 34_000) throw new Error('未覆盖开始行走到停稳的完整过程')
  let maxGapMs = 0, transitions = 0, decelerationFrames = 0, idleStart = -1, idleDistance = 0, maxStoppedDrift = 0
  let phaseOrder = 0, progress = 0, wraps = 0
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!
    if ([frame.wallMs, frame.animationTime, frame.distance, frame.speed, frame.elapsed, frame.duration, frame.terrainError].some(v => !Number.isFinite(v)) ||
        frame.paused !== 'false' || !Number.isFinite(Number(frame.timeScale)) || Number(frame.timeScale) < 0 || Number(frame.timeScale) > 1.001 ||
        frame.speed < 0 || frame.speed > .6 || Math.abs(frame.terrainError) > .003 || frame.duration < 24 || frame.duration > 32) throw new Error('行走过程状态无效')
    const phase = ['walking', 'decelerating', 'idle'].indexOf(frame.phase)
    if (phase < phaseOrder || phase < 0) throw new Error('行走阶段逆转')
    phaseOrder = phase
    if (phase === 1) decelerationFrames++
    if (phase === 2) {
      if (idleStart < 0) { idleStart = frame.wallMs; idleDistance = frame.distance }
      maxStoppedDrift = Math.max(maxStoppedDrift, Math.abs(frame.distance - idleDistance))
      if (frame.speed > .001) throw new Error('停稳后仍在移动')
    }
    if (i === 0) continue
    const previous = frames[i - 1]!, gap = frame.wallMs - previous.wallMs
    if (gap <= 0 || frame.elapsed < previous.elapsed || frame.distance < previous.distance - .001 || frame.distance - previous.distance > gap / 1000 * .6 + .003) throw new Error('世界位移跳跃或时钟逆转')
    maxGapMs = Math.max(maxGapMs, gap)
    if (frame.clip !== previous.clip) {
      if (previous.clip !== 'Walk' || frame.clip !== 'Idle') throw new Error('意外动作切换')
      transitions++
    } else {
      let step = frame.animationTime - previous.animationTime
      if (step < -4) { step += 8; wraps++ }
      if (step < -.001) throw new Error('动作时钟倒退')
      progress += Math.max(0, step)
    }
  }
  if (transitions !== 1 || decelerationFrames < 40 || idleStart < 0 || last.wallMs - idleStart < 3000 || maxStoppedDrift > .002 || maxGapMs > 250 || progress < 24 || wraps < 2 || last.distance <= first.distance + 1) throw new Error('完整行走／减速／停稳证据未通过')
  return { progress, wraps, maxGapMs, transitions, decelerationFrames, stoppedSeconds: (last.wallMs - idleStart) / 1000, maxStoppedDrift, distanceTravelled: last.distance - first.distance }
}
