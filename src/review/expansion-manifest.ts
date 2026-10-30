import type { DisplayableAnimalPackage } from './types'
import type { ReviewScaleEncounterAnimalId } from '../scale-encounter/types'
import type { ReviewMotionFootprint } from '../viewer/scale-encounter-motion-footprint'
import type { Locale } from '../i18n/locale'

/** Candidate audio identity; availability does not imply owner approval. */
export interface ExpansionNarrationTrack {
  readonly url: string
  readonly sha256: string
  readonly script: string
  /** Measured media duration, rounded to milliseconds. */
  readonly durationMs: number
}

export type ExpansionComparisonNarration = Readonly<Record<Locale,
  Readonly<Record<'intro' | 'transition' | 'arrival', ExpansionNarrationTrack>>>>

export interface AnimationContactSamples {
  readonly modelSha256: string
  readonly clip: 'Idle' | 'Walk'
  readonly duration: number
  readonly sampleRate: number
  readonly meters: number
  readonly frames: readonly {
    readonly time: number
    readonly feet: readonly { readonly name: string; readonly center: readonly number[]; readonly width: number; readonly depth: number; readonly stance: boolean }[]
  }[]
}
export interface WalkContactSamples extends AnimationContactSamples {
  readonly speedMetersPerSecond?: number
  /** Exact exported local leg-chain names and calibrated cruise endpoint. */
  readonly stopLegNodeNames?: readonly string[]
  readonly cruiseSeconds?: number
  readonly clip: 'Walk'
}
export interface ExpansionComparison {
  readonly id: ReviewScaleEncounterAnimalId
  readonly names: { readonly 'zh-CN': string; readonly en: string }
  readonly measurements: { readonly 'zh-CN': string; readonly en: string }
  readonly habitat: 'land' | 'air' | 'water'
  readonly modelSha256: string
  readonly meters: number
  readonly modelYawRadians: number
  readonly measurement?: 'body-length' | 'wingspan' | 'shoulder-height' | 'standing-height'
  readonly measurementAxis?: 'x' | 'y' | 'z'
  /** Authored bilingual phases remain usable as captions before audio exists. */
  readonly scripts?: Readonly<Record<Locale, Readonly<Record<'intro' | 'transition' | 'arrival', string>>>>
  readonly motionFootprint?: ReviewMotionFootprint
  readonly walkContacts?: WalkContactSamples
  readonly idleContacts?: AnimationContactSamples & { readonly clip: 'Idle' }
  readonly narration?: ExpansionComparisonNarration
}

export interface ExpansionReviewManifest {
  readonly evidenceVersion?: 'motion-v2' | 'motion-v3' | 'motion-v4' | 'motion-v5' | 'sky-integration-v1'
  readonly modelHashes: Readonly<Record<string, string>>
  /** Derived from the hash-checked GLB by the local manifest reader. */
  readonly clipDurations?: Readonly<Record<string, number>>
  readonly animals: readonly DisplayableAnimalPackage[]
  readonly comparisons: readonly ExpansionComparison[]
  readonly galleryNarration?: Readonly<Record<string, Readonly<Record<Locale, ExpansionNarrationTrack>>>>
  /** Explicit local routes only; never a directory-serving capability. */
  readonly files: Readonly<Record<string, string>>
  /** Private preparation state; never presented as scientific research. */
  readonly readiness?: Readonly<Record<string, {
    readonly complete: boolean
    readonly missing: readonly string[]
    readonly humanListening: 'pending'
  }>>
}
