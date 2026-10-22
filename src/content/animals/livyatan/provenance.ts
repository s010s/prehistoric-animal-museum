import type { AssetProvenance } from '../../types'

export const provenance = [
  {
    "assetPath": "model/model.glb",
    "kind": "model",
    "source": {
      "type": "third-party",
      "title": "Livyatan melvillei",
      "author": "majorgalah",
      "url": "https://sketchfab.com/models/8313bd7fde514b108c9ef469817b62ba",
      "accessedOn": "2026-10-20",
      "sha256": "8dcb2f2f471897e638a07c62eb66b972d64ffa8f49ae8278b3bab6b658cbf6f0",
      "bytes": 1435168
    },
    "license": {
      "spdx": "CC-BY-4.0",
      "name": "Creative Commons Attribution 4.0 International",
      "url": "https://creativecommons.org/licenses/by/4.0/"
    },
    "runtime": {
      "sha256": "74d0c2f720cc16ad3427a906f111a7da70c1ad877740e9183e6b772dfd239452",
      "bytes": 5588140
    },
    "modifications": [
      "Prepared a self-contained budgeted derivative with a smooth body surface and a repaired mouth/jaw deformation chain.",
      "Authored a closed eight-second in-place Idle with clearly visible paired pectoral strokes and increased vertical tail motion, preserving the other animation clips."
    ],
    "attribution": "“Livyatan melvillei” by majorgalah, CC BY 4.0; modified for the Prehistoric Animal Museum.",
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
      "title": "梅氏利维坦鲸 empty habitat — landscape",
      "tool": "built-in image_gen",
      "generatedOn": "2026-10-22",
      "prompt": "Use case: historical-scene. Asset: a new environment background for a calm preschool 3D natural history museum. Scene: Miocene Pacific coastal underwater scene, deep luminous teal water, distant submerged charcoal volcanic ridge on left edge descending into clean central blue, lowest part fine dark sand, soft cool overhead daylight; no giant kelp, reef or modern coastal structures. Soft naturalistic hand-painted gouache, convincing landscape depth with subtle natural textures, inviting readable midtones. Empty environment only. Keep central 75% visually quiet for a separately rendered animal and upper corners uncluttered for controls. For underwater scenes keep seabed in lowest 18% and a large clear middle water volume. For land scenes foreground must be one continuous level ground surface across full width with no ledge/platform/ridge or trench; horizon near upper third. No animals, fish, birds, humans, skeletons, shells, fossils, modern lawns/flowers, text, logos, UI, watermarks, floating particles, baked animal shadows, spotlit plinths or collage. Independently compose one LANDSCAPE 16:9 wide image.",
      "sha256": "0bbd4e3b1f0df43fc4f5281efa1fb6e93b961edaba1ad5c59338798ad36eb274",
      "bytes": 1951886
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "sha256": "c359fa37efc1917c2de3dbbe01a8c20dda44a1d717e9b69122dd0bb50da53762",
      "bytes": 89106
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
      "title": "梅氏利维坦鲸 empty habitat — portrait",
      "tool": "built-in image_gen",
      "generatedOn": "2026-10-22",
      "prompt": "Use case: historical-scene. Asset: a new environment background for a calm preschool 3D natural history museum. Scene: Miocene Pacific coastal underwater scene, deep luminous teal water, distant submerged charcoal volcanic ridge on left edge descending into clean central blue, lowest part fine dark sand, soft cool overhead daylight; no giant kelp, reef or modern coastal structures. Soft naturalistic hand-painted gouache, convincing landscape depth with subtle natural textures, inviting readable midtones. Empty environment only. Keep central 75% visually quiet for a separately rendered animal and upper corners uncluttered for controls. For underwater scenes keep seabed in lowest 18% and a large clear middle water volume. For land scenes foreground must be one continuous level ground surface across full width with no ledge/platform/ridge or trench; horizon near upper third. No animals, fish, birds, humans, skeletons, shells, fossils, modern lawns/flowers, text, logos, UI, watermarks, floating particles, baked animal shadows, spotlit plinths or collage. Independently compose one PORTRAIT 9:16 tall image, with ample empty vertical space. This is a fresh tall composition, not a crop of a wide scene.",
      "sha256": "32f3d74904530d8c8ff0910a337c043957bdcb21cb8e144376f94531284fbffe",
      "bytes": 2109308
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "sha256": "1e8d7ec89e41e004f147c35c9931afd402ca9812580a63cd27dfc6ede48a3773",
      "bytes": 107858
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
      "title": "梅氏利维坦鲸 Chinese narration",
      "tool": "Qwen3-TTS CustomVoice",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena built-in voice",
      "generatedOn": "2026-10-22",
      "prompt": "梅氏利维坦鲸的嘴里，上面有大牙齿，下面也有大牙齿。把它转到侧面，顺着嘴边慢慢找，上下两排你都发现了吗？",
      "sha256": "6ba5c30b9ac564f263112e75ebb48386226c16ce713b2f0e9b107836ca697370",
      "bytes": 921644
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "sha256": "a45d110e83663f4e60b55da89084cae2b5e2487875dc7fe286b3c88b4bda4fa9",
      "bytes": 121485
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
      "title": "梅氏利维坦鲸 English narration",
      "tool": "Qwen3-TTS CustomVoice",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena built-in voice",
      "generatedOn": "2026-10-22",
      "prompt": "Livyatan had large teeth in both its upper and lower jaws. Turn it to the side and see if you can find both rows along the edge of its mouth.",
      "sha256": "c50a33a0020a82baf0f1d0e7697916a5cbcb9b437a05a7d3bc61179a8cab3406",
      "bytes": 777644
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "sha256": "d87a0f431d0a10aa7eca07ba7c7f1fa751d840a7f53e7aa787cc8493a4feb497",
      "bytes": 103005
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
      "title": "梅氏利维坦鲸 transparent landscape model still",
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
      "sha256": "c1e317e9dae1a631b9f27cc4646f21cc13e3914452caba0ba76edc915c367c99",
      "bytes": 53560
    },
    "modifications": [
      "Preserved the complete animal silhouette and source materials.",
      "Verified the final model’s initial pose and renderer presentation before deriving or retaining the static image."
    ],
    "attribution": "“Livyatan melvillei” by majorgalah, CC BY 4.0; modified for the Prehistoric Animal Museum.",
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
      "title": "梅氏利维坦鲸 transparent portrait model still",
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
      "sha256": "167a8557f0f70e986316e31209dce4b05c4203954ebe661522cb792edae61604",
      "bytes": 10930
    },
    "modifications": [
      "Preserved the complete animal silhouette and source materials.",
      "Verified the final model’s initial pose and renderer presentation before deriving or retaining the static image."
    ],
    "attribution": "“Livyatan melvillei” by majorgalah, CC BY 4.0; modified for the Prehistoric Animal Museum.",
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
      "title": "梅氏利维坦鲸 scene collection thumbnail",
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
      "sha256": "652d4efbe8d6d20b61b2b981fcb906cded8a8913cacf72811a9c73fd9b8f5c5d",
      "bytes": 7426
    },
    "modifications": [
      "Preserved the complete animal silhouette and source materials.",
      "Verified the final model’s initial pose and renderer presentation before deriving or retaining the static image."
    ],
    "attribution": "“Livyatan melvillei” by majorgalah, CC BY 4.0; modified for the Prehistoric Animal Museum. Background artwork: CC BY-NC-SA 4.0; underlying model render: CC BY 4.0, with component licences retained.",
    "redistributionAllowed": true,
    "evidencePaths": [
      "provenance/LICENSES/model-license.txt",
      "provenance/LICENSES/model-source.txt",
      "provenance/LICENSES/derived-images.txt"
    ]
  }
] as const satisfies readonly [AssetProvenance, ...AssetProvenance[]]
