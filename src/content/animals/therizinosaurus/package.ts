import { definePublishedAnimal } from '../../types'
import { en } from './content.en'
import { zhCN } from './content.zh-CN'
import { provenance } from './provenance'

export const animalDefinition = definePublishedAnimal({
  "id": "therizinosaurus",
  "kind": "dinosaur",
  "habitat": "land",
  "atmosphere": "forest",
  "presentation": {
  "initialYawDegrees": -155,
  "safeAreaPadding": 0.14,
  "portraitSafeAreaPadding": 0.14,
  "toneMappingExposure": 1.08,
  "preciseBounds": true,
  "shadow": "ground"
},
  "animation": {
  "clip": "Idle",
  "loop": "repeat",
  "speed": 1
},
  "status": "published",
  content: { 'zh-CN': zhCN, en },
  narration: {
  "zh-CN": {
    "status": "ready",
    "sourcePath": "audio/narration.zh-CN.mp3",
    "mimeType": "audio/mpeg",
    "speaker": "Serena",
    "language": "Chinese",
    "humanReviewStatus": "pending",
    "publicationAuthorization": {
  "scope": "owner-publication-authorized",
  "recordSha256": "54e19bc6d0b22915d45a95327157d7b279497ad786d150500c2eddd02b765de1",
  "completeListening": "unverified"
}
  },
  "en": {
    "status": "ready",
    "sourcePath": "audio/narration.en.mp3",
    "mimeType": "audio/mpeg",
    "speaker": "Serena",
    "language": "English",
    "humanReviewStatus": "pending",
    "publicationAuthorization": {
  "scope": "owner-publication-authorized",
  "recordSha256": "54e19bc6d0b22915d45a95327157d7b279497ad786d150500c2eddd02b765de1",
  "completeListening": "unverified"
}
  }
},
  provenance,
})
