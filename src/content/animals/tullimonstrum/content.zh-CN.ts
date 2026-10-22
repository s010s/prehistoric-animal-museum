import type { AnimalContentZhCN } from '../../types'

export const zhCN = {
  "name": "塔利怪物",
  "classificationLabel": "分类仍有争议的水生动物",
  "visibleFeature": "细长的吻部伸在前面，眼睛长在身体两侧的柄上。",
  "facts": {
    "period": "石炭纪",
    "discoveryRegions": [
      "美国伊利诺伊州"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 0.3,
      "maxMeters": 0.3
    },
    "diet": "unknown"
  },
  "parentClassificationNote": "这种生活在古代海洋里的小动物，眼睛长在身体两侧的柄上，前面伸出细长的吻部。",
  "sources": [
    {
      "title": "菲尔德博物馆的塔利怪物研究",
      "url": "https://www.fieldmuseum.org/about/press/monster-mystery-solved-field-museum-scientists-help-solve-fifty-year-puzzle-about",
      "accessedOn": "2026-10-22"
    },
    {
      "title": "东京大学关于塔利怪物分类的研究",
      "url": "https://www.k.u-tokyo.ac.jp/information/category/press/10168.html",
      "accessedOn": "2026-10-22"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "它究竟属于哪一类动物，科学家至今还在讨论。"
    ],
    "editedBy": "Codex local editorial revision",
    "reviewedBy": "Project factual and editorial source check",
    "reviewedOn": "2026-10-22"
  },
  "narration": {
    "sentences": [
      "塔利怪物的两只眼睛伸向身体两边，像一根小横杆的两头。",
      "你能在眼睛前面，找到那条细长的吻部吗？"
    ],
    "pronunciation": [
      {
        "text": "塔利怪物",
        "reading": "tǎ lì guài wù"
      },
      {
        "text": "细长",
        "reading": "xì cháng"
      },
      {
        "text": "两只",
        "reading": "liǎng zhī"
      }
    ]
  }
} as const satisfies AnimalContentZhCN
