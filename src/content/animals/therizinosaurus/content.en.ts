import type { AnimalContentEn } from '../../types'

export const en = {
  "name": "Therizinosaurus",
  "classificationLabel": "Therizinosaurid dinosaur",
  "visibleFeature": "Long, slender claws on both hands.",
  "facts": {
    "period": "Late Cretaceous",
    "discoveryRegions": [
      "Mongolia"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 10,
      "maxMeters": 10
    },
    "diet": "herbivore"
  },
  "parentClassificationNote": "Therizinosaurus was a plant-eating theropod dinosaur that walked on two legs. Its long hand claws are easy to recognise.",
  "sources": [
    {
      "title": "Therizinosaurus at the Natural History Museum",
      "url": "https://www.nhm.ac.uk/discover/dino-directory/therizinosaurus.html",
      "accessedOn": "2026-10-28"
    },
    {
      "title": "Functional analyses of theropod hand claws",
      "url": "https://www.nature.com/articles/s42003-023-04552-4",
      "accessedOn": "2026-10-28"
    },
    {
      "title": "Stratigraphy and palaeoenvironments of the Nemegt Basin",
      "url": "https://doi.org/10.1016/j.palaeo.2017.11.018",
      "accessedOn": "2026-10-28"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "Its fossil remains are incomplete. The estimated ten-metre length and complete body shape rely partly on its relatives.",
      "Scientists still debate how it used its claws. Branch pulling, defence and display remain ideas to be tested.",
      "The feather arrangement, colours and gentle display movements include artistic reconstruction."
    ],
    "editedBy": "Museum content preparation",
    "reviewedBy": "Primary-source evidence check",
    "reviewedOn": "2026-10-28"
  },
  "narration": {
    "sentences": [
      "Therizinosaurus had long, slender claws on its hands.",
      "Turn it to the side and follow each claw all the way to the tip."
    ],
    "pronunciation": [
      {
        "text": "Therizinosaurus",
        "reading": "theh-riz-in-oh-SORE-us"
      }
    ]
  }
} as const satisfies AnimalContentEn
