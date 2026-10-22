import type { AnimalContentEn } from '../../types'

export const en = {
  "name": "Ankylosaurus",
  "classificationLabel": "Ankylosaurid dinosaur",
  "visibleFeature": "Bony armour across the back and a rounded club at the tail tip.",
  "facts": {
    "period": "Late Cretaceous",
    "discoveryRegions": [
      "North America"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 8.0,
      "maxMeters": 8.0
    },
    "diet": "herbivore"
  },
  "parentClassificationNote": "Ankylosaurus ate plants. Bony armour covered its body, and a heavy club grew at the end of its tail.",
  "sources": [
    {
      "title": "Ankylosaurus at the Natural History Museum",
      "url": "https://www.nhm.ac.uk/discover/dino-directory/ankylosaurus.html",
      "accessedOn": "2026-10-22"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "No complete Ankylosaurus skeleton has been found, so the exact arrangement of its back armour is still being studied."
    ],
    "editedBy": "Codex local editorial revision",
    "reviewedBy": "Project factual and editorial source check",
    "reviewedOn": "2026-10-22"
  },
  "narration": {
    "sentences": [
      "The bony plates on Ankylosaurus look like a sturdy coat of armour.",
      "Follow its back towards the tail, all the way to the rounded club at the very end."
    ],
    "pronunciation": [
      {
        "text": "Ankylosaurus",
        "reading": "An-KYE-low-sore-us"
      }
    ]
  }
} as const satisfies AnimalContentEn
