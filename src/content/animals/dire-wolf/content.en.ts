import type { AnimalContentEn } from '../../types'

export const en = {
  name: 'Dire Wolf',
  classificationLabel: 'A large extinct dog-like carnivore',
  visibleFeature:
    'Look at its strong body, broad head and big bushy tail - it was even heavier than wolves alive today.',
  narration: {
    sentences: [
      'Meet the dire wolf, a great Ice Age wolf that lived long before the wolves of today.',
      'Look at its strong body, broad head and big bushy tail - it was even heavier than wolves alive today.',
    ],
    pronunciation: [
      { text: 'dire wolf', reading: 'DY-uh wuulf' },
      { text: 'Aenocyon', reading: 'ay-NOH-sy-on' },
      { text: 'Pleistocene', reading: 'PLY-stoh-seen' },
    ],
  },
  facts: {
    period: 'Late Pleistocene (about 125,000 to 10,000 years ago)',
    discoveryRegions: [
      'North America (La Brea Tar Pits)',
      'South America',
    ],
    size: {
      kind: 'body-length',
      minMeters: 1.5,
      maxMeters: 1.8,
    },
    diet: 'carnivore',
  },
  parentClassificationNote:
    'The dire wolf is not the direct ancestor of living grey wolves. A 2021 genetic study found it was only distantly related to them - its closest living relatives are the African jackals - so palaeontologists moved it into its own genus, Aenocyon. It was about a quarter heavier than a grey wolf, with a broader skull, larger teeth and relatively shorter, sturdier legs. It is the most common carnivore at the La Brea Tar Pits, where more than 4,000 individuals have been found.',
  sources: [
    {
      title: 'Dire Wolf - U.S. National Park Service',
      url: 'https://www.nps.gov/articles/000/dire-wolf.htm',
      accessedOn: '2026-11-22',
    },
    {
      title: 'Dire Wolf - San Diego Natural History Museum Fossil Field Guide',
      url: 'https://www.sdnhm.org/exhibitions/fossil-mysteries/fossil-field-guide-a-z/dire-wolf/',
      accessedOn: '2026-11-22',
    },
    {
      title: 'Dire wolf - Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Dire_wolf',
      accessedOn: '2026-11-22',
    },
  ],
  editorial: {
    uncertaintyNotes: [
      'The exhibit model is an artistic reconstruction built on the body plan of its close relative, the living grey wolf; the real dire wolf was more robust, with a broader skull and relatively shorter legs. This simplification is recorded here for parents.',
      'Dire wolf coat colour and length cannot be determined from fossils; the model coat is an artistic interpretation.',
      'Why the dire wolf died out - losing its large prey, climate change, or competition with grey wolves - is still debated, with no single agreed answer.',
    ],
    editedBy: 'Prehistoric Animal Museum candidate research',
    reviewedBy: 'jianghong (product owner)',
    reviewedOn: '2026-11-22',
  },
} satisfies AnimalContentEn
