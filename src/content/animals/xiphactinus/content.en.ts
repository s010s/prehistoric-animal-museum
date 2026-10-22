import type { AnimalContentEn } from '../../types'

export const en = {
  "name": "Xiphactinus",
  "classificationLabel": "Ray-finned fish",
  "visibleFeature": "Large teeth inside a big mouth, with small fins beneath the body.",
  "facts": {
    "period": "Late Cretaceous",
    "discoveryRegions": [
      "Western Interior Seaway, North America"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 5.5,
      "maxMeters": 5.5
    },
    "diet": "carnivore"
  },
  "parentClassificationNote": "Xiphactinus was a meat-eating fish from ancient seas, with large teeth inside a big mouth.",
  "sources": [
    {
      "title": "Xiphactinus at the North Dakota Geological Survey",
      "url": "https://www.dmr.nd.gov/dmr/sites/www/files/documents/paleontology/pdfs/prehistoric-life-map/Xiphactinus.pdf",
      "accessedOn": "2026-10-22"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "Individuals varied in size, and some large Xiphactinus grew to more than five metres long."
    ],
    "editedBy": "Codex local editorial revision",
    "reviewedBy": "Project factual and editorial source check",
    "reviewedOn": "2026-10-22"
  },
  "narration": {
    "sentences": [
      "Xiphactinus had large teeth, and some individuals were over five metres long.",
      "Could a fish that big fit inside a tiny fish tank?"
    ],
    "pronunciation": [
      {
        "text": "Xiphactinus",
        "reading": "zy-FAK-tih-nus"
      }
    ]
  }
} as const satisfies AnimalContentEn
