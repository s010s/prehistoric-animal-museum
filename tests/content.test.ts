import { animal as stegosaurus } from '../src/content/animals/stegosaurus/animal'
import {
  discoverAnimalPackages,
  filterPublishedAnimals,
  getCollectionAnimals,
  productionAnimals,
} from '../src/content/catalog'
import {
  mainCollection,
  nextAnimalId,
  previousAnimalId,
  stepCollection,
  wrapCollectionIndex,
} from '../src/content/collections/main'
import type {
  AnimalModule,
  DraftAnimalPackage,
  PublishedAnimalPackage,
} from '../src/content/types'

function publishedAnimal(id: string): PublishedAnimalPackage {
  return {
    ...stegosaurus,
    id,
    assets: {
      ...stegosaurus.assets,
      narration: {
        'zh-CN': {
          ...stegosaurus.narration['zh-CN'],
          url: '/fixtures/narration.zh-CN.mp3',
        },
        en: {
          ...stegosaurus.narration.en,
          url: '/fixtures/narration.en.mp3',
        },
      },
    },
  }
}

function draftAnimal(id: string): DraftAnimalPackage {
  const animation = stegosaurus.animation
  return {
    id,
    status: 'draft',
    kind: 'dinosaur',
    habitat: 'land',
    atmosphere: 'forest',
    content: stegosaurus.content,
    presentation: stegosaurus.presentation,
    ...(animation ? { animation } : {}),
    narration: stegosaurus.narration,
    provenance: [],
    assets: {},
    draftNotes: ['测试用开发草稿。'],
  }
}

describe('animal package discovery', () => {
  const publishedA = publishedAnimal('published-a')
  const publishedB = publishedAnimal('published-b')
  const draft = draftAnimal('draft-a')
  const modules: Record<string, AnimalModule> = {
    './animals/z/animal.ts': { animal: publishedB },
    './animals/b/animal.ts': { animal: draft },
    './animals/a/animal.ts': { animal: publishedA },
  }

  it('discovers deterministically and excludes drafts in production', () => {
    expect(
      discoverAnimalPackages(modules, { includeDrafts: false }).map(
        ({ id }) => id,
      ),
    ).toEqual(['published-a', 'published-b'])
    expect(
      discoverAnimalPackages(modules, { includeDrafts: true }).map(
        ({ id }) => id,
      ),
    ).toEqual(['published-a', 'draft-a', 'published-b'])
    expect(filterPublishedAnimals([draft, publishedA])).toEqual([publishedA])
  })

  it('rejects duplicate IDs discovered at different module paths', () => {
    expect(() =>
      discoverAnimalPackages(
        {
          './animals/a/animal.ts': { animal: publishedA },
          './animals/b/animal.ts': {
            animal: publishedAnimal(publishedA.id),
          },
        },
        { includeDrafts: true },
      ),
    ).toThrow(/重复动物 ID/)
  })
})

describe('explicit looping collection', () => {
  it('preserves manifest order rather than discovery order', () => {
    const publishedA = publishedAnimal('published-a')
    const publishedB = publishedAnimal('published-b')
    const collection = {
      id: 'ordered',
      animalIds: ['published-b', 'published-a'],
      defaultAnimalId: 'published-b',
      loop: true,
    } as const

    expect(
      getCollectionAnimals(collection, [publishedA, publishedB]).map(
        ({ id }) => id,
      ),
    ).toEqual(['published-b', 'published-a'])
  })

  it('wraps positive and negative indices at both ends', () => {
    expect(wrapCollectionIndex(-1, 3)).toBe(2)
    expect(wrapCollectionIndex(3, 3)).toBe(0)
    expect(wrapCollectionIndex(7, 3)).toBe(1)
  })

  it('loops the thirty-six-animal production collection in its explicit order', () => {
    expect(previousAnimalId(mainCollection, 'stegosaurus')).toBe('anomalocaris')
    expect(nextAnimalId(mainCollection, 'stegosaurus')).toBe(
      'pteranodon',
    )
    expect(stepCollection(mainCollection, 'stegosaurus', 1_001)).toBe(
      'lystrosaurus',
    )
  })
})

describe('authored exhibit scenes', () => {
  it('wires distinct, reviewed narration assets for both public locales', () => {
    for (const animal of productionAnimals) {
      const zhCNRecord = animal.provenance.find(
        ({ assetPath }) => assetPath === 'audio/narration.zh-CN.mp3',
      )
      const enRecord = animal.provenance.find(
        ({ assetPath }) => assetPath === 'audio/narration.en.mp3',
      )

      expect(animal.narration['zh-CN'].humanReviewStatus).toBe('approved')
      expect(animal.narration.en.humanReviewStatus).toBe('approved')
      expect(animal.assets.narration['zh-CN'].url).toBeTruthy()
      expect(animal.assets.narration.en.url).toBeTruthy()
      expect(animal.assets.narration.en.url).not.toBe(
        animal.assets.narration['zh-CN'].url,
      )
      expect(zhCNRecord).toBeDefined()
      expect(enRecord).toBeDefined()
      expect(enRecord?.runtime.sha256).not.toBe(zhCNRecord?.runtime.sha256)
      expect(enRecord?.license.spdx).toBe('CC-BY-NC-SA-4.0')
    }
  })

  it('uses a distinct responsive background pair for every production animal', () => {
    const backgroundPairs = productionAnimals.map((animal) => {
      const landscape = animal.provenance.find(
        ({ assetPath }) => assetPath === 'backgrounds/landscape.webp',
      )
      const portrait = animal.provenance.find(
        ({ assetPath }) => assetPath === 'backgrounds/portrait.webp',
      )

      return `${landscape?.runtime.sha256}:${portrait?.runtime.sha256}`
    })

    expect(new Set(backgroundPairs).size).toBe(productionAnimals.length)
  })
})
