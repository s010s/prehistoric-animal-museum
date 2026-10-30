import type { AnimalContentEn } from '../../types'

export const en = {
  "name": "Sordes",
  "classificationLabel": "Small long-tailed pterosaur (flying reptile)",
  "visibleFeature": "A long tail, hair-like threads and thin membrane wings.",
  "narration": {
    "sentences": [
      "Meet Sordes, a little flying reptile with a long tail.",
      "Its body had hair-like threads, and thin skin membranes formed its wings."
    ],
    "pronunciation": [
      {
        "text": "Sordes",
        "reading": "SOR-deez",
        "note": "Keep the name together without a pause between syllables."
      }
    ]
  },
  "facts": {
    "period": "Late Jurassic",
    "discoveryRegions": [
      "Karatau, Kazakhstan, Asia"
    ],
    "size": {
      "kind": "wingspan",
      "minMeters": 0.6,
      "maxMeters": 0.6
    },
    "diet": "unknown"
  },
  "parentClassificationNote": "Sordes was a small pterosaur from the Late Jurassic, known from fossils in the Karatau region of what is now Kazakhstan. It had a long tail, and fossils preserve traces of hair-like threads and wing membranes. Its wingspan of about 0.6 metres is an approximate reference based on a research reconstruction; the body covering may have helped it retain heat.",
  "sources": [
    {
      "title": "Sordes pilosus and the nature of the pterosaur flight apparatus",
      "url": "https://doi.org/10.1038/371062a0",
      "accessedOn": "2026-10-29"
    },
    {
      "title": "A new approach to determining pterosaur body mass and its implications for pterosaur flight",
      "url": "https://epub.ub.uni-muenchen.de/12010/1/zitteliana_2008_b28_08.pdf",
      "accessedOn": "2026-10-29"
    },
    {
      "title": "The extent of the pterosaur flight membrane",
      "url": "https://www.app.pan.pl/archive/published/app56/app20090145.pdf",
      "accessedOn": "2026-10-29"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "About 0.6 metres rounds the 0.56-metre reconstructed wingspan in Witton 2008; it does not mean all Sordes individuals were the same size.",
      "Hair-like describes the appearance of the body covering; those threads should be distinguished from the supporting fibres inside the wing membrane.",
      "Colours, the density of the body covering and exact flight movements are reconstruction details that the fossils do not fully establish."
    ],
    "editedBy": "Codex-assisted primary-source drafting",
    "reviewedBy": "Codex primary-source cross-check",
    "reviewedOn": "2026-10-29"
  }
} as const satisfies AnimalContentEn
