import type { AnimalContentEn } from '../../types'

export const en = {
  "name": "Gallimimus",
  "classificationLabel": "Ornithomimid dinosaur",
  "visibleFeature": "Long legs, a small head and a toothless beak.",
  "facts": {
    "period": "Late Cretaceous",
    "discoveryRegions": [
      "Mongolia"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 6.0,
      "maxMeters": 6.0
    },
    "diet": "unknown"
  },
  "parentClassificationNote": "Gallimimus had long legs and a toothless beak, giving it an appearance a little like an ostrich.",
  "sources": [
    {
      "title": "Gallimimus at the Natural History Museum",
      "url": "https://www.nhm.ac.uk/discover/dino-directory/gallimimus.html",
      "accessedOn": "2026-10-22"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "Scientists still debate exactly what it ate.",
      "The arrangement and colour of its feathers must be inferred from fossil clues and its relatives."
    ],
    "editedBy": "Codex local editorial revision",
    "reviewedBy": "Project factual and editorial source check",
    "reviewedOn": "2026-10-22"
  },
  "narration": {
    "sentences": [
      "Give a big smile and show your teeth, if you like.",
      "Gallimimus had long legs and a bird-like beak, with no teeth inside."
    ],
    "pronunciation": [
      {
        "text": "Gallimimus",
        "reading": "galley-MIME-us"
      }
    ]
  }
} as const satisfies AnimalContentEn
