import type { AnimalContentZhCN } from '../../types'

export const zhCN = {
  "name": "怪诞虫",
  "classificationLabel": "叶足动物",
  "visibleFeature": "背上有成对的尖刺，身体下面有一排排小腿。",
  "facts": {
    "period": "寒武纪",
    "discoveryRegions": [
      "加拿大伯吉斯页岩"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 0.03,
      "maxMeters": 0.03
    },
    "diet": "unknown"
  },
  "parentClassificationNote": "怪诞虫生活在寒武纪的海洋里，只有几厘米长。画面放大后，更容易看清它的尖刺和小脚。",
  "sources": [
    {
      "title": "皇家安大略博物馆的怪诞虫介绍",
      "url": "https://burgess-shale.rom.on.ca/fossils/hallucigenia-sparsa/",
      "accessedOn": "2026-10-22"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "它怎样取食、怎样用小脚活动，还有一些细节需要研究。"
    ],
    "editedBy": "Codex local editorial revision",
    "reviewedBy": "Project factual and editorial source check",
    "reviewedOn": "2026-10-22"
  },
  "narration": {
    "sentences": [
      "摊开小手比一比，怪诞虫的身体只有几厘米长。",
      "它的背上有成对的尖刺，身体下面还排着一条条细腿。"
    ],
    "pronunciation": [
      {
        "text": "怪诞虫",
        "reading": "guài dàn chóng"
      },
      {
        "text": "厘米长",
        "reading": "lí mǐ cháng"
      },
      {
        "text": "背上",
        "reading": "bèi shang"
      },
      {
        "text": "只有",
        "reading": "zhǐ yǒu"
      }
    ]
  }
} as const satisfies AnimalContentZhCN
