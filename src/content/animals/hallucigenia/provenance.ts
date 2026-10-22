import type { AssetProvenance } from '../../types'

export const provenance = [
  {
    "assetPath": "model/model.glb",
    "kind": "model",
    "source": {
      "type": "third-party",
      "title": "怪诞虫",
      "author": "huykhoi2407",
      "url": "https://sketchfab.com/3d-models/hallucigenia-cambrian-animal-fad8306e863a4960b48e49c16c3806cf",
      "accessedOn": "2026-10-20",
      "sha256": "afc0ca41e7069889c80711a5b04d0148b5c864eaf20a47d62e922b869620cd25",
      "bytes": 5860864
    },
    "license": {
      "spdx": "CC-BY-4.0",
      "name": "Creative Commons Attribution 4.0 International",
      "url": "https://creativecommons.org/licenses/by/4.0/"
    },
    "runtime": {
      "sha256": "2f1c725ab3410bc0b650ee442d7028555e63b51288fb8a6531997941dc8daa1e",
      "bytes": 5640768
    },
    "modifications": [
      "Prepared a self-contained budgeted derivative with a segmented appendage rig.",
      "Authored a closed eight-second Idle with visible staggered motion through all twenty segmented appendage chains, including the terminal support-leg sections; kept the spine-bearing roots stable."
    ],
    "attribution": "“怪诞虫” by huykhoi2407, CC BY 4.0; modified for the Prehistoric Animal Museum.",
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
      "title": "怪诞虫 empty habitat — landscape",
      "tool": "built-in image_gen",
      "generatedOn": "2026-10-22",
      "prompt": "Use case: historical-scene. Asset: a new environment background for a calm preschool 3D natural history museum. Scene: Cambrian shallow seafloor, pale mint water and broad ivory fine-silt plain, low simple tubular sponge clusters only at far left bottom, flat low pebble patch at opposite corner; intimate tiny-animal scale. Soft naturalistic hand-painted gouache, convincing landscape depth with subtle natural textures, inviting readable midtones. Empty environment only. Keep central 75% visually quiet for a separately rendered animal and upper corners uncluttered for controls. For underwater scenes keep seabed in lowest 18% and a large clear middle water volume. For land scenes foreground must be one continuous level ground surface across full width with no ledge/platform/ridge or trench; horizon near upper third. No animals, fish, birds, humans, skeletons, shells, fossils, modern lawns/flowers, text, logos, UI, watermarks, floating particles, baked animal shadows, spotlit plinths or collage. Independently compose one LANDSCAPE 16:9 wide image.",
      "sha256": "fbfd738709b65fa01eb8e84e7f15b4c0e0e8aa470a51751fbfcc7db11c7f026b",
      "bytes": 2046757
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "sha256": "5304af7ec93c61c5e20881fc4843cd092b1a5bd43dc09500c84f60d8ea1261ec",
      "bytes": 103888
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
      "title": "怪诞虫 empty habitat — portrait",
      "tool": "built-in image_gen",
      "generatedOn": "2026-10-22",
      "prompt": "Use case: historical-scene. Asset: a new environment background for a calm preschool 3D natural history museum. Scene: Cambrian shallow seafloor, pale mint water and broad ivory fine-silt plain, low simple tubular sponge clusters only at far left bottom, flat low pebble patch at opposite corner; intimate tiny-animal scale. Soft naturalistic hand-painted gouache, convincing landscape depth with subtle natural textures, inviting readable midtones. Empty environment only. Keep central 75% visually quiet for a separately rendered animal and upper corners uncluttered for controls. For underwater scenes keep seabed in lowest 18% and a large clear middle water volume. For land scenes foreground must be one continuous level ground surface across full width with no ledge/platform/ridge or trench; horizon near upper third. No animals, fish, birds, humans, skeletons, shells, fossils, modern lawns/flowers, text, logos, UI, watermarks, floating particles, baked animal shadows, spotlit plinths or collage. Independently compose one PORTRAIT 9:16 tall image, with ample empty vertical space. This is a fresh tall composition, not a crop of a wide scene.",
      "sha256": "38b5ca315e01618162e29715d16ede5b3bfeb78575987d79f920e544cfb6c7c1",
      "bytes": 2014611
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "sha256": "e0e93e17281dc27b3e5f0f623f13653b3f4b2519564bd2b73584aadf141dd33f",
      "bytes": 93056
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
      "title": "怪诞虫 Chinese narration",
      "tool": "Qwen3-TTS CustomVoice",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena built-in voice",
      "generatedOn": "2026-10-22",
      "prompt": "摊开小手比一比，怪诞虫的身体只有几厘米长。它的背上有成对的尖刺，身体下面还排着一条条细腿。",
      "sha256": "09d3407ebf0e2d16e493b41755df3287b583c2c8637b81dd6e5c843b40d80dea",
      "bytes": 685484
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "sha256": "0ddc48020733fe47d22bded2c8adfdf560f03f9329dee0debfd6ca367bff878c",
      "bytes": 90285
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
      "title": "怪诞虫 English narration",
      "tool": "Qwen3-TTS CustomVoice",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena built-in voice",
      "generatedOn": "2026-10-22",
      "prompt": "Open your hand and imagine Hallucigenia, only a few centimetres long. It had pairs of spines on its back, with rows of little legs underneath.",
      "sha256": "f18b2116130fe5b37d938e7ab5f11b4d84d602eab6b41d3b31715e691c4d0892",
      "bytes": 846764
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "sha256": "57253cde3fcd079b05d0ac8c86a0d1c7edd0a0365e6b9d919d83e93054e72b17",
      "bytes": 111405
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
      "title": "怪诞虫 transparent landscape model still",
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
      "sha256": "90af50b61d30fa6f7e19362799c77965232b3f057779ce0aac53d109f3690fcd",
      "bytes": 105098
    },
    "modifications": [
      "Preserved the complete animal silhouette and source materials.",
      "Verified the final model’s initial pose and renderer presentation before deriving or retaining the static image."
    ],
    "attribution": "“怪诞虫” by huykhoi2407, CC BY 4.0; modified for the Prehistoric Animal Museum.",
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
      "title": "怪诞虫 transparent portrait model still",
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
      "sha256": "579f12ed7961e139b07520ed912d8b5795601db456a40f1e5da85c72ec423750",
      "bytes": 23394
    },
    "modifications": [
      "Preserved the complete animal silhouette and source materials.",
      "Verified the final model’s initial pose and renderer presentation before deriving or retaining the static image."
    ],
    "attribution": "“怪诞虫” by huykhoi2407, CC BY 4.0; modified for the Prehistoric Animal Museum.",
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
      "title": "怪诞虫 scene collection thumbnail",
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
      "sha256": "844802c01912b326654899a1ec2b127f1b62679273e8a336d76e7d7876ff80c5",
      "bytes": 11584
    },
    "modifications": [
      "Preserved the complete animal silhouette and source materials.",
      "Verified the final model’s initial pose and renderer presentation before deriving or retaining the static image."
    ],
    "attribution": "“怪诞虫” by huykhoi2407, CC BY 4.0; modified for the Prehistoric Animal Museum. Background artwork: CC BY-NC-SA 4.0; underlying model render: CC BY 4.0, with component licences retained.",
    "redistributionAllowed": true,
    "evidencePaths": [
      "provenance/LICENSES/model-license.txt",
      "provenance/LICENSES/model-source.txt",
      "provenance/LICENSES/derived-images.txt"
    ]
  }
] as const satisfies readonly [AssetProvenance, ...AssetProvenance[]]
