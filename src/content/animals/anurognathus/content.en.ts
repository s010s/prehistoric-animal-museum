import type { AnimalContentEn } from '../../types'

export const en = {
  "name": "Anurognathus",
  "classificationLabel": "Small pterosaur (flying reptile)",
  "visibleFeature": "Look at its short, wide face and its outstretched membrane wings.",
  "narration": {
    "sentences": [
      "This is Anurognathus, a small flying reptile from the Late Jurassic.",
      "Look at its short, wide face and its outstretched membrane wings."
    ],
    "pronunciation": [
      {
        "text": "Anurognathus",
        "reading": "an-oor-og-NAY-thus"
      }
    ]
  },
  "facts": {
    "period": "Late Jurassic (about 150 million years ago)",
    "discoveryRegions": [
      "southern Germany, Europe"
    ],
    "size": {
      "kind": "wingspan",
      "minMeters": 0.35,
      "maxMeters": 0.35
    },
    "diet": "carnivore"
  },
  "parentClassificationNote": "Anurognathus was a small flying reptile from the Late Jurassic, known from fossils in southern Germany. It had a short, broad head, large eye sockets and a short tail. Scientists think it may have caught insects in flight.",
  "sources": [
    {
      "title": "A second specimen of the pterosaur Anurognathus ammoni",
      "url": "https://doi.org/10.1007/BF02990250",
      "accessedOn": "2026-10-28"
    },
    {
      "title": "A new approach to determining pterosaur body mass and its implications for pterosaur flight",
      "url": "https://epub.ub.uni-muenchen.de/12010/1/zitteliana_2008_b28_08.pdf",
      "accessedOn": "2026-10-28"
    },
    {
      "title": "Evolutionary pressures of aerial insectivory reflected in anurognathid pterosaurs",
      "url": "https://doi.org/10.1111/joa.13814",
      "accessedOn": "2026-10-28"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "The approximately 35-centimetre reference rounds the 0.352-metre reconstructed wingspan in Witton 2008; equal bounds do not imply identical smallest and largest known animals.",
      "Comparative anatomy supports insect catching; particular foods and activity in low light remain interpretations.",
      "These fossil studies do not establish the colours, wing patterns or exact flight movements."
    ],
    "editedBy": "Codex-assisted primary-source drafting",
    "reviewedBy": "Codex primary-source cross-check",
    "reviewedOn": "2026-10-28"
  }
} as const satisfies AnimalContentEn
