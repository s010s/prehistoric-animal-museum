export interface SearchableCollectionAnimal {
  readonly classification: string
  readonly name: string
  /** Extra names and labels, e.g. the other locale's title. */
  readonly searchTerms?: readonly string[]
}

export function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase()
}

function searchTermList(query: string): string[] {
  return normalizeSearchText(query).split(/\s+/).filter(Boolean)
}

function searchHaystack(animal: SearchableCollectionAnimal): string {
  return normalizeSearchText(
    [animal.name, animal.classification, ...(animal.searchTerms ?? [])].join(' '),
  )
}

export function filterCollectionAnimals<Animal extends SearchableCollectionAnimal>(
  animals: readonly Animal[],
  query: string,
): Animal[] {
  const terms = searchTermList(query)
  if (terms.length === 0) {
    return [...animals]
  }

  return animals.filter((animal) => {
    const haystack = searchHaystack(animal)
    return terms.every((term) => haystack.includes(term))
  })
}
