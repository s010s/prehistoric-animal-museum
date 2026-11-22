import type { AnimalContentZhCN } from '../../types'

export const zhCN = {
  name: '恐狼',
  classificationLabel: '史前大型犬科动物',
  visibleFeature:
    '看看它粗壮的身体、宽宽的大脑袋和蓬松下垂的大尾巴，比今天的狼还要威风。',
  narration: {
    sentences: [
      '这是恐狼，一种生活在几十万年前的史前巨狼，它不是现在狼的祖先。',
      '看看它粗壮的身体、宽宽的大脑袋和蓬松的大尾巴，比今天的狼还要威风。',
    ],
    pronunciation: [
      { text: '恐狼', reading: 'kǒng láng' },
      { text: '犬科', reading: 'quǎn kē' },
      { text: '更新世', reading: 'gèng xīn shì' },
    ],
  },
  facts: {
    period: '晚更新世（约 12.5 万至 1 万年前）',
    discoveryRegions: [
      '北美洲（拉布雷亚沥青坑）',
      '南美洲',
    ],
    size: {
      kind: 'body-length',
      minMeters: 1.5,
      maxMeters: 1.8,
    },
    diet: 'carnivore',
  },
  parentClassificationNote:
    '恐狼不是现生灰狼的直系祖先。2021 年的基因研究发现它与灰狼亲缘很远，最近的生活亲属反而是非洲豺类，因此古生物学家把它从犬属独立成恐狼属（Aenocyon）。它比灰狼重约四分之一，头骨更宽、牙齿更大，腿相对更短更结实，是更新世北美最常见的食肉动物之一，拉布雷亚沥青坑已发现超过 4000 具个体。',
  sources: [
    {
      title: 'Dire Wolf — U.S. National Park Service',
      url: 'https://www.nps.gov/articles/000/dire-wolf.htm',
      accessedOn: '2026-11-22',
    },
    {
      title: 'Dire Wolf — San Diego Natural History Museum Fossil Field Guide',
      url: 'https://www.sdnhm.org/exhibitions/fossil-mysteries/fossil-field-guide-a-z/dire-wolf/',
      accessedOn: '2026-11-22',
    },
    {
      title: 'Dire wolf — Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Dire_wolf',
      accessedOn: '2026-11-22',
    },
  ],
  editorial: {
    uncertaintyNotes: [
      '展陈模型按近缘的现生灰狼体态做艺术复原；真实恐狼更粗壮、头骨更宽、腿相对更短。这一复原简化已在本说明中向家长注明。',
      '恐狼的毛色和毛长无法从化石确定，模型毛色属于艺术创作。',
      '恐狼灭绝的原因（大型猎物消失、气候变化、与灰狼竞争）仍有多家假说，没有单一结论。',
    ],
    editedBy: 'Prehistoric Animal Museum candidate research',
    reviewedBy: 'jianghong（产品负责人）',
    reviewedOn: '2026-11-22',
  },
} satisfies AnimalContentZhCN
