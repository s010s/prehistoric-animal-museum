import type { AnimalContentEn } from '../../types'

export const en = {
  "name": "Regaliceratops",
  "classificationLabel": "Ceratopsid dinosaur",
  "visibleFeature": "A large nose horn, small brow horns and a crown-like frill.",
  "facts": {
    "period": "Late Cretaceous",
    "discoveryRegions": [
      "Alberta, Canada"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 4,
      "maxMeters": 5
    },
    "diet": "herbivore"
  },
  "parentClassificationNote": "Regaliceratops was a plant-eating dinosaur that walked on four legs. Prominent bony points grew around the edge of its frill.",
  "sources": [
    {
      "title": "Original description and cranial ornamentation of Regaliceratops",
      "url": "https://nhmu.utah.edu/sites/default/files/trail-resource/New%20Horned%20Dinosaur%20.pdf",
      "accessedOn": "2026-10-28"
    },
    {
      "title": "An interview with the co-author about Regaliceratops and its estimated size",
      "url": "https://www.rcinet.ca/en/2015/06/05/spectacular-dinosaur-skull-reveals-new-species/",
      "accessedOn": "2026-10-28"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "The known fossil is mainly a nearly complete skull. Its estimated body length of four to five metres comes from reconstruction.",
      "The horn coverings, body colour and skin details cannot be established directly from this skull."
    ],
    "editedBy": "Museum content preparation",
    "reviewedBy": "Primary-source evidence check",
    "reviewedOn": "2026-10-28"
  },
  "narration": {
    "sentences": [
      "The frill behind Regaliceratops’s head has bony points around the edge, like a crown.",
      "Look at the horn on its nose, then the little horns above its eyes."
    ],
    "pronunciation": [
      {
        "text": "Regaliceratops",
        "reading": "reh-GAL-ih-SEH-ruh-tops"
      }
    ]
  }
} as const satisfies AnimalContentEn
