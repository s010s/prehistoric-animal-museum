import { describe, expect, it } from 'vitest'
import {
  filterCollectionAnimals,
  normalizeSearchText,
} from '../src/components/collection-search'

const animals = [
  {
    id: 'stegosaurus',
    name: '剑龙',
    classification: '剑龙类恐龙',
    searchTerms: ['Stegosaurus', 'Stegosaur dinosaur'],
    thumbnail: '/stegosaurus.webp',
    habitat: 'land' as const,
  },
  {
    id: 'pteranodon',
    name: '无齿翼龙',
    classification: '翼龙类',
    searchTerms: ['Pteranodon', 'Pterosaur'],
    thumbnail: '/pteranodon.webp',
    habitat: 'air' as const,
  },
  {
    id: 'megalodon',
    name: '巨齿鲨',
    classification: '鲨鱼类',
    searchTerms: ['Megalodon', 'Shark'],
    thumbnail: '/megalodon.webp',
    habitat: 'water' as const,
  },
]

describe('collection search', () => {
  it('normalises width, case and surrounding whitespace', () => {
    expect(normalizeSearchText('  ＳＴＥＧＯＳＡＵＲＵＳ  ')).toBe('stegosaurus')
  })

  it('returns every animal for an empty query', () => {
    expect(filterCollectionAnimals(animals, '')).toEqual(animals)
    expect(filterCollectionAnimals(animals, '   ')).toEqual(animals)
  })

  it('matches localised names and classification labels', () => {
    expect(filterCollectionAnimals(animals, '剑龙')).toHaveLength(1)
    expect(filterCollectionAnimals(animals, '翼龙类')).toMatchObject([
      { id: 'pteranodon' },
    ])
  })

  it('matches cross-locale search terms case-insensitively', () => {
    expect(filterCollectionAnimals(animals, 'stegosaurus')).toMatchObject([
      { id: 'stegosaurus' },
    ])
    expect(filterCollectionAnimals(animals, 'SHARK')).toMatchObject([
      { id: 'megalodon' },
    ])
  })

  it('requires every query term to match', () => {
    expect(filterCollectionAnimals(animals, '翼龙 无齿')).toMatchObject([
      { id: 'pteranodon' },
    ])
    expect(filterCollectionAnimals(animals, '翼龙 鲨鱼')).toEqual([])
  })

  it('returns no matches for an unknown query', () => {
    expect(filterCollectionAnimals(animals, '三角龙')).toEqual([])
  })
})
