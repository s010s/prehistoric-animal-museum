import narrationEnUrl from './audio/narration.en.mp3'
import narrationZhCNUrl from './audio/narration.zh-CN.mp3'
import landscapeUrl from './backgrounds/landscape.webp'
import portraitUrl from './backgrounds/portrait.webp'
import posterUrl from './images/poster.webp'
import posterPortraitUrl from './images/poster-portrait.webp'
import thumbnailUrl from './images/thumbnail.webp'
import modelUrl from './model/model.glb?url'

import { createRuntimeAnimal } from '../../create-runtime-animal'
import { animalDefinition } from './package'

export const animal = createRuntimeAnimal(animalDefinition, {
  backgroundLandscape: landscapeUrl,
  backgroundPortrait: portraitUrl,
  model: modelUrl,
  narration: {
    'zh-CN': narrationZhCNUrl,
    en: narrationEnUrl,
  },
  poster: posterUrl,
  posterPortrait: posterPortraitUrl,
  thumbnail: thumbnailUrl,
})
