import type { AnimalContentEn } from '../../types'

export const en = {
  "name": "Dimetrodon",
  "classificationLabel": "An ancient relative of mammals",
  "visibleFeature": "A tall sail along the back and a long tail behind.",
  "facts": {
    "period": "Early Permian",
    "discoveryRegions": [
      "North America and Europe"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 3.0,
      "maxMeters": 3.0
    },
    "diet": "carnivore"
  },
  "parentClassificationNote": "Dimetrodon lived before dinosaurs and was related to today’s mammals. Its tall back sail makes it easy to recognise.",
  "sources": [
    {
      "title": "Dimetrodon growth research at Museum für Naturkunde Berlin",
      "url": "https://www.museumfuernaturkunde.berlin/en/museum/services/press/press-release/default-2ee8144f207c78d023f635a60e5656ee/",
      "accessedOn": "2026-10-22"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "Different species varied in size. Scientists are still studying what the sail was used for."
    ],
    "editedBy": "Codex local editorial revision",
    "reviewedBy": "Project factual and editorial source check",
    "reviewedOn": "2026-10-22"
  },
  "narration": {
    "sentences": [
      "Dimetrodon’s tall sail rose above its back like a little hill.",
      "It lived before dinosaurs and was a distant relative of today’s mammals."
    ],
    "pronunciation": [
      {
        "text": "Dimetrodon",
        "reading": "dye-MET-ruh-don"
      }
    ]
  }
} as const satisfies AnimalContentEn
