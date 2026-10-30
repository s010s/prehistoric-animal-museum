import type {
  AnimalContent,
  AnimalStatus,
  DraftAnimalPackage,
  DraftNarrationAssets,
  DraftNarrationPlans,
  Locale,
  NarrationAsset,
  NarrationPlan,
  PublishedAnimalAssets,
  PublishedNarrationAssets,
  PublishedNarrationPlans,
  PublishedAnimalPackage,
  ReleaseCandidateAnimalPackage,
} from '../content/types'

export interface LocalReviewInfo {
  readonly badge: string
  readonly status: string
  readonly note: string
  readonly checks: readonly [string, ...string[]]
  readonly accent: {
    readonly strong: string
    readonly soft: string
  }
  readonly modelCredit?: {
    readonly attribution: string
    readonly licenseName: string
    readonly licenseUrl: string
    readonly sourceTitle: string
    readonly sourceUrl: string
  }
}

export type LocalReviewContent = {
  readonly 'zh-CN': AnimalContent
  readonly en?: AnimalContent
}

export type ReviewNarrationPlans =
  | NarrationPlan<'zh-CN'>
  | DraftNarrationPlans
  | PublishedNarrationPlans

export type ReviewNarrationAssets =
  | NarrationAsset<'zh-CN'>
  | DraftNarrationAssets
  | PublishedNarrationAssets

type ReviewAnimalAssets = Omit<PublishedAnimalAssets, 'narration'> & {
  readonly narration: ReviewNarrationAssets
}

export type CompleteDraftAnimalPackage = Omit<
  DraftAnimalPackage,
  'assets' | 'content' | 'narration' | 'status'
> & {
  readonly status: AnimalStatus
  readonly content: LocalReviewContent
  readonly narration: ReviewNarrationPlans
  readonly assets: ReviewAnimalAssets
  readonly review: LocalReviewInfo
}

/**
 * Local review packages predate the public bilingual package contract. They
 * are deliberately modelled only inside the review boundary: production
 * packages still have to satisfy PublishedAnimalPackage's complete zh-CN/en
 * content and narration maps.
 */
export type LegacyLocalReviewAnimalPackage = Omit<
  CompleteDraftAnimalPackage,
  'draftNotes'
> & {
  readonly draftNotes?: CompleteDraftAnimalPackage['draftNotes']
}

/** Live local capture draft. Missing derivatives are absent, never substitutes. */
export type RenderableReviewDraftAnimalPackage = Omit<
  CompleteDraftAnimalPackage,
  'status' | 'assets' | 'review'
> & {
  readonly status: 'draft'
  readonly content: Record<Locale, AnimalContent>
  readonly assets: Omit<ReviewAnimalAssets, 'poster' | 'thumbnail' | 'backgrounds'> & {
    readonly poster?: string
    readonly thumbnail?: string
    readonly backgrounds: {
      readonly landscape?: string
      readonly portrait?: string
    }
  }
  readonly review?: LocalReviewInfo
  readonly modelCredit?: NonNullable<LocalReviewInfo['modelCredit']>
}

export type DisplayableAnimalPackage =
  | (ReleaseCandidateAnimalPackage & { readonly review?: LocalReviewInfo })
  | (PublishedAnimalPackage & { readonly review?: LocalReviewInfo })
  | LegacyLocalReviewAnimalPackage
  | RenderableReviewDraftAnimalPackage

export function reviewNarrationPlanFor<Language extends Locale>(
  narration: ReviewNarrationPlans,
  locale: Language,
): NarrationPlan<Language> | undefined {
  if ('status' in narration) {
    return locale === 'zh-CN'
      ? (narration as NarrationPlan<Language>)
      : undefined
  }
  return narration[locale] as NarrationPlan<Language> | undefined
}

export function reviewNarrationAssetFor<Language extends Locale>(
  narration: ReviewNarrationAssets,
  locale: Language,
): NarrationAsset<Language> | undefined {
  if ('status' in narration) {
    return locale === 'zh-CN'
      ? (narration as NarrationAsset<Language>)
      : undefined
  }
  return narration[locale] as NarrationAsset<Language> | undefined
}
