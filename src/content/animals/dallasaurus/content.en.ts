import type { AnimalContentEn } from '../../types'

export const en = {
  "name": "Dallasaurus",
  "classificationLabel": "Early mosasaur reptile",
  "visibleFeature": "Four small legs with toes, a slender body and a long tail.",
  "facts": {
    "period": "Late Cretaceous",
    "discoveryRegions": [
      "Texas, USA, North America"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 1,
      "maxMeters": 1
    },
    "diet": "carnivore"
  },
  "parentClassificationNote": "Dallasaurus was an early mosasaur that lived near the coast during the Late Cretaceous. Its limbs retained toes, and their bones support the interpretation that it could still move on land.",
  "sources": [
    {
      "title": "Dallasaurus turneri, a new primitive mosasauroid from the Middle Turonian of Texas",
      "url": "https://www.cambridge.org/core/journals/netherlands-journal-of-geosciences/article/dallasaurus-turneri-a-new-primitive-mosasauroid-from-the-middle-turonian-of-texas-and-comments-on-the-phylogeny-of-mosasauridae-squamata/0E2626EAA92DEE96EE456671323F3268",
      "accessedOn": "2026-10-28"
    },
    {
      "title": "The evolution of mosasaurid foraging behavior through the lens of stable carbon isotopes",
      "url": "https://repository.naturalis.nl/pub/801158/Polcyn-2025-The-evolution-of-Mosasaurid-foraging-A.pdf",
      "accessedOn": "2026-10-28"
    },
    {
      "title": "Mosasaurine limb-bone anatomy and aquatic adaptation",
      "url": "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0076741",
      "accessedOn": "2026-10-28"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "About one metre is an estimate of its body length, rather than its standing height.",
      "Its fossils show limbs that could still be used on land. Its exact swimming style, skin colour and display movements are reconstructed."
    ],
    "editedBy": "Codex source-based editorial draft",
    "reviewedBy": "Codex factual source check",
    "reviewedOn": "2026-10-28"
  },
  "narration": {
    "sentences": [
      "Dallasaurus was a small early mosasaur, about one metre from head to tail.",
      "Look for its four little legs and toes, then follow the long tail behind."
    ],
    "pronunciation": [
      {
        "text": "Dallasaurus",
        "reading": "DAL-uh-SAW-rus"
      }
    ]
  }
} as const satisfies AnimalContentEn
