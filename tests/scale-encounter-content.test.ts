import {
  isScaleEncounterAnimal,
  scaleEncounterContentFor,
} from '../src/scale-encounter/content'

describe('scale encounter content', () => {
  it('enables the four calibrated land, snow, air and water pilots', () => {
    expect(isScaleEncounterAnimal('tyrannosaurus-rex')).toBe(true)
    expect(isScaleEncounterAnimal('pteranodon')).toBe(true)
    expect(isScaleEncounterAnimal('mosasaurus')).toBe(true)
    expect(isScaleEncounterAnimal('mammoth')).toBe(true)
    expect(isScaleEncounterAnimal('ichthyosaur')).toBe(false)
  })

  it('describes the mammoth comparison with a cautious adult shoulder-height range', () => {
    const zh = scaleEncounterContentFor('mammoth', 'zh-CN')
    const english = scaleEncounterContentFor('mammoth', 'en')

    expect(zh.copy.measurement).toContain('成年个体')
    expect(zh.copy.measurement).toContain('肩高约 3–3.5 米')
    expect(zh.copy.measurement).toContain('比例示意')
    expect(zh.copy.intro).toContain('羽绒服')
    expect(zh.copy.transition).toContain('围巾')
    expect(zh.copy.transition).toContain('身后')
    expect(zh.copy.arrival).toContain('肩膀')
    expect(english.copy.measurement).toContain('Adult shoulder height')
    expect(english.copy.measurement).toContain('scale illustration')
  })

  it('describes the Pteranodon encounter as genuinely eye-level', () => {
    const content = scaleEncounterContentFor('pteranodon', 'zh-CN')

    expect(content.sceneLabel).toContain('平视')
    expect(content.copy.transition).toContain('后上方')
    expect(content.copy.transition).toContain('眼睛')
    expect(content.copy.arrival).toContain('正前方')
    expect(content.copy.arrival).toContain('一样高')
    expect(`${content.copy.intro}${content.copy.transition}${content.copy.arrival}`)
      .not.toMatch(/低头|下面|俯视/)
  })

  it('keeps the underwater directions and visible anatomy aligned', () => {
    const content = scaleEncounterContentFor('mosasaurus', 'zh-CN')

    expect(content.copy.transition).toContain('右边')
    expect(content.copy.transition).toContain('身后')
    expect(content.copy.arrival).toContain('斜上方')
    expect(content.copy.arrival).toContain('肚子')
    expect(content.copy.arrival).toContain('四只大鳍')
    expect(content.copy.arrival).toContain('尾巴')
    expect(content.copy.arrival).toContain('水面')
  })

  it('keeps every guided line as an independently timed Serena asset', () => {
    for (const locale of ['zh-CN', 'en'] as const) {
      for (const animal of [
        'tyrannosaurus-rex',
        'pteranodon',
        'mosasaurus',
        'mammoth',
      ] as const) {
        const { audio } = scaleEncounterContentFor(animal, locale)
        expect(audio.intro).toMatch(new RegExp(`intro\\.${locale}\\.mp3$`))
        expect(audio.transition).toMatch(
          new RegExp(`transition\\.${locale}\\.mp3$`),
        )
        expect(audio.arrival).toMatch(
          new RegExp(`arrival\\.${locale}\\.mp3$`),
        )
      }
    }
  })
})
