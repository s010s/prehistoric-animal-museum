import type { AnimalContentZhCN } from '../../types'

export const zhCN = {
  "name": "欧巴宾虫",
  "classificationLabel": "早期节肢动物的近亲",
  "visibleFeature": "五只眼睛、细长的吻部和身体两侧的叶片。",
  "facts": {
    "period": "寒武纪 · 乌溜期",
    "discoveryRegions": [
      "加拿大 · 伯吉斯页岩海域"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 0.1,
      "maxMeters": 0.1
    },
    "diet": "unknown"
  },
  "parentClassificationNote": "欧巴宾虫长着五只眼睛，细长的吻部末端还有一对小爪。它连同吻部大约十厘米长，画面放大后更容易看清细节。",
  "sources": [
    {
      "title": "皇家安大略博物馆的欧巴宾虫介绍",
      "url": "https://burgess-shale.rom.on.ca/fossils/opabinia-regalis/",
      "accessedOn": "2026-10-22"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "科学家认为它可能用吻部的小爪抓取食物，具体动作要根据化石推测。"
    ],
    "editedBy": "Codex local editorial revision",
    "reviewedBy": "Project factual and editorial source check",
    "reviewedOn": "2026-10-22"
  },
  "narration": {
    "sentences": [
      "伸出五根手指，和欧巴宾虫头上的五只眼睛比一比。",
      "再沿着它细长的吻部往前找，最前端还有一对小爪子。"
    ],
    "pronunciation": [
      {
        "text": "欧巴宾虫",
        "reading": "ōu bā bīn chóng"
      },
      {
        "text": "细长",
        "reading": "xì cháng"
      },
      {
        "text": "五只",
        "reading": "wǔ zhī"
      },
      {
        "text": "爪子",
        "reading": "zhuǎ zi"
      }
    ]
  }
} as const satisfies AnimalContentZhCN
