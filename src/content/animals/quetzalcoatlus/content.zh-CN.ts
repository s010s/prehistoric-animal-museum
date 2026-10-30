import type { AnimalContentZhCN } from '../../types'

export const zhCN = {
  "name": "风神翼龙",
  "classificationLabel": "长颈的无齿翼龙类",
  "visibleFeature": "看看它长长的脖子和展开的大翅膀。",
  "narration": {
    "sentences": [
      "这是风神翼龙，一种生活在晚白垩世的飞行爬行动物。",
      "看看它长长的脖子和展开的大翅膀。"
    ],
    "pronunciation": [
      {
        "text": "风神翼龙",
        "reading": "fēng shén yì lóng"
      },
      {
        "text": "白垩世",
        "reading": "bái è shì"
      }
    ]
  },
  "facts": {
    "period": "晚白垩世",
    "discoveryRegions": [
      "北美洲（美国得克萨斯州）"
    ],
    "size": {
      "kind": "wingspan",
      "minMeters": 4.5,
      "maxMeters": 10
    },
    "diet": "carnivore"
  },
  "parentClassificationNote": "风神翼龙是生活在晚白垩世的飞行爬行动物，化石发现于美国得克萨斯州。它有长长的脖子和没有牙齿的长嘴。科学家估计，大型成员的翼展约为 10 米。",
  "sources": [
    {
      "title": "Morphology and taxonomy of Quetzalcoatlus Lawson 1975",
      "url": "https://doi.org/10.1080/02724634.2021.1907587",
      "accessedOn": "2026-10-28"
    },
    {
      "title": "Habitat of the giant pterosaur Quetzalcoatlus and the Javelina Formation",
      "url": "https://doi.org/10.1080/02724634.2019.1593184",
      "accessedOn": "2026-10-28"
    },
    {
      "title": "World’s Largest Pterosaur Leaped Aloft to Fly | University of Texas at Austin",
      "url": "https://www.jsg.utexas.edu/news/2021/12/worlds-largest-pterosaur-leaped-aloft-to-fly/",
      "accessedOn": "2026-10-28"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "4.5 米和 10 米分别是 2021 年研究中小型成员与大型 Q. northropi 的估算翼展，不是模型个体的实测尺寸，也不是完整生长范围。",
      "比一比使用大型成员约 10 米的参考翼展；展项名称保留为风神翼龙，不根据模型外观指定种、性别或年龄。",
      "大型成员的化石不完整，头部外形、体色及具体飞行动作仍含复原成分。",
      "肉食在这里概括取食小动物的研究解释，不能据此指定猎物或捕食方法。"
    ],
    "editedBy": "Codex-assisted primary-source drafting",
    "reviewedBy": "Codex primary-source cross-check",
    "reviewedOn": "2026-10-28"
  }
} as const satisfies AnimalContentZhCN
