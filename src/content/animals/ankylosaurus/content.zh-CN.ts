import type { AnimalContentZhCN } from '../../types'

export const zhCN = {
  "name": "甲龙",
  "classificationLabel": "甲龙类恐龙",
  "visibleFeature": "背上覆盖骨甲，尾巴末端长着圆钝的尾槌。",
  "facts": {
    "period": "晚白垩世",
    "discoveryRegions": [
      "北美洲"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 8.0,
      "maxMeters": 8.0
    },
    "diet": "herbivore"
  },
  "parentClassificationNote": "甲龙以植物为食，背上的骨甲和尾巴末端的尾槌很容易辨认。",
  "sources": [
    {
      "title": "伦敦自然历史博物馆的甲龙介绍",
      "url": "https://www.nhm.ac.uk/discover/dino-directory/ankylosaurus.html",
      "accessedOn": "2026-10-22"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "科学家还没有找到完整的甲龙骨架，背上的骨甲具体怎样排列仍在研究。"
    ],
    "editedBy": "Codex local editorial revision",
    "reviewedBy": "Project factual and editorial source check",
    "reviewedOn": "2026-10-22"
  },
  "narration": {
    "sentences": [
      "甲龙背上的骨质甲片，像一件结实的小盔甲。",
      "从背上顺着尾巴往后找，末端还有一个圆钝的尾槌。"
    ],
    "pronunciation": [
      {
        "text": "甲龙",
        "reading": "jiǎ lóng"
      },
      {
        "text": "背上",
        "reading": "bèi shang"
      },
      {
        "text": "尾槌",
        "reading": "wěi chuí"
      }
    ]
  }
} as const satisfies AnimalContentZhCN
