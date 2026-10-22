import type { AnimalContentZhCN } from '../../types'

export const zhCN = {
  "name": "剑射鱼",
  "classificationLabel": "古代辐鳍鱼类",
  "visibleFeature": "大嘴里长着大牙齿，腹部下方有小小的鱼鳍。",
  "facts": {
    "period": "晚白垩世",
    "discoveryRegions": [
      "北美洲西部内陆海道"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 5.5,
      "maxMeters": 5.5
    },
    "diet": "carnivore"
  },
  "parentClassificationNote": "剑射鱼生活在古代海洋里，大嘴里长着大牙齿，是一种肉食鱼。",
  "sources": [
    {
      "title": "北达科他州地质调查局的剑射鱼介绍",
      "url": "https://www.dmr.nd.gov/dmr/sites/www/files/documents/paleontology/pdfs/prehistoric-life-map/Xiphactinus.pdf",
      "accessedOn": "2026-10-22"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "不同个体大小不一，较大的剑射鱼能超过五米长。"
    ],
    "editedBy": "Codex local editorial revision",
    "reviewedBy": "Project factual and editorial source check",
    "reviewedOn": "2026-10-22"
  },
  "narration": {
    "sentences": [
      "剑射鱼生活在古代海洋里，嘴巴里有很大的牙齿。",
      "有的从头到尾超过五米，这样的大鱼装得进小小的鱼缸吗？"
    ],
    "pronunciation": [
      {
        "text": "剑射鱼",
        "reading": "jiàn shè yú"
      },
      {
        "text": "五米长",
        "reading": "wǔ mǐ cháng"
      }
    ]
  }
} as const satisfies AnimalContentZhCN
