import type { AnimalContentEn } from '../../types'

export const en = {
  "name": "Styxosaurus",
  "classificationLabel": "Marine reptile; plesiosaur",
  "visibleFeature": "A long neck, a small head and four flippers.",
  "facts": {
    "period": "Late Cretaceous",
    "discoveryRegions": [
      "Western Interior Seaway, North America"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 10.7,
      "maxMeters": 10.7
    },
    "diet": "carnivore"
  },
  "parentClassificationNote": "Styxosaurus was a marine reptile in the plesiosaur group. A long neck led to its small head, and four flippers grew along its sides.",
  "sources": [
    {
      "title": "Styxosaurus at the Museum of Geology",
      "url": "https://mogcollections.wordpress.com/2015/02/20/sdsm-451/",
      "accessedOn": "2026-10-22"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "Its full body length and the shape of its tail tip have to be reconstructed from the surviving fossils."
    ],
    "editedBy": "Codex local editorial revision",
    "reviewedBy": "Project factual and editorial source check",
    "reviewedOn": "2026-10-22"
  },
  "narration": {
    "sentences": [
      "Find Styxosaurus’s small head, then follow its long neck with your eyes all the way to its body.",
      "Four flippers sit along its sides, like four little paddles for moving through the water."
    ],
    "pronunciation": [
      {
        "text": "Styxosaurus",
        "reading": "stik-suh-SAW-rus"
      }
    ]
  }
} as const satisfies AnimalContentEn
