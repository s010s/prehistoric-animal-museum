// @vitest-environment node
import { validateSkyMotionRecordingInput } from '../scripts/sky-review-recording'
import type { ExpansionReviewManifest } from '../src/review/expansion-manifest'

const hash = 'a'.repeat(64)
const manifest = {
  animals: [{ id: 'sordes' }], modelHashes: { sordes: hash },
} as unknown as ExpansionReviewManifest
const state = { activeAnimalId: 'sordes', loadedModelSha256: hash, animationClip: 'Idle', animationDuration: '8.0000', animationTime: '0.0000', animationPaused: 'false', animationTimeScale: '1.0000' }
const input = () => ({
  label: 'feedback-sordes-gallery-landscape-test',
  animalId: 'sordes', modelSha256: hash, mode: 'gallery', locale: 'zh-CN',
  requestedDurationMs: 10000, elapsedMs: 10000, duration: 8,
  mimeType: 'video/webm;codecs=vp9',
  viewport: { width: 1280, height: 720, pixelRatio: 1 },
  canvas: { width: 1280, height: 720 },
  initialState: state, finalState: { ...state, animationTime: '2.0000' },
  frames: Array.from({ length: 301 }, (_, index) => ({ wallMs: index * 1000 / 30, animationTime: (index / 30) % 8, paused: 'false', timeScale: '1.0000', clip: 'Idle' })),
  chunks: [{ elapsedMs: 10000, bytes: 12000 }],
  videoBase64: Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(12000)]).toString('base64'),
})

const referenceHash = 'abcde65b2ea29c6ae86d8232a5e1a604b05099deb34cebfb30495aff53f61af1'
const referenceDuration = 10.666666984558105
const referenceInput = () => {
  const referenceState = { ...state, activeAnimalId: 'pteranodon', loadedModelSha256: referenceHash, animationDuration: '10.6667', animationTimeScale: '0.7000' }
  return {
    ...input(), label: 'feedback-pteranodon-gallery-landscape-test', animalId: 'pteranodon',
    modelSha256: referenceHash, requestedDurationMs: 18000, elapsedMs: 18000, duration: referenceDuration,
    initialState: referenceState, finalState: { ...referenceState, animationTime: (18 * .7 % referenceDuration).toFixed(4) },
    frames: Array.from({ length: 541 }, (_, index) => ({ wallMs: index * 1000 / 30, animationTime: (index / 30 * .7) % referenceDuration, paused: 'false', timeScale: '0.7000', clip: 'Idle' })),
    chunks: [{ elapsedMs: 18000, bytes: 12000 }],
  }
}

describe('sky native motion recording boundary', () => {
  it('accepts current live 10-second canvas metadata and an entire eight-second loop', () => {
    const result = validateSkyMotionRecordingInput(input(), manifest)
    expect(result.timeline.progressSeconds).toBeCloseTo(10, 5)
    expect(result.timeline.wraps).toBe(1)
  })

  it.each([
    { label: '../../outside' }, { animalId: 'not-selected' },
    { modelSha256: 'b'.repeat(64) }, { mode: 'other' },
    { finalState: { ...state, loadedModelSha256: 'b'.repeat(64) } },
    { finalState: { ...state, animationPaused: 'true' } },
    { finalState: { ...state, scaleEncounter: 'true' } },
    { requestedDurationMs: 40000 }, { videoBase64: 'not a video' },
  ])('rejects state/path/encoding mutation %j', patch => {
    expect(() => validateSkyMotionRecordingInput({ ...input(), ...patch }, manifest)).toThrow()
  })

  it('rejects missing render coverage, stalls and altered clocks', () => {
    expect(() => validateSkyMotionRecordingInput({ ...input(), frames: input().frames.slice(0, 40) }, manifest)).toThrow()
    const frames = input().frames.map(frame => ({ ...frame, animationTime: 0 }))
    expect(() => validateSkyMotionRecordingInput({ ...input(), frames }, manifest)).toThrow()
    const paused = input().frames.map((frame, index) => ({ ...frame, paused: index === 100 ? 'true' : 'false' }))
    expect(() => validateSkyMotionRecordingInput({ ...input(), frames: paused }, manifest)).toThrow()
  })

  it('accepts only the pinned public Pteranodon source with its authored 0.7-rate 18-second reference protocol', () => {
    const result = validateSkyMotionRecordingInput(referenceInput(), manifest)
    expect(result.timeline.progressSeconds).toBeCloseTo(12.6, 5)
    expect(result.timeline.wraps).toBe(1)
  })

  it.each([
    { modelSha256: 'b'.repeat(64) }, { animalId: 'pterodactylus' },
    { duration: 8 }, { duration: referenceDuration + .01 },
    { requestedDurationMs: 10000, elapsedMs: 10000 },
    { requestedDurationMs: 12000, elapsedMs: 12000 },
    { initialState: { ...state, activeAnimalId: 'pteranodon', loadedModelSha256: referenceHash } },
    { initialState: { ...state, activeAnimalId: 'pteranodon', loadedModelSha256: referenceHash, animationDuration: '10.6667', animationTimeScale: '1.0000' } },
  ])('rejects unpinned or truncated public reference %j', patch => {
    expect(() => validateSkyMotionRecordingInput({ ...referenceInput(), ...patch }, manifest)).toThrow()
  })

  it('keeps the private nine on their exact eight-second, ten-second protocol', () => {
    expect(() => validateSkyMotionRecordingInput({ ...input(), duration: referenceDuration, requestedDurationMs: 13000, elapsedMs: 13000 }, manifest)).toThrow()
    expect(() => validateSkyMotionRecordingInput({ ...input(), requestedDurationMs: 13000, elapsedMs: 13000 }, manifest)).toThrow()
    expect(() => validateSkyMotionRecordingInput({ ...input(), initialState: { ...state, animationTimeScale: '0.7000' } }, manifest)).toThrow()
  })
})
