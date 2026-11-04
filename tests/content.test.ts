import { animal as stegosaurus } from '../src/content/animals/stegosaurus/animal'
import { discoverAnimalPackages } from '../src/content/catalog'
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

  it('excludes drafts from production discovery', () => {
    expect(
      discoverAnimalPackages(modules, { includeDrafts: false }).some(
        ({ status }) => status === 'draft',
      ),
    ).toBe(false)
  })
})
