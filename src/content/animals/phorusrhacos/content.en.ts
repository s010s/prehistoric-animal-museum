import type { AnimalContentEn } from '../../types'

export const en = {
  "name": "Phorusrhacos",
  "classificationLabel": "Phorusrhacid bird",
  "visibleFeature": "Long legs and a large beak with a downward hook.",
  "facts": {
    "period": "Miocene",
    "discoveryRegions": [
      "Patagonia, Argentina"
    ],
    "size": {
      "kind": "standing-height",
      "minMeters": 2.4,
      "maxMeters": 2.4
    },
    "diet": "carnivore"
  },
  "parentClassificationNote": "Phorusrhacos longissimus was a large flightless bird from South America and a member of the terror bird family, Phorusrhacidae.",
  "sources": [
    {
      "title": "New skull remains of Phorusrhacos longissimus",
      "url": "https://doi.org/10.1017/jpa.2019.53",
      "accessedOn": "2026-10-28"
    },
    {
      "title": "Systematic revision and skeletal reconstructions of the Phorusrhacidae",
      "url": "https://revistas.usp.br/paz/article/view/33623",
      "accessedOn": "2026-10-28"
    },
    {
      "title": "The evolution and ecology of gigantism in terror birds",
      "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC11040249/",
      "accessedOn": "2026-10-28"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "Its full skeleton still requires reconstruction. The estimate of about 2.4 metres to the raised head depends on the reconstructed posture.",
      "Its precise hunting methods and running speed remain uncertain and cannot be read directly from its outline.",
      "The feather colours and gentle display movements include artistic reconstruction."
    ],
    "editedBy": "Museum content preparation",
    "reviewedBy": "Primary-source evidence check",
    "reviewedOn": "2026-10-28"
  },
  "narration": {
    "sentences": [
      "Phorusrhacos had long legs and a large beak with a hooked tip.",
      "Turn it to the side and see which way that hook curves."
    ],
    "pronunciation": [
      {
        "text": "Phorusrhacos",
        "reading": "for-us-RAH-koss"
      }
    ]
  }
} as const satisfies AnimalContentEn
