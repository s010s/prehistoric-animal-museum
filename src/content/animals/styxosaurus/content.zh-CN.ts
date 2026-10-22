import type { AnimalContentZhCN } from '../../types'

export const zhCN = {
  "name": "冥河龙",
  "classificationLabel": "蛇颈龙类海生爬行动物",
  "visibleFeature": "细长的脖子、小脑袋和四只鳍状肢。",
  "facts": {
    "period": "晚白垩世",
    "discoveryRegions": [
      "北美西部内陆海"
    ],
    "size": {
      "kind": "body-length",
      "minMeters": 10.7,
      "maxMeters": 10.7
    },
    "diet": "carnivore"
  },
  "parentClassificationNote": "冥河龙属于蛇颈龙类，是生活在海里的爬行动物。长脖子连接着小脑袋，身体两侧长着四个鳍状肢。",
  "sources": [
    {
      "title": "南达科他地质博物馆的冥河龙化石",
      "url": "https://mogcollections.wordpress.com/2015/02/20/sdsm-451/",
      "accessedOn": "2026-10-22"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "身体有多长、尾巴末端是什么样，需要结合保存下来的化石来复原。"
    ],
    "editedBy": "Codex local editorial revision",
    "reviewedBy": "Project factual and editorial source check",
    "reviewedOn": "2026-10-22"
  },
  "narration": {
    "sentences": [
      "先找找冥河龙的小脑袋，再用眼睛顺着长脖子一直找到身体。",
      "身体两侧还有四只鳍状肢，像四把划水的小桨。"
    ],
    "pronunciation": [
      {
        "text": "冥河龙",
        "reading": "míng hé lóng"
      },
      {
        "text": "鳍状肢",
        "reading": "qí zhuàng zhī"
      },
      {
        "text": "长脖子",
        "reading": "cháng bó zi"
      },
      {
        "text": "四只",
        "reading": "sì zhī"
      },
      {
        "text": "划水",
        "reading": "huá shuǐ"
      },
      {
        "text": "小桨",
        "reading": "xiǎo jiǎng"
      }
    ]
  }
} as const satisfies AnimalContentZhCN
