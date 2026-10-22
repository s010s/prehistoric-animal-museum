import type { AssetProvenance } from '../../types'

export const provenance = [
  {
    "assetPath": "model/model.glb",
    "kind": "model",
    "source": {
      "type": "third-party",
      "title": "菊石类",
      "author": "Emil van Dam",
      "url": "https://sketchfab.com/3d-models/ammonite-6f835b20078e4d7fbfa42d1dfe6797ba",
      "accessedOn": "2026-10-20",
      "sha256": "4081fae37646e2c2f64dd4b6c7ac3cd4f2c1245e37fc49c6959d6c7b917b922a",
      "bytes": 6257476
    },
    "license": {
      "spdx": "CC-BY-4.0",
      "name": "Creative Commons Attribution 4.0 International",
      "url": "https://creativecommons.org/licenses/by/4.0/"
    },
    "runtime": {
      "sha256": "72b099427fc277500ae38f9291f2e46ddbfe25342faa05394cfed4797dd02d04",
      "bytes": 3629608
    },
    "modifications": [
      "Prepared a self-contained budgeted derivative and retained shell, textures and existing arm structure.",
      "Authored gentle closed eight-second water-driven arm motion with slight lateral variation while keeping the shell stable.",
      "Preserved the existing closed eight-second tentacle Idle; the animal has no vertebrate tail."
    ],
    "attribution": "“菊石类” by Emil van Dam, CC BY 4.0; modified for the Prehistoric Animal Museum.",
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
      "title": "菊石类 empty habitat — landscape",
      "tool": "built-in image_gen",
      "generatedOn": "2026-10-22",
      "prompt": "Use case: historical-scene. Asset: a new environment background for a calm preschool 3D natural history museum. Scene: Mesozoic continental shelf underwater, clear periwinkle-blue water, pale limestone sand and a few rounded violet-grey limestone boulders restricted to lower corners, faint distant continental shelf visible low in frame. Soft naturalistic hand-painted gouache, convincing landscape depth with subtle natural textures, inviting readable midtones. Empty environment only. Keep central 75% visually quiet for a separately rendered animal and upper corners uncluttered for controls. For underwater scenes keep seabed in lowest 18% and a large clear middle water volume. For land scenes foreground must be one continuous level ground surface across full width with no ledge/platform/ridge or trench; horizon near upper third. No animals, fish, birds, humans, skeletons, shells, fossils, modern lawns/flowers, text, logos, UI, watermarks, floating particles, baked animal shadows, spotlit plinths or collage. Independently compose one LANDSCAPE 16:9 wide image.",
      "sha256": "315a8cf9dc995e24067a9e9ea2d7b00901aa7a6ddba6ccee65bf032ce405c2a1",
      "bytes": 1830841
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "sha256": "1feaf58fc763d1a7e1f433616aaf091f12a6c84268f88cb3482b9f7c710753c5",
      "bytes": 84992
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
      "title": "菊石类 empty habitat — portrait",
      "tool": "built-in image_gen",
      "generatedOn": "2026-10-22",
      "prompt": "Use case: historical-scene. Asset: a new environment background for a calm preschool 3D natural history museum. Scene: Mesozoic continental shelf underwater, clear periwinkle-blue water, pale limestone sand and a few rounded violet-grey limestone boulders restricted to lower corners, faint distant continental shelf visible low in frame. Soft naturalistic hand-painted gouache, convincing landscape depth with subtle natural textures, inviting readable midtones. Empty environment only. Keep central 75% visually quiet for a separately rendered animal and upper corners uncluttered for controls. For underwater scenes keep seabed in lowest 18% and a large clear middle water volume. For land scenes foreground must be one continuous level ground surface across full width with no ledge/platform/ridge or trench; horizon near upper third. No animals, fish, birds, humans, skeletons, shells, fossils, modern lawns/flowers, text, logos, UI, watermarks, floating particles, baked animal shadows, spotlit plinths or collage. Independently compose one PORTRAIT 9:16 tall image, with ample empty vertical space. This is a fresh tall composition, not a crop of a wide scene.",
      "sha256": "01b2d56682e778b340b7984bb1ccda20d620eabd42f5145fcddd472450c332fc",
      "bytes": 1872250
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "sha256": "8d1190f5052cab8c87e51d54227836e211ee40d90e34c7832561e979e9bbb5ed",
      "bytes": 84098
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
      "title": "菊石类 Chinese narration",
      "tool": "Qwen3-TTS CustomVoice",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena built-in voice",
      "generatedOn": "2026-10-22",
      "prompt": "这只菊石有卷成螺旋的壳，壳里的身体很柔软。用眼睛沿着螺旋慢慢往里走，一直找到最里面的那一圈。",
      "sha256": "c70e16ee37cc7b94215a8413333c78cb90574321ee47b2d5aa4cd03115dce88c",
      "bytes": 800684
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "sha256": "234056d71e72a0a77c04e16c576fc5c3bc363ef4ebc242a7b6344cdac8beb548",
      "bytes": 105405
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
      "title": "菊石类 English narration",
      "tool": "Qwen3-TTS CustomVoice",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena built-in voice",
      "generatedOn": "2026-10-22",
      "prompt": "This ammonite has a shell curled into a spiral, with a soft body inside. Follow the curling path with your eyes, slowly, all the way to the very middle.",
      "sha256": "9904c4db9b697f1c938dc35ed1e299771c6cad0b8d6f3d515a8f8cab921e5510",
      "bytes": 904364
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "sha256": "38e0852fb5fa866f12ed3d93e1a2cbbe79ce818989dd1983327dc6271e79aab9",
      "bytes": 119085
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
      "title": "菊石类 transparent landscape model still",
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
      "sha256": "a518e2fc84e2f35d39f524d6850cc92d45b2f0cc6eb1c1541683e2b5f8ef88da",
      "bytes": 146480
    },
    "modifications": [
      "Preserved the complete animal silhouette and source materials.",
      "Verified the final model’s initial pose and renderer presentation before deriving or retaining the static image."
    ],
    "attribution": "“菊石类” by Emil van Dam, CC BY 4.0; modified for the Prehistoric Animal Museum.",
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
      "title": "菊石类 transparent portrait model still",
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
      "sha256": "5f0eff126f81b3bfe298b457fd79a221d41a41a66e848212cc3cf449b15fd33b",
      "bytes": 29214
    },
    "modifications": [
      "Preserved the complete animal silhouette and source materials.",
      "Verified the final model’s initial pose and renderer presentation before deriving or retaining the static image."
    ],
    "attribution": "“菊石类” by Emil van Dam, CC BY 4.0; modified for the Prehistoric Animal Museum.",
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
      "title": "菊石类 scene collection thumbnail",
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
      "sha256": "4b6b723f5de2308a4ff5b018e5b666a7bbb45f8100fee59cd7673a06ef361041",
      "bytes": 11260
    },
    "modifications": [
      "Preserved the complete animal silhouette and source materials.",
      "Verified the final model’s initial pose and renderer presentation before deriving or retaining the static image."
    ],
    "attribution": "“菊石类” by Emil van Dam, CC BY 4.0; modified for the Prehistoric Animal Museum. Background artwork: CC BY-NC-SA 4.0; underlying model render: CC BY 4.0, with component licences retained.",
    "redistributionAllowed": true,
    "evidencePaths": [
      "provenance/LICENSES/model-license.txt",
      "provenance/LICENSES/model-source.txt",
      "provenance/LICENSES/derived-images.txt"
    ]
  }
] as const satisfies readonly [AssetProvenance, ...AssetProvenance[]]
