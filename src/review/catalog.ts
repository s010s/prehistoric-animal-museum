import { mainAnimals } from '../content/catalog'
import { animal as stegosaurus } from '../content/animals/stegosaurus/animal'
import type { PublishedAnimalPackage, ReleaseCandidateAnimalPackage } from '../content/types'
import { reviewAssetUrl } from './assets'
import { animal as apatosaurus } from './animals/apatosaurus/package'
import { animal as gigantoraptor } from './animals/gigantoraptor/package'
import { animal as ichthyosaur } from './animals/ichthyosaur/package'
import { animal as maiasaura } from './animals/maiasaura/package'
import { animal as mammoth } from './animals/mammoth/package'
import { animal as megalodon } from './animals/megalodon/package'
import { animal as pachycephalosaurus } from './animals/pachycephalosaurus/package'
import { animal as plesiosaurus } from './animals/plesiosaurus/package'
import { animal as pteranodon } from './animals/pteranodon/package'
import { animal as triceratops } from './animals/triceratops/package'
import { animal as tyrannosaurusRex } from './animals/tyrannosaurus-rex/package'
import { animal as dilophosaurusDraft } from './animals/dilophosaurus/package'
import { animal as mosasaurusDraft } from './animals/mosasaurus/package'
import { animal as sauropeltaDraft } from './animals/sauropelta/package'
import { animal as rhamphorhynchusDraft } from './animals/rhamphorhynchus/package'
import { animal as tupandactylusDraft } from './animals/tupandactylus/package'
import { animal as meganeuraDraft } from './animals/meganeura/package'
import { animal as spinosaurusDraft } from './animals/spinosaurus/package'
import { animal as lystrosaurusDraft } from './animals/lystrosaurus/package'
import { animal as baryonyxDraft } from './animals/baryonyx/package'
import { animal as archaeopteryxDraft } from './animals/archaeopteryx/package'
import { animal as carnotaurusDraft } from './animals/carnotaurus/package'
import { animal as anomalocarisDraft } from './animals/anomalocaris/package'
import type {
  CompleteDraftAnimalPackage,
  DisplayableAnimalPackage,
} from './types'

const reviewedStegosaurus = {
  ...stegosaurus,
  assets: {
    ...stegosaurus.assets,
    model: reviewAssetUrl('stegosaurus', 'model.glb'),
    poster: reviewAssetUrl('stegosaurus', 'poster.webp'),
    posterPortrait: reviewAssetUrl('stegosaurus', 'poster-portrait.webp'),
    thumbnail: reviewAssetUrl('stegosaurus', 'thumbnail.webp'),
    backgrounds: {
      landscape: reviewAssetUrl('stegosaurus', 'background-landscape'),
      portrait: reviewAssetUrl('stegosaurus', 'background-portrait'),
    },
    narration: {
      status: 'ready',
      sourcePath: 'audio/narration.zh-CN.mp3',
      mimeType: 'audio/mpeg',
      url: reviewAssetUrl('stegosaurus', 'narration.mp3'),
    },
  },
  review: {
    badge: '已听审',
    status: '剑龙基准包',
    note:
      '模型、场景、文案和 Serena 完整旁白均已通过人工验收；8.51 秒时长例外已获确认。官方一手材料支持 Serena 输出公开分发，本包现已进入生产集合。',
    checks: [
      '作为其余动物的构图、材质、灯光和交互基准。',
      '确认旁白播放、暂停和动物切换后的停止回零。',
    ],
    accent: {
      strong: '#a85f2f',
      soft: '#f2d1a5',
    },
  },
} satisfies DisplayableAnimalPackage

function acceptedOnboardingAnimal(
  animal: PublishedAnimalPackage,
  draft: CompleteDraftAnimalPackage,
): DisplayableAnimalPackage {
  return {
    ...animal,
    review: {
      ...draft.review,
      badge: '已验收',
      status: `${animal.content['zh-CN'].name}自动化新增包已晋升生产`,
      note: `${draft.review.note} 产品负责人已于 ${animal.content['zh-CN'].editorial.reviewedOn} 完成科学、视觉、动作、完整听审、公开分发与生产晋升验收。`,
    },
  }
}

function mergePublishedReviewAnimal(
  productionAnimal: PublishedAnimalPackage,
  reviewAnimal: DisplayableAnimalPackage,
): DisplayableAnimalPackage {
  if (!reviewAnimal.review) {
    return productionAnimal
  }
  return {
    ...productionAnimal,
    review: reviewAnimal.review,
  }
}

const publishedReviewAnimals: readonly DisplayableAnimalPackage[] = [
  reviewedStegosaurus,
  pachycephalosaurus,
  ichthyosaur,
  pteranodon,
  tyrannosaurusRex,
  triceratops,
  plesiosaurus,
  apatosaurus,
  gigantoraptor,
  mammoth,
  megalodon,
  maiasaura,
]

const onboardingDrafts: readonly CompleteDraftAnimalPackage[] = [
  sauropeltaDraft,
  dilophosaurusDraft,
  mosasaurusDraft,
  rhamphorhynchusDraft,
  tupandactylusDraft,
  meganeuraDraft,
  spinosaurusDraft,
  lystrosaurusDraft,
  baryonyxDraft,
  archaeopteryxDraft,
  carnotaurusDraft,
  anomalocarisDraft,
]

// The production collection is authoritative. A local draft automatically
// switches to its generated production assets as soon as an approved promotion
// appends the same ID; future drafts not yet promoted stay at the end of the
// explicit local-only allowlist.
export function buildLocalReviewCatalog(
  productionAnimals: readonly (PublishedAnimalPackage | ReleaseCandidateAnimalPackage)[],
  publishedReviews: readonly DisplayableAnimalPackage[],
  drafts: readonly CompleteDraftAnimalPackage[],
): readonly DisplayableAnimalPackage[] {
  const publishedReviewById = new Map(
    publishedReviews.map((animal) => [animal.id, animal]),
  )
  const draftById = new Map(drafts.map((animal) => [animal.id, animal]))
  const productionIds = new Set(productionAnimals.map(({ id }) => id))
  return [
    ...productionAnimals.map((animal) => {
      if (animal.status === 'draft') return animal
      const publishedReview = publishedReviewById.get(animal.id)
      if (publishedReview) {
        return mergePublishedReviewAnimal(animal, publishedReview)
      }
      const draft = draftById.get(animal.id)
      return draft ? acceptedOnboardingAnimal(animal, draft) : animal
    }),
    ...drafts.filter(({ id }) => !productionIds.has(id)),
  ]
}

export const localReviewAnimals = buildLocalReviewCatalog(
  mainAnimals,
  publishedReviewAnimals,
  onboardingDrafts,
)
