import type { AnimalContentZhCN } from '../../types'

export const zhCN = {
  "name": "异特龙",
  "classificationLabel": "兽脚类恐龙 · 异特龙科",
  "visibleFeature": "眼睛上方有小突起，前肢各有三根带爪的手指。",
  "facts": {
    "period": "晚侏罗世",
    "discoveryRegions": [
      "北美洲"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 9.7,
      "maxMeters": 9.7
    },
    "diet": "carnivore"
  },
  "parentClassificationNote": "异特龙生活在晚侏罗世，是一种用两条后腿行走的肉食恐龙。",
  "sources": [
    {
      "title": "伦敦自然历史博物馆的异特龙介绍",
      "url": "https://www.nhm.ac.uk/discover/dino-directory/allosaurus.html",
      "accessedOn": "2026-10-22"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "眼睛上方的小突起有什么作用，科学家还没有一致答案。"
    ],
    "editedBy": "Codex local editorial revision",
    "reviewedBy": "Project factual and editorial source check",
    "reviewedOn": "2026-10-22"
  },
  "narration": {
    "sentences": [
      "异特龙的两只小手，每只都有三根带爪的手指。",
      "张开你的小手和它比一比，再找找它眼睛上方的小突起。"
    ],
    "pronunciation": [
      {
        "text": "异特龙",
        "reading": "yì tè lóng"
      },
      {
        "text": "两只",
        "reading": "liǎng zhī"
      },
      {
        "text": "每只",
        "reading": "měi zhī"
      },
      {
        "text": "带爪",
        "reading": "dài zhǎo"
      }
    ]
  }
} as const satisfies AnimalContentZhCN
