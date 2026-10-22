import type { AnimalContentZhCN } from '../../types'

export const zhCN = {
  "name": "似鸡龙",
  "classificationLabel": "似鸟龙类恐龙",
  "visibleFeature": "长长的腿、小小的脑袋和没有牙齿的喙。",
  "facts": {
    "period": "晚白垩世",
    "discoveryRegions": [
      "蒙古"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 6.0,
      "maxMeters": 6.0
    },
    "diet": "unknown"
  },
  "parentClassificationNote": "似鸡龙有长长的腿和没有牙齿的喙，外形有些像今天的鸵鸟。",
  "sources": [
    {
      "title": "伦敦自然历史博物馆的似鸡龙介绍",
      "url": "https://www.nhm.ac.uk/discover/dino-directory/gallimimus.html",
      "accessedOn": "2026-10-22"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "它具体吃哪些食物，科学家还有不同看法。",
      "羽毛的分布和颜色还需要根据近亲和化石线索推测。"
    ],
    "editedBy": "Codex local editorial revision",
    "reviewedBy": "Project factual and editorial source check",
    "reviewedOn": "2026-10-22"
  },
  "narration": {
    "sentences": [
      "张开嘴巴笑一笑，你的牙齿露出来了吗？",
      "似鸡龙有长长的腿和像鸟一样的喙，嘴巴里面没有牙齿。"
    ],
    "pronunciation": [
      {
        "text": "似鸡龙",
        "reading": "sì jī lóng"
      },
      {
        "text": "喙",
        "reading": "huì"
      },
      {
        "text": "长长",
        "reading": "cháng cháng"
      }
    ]
  }
} as const satisfies AnimalContentZhCN
