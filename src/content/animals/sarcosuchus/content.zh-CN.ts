import type { AnimalContentZhCN } from '../../types'

export const zhCN = {
  "name": "帝鳄",
  "classificationLabel": "古代鳄形类爬行动物",
  "visibleFeature": "长长的嘴、鼓起的鼻端，以及背上成排的骨甲。",
  "facts": {
    "period": "早白垩世",
    "discoveryRegions": [
      "非洲 · 尼日尔"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 9,
      "maxMeters": 9
    },
    "diet": "carnivore"
  },
  "parentClassificationNote": "帝鳄也称肌鳄，属于已经灭绝的鳄形类爬行动物。研究较多的帝王肌鳄生活在早白垩世的河流环境里。",
  "sources": [
    {
      "title": "帝鳄的骨骼、年代与河流环境研究",
      "url": "https://d3qi0qp55mx5f5.cloudfront.net/paulsereno/i/docs/01-SCI-Sarcosuchus.pdf?mtime=1591816479",
      "accessedOn": "2026-10-28"
    },
    {
      "title": "根据鳄类头宽估算灭绝动物的体型",
      "url": "https://doi.org/10.1093/iob/obz006",
      "accessedOn": "2026-10-28"
    },
    {
      "title": "肌鳄属的古生态研究",
      "url": "https://zenodo.org/records/5719180",
      "accessedOn": "2026-10-28"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "这里约九米的体长采用头骨宽度研究中的一项估计并取整。早期研究给出过更大的估计，完整体长仍有不确定性。",
      "皮肤颜色、完整软组织和温和的展示动作属于艺术复原。"
    ],
    "editedBy": "Codex source-based editorial draft",
    "reviewedBy": "Codex factual source check",
    "reviewedOn": "2026-10-28"
  },
  "narration": {
    "sentences": [
      "帝鳄生活在白垩纪的河流附近，长长的嘴巴里有许多牙齿。",
      "顺着它的背往后找，一块块硬硬的骨甲一直排到尾巴上。"
    ],
    "pronunciation": [
      {
        "text": "帝鳄",
        "reading": "dì è"
      },
      {
        "text": "骨甲",
        "reading": "gǔ jiǎ"
      },
      {
        "text": "长长的",
        "reading": "cháng cháng de"
      }
    ]
  }
} as const satisfies AnimalContentZhCN
