import type { AnimalContentZhCN } from '../../types'

export const zhCN = {
  "name": "副栉龙",
  "classificationLabel": "鸭嘴龙类恐龙",
  "visibleFeature": "头冠从脑袋后面向后伸出，里面有弯曲的通道。",
  "facts": {
    "period": "晚白垩世",
    "discoveryRegions": [
      "北美洲"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 9.45,
      "maxMeters": 9.45
    },
    "diet": "herbivore"
  },
  "parentClassificationNote": "副栉龙以植物为食，向后伸出的头冠里有弯曲的通道。",
  "sources": [
    {
      "title": "伦敦自然历史博物馆的副栉龙介绍",
      "url": "https://www.nhm.ac.uk/discover/dino-directory/parasaurolophus.html",
      "accessedOn": "2026-10-22"
    },
    {
      "title": "副栉龙的生长与头冠研究",
      "url": "https://doi.org/10.7717/peerj.182",
      "accessedOn": "2026-10-22"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "头冠可能有发声或辨认同类等作用，科学家还在研究。"
    ],
    "editedBy": "Codex local editorial revision",
    "reviewedBy": "Project factual and editorial source check",
    "reviewedOn": "2026-10-22"
  },
  "narration": {
    "sentences": [
      "副栉龙的头冠，从头顶向后伸出。",
      "用手指跟着它的轮廓画一画，头冠里面还有弯弯曲曲的通道。"
    ],
    "pronunciation": [
      {
        "text": "副栉龙",
        "reading": "fù zhì lóng"
      },
      {
        "text": "头冠",
        "reading": "tóu guān"
      }
    ]
  }
} as const satisfies AnimalContentZhCN
