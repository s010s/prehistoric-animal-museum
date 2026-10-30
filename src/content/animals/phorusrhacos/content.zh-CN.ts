import type { AnimalContentZhCN } from '../../types'

export const zhCN = {
  "name": "骇鸟",
  "classificationLabel": "骇鸟科鸟类",
  "visibleFeature": "长长的双腿和尖端向下弯的大喙。",
  "facts": {
    "period": "中新世",
    "discoveryRegions": [
      "阿根廷 · 巴塔哥尼亚"
    ],
    "size": {
      "kind": "standing-height",
      "minMeters": 2.4,
      "maxMeters": 2.4
    },
    "diet": "carnivore"
  },
  "parentClassificationNote": "这里的骇鸟指 Phorusrhacos longissimus，是生活在南美洲的大型不会飞的鸟，属于骇鸟科。",
  "sources": [
    {
      "title": "骇鸟新头骨的原始研究",
      "url": "https://doi.org/10.1017/jpa.2019.53",
      "accessedOn": "2026-10-28"
    },
    {
      "title": "骇鸟科的化石分类与骨架复原研究",
      "url": "https://revistas.usp.br/paz/article/view/33623",
      "accessedOn": "2026-10-28"
    },
    {
      "title": "骇鸟科的体型演化与生态研究",
      "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC11040249/",
      "accessedOn": "2026-10-28"
    }
  ],
  "editorial": {
    "uncertaintyNotes": [
      "完整骨架仍需复原，抬头后约两米四的头顶高度属于估计，姿势会影响高度。",
      "具体捕食方式和奔跑速度仍需研究，不能从身体轮廓直接确定。",
      "羽毛颜色和展示动作包含艺术复原。"
    ],
    "editedBy": "Museum content preparation",
    "reviewedBy": "Primary-source evidence check",
    "reviewedOn": "2026-10-28"
  },
  "narration": {
    "sentences": [
      "骇鸟有一双长腿，头上长着一张大大的弯钩嘴。",
      "把它转到侧面，找一找嘴巴尖尖的地方朝哪边弯。"
    ],
    "pronunciation": [
      {
        "text": "骇鸟",
        "reading": "hài niǎo"
      },
      {
        "text": "喙",
        "reading": "huì"
      },
      {
        "text": "长着",
        "reading": "zhǎng zhe"
      }
    ]
  }
} as const satisfies AnimalContentZhCN
