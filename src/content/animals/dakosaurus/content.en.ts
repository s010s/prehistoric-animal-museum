import type { AnimalContentEn } from '../../types'

export const en = {
  "name": "Dakosaurus",
  "classificationLabel": "Marine crocodyliform reptile",
  "visibleFeature": "Four flippers and a finned tail.",
  "facts": {
    "period": "Late Jurassic",
    "discoveryRegions": [
      "Germany, Europe"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 4.8,
      "maxMeters": 4.8
    },
    "diet": "carnivore"
  },
  "parentClassificationNote": "Dakosaurus was a crocodyliform adapted to life in the sea, with limbs and a tail suited to moving through water. Cutting edges on its fossil teeth show that it was a meat eater.",
  "sources": [
    {
      "title": "A complete morphological description of Dakosaurus maximus with insights into its palaeoecology",
      "url": "https://www.palaeo-electronica.org/content/2026/5775-dakosaurus-maximus-morphology-and-palaeoecology",
      "accessedOn": "2026-10-28"
    },
    {
      "title": "The cranial osteology and feeding ecology of Dakosaurus and Plesiosuchus",
      "url": "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0044985",
      "accessedOn": "2026-10-28"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "About 4.8 metres comes from a well-studied fossil individual and does not mean that every Dakosaurus was the same size.",
      "Research has revised both its snout shape and the classification of some species. A short snout should not be claimed for every Dakosaurus.",
      "Complete soft tissues, skin colour and gentle display movements are reconstructed."
    ],
    "editedBy": "Codex source-based editorial draft",
    "reviewedBy": "Codex factual source check",
    "reviewedOn": "2026-10-28"
  },
  "narration": {
    "sentences": [
      "Dakosaurus was an ancient crocodile relative that lived in the sea and had four flippers.",
      "Follow its body to the tail and look for the fish-like fin at the end."
    ],
    "pronunciation": [
      {
        "text": "Dakosaurus",
        "reading": "DAK-oh-SAW-rus"
      }
    ]
  }
} as const satisfies AnimalContentEn
