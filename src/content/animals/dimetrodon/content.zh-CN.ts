import type { AnimalContentZhCN } from '../../types'

export const zhCN = {
  "name": "异齿龙",
  "classificationLabel": "哺乳动物的古代近亲",
  "visibleFeature": "高高的背帆和伸向身后的长尾巴。",
  "facts": {
    "period": "早二叠世",
    "discoveryRegions": [
      "北美洲和欧洲"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 3.0,
      "maxMeters": 3.0
    },
    "diet": "carnivore"
  },
  "parentClassificationNote": "异齿龙生活在恐龙出现以前，与今天的哺乳动物有亲缘关系。高高的背帆是它醒目的特征。",
  "sources": [
    {
      "title": "柏林自然博物馆的异齿龙生长研究",
      "url": "https://www.museumfuernaturkunde.berlin/en/museum/services/press/press-release/default-2ee8144f207c78d023f635a60e5656ee/",
      "accessedOn": "2026-10-22"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "不同种类的异齿龙大小不一，背帆的作用也还在研究。"
    ],
    "editedBy": "Codex local editorial revision",
    "reviewedBy": "Project factual and editorial source check",
    "reviewedOn": "2026-10-22"
  },
  "narration": {
    "sentences": [
      "异齿龙背上的大帆高高竖起，像背着一座小山。",
      "它生活得比恐龙还早，和今天的哺乳动物有亲缘关系。"
    ],
    "pronunciation": [
      {
        "text": "异齿龙",
        "reading": "yì chǐ lóng"
      },
      {
        "text": "背上",
        "reading": "bèi shang"
      },
      {
        "text": "背着",
        "reading": "bēi zhe"
      }
    ]
  }
} as const satisfies AnimalContentZhCN
