export const MAMMOTH_PALAEOENVIRONMENT_ANCHOR = {
  id: 'eastern-alps-mis3-teaching-composite-v1',
  reconstructionType: 'teaching-composite',
  location: {
    label: '奥地利东阿尔卑斯下因河谷一带',
    region: 'Lower Inn Valley, Eastern Alps, Austria',
    precision:
      '区域级教学锚点，不对应一处猛犸象化石的原位瞬间',
  },
  time: {
    label: '约 45,000 年前',
    interval: 'MIS 3 first half, approximately 47–43 cal ka BP',
  },
  seasonClimate: {
    season: '晚春清晨',
    state:
      '寒冷、偏干、开阔；河谷主体地表无冰，风吹薄雪只在背风洼地形成斑块',
    defaultSnowCoverFraction: 0.22,
    snowDepthStatement:
      '不声明精确厘米数；视觉上只表现薄而不连续的季节性残雪',
  },
  iceRole: {
    type: 'distant-high-elevation-glacier-and-ice-covered-ridge',
    label: '远处高海拔小型冰川与覆冰山脊',
    role:
      '只承担方向、尺度和寒冷气候参照；不可接近，不是猛犸象脚下表面，也不参与危险叙事',
  },
  facts: [
    '奥地利阿尔卑斯主要谷地在 MIS 3 前半段存在无冰时窗，猛犸象可进入谷地。',
    '长毛猛犸象需要可取食的开阔陆地；冰期不等于站在冰川上。',
    'MIS 3 东阿尔卑斯冷阶段可出现以灌木、草本和禾草为主的开阔植被。',
  ],
  artisticDecisions: [
    '把晚春清晨作为儿童友好的平静观察时刻。',
    '默认残雪约占可见地表五分之一，以便同时读清冷感、土壤和食物。',
    '把远处冰体压在地平线小范围内，不形成环形冰墙或第二地平线。',
  ],
  unknowns: [
    '没有把某一件猛犸象标本与同一瞬间的冰缘轮廓绑定。',
    '精确雪深、植被覆盖率、太阳方位和高海拔冰体尺度没有直接代理数据。',
    '场景是教学型综合复原，不能标成单一化石地点的现场照片。',
  ],
  sources: [
    {
      id: 'spotl-2018',
      title:
        'Mammoths inside the Alps during the last glacial period',
      doi: 'https://doi.org/10.1016/j.quascirev.2018.04.020',
      supports:
        'MIS 3 前半段奥地利阿尔卑斯主要谷地无冰及猛犸象进入谷地。',
    },
    {
      id: 'ilyashuk-2022',
      title:
        'Summer temperatures and environmental dynamics during the Middle Würmian (MIS 3) in the Eastern Alps',
      doi: 'https://doi.org/10.1016/j.qsa.2022.100050',
      supports:
        '下因河谷 MIS 3 环境变化、融雪／冰水影响和冷凉夏季背景。',
    },
    {
      id: 'starnberger-2013',
      title:
        'Late Pleistocene climate change and landscape dynamics in the Eastern Alps',
      doi: 'https://doi.org/10.1016/j.quascirev.2013.02.008',
      supports:
        'Unterangerberg 的 MIS 3 冷阶段以灌木、草本和禾草为主。',
    },
    {
      id: 'wang-2021',
      title:
        'Late Quaternary dynamics of Arctic biota from ancient environmental genomics',
      doi: 'https://doi.org/10.1038/s41586-021-04016-x',
      supports:
        '无冰、冷干、季节性强且有低矮可食植被的跨区域生态边界。',
    },
  ],
} as const

export type MammothPalaeoenvironmentAnchor =
  typeof MAMMOTH_PALAEOENVIRONMENT_ANCHOR
