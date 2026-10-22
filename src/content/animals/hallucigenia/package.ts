import type { PublishedAnimalDefinition, PublishedNarrationPlans } from '../../types'
import { en } from './content.en'
import { zhCN } from './content.zh-CN'
import { provenance } from './provenance'

const narration = {
  "zh-CN": {
    "status": "ready",
    "sourcePath": "audio/narration.zh-CN.mp3",
    "mimeType": "audio/mpeg",
    "speaker": "Serena",
    "language": "Chinese",
    "humanReviewStatus": "approved"
  },
  "en": {
    "status": "ready",
    "sourcePath": "audio/narration.en.mp3",
    "mimeType": "audio/mpeg",
    "speaker": "Serena",
    "language": "English",
    "humanReviewStatus": "approved"
  }
} as const satisfies PublishedNarrationPlans

export const animalDefinition = {
  ...{
  "id": "hallucigenia",
  "status": 'published',
  "kind": "other-prehistoric-animal",
  "habitat": "water",
  "atmosphere": "underwater",
  "presentation": {
    "initialYawDegrees": -18,
    "safeAreaPadding": 0.13,
    "portraitSafeAreaPadding": 0.18,
    "preciseBounds": true,
    "shadow": "none",
    "toneMappingExposure": 1.08,
    "cameraLightScale": 1.05
  },
  "animation": {
    "clip": "Idle",
    "loop": "repeat",
    "speed": 1
  },},
  content: { 'zh-CN': zhCN, en },
  narration,
  provenance: [provenance[0], ...provenance.slice(1)] as const,
} as const satisfies PublishedAnimalDefinition
