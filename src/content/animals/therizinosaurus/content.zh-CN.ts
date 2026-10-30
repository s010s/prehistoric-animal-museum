import type { AnimalContentZhCN } from '../../types'

export const zhCN = {
  "name": "镰刀龙",
  "classificationLabel": "镰刀龙科恐龙",
  "visibleFeature": "两只手上又细又长的爪子。",
  "facts": {
    "period": "晚白垩世",
    "discoveryRegions": [
      "蒙古"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 10,
      "maxMeters": 10
    },
    "diet": "herbivore"
  },
  "parentClassificationNote": "镰刀龙是用两条腿行走的植食兽脚类恐龙，手上的长爪很容易辨认。",
  "sources": [
    {
      "title": "伦敦自然历史博物馆的镰刀龙介绍",
      "url": "https://www.nhm.ac.uk/discover/dino-directory/therizinosaurus.html",
      "accessedOn": "2026-10-28"
    },
    {
      "title": "镰刀龙与其他兽脚类前爪的形态和功能研究",
      "url": "https://www.nature.com/articles/s42003-023-04552-4",
      "accessedOn": "2026-10-28"
    },
    {
      "title": "耐梅盖特盆地地层与古环境研究",
      "url": "https://doi.org/10.1016/j.palaeo.2017.11.018",
      "accessedOn": "2026-10-28"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "已发现的身体化石不完整，约十米的体长和完整体形需要借助近亲复原。",
      "长爪具体怎样使用仍有争论，拉取树枝、防御和展示等说法都需要检验。",
      "羽毛的分布、颜色和展示动作包含艺术复原。"
    ],
    "editedBy": "Museum content preparation",
    "reviewedBy": "Primary-source evidence check",
    "reviewedOn": "2026-10-28"
  },
  "narration": {
    "sentences": [
      "镰刀龙的两只手上，长着又细又长的爪子。",
      "把它转到侧面，看看这些爪子伸出去有多远。"
    ],
    "pronunciation": [
      {
        "text": "镰刀龙",
        "reading": "lián dāo lóng"
      },
      {
        "text": "爪子",
        "reading": "zhuǎ zi"
      },
      {
        "text": "长着",
        "reading": "zhǎng zhe"
      }
    ]
  }
} as const satisfies AnimalContentZhCN
