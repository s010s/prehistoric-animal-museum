import type { AnimalContentEn } from '../../types'

export const en = {
  "name": "Livyatan",
  "classificationLabel": "Extinct toothed whale",
  "visibleFeature": "A broad head with large teeth in both jaws.",
  "facts": {
    "period": "Miocene",
    "discoveryRegions": [
      "Pisco Basin, Peru"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 13.5,
      "maxMeters": 13.5
    },
    "diet": "carnivore"
  },
  "parentClassificationNote": "Livyatan was a large extinct whale with a broad head and large teeth in both its upper and lower jaws.",
  "sources": [
    {
      "title": "Discovery of a giant predatory sperm whale",
      "url": "https://www.vliz.be/imisdocs/publications/212617.pdf",
      "accessedOn": "2026-10-22"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "Scientists estimate its body length from skull fossils and other clues. Its complete body shape is still uncertain."
    ],
    "editedBy": "Codex local editorial revision",
    "reviewedBy": "Project factual and editorial source check",
    "reviewedOn": "2026-10-22"
  },
  "narration": {
    "sentences": [
      "Livyatan had large teeth in both its upper and lower jaws.",
      "Turn it to the side and see if you can find both rows along the edge of its mouth."
    ],
    "pronunciation": [
      {
        "text": "Livyatan",
        "reading": "liv-YAH-tan"
      }
    ]
  }
} as const satisfies AnimalContentEn
