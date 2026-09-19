import { SEA_LEVEL, type Position, type WorldSampler } from '../world'

export const SOUNDSCAPE_LAYERS = ['wind', 'surf', 'rain', 'river'] as const
export type SoundscapeLayer = typeof SOUNDSCAPE_LAYERS[number]
export interface SoundscapeFrame { camera: Position; rain: number; wind: number; active: boolean; delta: number; narrationActive?: boolean }
export interface SoundscapeSnapshot { volume: number; muted: boolean; enabled: boolean; status: 'off' | 'loading' | 'playing' | 'suspended' | 'retry'; decodedBytes: number; sourceCount: number; contextCount: number; targets: Record<SoundscapeLayer, number>; error: string | null }
interface Options { createContext?: () => AudioContext; load?: (layer: SoundscapeLayer, signal: AbortSignal) => Promise<ArrayBuffer>; pcmBudget?: number }
const clamp = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
const zero = (): Record<SoundscapeLayer, number> => ({ wind: 0, surf: 0, rain: 0, river: 0 })
const urls = { wind: new URL('../assets/soundscape/wind.wav', import.meta.url).href, surf: new URL('../assets/soundscape/surf.wav', import.meta.url).href, rain: new URL('../assets/soundscape/rain.wav', import.meta.url).href, river: new URL('../assets/soundscape/river.wav', import.meta.url).href }

/** Bounded real shoreline intersections (five stations), not nominal coastAt or region names. */
export function soundscapeMix(world: WorldSampler, frame: SoundscapeFrame): Record<SoundscapeLayer, number> {
 const { x, y, z } = frame.camera
 let shoreDistance = Infinity
 for (const dz of [-160, -80, 0, 80, 160]) shoreDistance = Math.min(shoreDistance, Math.hypot(x - world.shorelineAt(z + dz), dz))
 const altitude = Math.max(0, y - SEA_LEVEL), river = world.river.query(x, z)
 const riverDistance = river ? Math.max(0, river.signedBankDistance) : Infinity
 // Ocean side of the actual shoreline never inherits an inland stream by region label.
 const riverWeight = river && x >= world.shorelineAt(z) ? Math.exp(-riverDistance / 36) * Math.exp(-Math.max(0, y - river.waterLevel) / 55) * clamp(river.speed) : 0
 return { wind: .13 + .12 * clamp(frame.wind), surf: .48 * Math.exp(-shoreDistance / 130) * Math.exp(-altitude / 105), rain: .42 * clamp(frame.rain), river: .5 * riverWeight }
}

/** Owns only its own context. No RAF, timers, global audio pause, or autoplay preparation. */
export class Soundscape {
 private context: AudioContext | null = null
 private master: GainNode | null = null
 private voices: { source: AudioBufferSourceNode; gain: GainNode }[] = []
 private buffers: AudioBuffer[] = []
 private generation = 0
 private abort: AbortController | null = null
 private resuming = false
 private destroyed = false
 private volume = .6
 private muted = false
 private accumulator = .1
 private frame: SoundscapeFrame = { camera: { x: 0, y: 0, z: 0 }, rain: 0, wind: 0, active: false, delta: 0 }
 private snapshot: Omit<SoundscapeSnapshot, 'volume' | 'muted'> = { enabled: false, status: 'off', decodedBytes: 0, sourceCount: 0, contextCount: 0, targets: zero(), error: null }
 constructor(private world: WorldSampler, private options: Options = {}) {}
 getSnapshot(): SoundscapeSnapshot { return { ...this.snapshot, volume: this.volume, muted: this.muted, targets: { ...this.snapshot.targets } } }
 /** Invoke directly within the click handler: create/resume happens before any resource await. */
 async enable(): Promise<void> {
  if (this.destroyed || this.snapshot.status === 'loading' || this.snapshot.status === 'playing') return
  const generation = ++this.generation
  this.resuming = false
  this.abort?.abort(); this.abort = new AbortController()
  this.snapshot.enabled = true; this.snapshot.status = 'loading'; this.snapshot.error = null
  try {
   const context = this.context ?? (this.options.createContext?.() ?? new AudioContext())
   this.context = context; this.snapshot.contextCount = 1
   if (!this.master) { this.master = context.createGain(); this.master.gain.value = 0; this.master.connect(context.destination) }
   const resumed = context.resume() // Must stay before fetch/decode.
   await resumed
   if (!this.current(generation)) { if (this.context === context && !this.snapshot.enabled) void context.suspend().catch(() => {}); return }
   if (context.state !== 'running') throw new Error('Audio permission interrupted; click to retry')
   if (!this.buffers.length) {
    const buffers: AudioBuffer[] = []; let bytes = 0
    for (const layer of SOUNDSCAPE_LAYERS) {
     const data = await (this.options.load?.(layer, this.abort.signal) ?? fetch(urls[layer], { signal: this.abort.signal }).then(r => { if (!r.ok) throw new Error(`Sound asset ${r.status}`); return r.arrayBuffer() }))
     if (!this.current(generation)) return
     const buffer = await context.decodeAudioData(data)
     if (!this.current(generation)) return
     bytes += buffer.length * buffer.numberOfChannels * 4
     if (bytes > (this.options.pcmBudget ?? 12 * 1024 * 1024)) throw new Error('Decoded sound exceeds PCM budget')
     buffers.push(buffer)
    }
    this.buffers = buffers; this.snapshot.decodedBytes = bytes
   }
   if (!this.current(generation)) return
   if (!this.voices.length) this.buffers.forEach(buffer => { const source = context.createBufferSource(), gain = context.createGain(); source.buffer = buffer; source.loop = true; gain.gain.value = 0; source.connect(gain); gain.connect(this.master!); source.start(); this.voices.push({ source, gain }) })
   this.snapshot.sourceCount = this.voices.length
   this.accumulator = .1
   this.snapshot.status = 'suspended'
   if (this.frame.active && !this.frame.narrationActive && context.state !== 'running') this.resumeVoices()
   else this.apply()
  } catch (error) {
   if (!this.current(generation)) return
   this.silence(); this.snapshot.status = 'retry'; this.snapshot.error = error instanceof Error ? error.message : String(error)
  }
 }
 disable(): void {
  ++this.generation; this.resuming = false; this.abort?.abort(); this.abort = null; this.snapshot.enabled = false
  this.silence(); this.releaseVoices(); this.buffers = []; this.snapshot.decodedBytes = 0; this.snapshot.status = 'off'
 }
 setVolume(value: number): void { this.volume = clamp(value); this.applyMaster() }
 setMuted(value: boolean): void { this.muted = value; this.applyMaster() }
 update(frame: SoundscapeFrame): void {
  const wasActive = this.frame.active && !this.frame.narrationActive
  this.frame = frame
  if (!this.snapshot.enabled || !this.context) return
  if (!frame.active || frame.narrationActive) { this.silence(); if (this.snapshot.status !== 'loading' && this.snapshot.status !== 'retry') this.snapshot.status = 'suspended'; return }
  if (this.snapshot.status === 'retry' || this.snapshot.status === 'loading') return
  if (!wasActive && this.voices.length) this.resumeVoices()
  // An OS interruption while otherwise active needs a new user gesture, never
  // a permission loop or an optimistic "playing" UI while context is silent.
  if (wasActive && !this.resuming && this.snapshot.status === 'playing' && this.context.state !== 'running') {
   this.silence(); this.snapshot.status = 'retry'; this.snapshot.error = 'Audio interrupted; click to retry'; return
  }
  this.accumulator += Math.max(0, frame.delta)
  if (this.accumulator >= .1) { this.accumulator %= .1; this.apply() }
 }
 dispose(): void {
  if (this.destroyed) return
  this.disable(); this.destroyed = true; const context = this.context; this.context = null
  this.master?.disconnect(); this.master = null; this.snapshot.contextCount = 0
  if (context) void context.close().catch(() => {})
 }
 private resumeVoices(): void {
  if (!this.context || this.resuming) return
  const context = this.context, generation = this.generation
  this.resuming = true
  void context.resume().then(() => {
   if (!this.current(generation)) { if (this.context === context && !this.snapshot.enabled) this.silence(); return }
   this.resuming = false
   if (!this.frame.active || this.frame.narrationActive) { this.silence(); return }
   if (context.state !== 'running') throw new Error('Audio interrupted; click to retry')
   this.apply()
  }).catch(() => {
   if (this.current(generation)) { this.silence(); this.snapshot.status = 'retry'; this.snapshot.error = 'Audio interrupted; click to retry' }
  }).finally(() => { if (this.generation === generation) this.resuming = false })
 }
 private current(generation: number): boolean { return !this.destroyed && this.generation === generation && this.snapshot.enabled }
 private apply(): void {
  if (!this.frame.active || this.frame.narrationActive) { this.silence(); this.snapshot.status = 'suspended'; return }
  if (!this.context || this.context.state !== 'running' || !this.voices.length) return
  this.snapshot.targets = soundscapeMix(this.world, this.frame)
  this.voices.forEach((voice, i) => voice.gain.gain.setTargetAtTime(this.snapshot.targets[SOUNDSCAPE_LAYERS[i]!], this.context!.currentTime, .12))
  this.snapshot.status = 'playing'; this.applyMaster()
 }
 private applyMaster(): void {
  if (!this.master || !this.context) return
  const audible = this.snapshot.enabled && this.snapshot.status === 'playing' && this.frame.active && !this.frame.narrationActive && !this.muted
  this.master.gain.cancelScheduledValues(this.context.currentTime)
  if (audible) this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, .03)
  else this.master.gain.setValueAtTime(0, this.context.currentTime)
 }
 private silence(): void {
  if (!this.context || !this.master) return
  this.master.gain.cancelScheduledValues(this.context.currentTime); this.master.gain.setValueAtTime(0, this.context.currentTime)
  if (this.context.state === 'running') void this.context.suspend().catch(() => {})
 }
 private releaseVoices(): void { for (const { source, gain } of this.voices) { source.stop(); source.disconnect(); gain.disconnect(); source.buffer = null }; this.voices = []; this.snapshot.sourceCount = 0 }
}
