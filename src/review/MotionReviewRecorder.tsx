import { validateLoopingMotion, validateWalkingJourney, type JourneyFrame } from './motion-review-validation'
import { useRef, useState, useEffect } from 'react'

type ReviewCanvas = HTMLCanvasElement & {
  __museumReviewSetAnimationTime?: (time: number | null) => boolean
}

/** Local, opt-in recording of actual rendered frames, not an animation simulation. */
export default function MotionReviewRecorder() {
  const [status, setStatus] = useState('等待录制')
  const [busy, setBusy] = useState(false)
  const [canSetStill, setCanSetStill] = useState(false)
  const cleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanup.current?.(), [])
  const enabled = new URLSearchParams(window.location.search).has('motion-review')
  const journey = new URLSearchParams(window.location.search).has('journey')
  useEffect(() => {
    if (!enabled) return
    const sync = () => {
      const source = document.querySelector<ReviewCanvas>('canvas.viewer-canvas')
      setCanSetStill(!!source?.__museumReviewSetAnimationTime &&
        source.dataset.firstFrameRendered === 'true' &&
        source.dataset.transitioning !== 'true' && !source.dataset.scaleEncounter)
    }
    sync()
    const timer = window.setInterval(sync, 250)
    return () => window.clearInterval(timer)
  }, [enabled])
  if (!enabled) return null

  function setStill(time: number | null) {
    const source = document.querySelector<ReviewCanvas>('canvas.viewer-canvas')
    if (busy || !canSetStill || !source?.__museumReviewSetAnimationTime?.(time)) {
      setStatus('请在模型就绪的展馆中使用定格工具')
      return
    }
    setStatus(time === null ? '已恢复连续动作' : '已定格第 2 秒；进入比一比时继续播放，返回展馆后恢复定格')
  }

  function record() {
    const source = document.querySelector<ReviewCanvas>('canvas.viewer-canvas')
    if (!source || source.dataset.transitioning === 'true' ||
        source.dataset.firstFrameRendered !== 'true' || !source.dataset.loadedModelSha256 ||
        !source.dataset.animationTime) {
      setStatus('模型或动作未就绪')
      return
    }
    const id = source.dataset.activeAnimalId!
    const hash = source.dataset.loadedModelSha256
    const clip = source.dataset.animationClip
    const duration = Number(source.dataset.animationDuration)
    if (!Number.isFinite(duration) || duration <= 0 || duration > 60) { setStatus('动作循环时长无效'); return }
    const captureMs = journey ? 40_000 : Math.max(20_000, Math.ceil(duration * 2 + 2) * 1000)
    const mode = source.dataset.scaleEncounter ? 'comparison' : 'gallery'
    if (journey && (mode !== 'comparison' || clip !== 'Walk' || Number(source.dataset.locomotionElapsedSeconds) > 4)) { setStatus('请重新进入行走比一比，并在前4秒内开始完整录制'); return }
    const startedAt = new Date().toISOString()
    const output = document.createElement('canvas')
    const scale = Math.min(1, 1280 / source.width)
    output.width = Math.round(source.width * scale)
    output.height = Math.round(source.height * scale)
    const context = output.getContext('2d')!
    const stream = output.captureStream(30)
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      .find(type => MediaRecorder.isTypeSupported(type))
    if (!mimeType) { stream.getTracks().forEach(track => track.stop()); setStatus('录制编码不可用'); return }
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 })
    const chunks: Blob[] = []
    const frames: JourneyFrame[] = []
    let failure = ''
    let stopTimer = 0
    const begin = performance.now()
    const initialState = { ...source.dataset }
    const background = document.querySelector<HTMLImageElement>('.scene-background:not(.scene-background--outgoing) img')
    const renderFrame = () => {
      if (source.dataset.activeAnimalId !== id || source.dataset.loadedModelSha256 !== hash || (!journey && source.dataset.animationClip !== clip) ||
          (source.dataset.scaleEncounter ? 'comparison' : 'gallery') !== mode ||
          source.dataset.transitioning === 'true') {
        failure = '录制中模型或场景发生变化'
        recorder.stop()
        return
      }
      context.fillStyle = '#dce8e6'
      context.fillRect(0, 0, output.width, output.height)
      if (mode === 'gallery' && background?.complete && background.naturalWidth > 0) {
        const cover = Math.max(output.width / background.naturalWidth, output.height / background.naturalHeight)
        const width = background.naturalWidth * cover, height = background.naturalHeight * cover
        context.drawImage(background, (output.width - width) / 2, (output.height - height) / 2, width, height)
      }
      context.drawImage(source, 0, 0, output.width, output.height)
      frames.push({
        wallMs: performance.now() - begin,
        animationTime: Number(source.dataset.animationTime),
        paused: source.dataset.animationPaused ?? '',
        timeScale: source.dataset.animationTimeScale ?? '',
        clip: source.dataset.animationClip ?? '', phase: source.dataset.locomotionPhase ?? '',
        distance: Number(source.dataset.locomotionDistanceMeters ?? 0), speed: Number(source.dataset.locomotionSpeedMetersPerSecond ?? 0),
        elapsed: Number(source.dataset.locomotionElapsedSeconds ?? 0), duration: Number(source.dataset.locomotionDurationSeconds ?? 0),
        terrainError: Number(source.dataset.locomotionTerrainMaxErrorMeters ?? 0),
      })
    }
    const dispose = () => {
      window.clearTimeout(stopTimer)
      delete source.dataset.motionRecording
      source.removeEventListener('museum-review-frame', renderFrame)
      stream.getTracks().forEach(track => track.stop())
      cleanup.current = null
    }
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
    recorder.onerror = () => { failure = '浏览器录制失败' }
    recorder.onstop = async () => {
      dispose()
      try {
        if (failure) throw new Error(failure)
        if (frames.length < 100) throw new Error('完整帧记录不足')
        if (journey) validateWalkingJourney(frames)
        else validateLoopingMotion(frames, duration, clip ?? '')
        const video = new Blob(chunks, { type: mimeType })
        const form = new FormData()
        form.append('video', video)
        form.append('metadata', JSON.stringify({
          id, hash, clip, duration, mode, journey, startedAt, endedAt: new Date().toISOString(),
          width: output.width, height: output.height, viewport: [innerWidth, innerHeight],
          initialState, finalState: { ...source.dataset }, frames,
          background: background?.currentSrc ?? null,
          origin: 'Headed local App MediaRecorder; gallery composites actual canvas over current background; UI excluded; collector-attested, unsigned',
        }))
        // Same-origin local Vite-only endpoint; never uploads to an external service.
        const response = await fetch('/__museum-motion-capture', { method: 'POST', body: form })
        if (!response.ok) throw new Error(await response.text())
        const result = await response.json() as { saved: string }
        setStatus(`已保存 ${result.saved}`)
      } catch (error) { setStatus(`失败：${String(error)}`) }
      finally { setBusy(false) }
    }
    source.dataset.motionRecording = 'true'
    source.addEventListener('museum-review-frame', renderFrame)
    recorder.start(1000)
    setBusy(true)
    setStatus(journey ? '正在连续录制40秒 · 行走、减速和停稳' : `正在连续录制${captureMs / 1000}秒 · 请保持当前模型`)
    stopTimer = window.setTimeout(() => recorder.stop(), captureMs)
    cleanup.current = () => { failure = '页面离开，录制未完成'; if (recorder.state !== 'inactive') recorder.stop(); dispose() }
  }
  return <aside data-testid="motion-review-recorder" data-busy={busy}
    style={{ position: 'fixed', bottom: 100, left: 8, zIndex: 10000, background: '#fff', color: '#183a2d', padding: '8px 12px', borderRadius: 10, maxWidth: 420, fontSize: 12 }}>
    <button disabled={busy} onClick={() => void record()}>{journey ? '录制行走到停稳40秒' : '录制两个完整循环'}</button>
    <button disabled={busy || !canSetStill} onClick={() => setStill(2)}>定格第 2 秒</button>
    <button disabled={busy || !canSetStill} onClick={() => setStill(null)}>恢复连续动作</button>
    <output aria-live="polite">{status}</output>
  </aside>
}
