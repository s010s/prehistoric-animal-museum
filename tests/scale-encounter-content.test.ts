import {
  isScaleEncounterAnimal,
  scaleEncounterContentFor,
} from '../src/scale-encounter/content'
import {
  REVIEW_SCALE_ENCOUNTER_ANIMAL_IDS,
  SCALE_ENCOUNTER_ANIMAL_IDS,
} from '../src/scale-encounter/types'

const expansionAnimalIds = [
  'spinosaurus',
  'lystrosaurus',
  'baryonyx',
  'archaeopteryx',
  'carnotaurus',
  'anomalocaris',
] as const

describe('scale encounter content', () => {
  it('enables all twenty-four published animals from one catalog', () => {
    expect(SCALE_ENCOUNTER_ANIMAL_IDS).toHaveLength(24)
    for (const animalId of SCALE_ENCOUNTER_ANIMAL_IDS) {
      expect(isScaleEncounterAnimal(animalId)).toBe(true)
    }
    expect(isScaleEncounterAnimal('not-an-animal')).toBe(false)
  })

  it('promotes all six expansion encounters with bilingual copy and narration', () => {
    expect(REVIEW_SCALE_ENCOUNTER_ANIMAL_IDS).toHaveLength(0)
    for (const animalId of expansionAnimalIds) {
      expect(isScaleEncounterAnimal(animalId)).toBe(true)
      for (const locale of ['zh-CN', 'en'] as const) {
        const content = scaleEncounterContentFor(animalId, locale)
        const guidedCopy = `${content.copy.intro}${content.copy.transition}${content.copy.arrival}`
        expect(content.narrationAvailable).toBe(true)
        expect(content.audio.intro).toMatch(`intro.${locale}.mp3`)
        expect(content.audio.transition).toMatch(`transition.${locale}.mp3`)
        expect(content.audio.arrival).toMatch(`arrival.${locale}.mp3`)
        expect(content.copy.title.length).toBeGreaterThan(0)
        expect(content.copy.measurement.length).toBeGreaterThan(0)
        expect(guidedCopy).not.toMatch(
          /内部|调查|模型|复核|争议|候选|评审|internal|research|model|review|candidate|disputed/i,
        )
      }
    }
  })

  it('invites curiosity in the six newly narrated compare encounters', () => {
    for (const animalId of expansionAnimalIds) {
      for (const locale of ['zh-CN', 'en'] as const) {
        const content = scaleEncounterContentFor(animalId, locale)
        const guidedCopy = `${content.copy.intro}${content.copy.transition}${content.copy.arrival}`
        expect(guidedCopy).toMatch(/[？?]/)
        expect(content.copy.intro).toMatch(/寻找|去找|search|looking for/i)
      }
    }
  })

  it('keeps the corrected expansion narration aligned with the visible encounters', () => {
    const baryonyxZh = scaleEncounterContentFor('baryonyx', 'zh-CN')
    const baryonyxEn = scaleEncounterContentFor('baryonyx', 'en')
    const baryonyxZhScript = `${baryonyxZh.copy.intro}${baryonyxZh.copy.transition}${baryonyxZh.copy.arrival}`
    const baryonyxEnScript = `${baryonyxEn.copy.intro}${baryonyxEn.copy.transition}${baryonyxEn.copy.arrival}`

    expect(baryonyxZh.sceneLabel).toBe('河岸湿林')
    expect(baryonyxZhScript).toContain('森林')
    expect(baryonyxZhScript).toMatch(/长嘴|细长的嘴/)
    expect(baryonyxZhScript).toContain('大爪子')
    expect(baryonyxZhScript).toContain('寻找食物')
    expect(baryonyxZhScript).not.toMatch(/河边|河岸|水边|芦苇|八米七五/)
    expect(baryonyxEn.sceneLabel).toBe('Riverbank woodland')
    expect(baryonyxEnScript).toMatch(/forest/i)
    expect(baryonyxEnScript).toMatch(/long snout/i)
    expect(baryonyxEnScript).toMatch(/claw/i)
    expect(baryonyxEnScript).toMatch(/find food/i)
    expect(baryonyxEnScript).not.toMatch(/riverside|river|water|reeds?/i)

    const spinosaurusZh = scaleEncounterContentFor('spinosaurus', 'zh-CN')
    const spinosaurusEn = scaleEncounterContentFor('spinosaurus', 'en')
    const spinosaurusZhScript = `${spinosaurusZh.copy.intro}${spinosaurusZh.copy.transition}${spinosaurusZh.copy.arrival}`
    const spinosaurusEnScript = `${spinosaurusEn.copy.intro}${spinosaurusEn.copy.transition}${spinosaurusEn.copy.arrival}`
    expect(spinosaurusZh.sceneLabel).toBe('林缘浅滩')
    expect(spinosaurusZhScript).toMatch(/森林|林间|树影/)
    expect(spinosaurusZhScript).not.toMatch(/河岸|河边|泥滩|水里|芦苇/)
    expect(spinosaurusZh.copy.transition).toContain('相对较短的后腿')
    expect(spinosaurusZh.copy.transition).not.toContain('粗壮后腿')
    expect(spinosaurusEn.sceneLabel).toBe('Woodland shallows')
    expect(spinosaurusEnScript).toMatch(/forest|trees/i)
    expect(spinosaurusEnScript).not.toMatch(
      /riverbank|riverside|muddy bank|water|reeds?/i,
    )
    expect(spinosaurusEn.copy.transition).toContain(
      'relatively short hind legs',
    )
    expect(spinosaurusEn.copy.transition).not.toContain('powerful hind legs')

    const archaeopteryxZh = scaleEncounterContentFor(
      'archaeopteryx',
      'zh-CN',
    )
    const archaeopteryxEn = scaleEncounterContentFor('archaeopteryx', 'en')
    const archaeopteryxZhScript = `${archaeopteryxZh.copy.intro}${archaeopteryxZh.copy.transition}${archaeopteryxZh.copy.arrival}`
    const archaeopteryxEnScript = `${archaeopteryxEn.copy.intro}${archaeopteryxEn.copy.transition}${archaeopteryxEn.copy.arrival}`

    expect(archaeopteryxZh.sceneLabel).toBe('水畔倒木')
    expect(archaeopteryxZhScript).toMatch(/森林|林地/)
    expect(archaeopteryxZhScript).toContain('倒木')
    expect(archaeopteryxZhScript).not.toContain('木桩')
    expect(archaeopteryxZh.copy.measurement).toBe(
      '从嘴尖到尾尖的总长约 50 厘米',
    )
    expect(archaeopteryxZhScript).toContain('半米')
    expect(archaeopteryxZhScript).toContain('羽毛')
    expect(archaeopteryxZhScript).toContain('翅膀上的小爪子')
    expect(archaeopteryxZhScript).not.toMatch(
      /飞行装备|天空|滑翔|飞到对面|向前滑|一条手臂/,
    )
    expect(archaeopteryxEn.sceneLabel).toBe('Waterside fallen log')
    expect(archaeopteryxEnScript).toMatch(/forest/i)
    expect(archaeopteryxEnScript).toMatch(/fallen log/i)
    expect(archaeopteryxEnScript).not.toMatch(/tree stump/i)
    expect(archaeopteryxEn.copy.measurement).toBe(
      'About 50 cm in total from beak tip to tail tip',
    )
    expect(archaeopteryxEnScript).toMatch(/half a metre/i)
    expect(archaeopteryxEnScript).toMatch(/feathers/i)
    expect(archaeopteryxEnScript).toMatch(/wing claws/i)
    expect(archaeopteryxEnScript).not.toMatch(
      /flying gear|\bsky\b|\bsoar\w*\b|\bglid\w*\b|young child’s arm/i,
    )

    const anomalocarisZh = scaleEncounterContentFor('anomalocaris', 'zh-CN')
    const anomalocarisEn = scaleEncounterContentFor('anomalocaris', 'en')
    expect(anomalocarisZh.copy.arrival).not.toContain('小朋友的一条手臂')
    expect(anomalocarisEn.copy.arrival).not.toContain('young child’s arm')
  })

  it('explains that height sets the eye view and every scene is imaginary', () => {
    const zh = scaleEncounterContentFor('pteranodon', 'zh-CN')
    const english = scaleEncounterContentFor('pteranodon', 'en')

    expect(zh.copy.setup.subtitle).toContain('眼睛视角')
    expect(zh.copy.setup.subtitle).toContain('探险装备')
    expect(zh.copy.setup.subtitle).toContain('想象')
    expect(english.copy.setup.subtitle).toContain('same functional')
    expect(english.copy.setup.subtitle).toContain('imaginative encounter')
    expect(zh.copy.setup.fieldApproach).toBe('想离动物多近？')
    expect(zh.copy.setup.approachHelp).toContain('动物身体外面一点点')
    expect(zh.copy.setup.approachHelp).toContain('一起打卡')
  })

  it('describes Megalodon as sixteen metres and compares length with a bus', () => {
    const zh = scaleEncounterContentFor('megalodon', 'zh-CN')
    const english = scaleEncounterContentFor('megalodon', 'en')
    const narration = `${zh.copy.intro}${zh.copy.transition}${zh.copy.arrival}`

    expect(zh.copy.measurement).toContain('约 16 米')
    expect(zh.copy.arrival).toContain('比一辆大巴还要长')
    expect(narration).not.toMatch(/十六米半|哪片蓝色海水|还要远/)
    expect(english.copy.measurement).toContain('About 16 m')
    expect(`${english.copy.intro}${english.copy.arrival}`).not.toContain(
      'sixteen and a half',
    )
  })

  it('keeps the mammoth invitation simple, warm and child-facing', () => {
    const zh = scaleEncounterContentFor('mammoth', 'zh-CN')
    const english = scaleEncounterContentFor('mammoth', 'en')

    expect(zh.copy.measurement).toContain('肩膀离地约 3–3.5 米')
    expect(zh.copy.intro).not.toMatch(/防寒外套|手套|雪裤|雪地靴/)
    expect(zh.copy.intro).toContain('冰河时代')
    expect(zh.copy.intro).toContain('寻找猛犸象')
    expect(zh.copy.intro).not.toMatch(/模型|幼年|成年|暂时|展示/)
    expect(zh.copy.transition).toContain('厚外套')
    expect(zh.copy.transition).toContain('手套')
    expect(zh.copy.transition).toContain('雪裤')
    expect(zh.copy.transition).toContain('雪地靴')
    expect(zh.copy.arrival).toContain('抬头看')
    expect(zh.copy.arrival).toContain('弯弯的象牙')
    expect(zh.copy.arrival).not.toMatch(/绕到|来到.*眼睛|机位|相机/)
    expect(english.copy.measurement).toContain('Shoulders')
    expect(english.copy.intro).not.toMatch(/model|listing|baby|enlarge/i)
    expect(english.copy.transition).toContain('thick coats')
    expect(english.copy.transition).toContain('snow trousers')
  })

  it('describes the Pteranodon encounter without hard-coding one of its two viewpoints into the scene label', () => {
    const content = scaleEncounterContentFor('pteranodon', 'zh-CN')

    expect(content.sceneLabel).toBe('空中相遇')
    expect(content.sceneLabel).not.toContain('小朋友眼睛视角')
    expect(content.copy.intro).toContain('飞行装备')
    expect(content.copy.transition).toContain('手臂张开')
    expect(content.copy.transition).toContain('小飞鸟')
    expect(content.copy.transition).not.toMatch(/后上方|来到.*眼睛/)
    expect(content.copy.arrival).toContain('对面')
    expect(content.copy.arrival).toContain('七米')
    expect(`${content.copy.intro}${content.copy.transition}${content.copy.arrival}`)
      .not.toMatch(/低头|下面|俯视/)
  })

  it('keeps the underwater directions and visible anatomy aligned', () => {
    const content = scaleEncounterContentFor('mosasaurus', 'zh-CN')

    expect(content.copy.intro).toContain('白垩纪的海洋')
    expect(content.copy.intro).toContain('寻找沧龙')
    expect(content.copy.intro).toContain('潜水装备')
    expect(content.copy.transition).toContain('面镜')
    expect(content.copy.transition).toContain('气瓶')
    expect(content.copy.transition).toContain('脚蹼')
    expect(content.copy.transition).toContain('水面')
    expect(content.copy.transition).not.toMatch(/右边|身后|来到.*眼睛/)
    expect(content.copy.arrival).toContain('斜上方')
    expect(content.copy.arrival).toContain('肚子')
    expect(content.copy.arrival).toContain('四只鳍')
    expect(content.copy.arrival).toContain('尾巴')
    expect(content.copy.arrival).toContain('十二米')
  })

  it('keeps every guided phase as an independently addressable narration slice', () => {
    for (const locale of ['zh-CN', 'en'] as const) {
      for (const animal of [
        ...SCALE_ENCOUNTER_ANIMAL_IDS,
      ]) {
        const { audio } = scaleEncounterContentFor(animal, locale)
        expect(audio.intro).toMatch(
          new RegExp(`intro(?:-v\\d+)?\\.${locale}\\.mp3$`),
        )
        expect(audio.transition).toMatch(
          new RegExp(`transition(?:-v\\d+)?\\.${locale}\\.mp3$`),
        )
        expect(audio.arrival).toMatch(
          new RegExp(`arrival(?:-v\\d+)?\\.${locale}\\.mp3$`),
        )
        expect(audio.toChildEyes).toMatch(
          new RegExp(`view-switch-to-eyes(?:-v\\d+)?\\.${locale}\\.mp3$`),
        )
        expect(audio.toChildRear).toMatch(
          new RegExp(`view-switch-to-rear(?:-v\\d+)?\\.${locale}\\.mp3$`),
        )
      }
    }
  })

  it('uses one exploration voice without exposing models or scientific caveats', () => {
    const ichthyosaur = scaleEncounterContentFor('ichthyosaur', 'zh-CN')
    const plesiosaur = scaleEncounterContentFor('plesiosaurus', 'zh-CN')
    const meganeura = scaleEncounterContentFor('meganeura', 'zh-CN')

    for (const animalId of SCALE_ENCOUNTER_ANIMAL_IDS) {
      const content = scaleEncounterContentFor(animalId, 'zh-CN')
      const narration = `${content.copy.intro}${content.copy.transition}${content.copy.arrival}`
      expect(content.copy.intro).toMatch(/寻找|去找/)
      expect(narration).not.toMatch(/模型|展示|复原|估算|不确定|只作|类/)
      // The Megalodon line deliberately uses the unambiguous comparative
      // phrase requested for the bus comparison. Other scripts retain the
      // existing guard against polyphonic uses that previously confused TTS.
      if (animalId === 'megalodon') {
        expect(content.copy.arrival).toContain('比一辆大巴还要长')
      } else if (!expansionAnimalIds.includes(animalId as typeof expansionAnimalIds[number])) {
        expect(narration).not.toContain('长')
      }
    }
    expect(ichthyosaur.copy.intro).toContain('寻找鱼龙')
    expect(ichthyosaur.copy.intro).not.toContain('鱼龙类')
    expect(plesiosaur.copy.intro).toContain('寻找蛇颈龙')
    expect(plesiosaur.copy.intro).not.toContain('蛇颈龙类')
    expect(plesiosaur.copy.transition).toContain('我们轻轻摆动脚蹼')
    expect(plesiosaur.copy.transition).toContain('蛇颈龙正从对面游来')
    expect(meganeura.sceneLabel).toBe('林间湿地')
    expect(meganeura.copy.arrival).toContain('七十厘米')
  })

  it('names each river habitat while preserving the recorded forest narration', () => {
    for (const [animalId, zhLabel, enLabel] of [
      ['gigantoraptor', '植被河漫平原', 'Vegetated river plain'],
      ['dilophosaurus', '季节性河谷', 'Seasonal river valley'],
      ['meganeura', '林间湿地', 'Forest wetland'],
    ] as const) {
      const zh = scaleEncounterContentFor(animalId, 'zh-CN')
      const english = scaleEncounterContentFor(animalId, 'en')

      expect(zh.sceneLabel).toBe(zhLabel)
      expect(zh.copy.intro).toMatch(/森林/)
      expect(english.sceneLabel).toBe(enLabel)
      expect(english.copy.intro).toMatch(/forest/i)
    }
  })

  it('keeps the English narration on the same child-first exploration path', () => {
    for (const animalId of SCALE_ENCOUNTER_ANIMAL_IDS) {
      const content = scaleEncounterContentFor(animalId, 'en')
      const narration = `${content.copy.intro}${content.copy.transition}${content.copy.arrival}`
      expect(content.copy.intro).toMatch(/search|searching|looking for/i)
      expect(narration).not.toMatch(/model|display|reconstruct|estimate|uncertain/i)
    }
  })

  it('uses the revised shared viewpoint lines for every Chinese animal', () => {
    const sharedViewpointAudio = new Set<string>()

    for (const animalId of SCALE_ENCOUNTER_ANIMAL_IDS) {
      const content = scaleEncounterContentFor(animalId, 'zh-CN')
      expect(content.copy.toChildEyes).not.toMatch(/更大|变大/)
      expect(content.copy.toChildRear).not.toMatch(/更大|变大/)
      expect(content.audio.toChildEyes).toMatch(
        /view-switch-to-eyes-v4\.zh-CN\.mp3$/,
      )
      expect(content.audio.toChildRear).toMatch(
        /view-switch-to-rear-v4\.zh-CN\.mp3$/,
      )
      sharedViewpointAudio.add(content.audio.toChildEyes)
      sharedViewpointAudio.add(content.audio.toChildRear)
    }

    expect(sharedViewpointAudio.size).toBe(2)
  })
})
