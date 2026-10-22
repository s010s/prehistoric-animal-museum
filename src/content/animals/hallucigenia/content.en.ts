import type { AnimalContentEn } from '../../types'

export const en = {
  "name": "Hallucigenia",
  "classificationLabel": "Lobopodian",
  "visibleFeature": "Paired spines along the back and rows of little legs underneath.",
  "facts": {
    "period": "Cambrian",
    "discoveryRegions": [
      "Burgess Shale, Canada"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 0.03,
      "maxMeters": 0.03
    },
    "diet": "unknown"
  },
  "parentClassificationNote": "Hallucigenia lived in Cambrian seas and was only a few centimetres long. The enlarged view makes its spines and little legs easier to see.",
  "sources": [
    {
      "title": "Hallucigenia at the Royal Ontario Museum",
      "url": "https://burgess-shale.rom.on.ca/fossils/hallucigenia-sparsa/",
      "accessedOn": "2026-10-22"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "Some details of how it fed and used its little legs are still being studied."
    ],
    "editedBy": "Codex local editorial revision",
    "reviewedBy": "Project factual and editorial source check",
    "reviewedOn": "2026-10-22"
  },
  "narration": {
    "sentences": [
      "Open your hand and imagine Hallucigenia, only a few centimetres long.",
      "It had pairs of spines on its back, with rows of little legs underneath."
    ],
    "pronunciation": [
      {
        "text": "Hallucigenia",
        "reading": "ha-loo-sih-JEE-nee-uh"
      }
    ]
  }
} as const satisfies AnimalContentEn
