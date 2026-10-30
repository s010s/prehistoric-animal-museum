import type { AnimalContentZhCN } from '../../types'

export const zhCN = {
  "name": "达拉斯蜥蜴",
  "classificationLabel": "早期沧龙类爬行动物",
  "visibleFeature": "带着脚趾的四条小腿，以及细长的身体和尾巴。",
  "facts": {
    "period": "晚白垩世",
    "discoveryRegions": [
      "北美洲 · 美国得克萨斯州"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 1,
      "maxMeters": 1
    },
    "diet": "carnivore"
  },
  "parentClassificationNote": "达拉斯蜥蜴属于沧龙类，生活在晚白垩世的近岸环境中。它的四肢保留了脚趾，骨骼支持它仍能在陆上活动的解释。",
  "sources": [
    {
      "title": "达拉斯蜥蜴的原始描述与四肢研究",
      "url": "https://www.cambridge.org/core/journals/netherlands-journal-of-geosciences/article/dallasaurus-turneri-a-new-primitive-mosasauroid-from-the-middle-turonian-of-texas-and-comments-on-the-phylogeny-of-mosasauridae-squamata/0E2626EAA92DEE96EE456671323F3268",
      "accessedOn": "2026-10-28"
    },
    {
      "title": "沧龙类取食环境、体型与食性研究",
      "url": "https://repository.naturalis.nl/pub/801158/Polcyn-2025-The-evolution-of-Mosasaurid-foraging-A.pdf",
      "accessedOn": "2026-10-28"
    },
    {
      "title": "沧龙类肢骨与水生适应研究",
      "url": "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0076741",
      "accessedOn": "2026-10-28"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "约一米是体长估计，不能用它表示站立高度。",
      "化石显示它保留了能在陆上活动的四肢；具体游泳方式、皮色和展示动作仍需复原。"
    ],
    "editedBy": "Codex source-based editorial draft",
    "reviewedBy": "Codex factual source check",
    "reviewedOn": "2026-10-28"
  },
  "narration": {
    "sentences": [
      "达拉斯蜥蜴是一种小型沧龙类动物，从头到尾大约一米长。",
      "看看它的四条小腿和脚趾，再顺着身体找到长长的尾巴。"
    ],
    "pronunciation": [
      {
        "text": "达拉斯蜥蜴",
        "reading": "dá lā sī xī yì"
      },
      {
        "text": "沧龙",
        "reading": "cāng lóng"
      },
      {
        "text": "脚趾",
        "reading": "jiǎo zhǐ"
      },
      {
        "text": "一米长",
        "reading": "yì mǐ cháng"
      }
    ]
  }
} as const satisfies AnimalContentZhCN
