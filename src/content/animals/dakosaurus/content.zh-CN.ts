import type { AnimalContentZhCN } from '../../types'

export const zhCN = {
  "name": "达科龙",
  "classificationLabel": "海生鳄形类爬行动物",
  "visibleFeature": "四只鳍状肢，以及带着尾鳍的尾巴。",
  "facts": {
    "period": "晚侏罗世",
    "discoveryRegions": [
      "欧洲 · 德国"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 4.8,
      "maxMeters": 4.8
    },
    "diet": "carnivore"
  },
  "parentClassificationNote": "达科龙属于适应海洋生活的鳄形类，四肢和尾部都适合在水中移动。化石牙齿带有切割食物的边缘，说明它是肉食动物。",
  "sources": [
    {
      "title": "达科龙完整骨架与古生态研究",
      "url": "https://www.palaeo-electronica.org/content/2026/5775-dakosaurus-maximus-morphology-and-palaeoecology",
      "accessedOn": "2026-10-28"
    },
    {
      "title": "达科龙头颅与取食研究",
      "url": "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0044985",
      "accessedOn": "2026-10-28"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "约四点八米参考了一具研究较完整的达科龙化石，不代表每只个体都一样大。",
      "不同研究对达科龙的吻形和属内分类有过修订，不能把所有达科龙都说成短吻。",
      "完整软组织、皮肤颜色和温和的展示动作属于复原。"
    ],
    "editedBy": "Codex source-based editorial draft",
    "reviewedBy": "Codex factual source check",
    "reviewedOn": "2026-10-28"
  },
  "narration": {
    "sentences": [
      "达科龙是鳄鱼的古代亲戚，生活在海里，身体两边有四只鳍状肢。",
      "顺着身体找到尾巴，看看末端像鱼尾一样的尾鳍。"
    ],
    "pronunciation": [
      {
        "text": "达科龙",
        "reading": "dá kē lóng"
      },
      {
        "text": "鳍状肢",
        "reading": "qí zhuàng zhī"
      },
      {
        "text": "尾鳍",
        "reading": "wěi qí"
      }
    ]
  }
} as const satisfies AnimalContentZhCN
