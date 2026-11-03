import type { Locale } from './types'

export const animalSeoDescriptionMaxLength = 160

interface AnimalSeoContext {
  readonly id: string
  readonly locale: Locale
  readonly name: string
}

const searchDescriptions: Readonly<Record<string, Partial<Record<Locale, string>>>> = {
  triceratops: {
    'zh-CN': '通过三角龙3D模型观察三只角和颈盾，了解晚白垩世这种植食性恐龙。家长资料收录体长、化石发现地区和科学来源。',
  },
  stegosaurus: {
    'zh-CN': '旋转剑龙3D模型，观察背部骨板和尾刺，了解它在晚侏罗世的生活。附中英文讲解、体型与食性资料及科学来源。',
  },
  pachycephalosaurus: {
    'zh-CN': '肿头龙3D模型呈现头顶骨穹和身体外形，配有中英文讲解。家长资料介绍体型、生活时期及骨穹用途的研究与不确定性。',
  },
  anomalocaris: {
    en: 'Rotate an Anomalocaris 3D model to inspect its swimming flaps, eyes and grasping appendages. Learn about this Cambrian animal with scientific sources.',
  },
  hallucigenia: {
    en: 'Explore Hallucigenia in 3D, from its paired spines to tiny legs. Learn about this small Cambrian animal through narration and source-backed facts.',
  },
}

export function animalSeoTitle(name: string, locale: Locale): string {
  return locale === 'zh-CN'
    ? `${name} 3D模型与科普 | 史前动物博物馆`
    : `${name} 3D model & facts | Prehistoric Animal Museum`
}

export function animalSeoDescription(
  narrationSentences: readonly string[],
  context?: AnimalSeoContext,
): string {
  const sentences = narrationSentences
    .map((sentence) => sentence.trim())
    .filter(Boolean)
  const completeDescription = sentences.join(' ')

  if (context) {
    const specific = searchDescriptions[context.id]?.[context.locale]
    if (specific) return specific
    const introduction = context.locale === 'zh-CN'
      ? `旋转${context.name}的3D模型，配合中英文讲解和有来源的家长资料一起观察。`
      : `Explore ${context.name} in 3D, with narration and a guide for grown-ups.`
    const description = `${introduction} ${sentences[0] ?? ''}`.trim()
    return description.length <= animalSeoDescriptionMaxLength
      ? description
      : introduction
  }

  if (completeDescription.length <= animalSeoDescriptionMaxLength) {
    return completeDescription
  }

  return sentences[0] ?? ''
}
