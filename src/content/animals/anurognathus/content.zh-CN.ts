import type { AnimalContentZhCN } from '../../types'

export const zhCN = {
  "name": "蛙嘴翼龙",
  "classificationLabel": "小型翼龙类飞行爬行动物",
  "visibleFeature": "看看它宽宽的小脸和展开的皮膜翅膀。",
  "narration": {
    "sentences": [
      "这是蛙嘴翼龙，一种生活在晚侏罗世的小型飞行爬行动物。",
      "看看它宽宽的小脸和展开的皮膜翅膀。"
    ],
    "pronunciation": [
      {
        "text": "蛙嘴翼龙",
        "reading": "wā zuǐ yì lóng"
      },
      {
        "text": "侏罗世",
        "reading": "zhū luó shì"
      },
      {
        "text": "皮膜翅膀",
        "reading": "pí mó chì bǎng"
      }
    ]
  },
  "facts": {
    "period": "晚侏罗世（约 1.5 亿年前）",
    "discoveryRegions": [
      "欧洲（德国南部）"
    ],
    "size": {
      "kind": "wingspan",
      "minMeters": 0.35,
      "maxMeters": 0.35
    },
    "diet": "carnivore"
  },
  "parentClassificationNote": "蛙嘴翼龙是生活在晚侏罗世的小型飞行爬行动物，化石发现于德国南部。它的头部短而宽，眼眶很大，尾巴很短。科学家认为它可能在飞行中捕捉昆虫。",
  "sources": [
    {
      "title": "A second specimen of the pterosaur Anurognathus ammoni",
      "url": "https://doi.org/10.1007/BF02990250",
      "accessedOn": "2026-10-28"
    },
    {
      "title": "A new approach to determining pterosaur body mass and its implications for pterosaur flight",
      "url": "https://epub.ub.uni-muenchen.de/12010/1/zitteliana_2008_b28_08.pdf",
      "accessedOn": "2026-10-28"
    },
    {
      "title": "Evolutionary pressures of aerial insectivory reflected in anurognathid pterosaurs",
      "url": "https://doi.org/10.1111/joa.13814",
      "accessedOn": "2026-10-28"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "约 35 厘米是 Witton 2008 研究中 0.352 米复原翼展的取整参考值，不表示已知最小值与最大值相同。",
      "捕食昆虫有比较形态研究支持；具体食物和低光照活动方式仍属于研究解释。",
      "体色、翼膜花纹和具体飞行动作不能从上述化石研究中直接确定。"
    ],
    "editedBy": "Codex-assisted primary-source drafting",
    "reviewedBy": "Codex primary-source cross-check",
    "reviewedOn": "2026-10-28"
  }
} as const satisfies AnimalContentZhCN
