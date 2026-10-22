import type { AnimalContentEn } from '../../types'

export const en = {
  "name": "Tully monster",
  "classificationLabel": "Aquatic animal; classification debated",
  "visibleFeature": "A long snout at the front and eyes on stalks to either side.",
  "facts": {
    "period": "Carboniferous",
    "discoveryRegions": [
      "Illinois, USA"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 0.3,
      "maxMeters": 0.3
    },
    "diet": "unknown"
  },
  "parentClassificationNote": "This small animal lived in ancient seas. Its eyes sat on stalks to either side, with a long snout reaching out in front.",
  "sources": [
    {
      "title": "Tully monster research at the Field Museum",
      "url": "https://www.fieldmuseum.org/about/press/monster-mystery-solved-field-museum-scientists-help-solve-fifty-year-puzzle-about",
      "accessedOn": "2026-10-22"
    },
    {
      "title": "University of Tokyo research on the Tully monster’s classification",
      "url": "https://www.k.u-tokyo.ac.jp/information/category/press/10168.html",
      "accessedOn": "2026-10-22"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "Scientists are still debating which group of animals it belonged to."
    ],
    "editedBy": "Codex local editorial revision",
    "reviewedBy": "Project factual and editorial source check",
    "reviewedOn": "2026-10-22"
  },
  "narration": {
    "sentences": [
      "The Tully monster’s eyes stuck out to the sides, like the ends of a little bar.",
      "Can you find the long snout stretching out in front of them?"
    ],
    "pronunciation": [
      {
        "text": "Tully monster",
        "reading": "TULL-ee MON-ster"
      }
    ]
  }
} as const satisfies AnimalContentEn
