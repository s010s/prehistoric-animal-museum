import type { AssetProvenance } from '../../types'

export const provenance = [
  {
    "assetPath": "model/model.glb",
    "kind": "model",
    "source": {
      "type": "third-party",
      "title": "Allosaurus",
      "author": "PAndras (PusztaiAndras)",
      "url": "https://sketchfab.com/3d-models/allosaurus-6c5142e093a147bdb86e0eeb837b476c",
      "accessedOn": "2026-10-20",
      "bytes": 14596260,
      "sha256": "a96163810429c8d35719d381b27f8faeb09e87a0cd6d16e0ff5bac06ab0ba546"
    },
    "license": {
      "spdx": "CC-BY-4.0",
      "name": "Creative Commons Attribution 4.0 International",
      "url": "https://creativecommons.org/licenses/by/4.0/"
    },
    "runtime": {
      "sha256": "265e4d435674defcf29fa01283051d1a2f025e768c240605d6200b2ead1922d3",
      "bytes": 9604028
    },
    "modifications": [
      "Prepared a neutral, non-morph glTF derivative with corrected knee skinning and project armature while retaining source geometry, materials and textures.",
      "Authored an eight-second standing Idle with a larger tail sweep and conspicuous paired foreclaw movement; preserved the Walk clip."
    ],
    "attribution": "“Allosaurus” by PAndras (PusztaiAndras), CC BY 4.0; modified for the Prehistoric Animal Museum.",
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
      "title": "Allosaurus habitat — landscape",
      "tool": "built-in image_gen",
      "generatedOn": "2026-10-22",
      "prompt": "Use case: historical-scene. Asset: a new environment background for a calm preschool 3D natural history museum. Scene: Late Jurassic Morrison floodplain, level pale ochre alluvial earth foreground, broad distant shallow river curving behind, layered burnt-orange sandstone mesas on far left horizon, scattered low cycads and umbrella conifers far right, clear late afternoon cream sky. Soft naturalistic hand-painted gouache, convincing landscape depth with subtle natural textures, inviting readable midtones. Empty environment only. Keep central 75% visually quiet for a separately rendered animal and upper corners uncluttered for controls. For underwater scenes keep seabed in lowest 18% and a large clear middle water volume. For land scenes foreground must be one continuous level ground surface across full width with no ledge/platform/ridge or trench; horizon near upper third. No animals, fish, birds, humans, skeletons, shells, fossils, modern lawns/flowers, text, logos, UI, watermarks, floating particles, baked animal shadows, spotlit plinths or collage. Independently compose one LANDSCAPE 16:9 wide image.",
      "bytes": 2779587,
      "sha256": "26209908a8059d0c5553d976d167d015f27f03a1e774bbc8af8c127a70b6baca"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International — project-authored content",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "sha256": "bda60c1aba3f561a40f6021427b886bb867e0bcf78c5d14e462796390d910bef",
      "bytes": 262328
    },
    "modifications": [
      "Converted this animal’s independently generated composition to compact WebP.",
      "Kept the central display area empty for the separate 3D animal; landscape and portrait are separate ImageGen outputs."
    ],
    "attribution": "Project-generated habitat art created with OpenAI ImageGen.",
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
      "title": "Allosaurus habitat — portrait",
      "tool": "built-in image_gen",
      "generatedOn": "2026-10-22",
      "prompt": "Use case: historical-scene. Asset: a new environment background for a calm preschool 3D natural history museum. Scene: Late Jurassic Morrison floodplain, level pale ochre alluvial earth foreground, broad distant shallow river curving behind, layered burnt-orange sandstone mesas on far left horizon, scattered low cycads and umbrella conifers far right, clear late afternoon cream sky. Soft naturalistic hand-painted gouache, convincing landscape depth with subtle natural textures, inviting readable midtones. Empty environment only. Keep central 75% visually quiet for a separately rendered animal and upper corners uncluttered for controls. For underwater scenes keep seabed in lowest 18% and a large clear middle water volume. For land scenes foreground must be one continuous level ground surface across full width with no ledge/platform/ridge or trench; horizon near upper third. No animals, fish, birds, humans, skeletons, shells, fossils, modern lawns/flowers, text, logos, UI, watermarks, floating particles, baked animal shadows, spotlit plinths or collage. Independently compose one PORTRAIT 9:16 tall image, with ample empty vertical space. This is a fresh tall composition, not a crop of a wide scene.",
      "bytes": 2681111,
      "sha256": "3d31b51d8fd301ead472855882877a67e3963c145a930b65f0549270922d2c6f"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International — project-authored content",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "sha256": "75d451663a7fc3f5fea395f7da34d28087da71153605e0deac4dabd2ed5495e5",
      "bytes": 230300
    },
    "modifications": [
      "Converted this animal’s independently generated composition to compact WebP.",
      "Kept the central display area empty for the separate 3D animal; landscape and portrait are separate ImageGen outputs."
    ],
    "attribution": "Project-generated habitat art created with OpenAI ImageGen.",
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
      "title": "Allosaurus Chinese narration",
      "tool": "Qwen3-TTS CustomVoice",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena built-in voice",
      "generatedOn": "2026-10-22",
      "prompt": "异特龙的两只小手，每只都有三根带爪的手指。张开你的小手和它比一比，再找找它眼睛上方的小突起。",
      "bytes": 94845,
      "sha256": "6fa478428dfde6253983854b55778907ba3979d3c99e0c703e4c1032fb81e9f6"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International — project-authored content",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "bytes": 94845,
      "sha256": "6fa478428dfde6253983854b55778907ba3979d3c99e0c703e4c1032fb81e9f6"
    },
    "modifications": [
      "Generated offline from the exact two-sentence script using the built-in Serena voice.",
      "Normalised to 48 kHz mono MP3; copied without re-encoding."
    ],
    "attribution": "Project-generated Chinese narration, reviewed by humans and synthesized offline using Qwen3-TTS 0.6B CustomVoice (Serena).",
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
      "title": "Allosaurus English narration",
      "tool": "Qwen3-TTS CustomVoice",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena built-in voice",
      "generatedOn": "2026-10-22",
      "prompt": "Allosaurus had three clawed fingers on each hand. Open your own hand to compare, then look for the little bumps above its eyes.",
      "bytes": 81405,
      "sha256": "55ab22975f69d3a91643b82a4269972d0bfbf48972fa5bc1a696f0a4161b1ce8"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International — project-authored content",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "bytes": 81405,
      "sha256": "55ab22975f69d3a91643b82a4269972d0bfbf48972fa5bc1a696f0a4161b1ce8"
    },
    "modifications": [
      "Generated offline from the exact two-sentence script using the built-in Serena voice.",
      "Normalised to 48 kHz mono MP3; copied without re-encoding."
    ],
    "attribution": "Project-generated English narration, reviewed by humans and synthesized offline using Qwen3-TTS 0.6B CustomVoice (Serena).",
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
      "title": "Allosaurus transparent model poster",
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
      "sha256": "02784c6bcf573e16f16c9bd6187c8eb96cf55052467886201de784546d6f71ce",
      "bytes": 107186
    },
    "modifications": [
      "Preserved the complete animal silhouette and source materials.",
      "Verified the final model’s initial pose and renderer presentation before deriving or retaining the static image."
    ],
    "attribution": "“Allosaurus” by PAndras (PusztaiAndras), CC BY 4.0; modified for the Prehistoric Animal Museum.",
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
      "title": "Allosaurus transparent model poster",
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
      "sha256": "a0b800e4ac0bb61ce35680469ad4163dc8f883c5523a8feb044451893d87ab4d",
      "bytes": 18178
    },
    "modifications": [
      "Preserved the complete animal silhouette and source materials.",
      "Verified the final model’s initial pose and renderer presentation before deriving or retaining the static image."
    ],
    "attribution": "“Allosaurus” by PAndras (PusztaiAndras), CC BY 4.0; modified for the Prehistoric Animal Museum.",
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
      "title": "Allosaurus collection thumbnail",
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
      "sha256": "71e38db4a4020c2a14e1eea90ca646bc7362bddc3eadc5f1e5da9d7065b58136",
      "bytes": 20282
    },
    "modifications": [
      "Preserved the complete animal silhouette and source materials.",
      "Verified the final model’s initial pose and renderer presentation before deriving or retaining the static image."
    ],
    "attribution": "“Allosaurus” by PAndras (PusztaiAndras), CC BY 4.0; modified for the Prehistoric Animal Museum. Background art is project-generated and licensed separately under CC BY-NC-SA 4.0.",
    "redistributionAllowed": true,
    "evidencePaths": [
      "provenance/LICENSES/model-license.txt",
      "provenance/LICENSES/model-source.txt",
      "provenance/LICENSES/derived-images.txt"
    ]
  }
] as const satisfies readonly [AssetProvenance, ...AssetProvenance[]]
