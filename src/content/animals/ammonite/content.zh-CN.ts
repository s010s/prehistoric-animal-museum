import type { AnimalContentZhCN } from '../../types'

export const zhCN = {
  "name": "菊石类",
  "classificationLabel": "菊石类头足动物",
  "visibleFeature": "卷成螺旋的外壳，壳口外伸出柔软的触腕。",
  "facts": {
    "period": "古生代至中生代",
    "discoveryRegions": [
      "世界多地"
    ],
    "size": {
      "kind": "unknown",
      "note": "不同种类大小差别很大"
    },
    "diet": "unknown"
  },
  "parentClassificationNote": "菊石是一大类已经灭绝的海洋动物，柔软的身体住在坚硬的外壳里。许多菊石的壳卷成螺旋，大小和形状各不相同。",
  "sources": [
    {
      "title": "伦敦自然历史博物馆的菊石介绍",
      "url": "https://www.nhm.ac.uk/discover/what-is-an-ammonite.html",
      "accessedOn": "2026-10-22"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "菊石的壳经常能保存成化石，触腕等柔软部分却很少留下痕迹，样子还有许多未知。"
    ],
    "editedBy": "Codex local editorial revision",
    "reviewedBy": "Project factual and editorial source check",
    "reviewedOn": "2026-10-22"
  },
  "narration": {
    "sentences": [
      "这只菊石有卷成螺旋的壳，壳里的身体很柔软。",
      "用眼睛沿着螺旋慢慢往里走，一直找到最里面的那一圈。"
    ],
    "pronunciation": [
      {
        "text": "菊石",
        "reading": "jú shí"
      },
      {
        "text": "卷成",
        "reading": "juǎn chéng"
      }
    ]
  }
} as const satisfies AnimalContentZhCN
