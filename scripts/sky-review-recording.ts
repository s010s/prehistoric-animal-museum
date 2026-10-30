import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import type { ExpansionReviewManifest } from '../src/review/expansion-manifest'
import { SKY_EXPANSION_REVIEW_ID_SET } from '../src/review/sky-expansion-config'
import { animalDefinition as pteranodonDefinition } from '../src/content/animals/pteranodon/package'

const MAX_BODY_BYTES = 32 * 1024 * 1024
const RECORDING_ROOT = '.handoff/sky-expansion-12/feedback-repairs-20261029/browser-review/recordings'
const REFERENCE_RECORDING_ROOT = '.handoff/sky-expansion-12/refinements-20261030/browser-review/recordings'
const PTERANODON_REFERENCE = {
  id: 'pteranodon',
  sourcePath: 'src/content/animals/pteranodon/model/model.glb',
  sha256: 'abcde65b2ea29c6ae86d8232a5e1a604b05099deb34cebfb30495aff53f61af1',
  packagePath: 'src/content/animals/pteranodon/package.ts',
  clip: 'Idle', duration: 10.666666984558105, playbackRate: .7, recordingMs: 18000,
} as const
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid recording object.')
  return value as Record<string, unknown>
}
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex')

/** Checks recorded render-clock coverage, not visual quality or signed origin. */
export function validateSkyMotionRecordingInput(value: unknown, manifest: ExpansionReviewManifest) {
  const input = object(value)
  const id = input.animalId
  const reference = id === PTERANODON_REFERENCE.id
  const duration = reference ? PTERANODON_REFERENCE.duration : 8
  const playbackRate = reference ? PTERANODON_REFERENCE.playbackRate : 1
  const recordingMs = reference ? PTERANODON_REFERENCE.recordingMs : 10000
  if (reference && (pteranodonDefinition.id !== PTERANODON_REFERENCE.id ||
      pteranodonDefinition.animation?.clip !== PTERANODON_REFERENCE.clip ||
      pteranodonDefinition.animation.speed !== PTERANODON_REFERENCE.playbackRate)) {
    throw new Error('Pinned Pteranodon authored playback definition changed.')
  }
  if (typeof id !== 'string' || (!reference && (!SKY_EXPANSION_REVIEW_ID_SET.has(id) || !manifest.animals.some(animal => animal.id === id))) ||
      input.modelSha256 !== (reference ? PTERANODON_REFERENCE.sha256 : manifest.modelHashes[id]) || !/^[a-f0-9]{64}$/.test(String(input.modelSha256)) ||
      !['gallery', 'comparison'].includes(String(input.mode)) || !['zh-CN', 'en'].includes(String(input.locale)) ||
      typeof input.label !== 'string' || !new RegExp(`^feedback-${id}-${String(input.mode)}-(portrait|landscape)-[a-z0-9-]{1,60}$`).test(input.label) ||
      input.requestedDurationMs !== recordingMs || typeof input.elapsedMs !== 'number' || input.elapsedMs < recordingMs - 500 || input.elapsedMs > recordingMs + 1500 ||
      input.duration !== duration || !/^video\/webm(?:;codecs=vp[89])?$/.test(String(input.mimeType))) {
    throw new Error('Recording identity, duration or strict label is stale.')
  }
  const initial = object(input.initialState), final = object(input.finalState)
  for (const state of [initial, final]) {
    if (state.activeAnimalId !== id || state.loadedModelSha256 !== input.modelSha256 || state.animationClip !== 'Idle' ||
        state.animationPaused !== 'false' || Number(state.animationTimeScale) !== playbackRate || !Number.isFinite(Number(state.animationDuration)) ||
        (reference ? Math.abs(Number(state.animationDuration) - duration) > .00005 : Number(state.animationDuration) !== 8) ||
        (state.scaleEncounter === 'true' ? 'comparison' : 'gallery') !== input.mode ||
        !Number.isFinite(Number(state.animationTime))) throw new Error('Recording start/end model or running state changed.')
  }
  const viewport = object(input.viewport), canvas = object(input.canvas)
  for (const dimension of [viewport.width, viewport.height, canvas.width, canvas.height]) {
    if (typeof dimension !== 'number' || !Number.isFinite(dimension) || dimension < 1 || dimension > 16384) throw new Error('Invalid recording viewport.')
  }
  if (!Array.isArray(input.frames) || input.frames.length < 100 || input.frames.length > 3000) throw new Error('Insufficient render-clock coverage.')
  let progress = 0, wraps = 0, maxGapMs = 0
  let previous: { wallMs: number; animationTime: number } | null = null
  for (const value of input.frames) {
    const frame = object(value)
    if (typeof frame.wallMs !== 'number' || !Number.isFinite(frame.wallMs) || frame.wallMs < 0 || frame.wallMs > recordingMs + 2000 ||
        typeof frame.animationTime !== 'number' || !Number.isFinite(frame.animationTime) || frame.animationTime < 0 || frame.animationTime > duration + .001 ||
        frame.clip !== 'Idle' || frame.paused !== 'false' || Number(frame.timeScale) !== playbackRate) throw new Error('Invalid running frame state.')
    if (previous) {
      const gap = frame.wallMs - previous.wallMs
      let step = frame.animationTime - previous.animationTime
      if (step < -duration / 2) { step += duration; wraps++ }
      if (gap <= 0 || step < -.001 || step > gap / 1000 * playbackRate + .1) throw new Error('Recording clock jumped or reversed.')
      progress += Math.max(0, step)
      maxGapMs = Math.max(maxGapMs, gap)
    }
    previous = { wallMs: frame.wallMs, animationTime: frame.animationTime }
  }
  const first = object(input.frames[0]), last = object(input.frames.at(-1))
  const wallSeconds = (Number(last.wallMs) - Number(first.wallMs)) / 1000
  if (wallSeconds < recordingMs / 1000 - 1 || progress < duration || wraps < 1 || maxGapMs > 250 || Math.abs(progress - wallSeconds * playbackRate) > .35) {
    throw new Error('Actual recording did not cover a real-time complete loop without a frame gap.')
  }
  if (!Array.isArray(input.chunks) || !input.chunks.length || input.chunks.length > 100) throw new Error('Missing native recorder chunk evidence.')
  if (typeof input.videoBase64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.videoBase64)) throw new Error('Invalid WebM encoding.')
  const video = Buffer.from(input.videoBase64, 'base64')
  if (video.length < 10000 || video.length > 24 * 1024 * 1024 || video.readUInt32BE(0) !== 0x1a45dfa3 || video.toString('base64') !== input.videoBase64) throw new Error('Missing bounded native WebM bytes.')
  const { videoBase64: _, ...metadata } = input
  void _
  return { metadata, video, timeline: { progressSeconds: progress, wallSeconds, playbackRate, wraps, maxGapMs, frameCount: input.frames.length } }
}

/** Review-only, bounded loopback ingestion. Never serves files or directories. */
export async function saveSkyMotionRecording(request: IncomingMessage, response: ServerResponse, manifest: ExpansionReviewManifest): Promise<void> {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  if (request.method !== 'POST') { response.statusCode = 405; response.end(JSON.stringify({ error: 'POST required.' })); return }
  const host = request.headers.host ?? ''
  if (!/^(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host) || request.headers.origin !== `http://${host}` ||
      request.headers['content-type'] !== 'application/json') {
    response.statusCode = 403; response.end(JSON.stringify({ error: 'Loopback same-origin JSON capture only.' })); return
  }
  try {
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const raw of request) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array)
      bytes += chunk.length
      if (bytes > MAX_BODY_BYTES) { response.statusCode = 413; response.end(JSON.stringify({ error: 'Recording exceeds 32 MiB.' })); return }
      chunks.push(chunk)
    }
    const result = validateSkyMotionRecordingInput(JSON.parse(Buffer.concat(chunks).toString()), manifest)
    const id = String(result.metadata.animalId)
    const reference = id === PTERANODON_REFERENCE.id
    const sourcePath = reference ? PTERANODON_REFERENCE.sourcePath : manifest.files[`/__museum-review-assets/${id}/model.glb`]
    if (!sourcePath) throw new Error('Current model path is missing.')
    const source = readFileSync(sourcePath)
    if (sha(source) !== result.metadata.modelSha256) throw new Error('Current model bytes changed; restart the review server.')
    if (reference) {
      const document = JSON.parse(source.subarray(20, 20 + source.readUInt32LE(12)).toString()) as {
        animations: { name: string; samplers: { input: number }[] }[]
        accessors: { max?: number[] }[]
      }
      const clip = document.animations.find(animation => animation.name === PTERANODON_REFERENCE.clip)
      const duration = clip && Math.max(...clip.samplers.map(sampler => document.accessors[sampler.input]?.max?.[0] ?? NaN))
      if (duration !== PTERANODON_REFERENCE.duration) throw new Error('Pinned Pteranodon reference clip duration changed.')
    }
    const recordingRoot = reference ? REFERENCE_RECORDING_ROOT : RECORDING_ROOT
    mkdirSync(recordingRoot, { recursive: true })
    const directory = resolve(recordingRoot, String(result.metadata.label))
    mkdirSync(directory)
    const videoPath = resolve(directory, 'capture.webm')
    const metadataPath = resolve(directory, 'capture.json')
    writeFileSync(videoPath, result.video, { flag: 'wx' })
    writeFileSync(metadataPath, JSON.stringify({
      ...result.metadata, savedAt: new Date().toISOString(), timelineCheck: result.timeline,
      recordingProtocol: reference ? 'pinned-public-pteranodon-reference-v1' : 'private-sky-eight-second-v1',
      ...(reference ? { pinnedReference: PTERANODON_REFERENCE } : {}),
      videoBytes: result.video.length, videoSha256: sha(result.video),
      captureSurface: 'Native live WebGL canvas MediaRecorder; DOM UI/background and audio excluded.',
      captureProvenance: 'Collector-attested headed local App; unsigned; technical timeline checks do not prove visual or listening approval.',
    }, null, 2) + '\n', { flag: 'wx' })
    response.end(JSON.stringify({ saved: true, label: result.metadata.label, videoPath, metadataPath, sha256: sha(result.video), timeline: result.timeline }))
  } catch (error) {
    response.statusCode = error instanceof Error && 'code' in error && error.code === 'EEXIST' ? 409 : 400
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  }
}
