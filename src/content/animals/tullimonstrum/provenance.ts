import type { AssetProvenance } from '../../types'

export const provenance = [
  {
    "assetPath": "model/model.glb",
    "kind": "model",
    "source": {
      "type": "third-party",
      "title": "塔利怪物",
      "author": "huykhoi2407",
      "url": "https://sketchfab.com/3d-models/tully-monster-tullimonstrum-48e46fb0c1ba436a88a4b9e5bda693ee",
      "accessedOn": "2026-10-20",
      "sha256": "2af53e6f4d544e0950e41d372c22139ffd6a5fc2e6980f1edec0722418452b0e",
      "bytes": 3918124
    },
    "license": {
      "spdx": "CC-BY-4.0",
      "name": "Creative Commons Attribution 4.0 International",
      "url": "https://creativecommons.org/licenses/by/4.0/"
    },
    "runtime": {
      "sha256": "89c10f5b4ac2846d1be41b5103dcc1cdf4647037073a19fd532aba370e35fec6",
      "bytes": 4482112
    },
    "modifications": [
      "Prepared a self-contained budgeted derivative while retaining source mesh, textures and rig structure.",
      "Authored a closed eight-second Idle with clearly visible tail-stem and tail-fin movement while preserving the existing proboscis motion and other animation clips."
    ],
    "attribution": "“塔利怪物” by huykhoi2407, CC BY 4.0; modified for the Prehistoric Animal Museum.",
    "redistributionAllowed": true,
    "evidencePaths": [
      "provenance/LICENSES/model-license.txt",
      "provenance/LICENSES/model-source.txt"
    ]
  },
  {
    "assetPath": "backgrounds/landscape.webp",
    "kind": "background",
    "source": {
      "type": "generated",
      "title": "塔利怪物 empty habitat — landscape",
      "tool": "built-in image_gen",
      "generatedOn": "2026-10-22",
      "prompt": "Use case: historical-scene. Asset: NEW LANDSCAPE 16:9 background for the Tullimonstrum exhibit in a preschool 3D natural history museum. An EMPTY Carboniferous brackish estuary seen underwater: luminous warm amber-green water, low silty ochre bottom at lowest 18%, one submerged weathered branch confined to far right edge, distant dark root silhouettes at far left. Broad quiet clear water in central 75% for a separately rendered animal. Soft naturalistic hand-painted gouache, calm inviting daylight, readable midtones, subtle natural texture. A distinct estuary identity rather than a blue ocean. No animal, fish, shells, coral, modern plants, people, text, logos, watermark, UI, bubbles, particles, platform or baked animal shadow. Independently compose as a wide landscape, not a collage. Output full image.",
      "sha256": "98a2e6aa1c68db04aef79d9f90163f7668aa29d1bfe96ad1277053f0135226b6",
      "bytes": 2173936
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "sha256": "50402a48c0899aee29f6e5f1382753b32aeb140789a66e35c534732b11f095d1",
      "bytes": 148516
    },
    "modifications": [
      "Converted this animal’s independently generated composition to compact WebP.",
      "Kept the central display area empty for the separate 3D animal; landscape and portrait are separate ImageGen outputs."
    ],
    "attribution": "Project-generated habitat artwork created offline with OpenAI ImageGen.",
    "redistributionAllowed": true,
    "evidencePaths": [
      "provenance/LICENSES/background-generation.txt"
    ]
  },
  {
    "assetPath": "backgrounds/portrait.webp",
    "kind": "background",
    "source": {
      "type": "generated",
      "title": "塔利怪物 empty habitat — portrait",
      "tool": "built-in image_gen",
      "generatedOn": "2026-10-22",
      "prompt": "Use case: historical-scene. Asset: a new environment background for a calm preschool 3D natural history museum. Scene: Carboniferous brackish estuary underwater, warm amber-green water and ochre silt, sparse submerged woody roots confined to edge, no blue ocean. Soft naturalistic hand-painted gouache, convincing landscape depth with subtle natural textures, inviting readable midtones. Empty environment only. Keep central 75% visually quiet for a separately rendered animal and upper corners uncluttered for controls. For underwater scenes keep seabed in lowest 18% and a large clear middle water volume. For land scenes foreground must be one continuous level ground surface across full width with no ledge/platform/ridge or trench; horizon near upper third. No animals, fish, birds, humans, skeletons, shells, fossils, modern lawns/flowers, text, logos, UI, watermarks, floating particles, baked animal shadows, spotlit plinths or collage. Independently compose one PORTRAIT 9:16 tall image, with ample empty vertical space. This is a fresh tall composition, not a crop of a wide scene.",
      "sha256": "4477d5174b6c6c9ad5b694f448450bbf29ce050242dac92a173a1b65419adf20",
      "bytes": 2094363
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "sha256": "fe4ee6a36aefc265b68652d6df566a2b82fb551dd978a6c313ba81c2a7f16237",
      "bytes": 118306
    },
    "modifications": [
      "Converted this animal’s independently generated composition to compact WebP.",
      "Kept the central display area empty for the separate 3D animal; landscape and portrait are separate ImageGen outputs."
    ],
    "attribution": "Project-generated habitat artwork created offline with OpenAI ImageGen.",
    "redistributionAllowed": true,
    "evidencePaths": [
      "provenance/LICENSES/background-generation.txt"
    ]
  },
  {
    "assetPath": "audio/narration.zh-CN.mp3",
    "kind": "narration",
    "source": {
      "type": "generated",
      "title": "塔利怪物 Chinese narration",
      "tool": "Qwen3-TTS CustomVoice",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena built-in voice",
      "generatedOn": "2026-10-22",
      "prompt": "塔利怪物的两只眼睛伸向身体两边，像一根小横杆的两头。你能在眼睛前面，找到那条细长的吻部吗？",
      "sha256": "97c7dc617e8396a45fbba40e3fe261e1b0d175ec4608637f5237e525035a590a",
      "bytes": 691244
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "sha256": "403cfe73e43d59858b7f2a642a236e78a5495d3fe9bf62d278de65e95facae43",
      "bytes": 91005
    },
    "modifications": [
      "Synthesized offline from the reviewed two-sentence text with context-specific pronunciation controls.",
      "Normalized the complete narration to a 48 kHz mono MP3; no runtime synthesis."
    ],
    "attribution": "Project narration written for the museum and synthesized offline with Qwen3-TTS 0.6B CustomVoice, Serena.",
    "redistributionAllowed": true,
    "evidencePaths": [
      "provenance/LICENSES/narration-rights.txt"
    ]
  },
  {
    "assetPath": "audio/narration.en.mp3",
    "kind": "narration",
    "source": {
      "type": "generated",
      "title": "塔利怪物 English narration",
      "tool": "Qwen3-TTS CustomVoice",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena built-in voice",
      "generatedOn": "2026-10-22",
      "prompt": "The Tully monster’s eyes stuck out to the sides, like the ends of a little bar. Can you find the long snout stretching out in front of them?",
      "sha256": "994aa2c86cd3716ff0a9a966a9eaf2e3492e00ee4ccac43cab96e911b4c28026",
      "bytes": 662444
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "sha256": "48226d94e825d92f6c1b22cd97a6f795c60bed986d3ce84a92d5978b7721db35",
      "bytes": 87165
    },
    "modifications": [
      "Synthesized offline from the reviewed two-sentence text with context-specific pronunciation controls.",
      "Normalized the complete narration to a 48 kHz mono MP3; no runtime synthesis."
    ],
    "attribution": "Project narration written for the museum and synthesized offline with Qwen3-TTS 0.6B CustomVoice, Serena.",
    "redistributionAllowed": true,
    "evidencePaths": [
      "provenance/LICENSES/narration-rights.txt"
    ]
  },
  {
    "assetPath": "images/poster.webp",
    "kind": "poster",
    "source": {
      "type": "derived",
      "title": "塔利怪物 transparent landscape model still",
      "generatedOn": "2026-10-22",
      "inputAssetPaths": [
        "model/model.glb"
      ],
      "method": "Retained the existing headed Idle0 transparent still after verifying the updated model produces the same complete world-space geometry, normals, materials and presentation at that frame."
    },
    "license": {
      "spdx": "CC-BY-4.0",
      "name": "Creative Commons Attribution 4.0 International",
      "url": "https://creativecommons.org/licenses/by/4.0/"
    },
    "runtime": {
      "sha256": "174d70271401cb25e91412c379ad287109c218d3865afcdecb204096113eb649",
      "bytes": 81398
    },
    "modifications": [
      "Preserved the complete animal silhouette and source materials.",
      "Verified the final model’s initial pose and renderer presentation before deriving or retaining the static image."
    ],
    "attribution": "“塔利怪物” by huykhoi2407, CC BY 4.0; modified for the Prehistoric Animal Museum.",
    "redistributionAllowed": true,
    "evidencePaths": [
      "provenance/LICENSES/model-license.txt",
      "provenance/LICENSES/model-source.txt",
      "provenance/LICENSES/derived-images.txt"
    ]
  },
  {
    "assetPath": "images/poster-portrait.webp",
    "kind": "poster",
    "source": {
      "type": "derived",
      "title": "塔利怪物 transparent portrait model still",
      "generatedOn": "2026-10-22",
      "inputAssetPaths": [
        "model/model.glb"
      ],
      "method": "Retained the existing headed Idle0 transparent still after verifying the updated model produces the same complete world-space geometry, normals, materials and presentation at that frame."
    },
    "license": {
      "spdx": "CC-BY-4.0",
      "name": "Creative Commons Attribution 4.0 International",
      "url": "https://creativecommons.org/licenses/by/4.0/"
    },
    "runtime": {
      "sha256": "eefd46d236d01c39fdce6f5183afc3a4f72f4f8e56c52bb34b9c009a95f6dd1b",
      "bytes": 12206
    },
    "modifications": [
      "Preserved the complete animal silhouette and source materials.",
      "Verified the final model’s initial pose and renderer presentation before deriving or retaining the static image."
    ],
    "attribution": "“塔利怪物” by huykhoi2407, CC BY 4.0; modified for the Prehistoric Animal Museum.",
    "redistributionAllowed": true,
    "evidencePaths": [
      "provenance/LICENSES/model-license.txt",
      "provenance/LICENSES/model-source.txt",
      "provenance/LICENSES/derived-images.txt"
    ]
  },
  {
    "assetPath": "images/thumbnail.webp",
    "kind": "thumbnail",
    "source": {
      "type": "derived",
      "title": "塔利怪物 scene collection thumbnail",
      "generatedOn": "2026-10-22",
      "inputAssetPaths": [
        "model/model.glb",
        "backgrounds/landscape.webp"
      ],
      "method": "Freshly composited the animal’s verified pose-equivalent headed Idle0 transparent model still over its own independently generated landscape background, then encoded as 320×320 WebP."
    },
    "license": {
      "spdx": "CC-BY-4.0",
      "name": "CC BY 4.0 model render; CC BY-NC-SA 4.0 background (component licences retained)",
      "url": "https://creativecommons.org/licenses/by/4.0/"
    },
    "runtime": {
      "sha256": "2394a2b5cb9dd1d08b6f2633c9919de221b2acfa0257333012790c376ad2f2e7",
      "bytes": 15082
    },
    "modifications": [
      "Preserved the complete animal silhouette and source materials.",
      "Verified the final model’s initial pose and renderer presentation before deriving or retaining the static image."
    ],
    "attribution": "“塔利怪物” by huykhoi2407, CC BY 4.0; modified for the Prehistoric Animal Museum. Background artwork: CC BY-NC-SA 4.0; underlying model render: CC BY 4.0, with component licences retained.",
    "redistributionAllowed": true,
    "evidencePaths": [
      "provenance/LICENSES/model-license.txt",
      "provenance/LICENSES/model-source.txt",
      "provenance/LICENSES/derived-images.txt"
    ]
  }
] as const satisfies readonly [AssetProvenance, ...AssetProvenance[]]
