import type { AnimalContentZhCN } from '../../types'

export const zhCN = {
  "name": "帝王角龙",
  "classificationLabel": "角龙科恐龙",
  "visibleFeature": "鼻子上的大角、眼睛上方的小角和像王冠的颈盾。",
  "facts": {
    "period": "晚白垩世",
    "discoveryRegions": [
      "加拿大 · 艾伯塔省"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 4,
      "maxMeters": 5
    },
    "diet": "herbivore"
  },
  "parentClassificationNote": "帝王角龙是用四条腿行走的植食恐龙，头后颈盾的边缘长着醒目的骨质突起。",
  "sources": [
    {
      "title": "帝王角龙的原始描述与角饰研究",
      "url": "https://nhmu.utah.edu/sites/default/files/trail-resource/New%20Horned%20Dinosaur%20.pdf",
      "accessedOn": "2026-10-28"
    },
    {
      "title": "帝王角龙研究作者的发现与体型估计访谈",
      "url": "https://www.rcinet.ca/en/2015/06/05/spectacular-dinosaur-skull-reveals-new-species/",
      "accessedOn": "2026-10-28"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "已知化石主要是近乎完整的头骨，四至五米的体长来自复原估计。",
      "角外面的角质层、身体颜色和皮肤细节不能由这件头骨直接确定。"
    ],
    "editedBy": "Museum content preparation",
    "reviewedBy": "Primary-source evidence check",
    "reviewedOn": "2026-10-28"
  },
  "narration": {
    "sentences": [
      "帝王角龙头后的大颈盾，边缘一片片凸起，像一顶王冠。",
      "再看看它的鼻子和眼睛上方，哪边的角更长？"
    ],
    "pronunciation": [
      {
        "text": "帝王角龙",
        "reading": "dì wáng jiǎo lóng"
      },
      {
        "text": "颈盾",
        "reading": "jǐng dùn"
      },
      {
        "text": "长着",
        "reading": "zhǎng zhe"
      }
    ]
  }
} as const satisfies AnimalContentZhCN
