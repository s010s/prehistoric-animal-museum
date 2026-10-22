import type { AssetProvenance } from '../../types'

export const provenance = [
  {
    "assetPath": "model/model.glb",
    "kind": "model",
    "source": {
      "type": "third-party",
      "title": "Styxosaurus snowii",
      "author": "Julian Johnson-Mortimer",
      "url": "https://sketchfab.com/models/c0ee838a9345458b91ef2cca3ba94542",
      "accessedOn": "2026-10-20",
      "sha256": "c5d9d785893a93289cd7ba8a10fc726a2bd52d96d34f6cf9bf2d022dbce40e89",
      "bytes": 7405456
    },
    "license": {
      "spdx": "CC-BY-4.0",
      "name": "Creative Commons Attribution 4.0 International",
      "url": "https://creativecommons.org/licenses/by/4.0/"
    },
    "runtime": {
      "sha256": "04afc983026c3a72ba72715276301d29c8a522bb7117cec98558463981270251",
      "bytes": 12549080
    },
    "modifications": [
      "Prepared a self-contained budgeted derivative while preserving source appearance and the original Swim clip.",
      "Authored a closed eight-second in-place Idle with clearly visible strokes of all four flippers and a larger tail follow-through, preserving the other animation clips."
    ],
    "attribution": "“Styxosaurus snowii” by Julian Johnson-Mortimer, CC BY 4.0; modified for the Prehistoric Animal Museum.",
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
      "title": "冥河龙 empty habitat — landscape",
      "tool": "built-in image_gen",
      "generatedOn": "2026-10-22",
      "prompt": "Use case: historical-scene. Asset: a new environment background for a calm preschool 3D natural history museum. Scene: Late Cretaceous Western Interior Seaway underwater, luminous clear azure open-water column filling central and upper frame, a very distant sloping white chalk seafloor low on right, broad thin pale light bands near surface; open and expansive with no reef. Soft naturalistic hand-painted gouache, convincing landscape depth with subtle natural textures, inviting readable midtones. Empty environment only. Keep central 75% visually quiet for a separately rendered animal and upper corners uncluttered for controls. For underwater scenes keep seabed in lowest 18% and a large clear middle water volume. For land scenes foreground must be one continuous level ground surface across full width with no ledge/platform/ridge or trench; horizon near upper third. No animals, fish, birds, humans, skeletons, shells, fossils, modern lawns/flowers, text, logos, UI, watermarks, floating particles, baked animal shadows, spotlit plinths or collage. Independently compose one LANDSCAPE 16:9 wide image.",
      "sha256": "b44564b655360bed1c1966a171dbee925ca39ea3476e2cebe3ac64f8622251b8",
      "bytes": 1780149
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "sha256": "05f304807f9ff1dcad96c8229141dc25f0d967420e6e10d08f663eff9d5e36e1",
      "bytes": 76928
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
      "title": "冥河龙 empty habitat — portrait",
      "tool": "built-in image_gen",
      "generatedOn": "2026-10-22",
      "prompt": "Use case: historical-scene. Asset: a new environment background for a calm preschool 3D natural history museum. Scene: Late Cretaceous Western Interior Seaway underwater, luminous clear azure open-water column filling central and upper frame, a very distant sloping white chalk seafloor low on right, broad thin pale light bands near surface; open and expansive with no reef. Soft naturalistic hand-painted gouache, convincing landscape depth with subtle natural textures, inviting readable midtones. Empty environment only. Keep central 75% visually quiet for a separately rendered animal and upper corners uncluttered for controls. For underwater scenes keep seabed in lowest 18% and a large clear middle water volume. For land scenes foreground must be one continuous level ground surface across full width with no ledge/platform/ridge or trench; horizon near upper third. No animals, fish, birds, humans, skeletons, shells, fossils, modern lawns/flowers, text, logos, UI, watermarks, floating particles, baked animal shadows, spotlit plinths or collage. Independently compose one PORTRAIT 9:16 tall image, with ample empty vertical space. This is a fresh tall composition, not a crop of a wide scene.",
      "sha256": "721f8e5a23478460380e92947c8d4f1e64b4f6d9725a881bf8b55949251b4aa1",
      "bytes": 1848625
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "sha256": "b7491c9c94c15c77c9bbb22891d5c80edaf837f317583c9ed5470b7108e8fa25",
      "bytes": 82322
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
      "title": "冥河龙 Chinese narration",
      "tool": "Qwen3-TTS CustomVoice",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena built-in voice",
      "generatedOn": "2026-10-22",
      "prompt": "先找找冥河龙的小脑袋，再用眼睛顺着长脖子一直找到身体。身体两侧还有四只鳍状肢，像四把划水的小桨。",
      "sha256": "65ba162c73e8c7bd6f12779b56856e776732ea462b99725b00af8ae0d03ed315",
      "bytes": 835244
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "sha256": "421c2258d2a98ccb19edac370dfda0fe9e28579269b3f9cf5c979bf933492b05",
      "bytes": 110205
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
      "title": "冥河龙 English narration",
      "tool": "Qwen3-TTS CustomVoice",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena built-in voice",
      "generatedOn": "2026-10-22",
      "prompt": "Find Styxosaurus’s small head, then follow its long neck with your eyes all the way to its body. Four flippers sit along its sides, like four little paddles for moving through the water.",
      "sha256": "4af718bf87aa9a2ea2e4f241d3fe041e108dfe16b3ef5627ceb1406e41afeac4",
      "bytes": 1019564
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "sha256": "b87c6669899d06bcb628b8ece95b1acd6e7332947a51b1b1ab3e920f8afd4276",
      "bytes": 135405
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
      "title": "冥河龙 transparent landscape model still",
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
      "sha256": "4ab96c5386e018d0c6cd88add5f909a3fdbf91896a6efa16bb4598d21c1421e7",
      "bytes": 48884
    },
    "modifications": [
      "Preserved the complete animal silhouette and source materials.",
      "Verified the final model’s initial pose and renderer presentation before deriving or retaining the static image."
    ],
    "attribution": "“Styxosaurus snowii” by Julian Johnson-Mortimer, CC BY 4.0; modified for the Prehistoric Animal Museum.",
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
      "title": "冥河龙 transparent portrait model still",
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
      "sha256": "63ba330cc7d9f9ad94b1e5b7f7c24a3199adaf5ab21074006b678fb88ec1a257",
      "bytes": 8772
    },
    "modifications": [
      "Preserved the complete animal silhouette and source materials.",
      "Verified the final model’s initial pose and renderer presentation before deriving or retaining the static image."
    ],
    "attribution": "“Styxosaurus snowii” by Julian Johnson-Mortimer, CC BY 4.0; modified for the Prehistoric Animal Museum.",
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
      "title": "冥河龙 scene collection thumbnail",
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
      "sha256": "cf65e5b1c327485140032f1770fb297b291660b520961711ca44107454c4028d",
      "bytes": 9866
    },
    "modifications": [
      "Preserved the complete animal silhouette and source materials.",
      "Verified the final model’s initial pose and renderer presentation before deriving or retaining the static image."
    ],
    "attribution": "“Styxosaurus snowii” by Julian Johnson-Mortimer, CC BY 4.0; modified for the Prehistoric Animal Museum. Background artwork: CC BY-NC-SA 4.0; underlying model render: CC BY 4.0, with component licences retained.",
    "redistributionAllowed": true,
    "evidencePaths": [
      "provenance/LICENSES/model-license.txt",
      "provenance/LICENSES/model-source.txt",
      "provenance/LICENSES/derived-images.txt"
    ]
  }
] as const satisfies readonly [AssetProvenance, ...AssetProvenance[]]
