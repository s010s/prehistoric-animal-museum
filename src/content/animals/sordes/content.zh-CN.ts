import type { AnimalContentZhCN } from '../../types'

export const zhCN = {
  "name": "索德斯翼龙",
  "classificationLabel": "小型长尾翼龙类飞行爬行动物",
  "visibleFeature": "长长的尾巴、毛一样的细丝，还有薄薄的皮膜翅膀。",
  "narration": {
    "sentences": [
      "这位长尾巴的小飞行家叫索德斯翼龙。",
      "它身上有毛一样的细丝，翅膀由薄薄的皮膜组成。"
    ],
    "pronunciation": [
      {
        "text": "索德斯翼龙",
        "reading": "suǒ dé sī yì lóng"
      },
      {
        "text": "皮膜",
        "reading": "pí mó"
      },
      {
        "text": "侏罗世",
        "reading": "zhū luó shì"
      }
    ]
  },
  "facts": {
    "period": "晚侏罗世",
    "discoveryRegions": [
      "亚洲（哈萨克斯坦卡拉套地区）"
    ],
    "size": {
      "kind": "wingspan",
      "minMeters": 0.6,
      "maxMeters": 0.6
    },
    "diet": "unknown"
  },
  "parentClassificationNote": "索德斯翼龙是晚侏罗世的一种小型翼龙，化石发现于今天哈萨克斯坦的卡拉套地区。它有长尾巴，化石还保留了毛样细丝和翼膜的痕迹。双翼展开约0.6米，是依据研究复原给出的近似参考；体表细丝可能有助于保温。",
  "sources": [
    {
      "title": "Sordes pilosus and the nature of the pterosaur flight apparatus",
      "url": "https://doi.org/10.1038/371062a0",
      "accessedOn": "2026-10-29"
    },
    {
      "title": "A new approach to determining pterosaur body mass and its implications for pterosaur flight",
      "url": "https://epub.ub.uni-muenchen.de/12010/1/zitteliana_2008_b28_08.pdf",
      "accessedOn": "2026-10-29"
    },
    {
      "title": "The extent of the pterosaur flight membrane",
      "url": "https://www.app.pan.pl/archive/published/app56/app20090145.pdf",
      "accessedOn": "2026-10-29"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "约0.6米取整自Witton 2008研究中的0.56米复原翼展，不表示每只索德斯翼龙都有相同大小。",
      "毛样细丝是对外观的描述；它们与翼膜内部的支撑纤维需要区分。",
      "体色、细丝的密度和具体飞行动作属于复原细节，化石尚不能完整确定这些活体特征。"
    ],
    "editedBy": "Codex-assisted primary-source drafting",
    "reviewedBy": "Codex primary-source cross-check",
    "reviewedOn": "2026-10-29"
  }
} as const satisfies AnimalContentZhCN
