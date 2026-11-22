import { definePublishedAnimal } from '../../types'
import { en } from './content.en'
import { zhCN } from './content.zh-CN'
import { provenance } from './provenance'

export const animalDefinition = definePublishedAnimal({
  id: 'dire-wolf',
  status: 'published',
  kind: 'other-prehistoric-animal',
  habitat: 'land',
  atmosphere: 'ice',
  content: { 'zh-CN': zhCN, en },
  presentation: {
    initialYawDegrees: -35,
    safeAreaPadding: 0.12,
    portraitSafeAreaPadding: 0.14,
    shadow: 'ground',
    shadowOpacity: 0.35,
    shadowScale: 1.3,
  },
  animation: {
    clip: 'Idle',
    loop: 'repeat',
    speed: 1,
  },
  narration: {
    'zh-CN': {
      status: 'ready',
      sourcePath: 'audio/narration.zh-CN.mp3',
      mimeType: 'audio/mpeg',
      speaker: 'Serena',
      language: 'Chinese',
      humanReviewStatus: 'approved',
    },
    en: {
      status: 'ready',
      sourcePath: 'audio/narration.en.mp3',
      mimeType: 'audio/mpeg',
      speaker: 'Serena',
      language: 'English',
      humanReviewStatus: 'approved',
    },
  },
  provenance,
})
