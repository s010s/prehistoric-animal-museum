import type { AssetProvenance } from '../../types'

export const provenance = [
  {
    "assetPath": "model/model.glb",
    "kind": "model",
    "source": {
      "type": "third-party",
      "title": "甲龙",
      "author": "pikabobalex",
      "url": "https://sketchfab.com/3d-models/dino-ankylosaurus-55b9adcbcf7846e8a833bfc77eaf3d3f",
      "accessedOn": "2026-10-20",
      "bytes": 4269096,
      "sha256": "425757980754dd37447b4e20942000c202bbbf43327f7a269b1e4e11ab5e5338"
    },
    "license": {
      "spdx": "CC-BY-4.0",
      "name": "Creative Commons Attribution 4.0 International",
      "url": "https://creativecommons.org/licenses/by/4.0/"
    },
    "runtime": {
      "sha256": "7447dc70cba8321b85e40356ae5f92477f319b3bc01ea309917d2b7927455b75",
      "bytes": 4334176
    },
    "modifications": [
      "Prepared a self-contained glTF derivative with calibrated material, coordinates and budget.",
      "Authored an eight-second standing Idle with a conspicuous tail-club sweep using a common tail-root pivot and retained segment follow-through; preserved the Walk clip."
    ],
    "attribution": "“甲龙” by pikabobalex, CC BY 4.0; modified for the Prehistoric Animal Museum.",
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
      "title": "Ankylosaurus habitat — landscape",
      "tool": "built-in image_gen",
      "generatedOn": "2026-10-22",
      "prompt": "Use case: historical-scene. Asset: a new environment background for a calm preschool 3D natural history museum. Scene: Late Cretaceous woodland clearing, broad flat muted brown leaf-litter earth foreground, tall dark green conifers grouped only at side edges, distant open forest softened by cool mist, a modest patch of low fern foliage at lower right; dappled soft light. Soft naturalistic hand-painted gouache, convincing landscape depth with subtle natural textures, inviting readable midtones. Empty environment only. Keep central 75% visually quiet for a separately rendered animal and upper corners uncluttered for controls. For underwater scenes keep seabed in lowest 18% and a large clear middle water volume. For land scenes foreground must be one continuous level ground surface across full width with no ledge/platform/ridge or trench; horizon near upper third. No animals, fish, birds, humans, skeletons, shells, fossils, modern lawns/flowers, text, logos, UI, watermarks, floating particles, baked animal shadows, spotlit plinths or collage. Independently compose one LANDSCAPE 16:9 wide image.",
      "bytes": 3270709,
      "sha256": "0ad6327bb67434a3b4f44406971416e822165e7364e2668a9ca3c5d4c712540a"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International — project-authored content",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "sha256": "79557bbd9ddc61045ddc8362be09be09b6e5e716cd51d96e44d133850c7fb9d0",
      "bytes": 384156
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
      "title": "Ankylosaurus habitat — portrait",
      "tool": "built-in image_gen",
      "generatedOn": "2026-10-22",
      "prompt": "Use case: historical-scene. Asset: a new environment background for a calm preschool 3D natural history museum. Scene: Late Cretaceous woodland clearing, broad flat muted brown leaf-litter earth foreground, tall dark green conifers grouped only at side edges, distant open forest softened by cool mist, a modest patch of low fern foliage at lower right; dappled soft light. Soft naturalistic hand-painted gouache, convincing landscape depth with subtle natural textures, inviting readable midtones. Empty environment only. Keep central 75% visually quiet for a separately rendered animal and upper corners uncluttered for controls. For underwater scenes keep seabed in lowest 18% and a large clear middle water volume. For land scenes foreground must be one continuous level ground surface across full width with no ledge/platform/ridge or trench; horizon near upper third. No animals, fish, birds, humans, skeletons, shells, fossils, modern lawns/flowers, text, logos, UI, watermarks, floating particles, baked animal shadows, spotlit plinths or collage. Independently compose one PORTRAIT 9:16 tall image, with ample empty vertical space. This is a fresh tall composition, not a crop of a wide scene.",
      "bytes": 3078205,
      "sha256": "96887bc71c43ec3c5356b4a02b859db82d2140b9ef927b487c164cb0548d2e7a"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International — project-authored content",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "sha256": "033a59af04bc13a4063215435f0c4515c0f56f60d8fe691dbd2983d68d63fcf2",
      "bytes": 327252
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
      "title": "Ankylosaurus Chinese narration",
      "tool": "Qwen3-TTS CustomVoice",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena built-in voice",
      "generatedOn": "2026-10-22",
      "prompt": "甲龙背上的骨质甲片，像一件结实的小盔甲。从背上顺着尾巴往后找，末端还有一个圆钝的尾槌。",
      "bytes": 86685,
      "sha256": "18b6d034e7bcfecaf5d8791b0924aff532796204c8ce1a51f559c6b167be7769"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International — project-authored content",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "bytes": 86685,
      "sha256": "18b6d034e7bcfecaf5d8791b0924aff532796204c8ce1a51f559c6b167be7769"
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
      "title": "Ankylosaurus English narration",
      "tool": "Qwen3-TTS CustomVoice",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena built-in voice",
      "generatedOn": "2026-10-22",
      "prompt": "The bony plates on Ankylosaurus look like a sturdy coat of armour. Follow its back towards the tail, all the way to the rounded club at the very end.",
      "bytes": 105645,
      "sha256": "3d7ae55ade3aa7b45dc0e1a657909babf9b22dff8b67d7d8e8abf09515bf3fdc"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International — project-authored content",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "bytes": 105645,
      "sha256": "3d7ae55ade3aa7b45dc0e1a657909babf9b22dff8b67d7d8e8abf09515bf3fdc"
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
      "title": "Ankylosaurus transparent model poster",
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
      "sha256": "316bf8b1f03ba3596e931ae46acff5f5d06a3333835cb958ee859ad577004f3d",
      "bytes": 142758
    },
    "modifications": [
      "Preserved the complete animal silhouette and source materials.",
      "Verified the final model’s initial pose and renderer presentation before deriving or retaining the static image."
    ],
    "attribution": "“甲龙” by pikabobalex, CC BY 4.0; modified for the Prehistoric Animal Museum.",
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
      "title": "Ankylosaurus transparent model poster",
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
      "sha256": "d1ae09eb6939f3560f8c6976cbd626ce5bb893c14cd0ef761088b8a1d15ab214",
      "bytes": 27242
    },
    "modifications": [
      "Preserved the complete animal silhouette and source materials.",
      "Verified the final model’s initial pose and renderer presentation before deriving or retaining the static image."
    ],
    "attribution": "“甲龙” by pikabobalex, CC BY 4.0; modified for the Prehistoric Animal Museum.",
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
      "title": "Ankylosaurus collection thumbnail",
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
      "sha256": "b68960bb1d63dd54a6104a7ba947d89f0d31fa4758ddffbd17093dc8ec0fa6cc",
      "bytes": 27248
    },
    "modifications": [
      "Preserved the complete animal silhouette and source materials.",
      "Verified the final model’s initial pose and renderer presentation before deriving or retaining the static image."
    ],
    "attribution": "“甲龙” by pikabobalex, CC BY 4.0; modified for the Prehistoric Animal Museum. Background art is project-generated and licensed separately under CC BY-NC-SA 4.0.",
    "redistributionAllowed": true,
    "evidencePaths": [
      "provenance/LICENSES/model-license.txt",
      "provenance/LICENSES/model-source.txt",
      "provenance/LICENSES/derived-images.txt"
    ]
  }
] as const satisfies readonly [AssetProvenance, ...AssetProvenance[]]
