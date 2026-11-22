import {
  createPublishedAssetProvenance,
  createReviewedEnglishNarrationProvenance,
  recomposedCollectionThumbnailDerivation,
  reviewedBackgroundSources,
} from '../../provenance-helpers'
import { en } from './content.en'
import { zhCN } from './content.zh-CN'

const baseProvenance = createPublishedAssetProvenance({
  animalName: zhCN.name,
  model: {
    source: {
      title: 'Italian White Wolf',
      author: 'SDPM (Sketchfab user sdpm)',
      url: 'https://sketchfab.com/3d-models/italian-white-wolf-1de9441cb0744c0d8459ce957b8d0a57',
      accessedOn: '2026-11-22',
      bytes: 2_700_808,
      sha256:
        '28cb235a24d670116652b72321f45e56b9b5d9f7c3639466a0fa941ce3d1d347',
    },
    runtime: {
      bytes: 3_345_836,
      sha256:
        '55c83d5c87f2b28cdb3c5c1b021be610f14f9beffb0d4bc467424f6d752e2ec2',
    },
    modifications: [
      'Used the CC BY 4.0 source directly; the licence permits modification and redistribution with attribution recorded here and in the public credits.',
      'Reoriented the source from its Y length axis into the canonical X body axis and rescaled it to the museum target length, keeping the model grounded for a land exhibit.',
      'Left the PBR metallic default in place after verifying the coat reads naturally under the runtime environment lighting; no material was rebuilt.',
      'Authored a deterministic project Idle (land-breathe-tail morph): eight-second closed loop with gentle breathing and tail sway, no root translation, no walking.',
      'Exported one self-contained GLB with one mesh, one material, one embedded base-colour texture and one Idle clip, validated against the model budget.',
      'The exhibit is an artistic reconstruction on a close relative gray-wolf build; the parent-facing note records that the real dire wolf was more robust with a broader skull.',
    ],
  },
  derivedImagesGeneratedOn: '2026-11-22',
  thumbnailDerivation: {
    ...recomposedCollectionThumbnailDerivation,
    generatedOn: '2026-11-22',
  },
  backgrounds: {
    landscape: {
      source: reviewedBackgroundSources.mammoth.landscape,
      runtime: {
        bytes: 420_388,
        sha256:
          '2b23ceaf9e6b7f6d270dcb327254f5be27fb764fc2a845c627fa928aa3c01eb4',
      },
      runtimeModifications: [
        'Reused the already-reviewed project-authored mammoth Ice Age tundra background without modification; its palette and cold daylight suit the Late Pleistocene dire wolf exhibit.',
      ],
    },
    portrait: {
      source: reviewedBackgroundSources.mammoth.portrait,
      runtime: {
        bytes: 268_126,
        sha256:
          '3b5e795c4abe470c1ca0cfba9d7834397080b76cb261e2ea1d3f1757f0482335',
      },
      runtimeModifications: [
        'Reused the already-reviewed project-authored mammoth Ice Age tundra portrait background without modification.',
      ],
    },
  },
  poster: {
    bytes: 125_442,
    sha256:
      '20342d2e0fea72adaa199f123b00f1d47122b819ae088f1cb37a519a0485bfed',
  },
  posterPortrait: {
    bytes: 55_812,
    sha256:
      'b6174fcc3d6fd00eb046ff34af44eb340a08b0304d4fc307fbe07f299d98d1bd',
  },
  thumbnail: {
    bytes: 45_230,
    sha256:
      '51e03b171a07d0927f3c4a054c9a5cee71d224ba700b40ac81f3b94a3cc260f3',
  },
  narration: {
    generatedOn: '2026-11-22',
    script: zhCN.narration.sentences.join(''),
    bytes: 139_004,
    sha256:
      'f54eedb8bff43c1ed11ccbbb4d0a3840b9385e05f77686f830ad2f042b814631',
  },
})

export const provenance = [
  ...baseProvenance,
  createReviewedEnglishNarrationProvenance('dire-wolf', en),
] as const
