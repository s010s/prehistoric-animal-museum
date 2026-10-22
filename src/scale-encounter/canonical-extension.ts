import type { Locale } from '../content/types'

export interface CanonicalIdleContactSamples {
  readonly modelSha256: string
  readonly clip: 'Idle'
  readonly duration: number
  readonly sampleRate: number
  readonly meters: number
  readonly frames: readonly {
    readonly time: number
    readonly feet: readonly {
      readonly name: string
      readonly center: readonly number[]
      readonly width: number
      readonly depth: number
      readonly stance: boolean
    }[]
  }[]
}

export interface CanonicalComparisonMetadata {
  readonly names: Readonly<Record<Locale, string>>
  readonly measurements: Readonly<Record<Locale, string>>
  readonly habitat: 'land' | 'water'
  readonly modelSha256: string
  readonly meters: number
  readonly modelYawRadians: number
}

export interface CanonicalComparisonAudio {
  readonly url: string
  readonly script: string
  readonly sha256: string
  readonly durationMs: number
}

export interface CanonicalMotionFootprint {
  readonly modelSha256: string
  readonly clip: string
  readonly duration: number
  readonly sampleCount: number
  readonly points: readonly (readonly [number, number])[]
}
