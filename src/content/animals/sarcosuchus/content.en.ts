import type { AnimalContentEn } from '../../types'

export const en = {
  "name": "Sarcosuchus",
  "classificationLabel": "Extinct crocodyliform reptile",
  "visibleFeature": "A long snout, an expanded nose tip and rows of bony armour along the back.",
  "facts": {
    "period": "Early Cretaceous",
    "discoveryRegions": [
      "Niger, Africa"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 9,
      "maxMeters": 9
    },
    "diet": "carnivore"
  },
  "parentClassificationNote": "Sarcosuchus was an extinct crocodyliform reptile. The well-studied species Sarcosuchus imperator lived in river environments during the Early Cretaceous.",
  "sources": [
    {
      "title": "The giant crocodyliform Sarcosuchus from the Cretaceous of Africa",
      "url": "https://d3qi0qp55mx5f5.cloudfront.net/paulsereno/i/docs/01-SCI-Sarcosuchus.pdf?mtime=1591816479",
      "accessedOn": "2026-10-28"
    },
    {
      "title": "Crocodylian head width allometry and phylogenetic prediction of body size in extinct crocodyliforms",
      "url": "https://doi.org/10.1093/iob/obz006",
      "accessedOn": "2026-10-28"
    },
    {
      "title": "Systematic revision of Sarcosuchus hartti and Sarcosuchus palaeoecology",
      "url": "https://zenodo.org/records/5719180",
      "accessedOn": "2026-10-28"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "The approximate nine-metre body length rounds one estimate from a skull-width study. Earlier research produced larger estimates, and its full length remains uncertain.",
      "Skin colour, complete soft tissues and gentle display movements are artistic reconstructions."
    ],
    "editedBy": "Codex source-based editorial draft",
    "reviewedBy": "Codex factual source check",
    "reviewedOn": "2026-10-28"
  },
  "narration": {
    "sentences": [
      "Sarcosuchus lived around Cretaceous rivers and had many teeth inside its long jaws.",
      "Follow its back towards the tail and look for the rows of hard, bony armour."
    ],
    "pronunciation": [
      {
        "text": "Sarcosuchus",
        "reading": "sar-koh-SOO-kus"
      }
    ]
  }
} as const satisfies AnimalContentEn
