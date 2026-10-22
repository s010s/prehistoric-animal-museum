import type { AnimalContentEn } from '../../types'

export const en = {
  "name": "Parasaurolophus",
  "classificationLabel": "Hadrosaurid dinosaur",
  "visibleFeature": "A crest stretches back from the head, with winding passages inside.",
  "facts": {
    "period": "Late Cretaceous",
    "discoveryRegions": [
      "North America"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 9.45,
      "maxMeters": 9.45
    },
    "diet": "herbivore"
  },
  "parentClassificationNote": "Parasaurolophus ate plants. Its long crest reached back from its head, with winding passages inside.",
  "sources": [
    {
      "title": "Parasaurolophus at the Natural History Museum",
      "url": "https://www.nhm.ac.uk/discover/dino-directory/parasaurolophus.html",
      "accessedOn": "2026-10-22"
    },
    {
      "title": "Growth and crest development in Parasaurolophus",
      "url": "https://doi.org/10.7717/peerj.182",
      "accessedOn": "2026-10-22"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "The crest may have helped it make sounds or recognise others of its kind. Scientists are still studying its possible uses."
    ],
    "editedBy": "Codex local editorial revision",
    "reviewedBy": "Project factual and editorial source check",
    "reviewedOn": "2026-10-22"
  },
  "narration": {
    "sentences": [
      "Draw the shape of Parasaurolophus’s crest in the air with one finger.",
      "It stretched back from the top of its head, with winding passages hidden inside."
    ],
    "pronunciation": [
      {
        "text": "Parasaurolophus",
        "reading": "pa-ra-saw-ROL-off-us"
      }
    ]
  }
} as const satisfies AnimalContentEn
