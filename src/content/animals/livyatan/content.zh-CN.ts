import type { AnimalContentZhCN } from '../../types'

export const zhCN = {
  "name": "梅氏利维坦鲸",
  "classificationLabel": "古代齿鲸",
  "visibleFeature": "宽大的头部，上下颌都有大牙齿。",
  "facts": {
    "period": "中新世",
    "discoveryRegions": [
      "秘鲁 · 皮斯科盆地海域"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 13.5,
      "maxMeters": 13.5
    },
    "diet": "carnivore"
  },
  "parentClassificationNote": "梅氏利维坦鲸是已经灭绝的大型鲸类，宽大的头部里，上下颌都长着大牙齿。",
  "sources": [
    {
      "title": "梅氏利维坦鲸的发现与捕食研究",
      "url": "https://www.vliz.be/imisdocs/publications/212617.pdf",
      "accessedOn": "2026-10-22"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "科学家根据头骨等化石估计它的体长，完整身体的模样还不能确定。"
    ],
    "editedBy": "Codex local editorial revision",
    "reviewedBy": "Project factual and editorial source check",
    "reviewedOn": "2026-10-22"
  },
  "narration": {
    "sentences": [
      "梅氏利维坦鲸的嘴里，上面有大牙齿，下面也有大牙齿。",
      "把它转到侧面，顺着嘴边慢慢找，上下两排你都发现了吗？"
    ],
    "pronunciation": [
      {
        "text": "梅氏利维坦鲸",
        "reading": "méi shì lì wéi tǎn jīng"
      },
      {
        "text": "转到",
        "reading": "zhuǎn dào"
      }
    ]
  }
} as const satisfies AnimalContentZhCN
