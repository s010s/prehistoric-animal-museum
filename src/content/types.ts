export const animalIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const sha256Pattern = /^[a-f0-9]{64}$/
export const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/

export type AnimalStatus = 'draft' | 'published'
export type AnimalKind =
  | 'dinosaur'
  | 'pterosaur'
  | 'marine-reptile'
  | 'other-prehistoric-animal'
export type Habitat = 'land' | 'air' | 'water'
export type AtmosphereKind =
  | 'air'
  | 'forest'
  | 'ice'
  | 'plains'
  | 'underwater'
export type Diet = 'herbivore' | 'carnivore' | 'omnivore' | 'unknown'
export type Locale = 'zh-CN' | 'en'
export type Sha256 = string
export type IsoDate = string

export type AnimalSizeFact =
  | { readonly kind: 'unknown'; readonly note: string }
  | {
      readonly kind: 'body-length' | 'shoulder-height' | 'wingspan'
      readonly minMeters: number
      readonly maxMeters: number
    }
  | {
      readonly kind: 'group-range'
      readonly minMeters: number
      readonly maxMeters: number
      readonly note: string
    }

export interface PronunciationEntry {
  readonly text: string
  readonly reading: string
  readonly note?: string
}

export interface ScientificSource {
  readonly title: string
  readonly url: `https://${string}`
  readonly accessedOn: IsoDate
}

export interface AnimalContent {
  readonly name: string
  readonly classificationLabel: string
  readonly visibleFeature: string
  readonly narration: {
    readonly sentences: readonly [string, string]
    readonly pronunciation: readonly [
      PronunciationEntry,
      ...PronunciationEntry[],
    ]
  }
  readonly facts: {
    readonly period: string
    readonly discoveryRegions: readonly [string, ...string[]]
    readonly size: AnimalSizeFact
    readonly diet: Diet
  }
  readonly parentClassificationNote: string
  readonly sources: readonly [ScientificSource, ...ScientificSource[]]
  readonly editorial: {
    readonly uncertaintyNotes: readonly string[]
    readonly editedBy: string
    readonly reviewedBy: string
    readonly reviewedOn: IsoDate
  }
}

export type AnimalContentZhCN = AnimalContent
export type AnimalContentEn = AnimalContent

export interface AnimalPresentation {
  readonly cameraLightScale?: number
  readonly initialYawDegrees: number
  /**
   * Moves the fitted model inside the desktop/landscape composition frame.
   * Negative values move it toward audience-left.
   */
  readonly landscapeHorizontalOffset?: number
  /**
   * Moves the fitted model vertically inside the desktop/landscape
   * composition frame. Positive values move it toward the ground.
   */
  readonly landscapeVerticalOffset?: number
  /**
   * Optional equivalent nudge for portrait layouts. Omit to keep the fitted
   * bounds geometrically centred.
   */
  readonly portraitHorizontalOffset?: number
  /**
   * Portrait equivalent of landscapeVerticalOffset.
   * Positive values move the model toward the bottom of the stage.
   */
  readonly portraitVerticalOffset?: number
  /**
   * Adds portrait-only breathing room for unusually wide silhouettes.
   * Falls back to safeAreaPadding when omitted.
   */
  readonly portraitSafeAreaPadding?: number
  readonly safeAreaPadding: number
  /**
   * Fits and grounds against the animated skin at the first frame instead of
   * relying on a mesh's bind-space bounding box.
   */
  readonly preciseBounds?: boolean
  readonly shadow: 'ground' | 'none'
  readonly shadowOpacity?: number
  readonly shadowScale?: number
  /** Optional footprint-depth scale, independent of the silhouette length. */
  readonly shadowDepthScale?: number
  /** Moves the shadow along the animal's initial left/right stage axis. */
  readonly shadowHorizontalOffset?: number
  /** Moves the shadow toward or away from the initial camera. */
  readonly shadowDepthOffset?: number
  /**
   * Small vertical adjustment from the fitted visible foot-contact plane.
   */
  readonly shadowYOffset?: number
  readonly toneMappingExposure?: number
}

export interface AnimalAnimation {
  readonly clip: string
  readonly loop: 'repeat' | 'once'
  readonly speed: number
}

export type CanonicalRuntimeAssetPath =
  | 'model/model.glb'
  | 'images/poster.webp'
  | 'images/poster-portrait.webp'
  | 'images/thumbnail.webp'
  | 'backgrounds/landscape.webp'
  | 'backgrounds/portrait.webp'
  | 'audio/narration.zh-CN.mp3'
  | 'audio/narration.en.mp3'

export type AssetKind =
  | 'model'
  | 'embedded-textures'
  | 'background'
  | 'poster'
  | 'thumbnail'
  | 'narration'

export type LicenseIdentifier =
  | 'CC0-1.0'
  | 'CC-BY-4.0'
  | 'CC-BY-NC-SA-4.0'
  | 'LicenseRef-Public-Domain'
  | 'LicenseRef-OpenAI-Output'
  | 'MIT'
  | 'BSD-2-Clause'
  | 'BSD-3-Clause'
  | 'Apache-2.0'

export interface AssetLicense {
  readonly spdx: LicenseIdentifier
  readonly name: string
  readonly url: `https://${string}`
}

export interface ThirdPartyAssetSource {
  readonly type: 'third-party'
  readonly title: string
  readonly author: string
  readonly url: `https://${string}`
  readonly accessedOn: IsoDate
  readonly sha256: Sha256
  readonly bytes: number
}

export interface GeneratedAssetSource {
  readonly type: 'generated'
  readonly title: string
  readonly tool: string
  readonly model?: string
  readonly revision?: string
  readonly generatedOn: IsoDate
  readonly prompt: string
  readonly sha256: Sha256
  readonly bytes: number
}

export interface DerivedAssetSource {
  readonly type: 'derived'
  readonly title: string
  readonly generatedOn: IsoDate
  readonly inputAssetPaths: readonly [
    CanonicalRuntimeAssetPath,
    ...CanonicalRuntimeAssetPath[],
  ]
  readonly method: string
}

export type AssetSource =
  | ThirdPartyAssetSource
  | GeneratedAssetSource
  | DerivedAssetSource

export interface AssetProvenance {
  readonly assetPath: CanonicalRuntimeAssetPath
  readonly kind: AssetKind
  readonly source: AssetSource
  readonly license: AssetLicense
  readonly runtime: {
    readonly sha256: Sha256
    readonly bytes: number
  }
  readonly modifications: readonly [string, ...string[]]
  readonly attribution: string
  readonly redistributionAllowed: boolean
  readonly evidencePaths: readonly [string, ...string[]]
}

export type NarrationSourcePath<Language extends Locale = Locale> =
  `audio/narration.${Language}.mp3`

export interface ReadyNarrationPlan<Language extends Locale = Locale> {
  readonly status: 'ready'
  readonly sourcePath: NarrationSourcePath<Language>
  readonly mimeType: 'audio/mpeg'
}

export type NarrationLanguage<Language extends Locale> =
  Language extends 'zh-CN' ? 'Chinese' : 'English'

export interface ApprovedNarrationPlan<Language extends Locale = Locale>
  extends ReadyNarrationPlan<Language> {
  readonly speaker: 'Serena'
  readonly language: NarrationLanguage<Language>
  readonly humanReviewStatus: 'approved'
}

export interface PendingNarrationPlan<Language extends Locale = Locale> {
  readonly status: 'pending-review'
  readonly expectedPath: NarrationSourcePath<Language>
  readonly message: string
  readonly gate: {
    readonly id: 'final-narration'
    readonly locale: Language
    readonly reason: string
  }
}

export type NarrationPlan<Language extends Locale = Locale> =
  | ReadyNarrationPlan<Language>
  | PendingNarrationPlan<Language>

export interface ReadyNarrationAsset<Language extends Locale = Locale>
  extends ReadyNarrationPlan<Language> {
  readonly url: string
}

export interface ApprovedNarrationAsset<Language extends Locale = Locale>
  extends ApprovedNarrationPlan<Language> {
  readonly url: string
}

export type NarrationAsset<Language extends Locale = Locale> =
  | ReadyNarrationAsset<Language>
  | PendingNarrationPlan<Language>

export type PublishedNarrationPlans = {
  readonly [Language in Locale]: ApprovedNarrationPlan<Language>
}

export type PublishedNarrationAssets = {
  readonly [Language in Locale]: ApprovedNarrationAsset<Language>
}

export type DraftNarrationPlans = Partial<{
  readonly [Language in Locale]: NarrationPlan<Language>
}>

export type DraftNarrationAssets = Partial<{
  readonly [Language in Locale]: NarrationAsset<Language>
}>

export interface PublishedAnimalAssets {
  readonly model: string
  /** Exact encoded byte length of the runtime GLB at `model`. */
  readonly modelBytes: number
  readonly poster: string
  readonly posterPortrait?: string
  readonly thumbnail: string
  readonly backgrounds: {
    readonly landscape: string
    readonly portrait: string
  }
  readonly narration: PublishedNarrationAssets
}

export interface DraftAnimalAssets {
  readonly posterPortrait?: string
  readonly model?: string
  /** Exact encoded byte length of the runtime GLB at `model`, when present. */
  readonly modelBytes?: number
  readonly poster?: string
  readonly thumbnail?: string
  readonly backgrounds?: {
    readonly landscape?: string
    readonly portrait?: string
  }
  readonly narration?: DraftNarrationAssets
}

interface AnimalPackageCommon {
  readonly id: string
  readonly kind: AnimalKind
  readonly habitat: Habitat
  readonly atmosphere: AtmosphereKind
  readonly presentation: AnimalPresentation
  readonly animation?: AnimalAnimation
  readonly provenance: readonly AssetProvenance[]
}

export interface PublishedAnimalPackage extends AnimalPackageCommon {
  readonly status: 'published'
  readonly content: {
    readonly [Language in Locale]: AnimalContent
  }
  readonly narration: PublishedNarrationPlans
  readonly assets: PublishedAnimalAssets
  readonly provenance: readonly [
    AssetProvenance,
    ...AssetProvenance[],
  ]
}

export interface DraftAnimalPackage extends AnimalPackageCommon {
  readonly status: 'draft'
  readonly content: Partial<{
    readonly [Language in Locale]: AnimalContent
  }>
  readonly narration: DraftNarrationPlans
  readonly assets: DraftAnimalAssets
  readonly draftNotes: readonly [string, ...string[]]
}

/** Complete renderable draft; this type never grants production approval. */
export type ReleaseCandidateAnimalPackage = Omit<PublishedAnimalPackage, 'status'> & {
  readonly status: 'draft'
  readonly draftNotes: readonly [string, ...string[]]
}

export type CompleteAnimalDefinition = Omit<PublishedAnimalDefinition, 'status'> & {
  readonly status: AnimalStatus
}

export type AnimalPackage = PublishedAnimalPackage | DraftAnimalPackage

export type PublishedAnimalDefinition = Omit<PublishedAnimalPackage, 'assets'>
export type DraftAnimalDefinition = Omit<DraftAnimalPackage, 'assets'>
export type AnimalPackageDefinition =
  | PublishedAnimalDefinition
  | DraftAnimalDefinition

/**
 * Gives package consumers one stable, release-ready type while keeping the
 * type error at the package declaration that has not cleared every gate yet.
 */
export function definePublishedAnimal(
  definition: PublishedAnimalDefinition,
): PublishedAnimalDefinition {
  return definition
}

export interface AnimalModule {
  readonly animal: AnimalPackage
}

export interface AnimalDefinitionModule {
  readonly animalDefinition: AnimalPackageDefinition
}

export interface AnimalCollection<AnimalId extends string = string> {
  readonly id: string
  readonly animalIds: readonly [AnimalId, ...AnimalId[]]
  readonly defaultAnimalId: AnimalId
  readonly loop: boolean
}

export interface CreditEntry {
  readonly id: string
  readonly animalId: string
  readonly assetPath: CanonicalRuntimeAssetPath
  readonly assetKind: AssetKind
  readonly sourceTitle: string
  readonly author: string
  readonly licenseName: string
  readonly licenseUrl: string
  readonly sourceUrl?: string
  readonly attribution: string
  readonly modifications: readonly string[]
}
