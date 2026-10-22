import type { AnimalContentEn } from '../../types'

export const en = {
  "name": "Opabinia",
  "classificationLabel": "An early relative of arthropods",
  "visibleFeature": "Five eyes, a long snout and flaps along the sides.",
  "facts": {
    "period": "Cambrian, Wuliuan",
    "discoveryRegions": [
      "Burgess Shale, Canada"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 0.1,
      "maxMeters": 0.1
    },
    "diet": "unknown"
  },
  "parentClassificationNote": "Opabinia had five eyes and a pair of little claws at the end of a long snout. Including the snout, it could reach about ten centimetres long. The enlarged view helps you see these details.",
  "sources": [
    {
      "title": "Opabinia at the Royal Ontario Museum",
      "url": "https://burgess-shale.rom.on.ca/fossils/opabinia-regalis/",
      "accessedOn": "2026-10-22"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "Scientists think it may have used the claws on its snout to grasp food. Its exact movements must be inferred from fossils."
    ],
    "editedBy": "Codex local editorial revision",
    "reviewedBy": "Project factual and editorial source check",
    "reviewedOn": "2026-10-22"
  },
  "narration": {
    "sentences": [
      "Hold up five fingers for the five eyes on Opabinia’s head.",
      "Then follow its long snout to the pair of tiny claws at the tip."
    ],
    "pronunciation": [
      {
        "text": "Opabinia",
        "reading": "oh-pa-BIN-ee-uh"
      }
    ]
  }
} as const satisfies AnimalContentEn
