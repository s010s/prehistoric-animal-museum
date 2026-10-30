import { useEffect, useRef, useState } from 'react'
import { SKY_EXPANSION_REVIEW_ID_SET } from './sky-expansion-config'

// This is one fixed source reference, not a general public-animal permission.
const PTERANODON_REFERENCE = {
  id: 'pteranodon',
  sha256: 'abcde65b2ea29c6ae86d8232a5e1a604b05099deb34cebfb30495aff53f61af1',
  duration: 10.666666984558105, playbackRate: .7, recordingMs: 18000,
} as const
function recordingProtocol(source: HTMLCanvasElement | null) {
  if (!source) return null
  const id = source.dataset.activeAnimalId ?? ''
  if (id === PTERANODON_REFERENCE.id) {
    return source.dataset.loadedModelSha256 === PTERANODON_REFERENCE.sha256 &&
      Number(source.dataset.animationTimeScale) === PTERANODON_REFERENCE.playbackRate &&
      Math.abs(Number(source.dataset.animationDuration) - PTERANODON_REFERENCE.duration) <= .00005
      ? PTERANODON_REFERENCE : null
  }
  return SKY_EXPANSION_REVIEW_ID_SET.has(id) && Number(source.dataset.animationDuration) === 8
    ? { duration: 8, playbackRate: 1, recordingMs: 10000 } : null
}

const snapshot = (canvas: HTMLCanvasElement) => Object.fromEntries(
  Object.entries(canvas.dataset).filter(([key]) => key !== 'reviewCapturePng' && key !== 'performanceSummary'),
)
const base64 = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(new Error('无法读取录制字节'))
  reader.onload = () => typeof reader.result === 'string'
    ? resolve(reader.result.split(',')[1] ?? '')
    : reject(new Error('录制字节格式无效'))
  reader.readAsDataURL(blob)
})

/** Explicit local review tool. Records live canvas frames, with no audio. */
export default function SkyMotionRecorder() {
  const [status, setStatus] = useState('等待录制 · 无音轨')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [recordingMs, setRecordingMs] = useState(10000)
  const busyRef = useRef(false)
  const cleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanup.current?.(), [])
  const enabled = new URLSearchParams(window.location.search).get('skyMotionRecord') === '1'
  useEffect(() => {
    if (!enabled) return
    const syncDuration = () => setRecordingMs(recordingProtocol(document.querySelector('canvas.viewer-canvas'))?.recordingMs ?? 10000)
    syncDuration()
    const timer = window.setInterval(syncDuration, 250)
    return () => window.clearInterval(timer)
  }, [enabled])
  if (!enabled) return null

  function record() {
    if (busyRef.current) return
    const source = document.querySelector<HTMLCanvasElement>('canvas.viewer-canvas')
    const id = source?.dataset.activeAnimalId ?? ''
    const protocol = recordingProtocol(source)
    if (!source || !protocol || source.dataset.firstFrameRendered !== 'true' ||
        source.dataset.transitioning === 'true' || source.dataset.animationPaused !== 'false' ||
        source.dataset.animationClip !== 'Idle' ||
        !source.dataset.loadedModelSha256 || source.dataset.motionRecording === 'true') {
      setStatus('失败：请等待当前模型就绪并恢复连续Idle动作')
      return
    }
    if (!source.captureStream || typeof MediaRecorder === 'undefined') { setStatus('失败：浏览器不支持原生录制'); return }
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type))
    if (!mimeType) { setStatus('失败：WebM编码不可用'); return }
    const hash = source.dataset.loadedModelSha256
    const captureMs = protocol.recordingMs
    const captureSeconds = captureMs / 1000
    const mode = source.dataset.scaleEncounter === 'true' ? 'comparison' : 'gallery'
    const orientation = innerHeight > innerWidth ? 'portrait' : 'landscape'
    const label = `feedback-${id}-${mode}-${orientation}-${Date.now()}`
    const initialState = snapshot(source)
    const previousRecordingFlag = source.dataset.motionRecording
    const viewport = { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio }
    const canvasSize = { width: source.width, height: source.height }
    const locale = document.documentElement.lang
    const startedAt = new Date().toISOString()
    const begin = performance.now()
    const visibility = [{ atMs: 0, state: document.visibilityState }]
    const stream = source.captureStream(24)
    let recorder: MediaRecorder
    try { recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_400_000 }) }
    catch (error) { stream.getTracks().forEach(track => track.stop()); setStatus(`失败：${String(error)}`); return }
    const chunks: Blob[] = []
    const chunkEvents: { elapsedMs: number; bytes: number }[] = []
    const frames: Record<string, string | number>[] = []
    let failure = ''
    let timer = 0
    const onVisibility = () => visibility.push({ atMs: performance.now() - begin, state: document.visibilityState })
    const onFrame = () => {
      if (source.dataset.activeAnimalId !== id || source.dataset.loadedModelSha256 !== hash ||
          (source.dataset.scaleEncounter === 'true' ? 'comparison' : 'gallery') !== mode || source.dataset.transitioning === 'true' ||
          source.dataset.animationPaused !== 'false' || source.dataset.animationClip !== 'Idle' ||
          Number(source.dataset.animationTimeScale) !== protocol.playbackRate ||
          document.documentElement.lang !== locale || innerWidth !== viewport.width || innerHeight !== viewport.height ||
          source.width !== canvasSize.width || source.height !== canvasSize.height) {
        failure = '录制中模型、模式或运行状态发生变化'
        if (recorder.state !== 'inactive') recorder.stop()
        return
      }
      frames.push({ wallMs: performance.now() - begin, animationTime: Number(source.dataset.animationTime),
        paused: source.dataset.animationPaused ?? '', timeScale: source.dataset.animationTimeScale ?? '', clip: source.dataset.animationClip ?? '',
        distance: source.dataset.scaleEncounterDistanceMeters ?? '', orbitAngle: source.dataset.scaleEncounterOrbitAngleDegrees ?? '',
        avatarAnimationTimeSeconds: source.dataset.scaleEncounterAvatarAnimationTimeSeconds ?? '',
        avatarAnimationRate: source.dataset.scaleEncounterAvatarAnimationRate ?? '',
      })
    }
    const dispose = () => {
      clearTimeout(timer)
      source.removeEventListener('museum-review-frame', onFrame)
      document.removeEventListener('visibilitychange', onVisibility)
      if (previousRecordingFlag === undefined) delete source.dataset.motionRecording
      else source.dataset.motionRecording = previousRecordingFlag
      stream.getTracks().forEach(track => track.stop())
      cleanup.current = null
    }
    recorder.ondataavailable = event => {
      if (event.data.size) { chunks.push(event.data); chunkEvents.push({ elapsedMs: performance.now() - begin, bytes: event.data.size }) }
    }
    recorder.onerror = () => { failure = '浏览器录制出错'; if (recorder.state !== 'inactive') recorder.stop() }
    recorder.onstop = async () => {
      const elapsedMs = performance.now() - begin
      const finalState = snapshot(source)
      const trackSettings = stream.getVideoTracks()[0]?.getSettings() ?? {}
      dispose()
      try {
        if (failure) throw new Error(failure)
        const video = new Blob(chunks, { type: mimeType })
        setStatus('正在保存实际WebM与状态…')
        const response = await fetch('/__museum-sky-motion-recording', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label, animalId: id, modelSha256: hash, mode, locale,
            requestedDurationMs: captureMs, elapsedMs, duration: protocol.duration, mimeType, startedAt, endedAt: new Date().toISOString(),
            viewport, canvas: canvasSize, initialState, finalState,
            frames, chunks: chunkEvents, visibility, trackSettings,
            videoBase64: await base64(video),
          }),
        })
        const saved = await response.json() as { error?: string; saved?: boolean; videoPath?: string; metadataPath?: string }
        if (!response.ok || !saved.saved) throw new Error(saved.error ?? '本机保存失败')
        setResult(JSON.stringify(saved))
        setStatus(`已保存${captureSeconds}秒实际动作 · 无音轨`)
      } catch (error) { setStatus(`失败：${error instanceof Error ? error.message : String(error)}`) }
      finally { busyRef.current = false; setBusy(false) }
    }
    source.dataset.motionRecording = 'true'
    source.addEventListener('museum-review-frame', onFrame)
    document.addEventListener('visibilitychange', onVisibility)
    busyRef.current = true
    setBusy(true)
    setResult('')
    setStatus(`正在录制${captureSeconds}秒实际动作 · 请保持当前模型`)
    try {
      recorder.start(250)
      timer = window.setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop() }, captureMs)
      cleanup.current = () => { failure = '页面离开，录制未完成'; if (recorder.state !== 'inactive') recorder.stop(); dispose() }
    } catch (error) {
      dispose(); busyRef.current = false; setBusy(false); setStatus(`失败：${String(error)}`)
    }
  }

  return <aside data-testid="sky-motion-recorder" data-busy={busy} data-result={result} data-recording-duration-ms={recordingMs}
    style={{ position: 'fixed', left: 8, bottom: 100, zIndex: 10001, background: '#fff', color: '#183a2d', borderRadius: 8, padding: 8, maxWidth: 340, fontSize: 12 }}>
    <button disabled={busy} onClick={record}>录制{recordingMs / 1000}秒动作</button>
    <output aria-live="polite" data-testid="sky-motion-recording-status">{status}</output>
  </aside>
}
