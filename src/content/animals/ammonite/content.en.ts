import type { AnimalContentEn } from '../../types'

export const en = {
  "name": "Ammonites",
  "classificationLabel": "Ammonoid cephalopods",
  "visibleFeature": "A spiral shell with soft arms extending from its opening.",
  "facts": {
    "period": "Palaeozoic and Mesozoic eras",
    "discoveryRegions": [
      "many parts of the world"
    ],
    "size": {
      "kind": "unknown",
      "note": "Size varies widely between species"
    },
    "diet": "unknown"
  },
  "parentClassificationNote": "Ammonites were a large group of extinct sea animals with soft bodies inside hard shells. Many shells curled into spirals, with a wide variety of sizes and shapes.",
  "sources": [
    {
      "title": "Ammonites at the Natural History Museum",
      "url": "https://www.nhm.ac.uk/discover/what-is-an-ammonite.html",
      "accessedOn": "2026-10-22"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "Shells often survive as fossils, while soft parts such as the arms rarely leave traces. Much of their appearance remains uncertain."
    ],
    "editedBy": "Codex local editorial revision",
    "reviewedBy": "Project factual and editorial source check",
    "reviewedOn": "2026-10-22"
  },
  "narration": {
    "sentences": [
      "This ammonite has a shell curled into a spiral, with a soft body inside.",
      "Follow the curling path with your eyes, slowly, all the way to the very middle."
    ],
    "pronunciation": [
      {
        "text": "ammonite",
        "reading": "AM-uh-nyte"
      }
    ]
  }
} as const satisfies AnimalContentEn
