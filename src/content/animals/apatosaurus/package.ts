import { definePublishedAnimal } from '../../types'
import { en } from './content.en'
import { zhCN } from './content.zh-CN'
import { provenance } from './provenance'

export const animalDefinition = definePublishedAnimal({
  id: 'apatosaurus',
  status: 'published',
  kind: 'dinosaur',
  habitat: 'land',
  atmosphere: 'plains',
  content: { 'zh-CN': zhCN, en },
  presentation: {
    cameraLightScale: 1.05,
    initialYawDegrees: 0,
    landscapeHorizontalOffset: 0.01,
    landscapeVerticalOffset: 0.035,
    portraitVerticalOffset: 0.05,
    safeAreaPadding: 0.12,
    shadow: 'ground',
    shadowDepthScale: 0.9,
    shadowHorizontalOffset: -0.61,
    shadowOpacity: 0.56,
    shadowScale: 0.38,
    shadowYOffset: 0.11,
    toneMappingExposure: 1.28,
  },
  animation: {
    clip: 'Idle',
    loop: 'repeat',
    speed: 0.9,
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
