import type { AnimalContentEn } from '../../types'

export const en = {
  "name": "Allosaurus",
  "classificationLabel": "Theropod dinosaur; allosaurid",
  "visibleFeature": "Small projections above the eyes and three clawed fingers on each hand.",
  "facts": {
    "period": "Late Jurassic",
    "discoveryRegions": [
      "North America"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 9.7,
      "maxMeters": 9.7
    },
    "diet": "carnivore"
  },
  "parentClassificationNote": "Allosaurus lived during the Late Jurassic. It was a meat-eating dinosaur that walked on two hind legs.",
  "sources": [
    {
      "title": "Allosaurus at the Natural History Museum",
      "url": "https://www.nhm.ac.uk/discover/dino-directory/allosaurus.html",
      "accessedOn": "2026-10-22"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "Scientists do not yet agree on what the small projections above its eyes were used for."
    ],
    "editedBy": "Codex local editorial revision",
    "reviewedBy": "Project factual and editorial source check",
    "reviewedOn": "2026-10-22"
  },
  "narration": {
    "sentences": [
      "Allosaurus had three clawed fingers on each hand.",
      "Open your own hand to compare, then look for the little bumps above its eyes."
    ],
    "pronunciation": [
      {
        "text": "Allosaurus",
        "reading": "AL-oh-saw-russ"
      }
    ]
  }
} as const satisfies AnimalContentEn
