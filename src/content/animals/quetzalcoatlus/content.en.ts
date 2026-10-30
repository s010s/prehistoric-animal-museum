import type { AnimalContentEn } from '../../types'

export const en = {
  "name": "Quetzalcoatlus",
  "classificationLabel": "Long-necked, toothless pterosaur",
  "visibleFeature": "Look at its long neck and its great outstretched wings.",
  "narration": {
    "sentences": [
      "This is Quetzalcoatlus, a flying reptile from the Late Cretaceous.",
      "Look at its long neck and its great outstretched wings."
    ],
    "pronunciation": [
      {
        "text": "Quetzalcoatlus",
        "reading": "ket-zel-KWAT-a-lus"
      }
    ]
  },
  "facts": {
    "period": "Late Cretaceous",
    "discoveryRegions": [
      "Texas, United States, North America"
    ],
    "size": {
      "kind": "wingspan",
      "minMeters": 4.5,
      "maxMeters": 10
    },
    "diet": "carnivore"
  },
  "parentClassificationNote": "Quetzalcoatlus was a flying reptile from the Late Cretaceous, known from fossils in Texas. It had a long neck and long, toothless jaws. Scientists estimate that giant members had wingspans of about 10 metres.",
  "sources": [
    {
      "title": "Morphology and taxonomy of Quetzalcoatlus Lawson 1975",
      "url": "https://doi.org/10.1080/02724634.2021.1907587",
      "accessedOn": "2026-10-28"
    },
    {
      "title": "Habitat of the giant pterosaur Quetzalcoatlus and the Javelina Formation",
      "url": "https://doi.org/10.1080/02724634.2019.1593184",
      "accessedOn": "2026-10-28"
    },
    {
      "title": "World’s Largest Pterosaur Leaped Aloft to Fly | University of Texas at Austin",
      "url": "https://www.jsg.utexas.edu/news/2021/12/worlds-largest-pterosaur-leaped-aloft-to-fly/",
      "accessedOn": "2026-10-28"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "The 4.5- and 10-metre values are the 2021 reconstructed wingspans of a smaller member and the giant Q. northropi; they are neither measurements of this model nor a complete growth range.",
      "The comparison uses the giant’s approximately 10-metre reference wingspan. The label stays at genus level, with no species, sex or age inferred from the model.",
      "The giant’s fossil remains are incomplete. Its head shape, colours and exact flight movements include reconstruction.",
      "Carnivore summarises a proposed diet of small animals; it does not identify particular prey or a feeding technique."
    ],
    "editedBy": "Codex-assisted primary-source drafting",
    "reviewedBy": "Codex primary-source cross-check",
    "reviewedOn": "2026-10-28"
  }
} as const satisfies AnimalContentEn
