import type { AssetProvenance } from '../../types'

export const provenance = [
  {
    "assetPath": "model/model.glb",
    "kind": "model",
    "source": {
      "type": "third-party",
      "title": "似鸡龙",
      "author": "htqj寒潭秋镜",
      "url": "https://sketchfab.com/3d-models/gallimimus-3694e4706ca844549ce9a6d57c555091",
      "accessedOn": "2026-10-20",
      "bytes": 1786764,
      "sha256": "740e5d4adfaba6df8fff5e309e9c7a5afeb9e1e250d0a49e48cf3446b9868c9d"
    },
    "license": {
      "spdx": "CC-BY-4.0",
      "name": "Creative Commons Attribution 4.0 International",
      "url": "https://creativecommons.org/licenses/by/4.0/"
    },
    "runtime": {
      "sha256": "d6f28eccc1a91b432b4a5fcc2364d69c024fd42eb1b7377b46ebb9782a8d348a",
      "bytes": 3579240
    },
    "modifications": [
      "Prepared a self-contained glTF derivative with calibrated material, coordinates and budget.",
      "Authored an eight-second standing Idle with a larger flexible tail sway; preserved the Walk clip and planted feet."
    ],
    "attribution": "“似鸡龙” by htqj寒潭秋镜, CC BY 4.0; modified for the Prehistoric Animal Museum.",
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
      "title": "Gallimimus habitat — landscape",
      "tool": "built-in image_gen",
      "generatedOn": "2026-10-22",
      "prompt": "Use case: historical-scene. Asset: a new environment background for a calm preschool 3D natural history museum. Scene: Late Cretaceous Mongolian semi-arid basin, broad level buff sand display ground, low lavender weathered hills very distant, one cluster of sparse low scrubby ancient vegetation at far right and dry shallow winding wash in far background, huge pale blue sky. Soft naturalistic hand-painted gouache, convincing landscape depth with subtle natural textures, inviting readable midtones. Empty environment only. Keep central 75% visually quiet for a separately rendered animal and upper corners uncluttered for controls. For underwater scenes keep seabed in lowest 18% and a large clear middle water volume. For land scenes foreground must be one continuous level ground surface across full width with no ledge/platform/ridge or trench; horizon near upper third. No animals, fish, birds, humans, skeletons, shells, fossils, modern lawns/flowers, text, logos, UI, watermarks, floating particles, baked animal shadows, spotlit plinths or collage. Independently compose one LANDSCAPE 16:9 wide image.",
      "bytes": 2225668,
      "sha256": "a925ef0d640679d403dc97f64688aa60ae79954bc9898ec435f6a4b57dad30ac"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International — project-authored content",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "sha256": "69ca5cd322a7a6e50c9da4f3196ed9b7f3cacc7df6a44863cacd79d0d6c55192",
      "bytes": 138498
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
      "title": "Gallimimus habitat — portrait",
      "tool": "built-in image_gen",
      "generatedOn": "2026-10-22",
      "prompt": "Use case: historical-scene. Asset: a new environment background for a calm preschool 3D natural history museum. Scene: Late Cretaceous Mongolian semi-arid basin, broad level buff sand display ground, low lavender weathered hills very distant, one cluster of sparse low scrubby ancient vegetation at far right and dry shallow winding wash in far background, huge pale blue sky. Soft naturalistic hand-painted gouache, convincing landscape depth with subtle natural textures, inviting readable midtones. Empty environment only. Keep central 75% visually quiet for a separately rendered animal and upper corners uncluttered for controls. For underwater scenes keep seabed in lowest 18% and a large clear middle water volume. For land scenes foreground must be one continuous level ground surface across full width with no ledge/platform/ridge or trench; horizon near upper third. No animals, fish, birds, humans, skeletons, shells, fossils, modern lawns/flowers, text, logos, UI, watermarks, floating particles, baked animal shadows, spotlit plinths or collage. Independently compose one PORTRAIT 9:16 tall image, with ample empty vertical space. This is a fresh tall composition, not a crop of a wide scene.",
      "bytes": 2635365,
      "sha256": "8a7fb88583aa7718dda9212270670892782fabaa762cdc0e7af1951385c287c9"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International — project-authored content",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "sha256": "ec39e5b27af8267b9b19fe7cc4ba33d00a17025369854fc47041b7cb5a070b3c",
      "bytes": 199276
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
      "title": "Gallimimus Chinese narration",
      "tool": "Qwen3-TTS CustomVoice",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena built-in voice",
      "generatedOn": "2026-10-22",
      "prompt": "张开嘴巴笑一笑，你的牙齿露出来了吗？似鸡龙有长长的腿和像鸟一样的喙，嘴巴里面没有牙齿。",
      "bytes": 89325,
      "sha256": "ccee4ec257444f18f7ca9c2a792099a4bec5747711d89f619ec264f11dbe9a32"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International — project-authored content",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "bytes": 89325,
      "sha256": "ccee4ec257444f18f7ca9c2a792099a4bec5747711d89f619ec264f11dbe9a32"
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
      "title": "Gallimimus English narration",
      "tool": "Qwen3-TTS CustomVoice",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena built-in voice",
      "generatedOn": "2026-10-22",
      "prompt": "Give a big smile and show your teeth, if you like. Gallimimus had long legs and a bird-like beak, with no teeth inside.",
      "bytes": 108525,
      "sha256": "3ef39685fc7c8319185995f55710d4c20bad5a7e98e6d612fb372c495e7f266d"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International — project-authored content",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "bytes": 108525,
      "sha256": "3ef39685fc7c8319185995f55710d4c20bad5a7e98e6d612fb372c495e7f266d"
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
      "title": "Gallimimus transparent model poster",
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
      "sha256": "9ad1ff4e5aa7d8f59d3d0a55047ef80921acc60b7d90d2f152761beaff57c294",
      "bytes": 108482
    },
    "modifications": [
      "Preserved the complete animal silhouette and source materials.",
      "Verified the final model’s initial pose and renderer presentation before deriving or retaining the static image."
    ],
    "attribution": "“似鸡龙” by htqj寒潭秋镜, CC BY 4.0; modified for the Prehistoric Animal Museum.",
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
      "title": "Gallimimus transparent model poster",
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
      "sha256": "f269b332e50712114226f103ccfde636fd23e1fa156de1e4df7fb0ffc5a7253d",
      "bytes": 18170
    },
    "modifications": [
      "Preserved the complete animal silhouette and source materials.",
      "Verified the final model’s initial pose and renderer presentation before deriving or retaining the static image."
    ],
    "attribution": "“似鸡龙” by htqj寒潭秋镜, CC BY 4.0; modified for the Prehistoric Animal Museum.",
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
      "title": "Gallimimus collection thumbnail",
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
      "sha256": "777150445ddb071191ab6b05336c3d6538f2f6285563f0462c4b8c4d86ca3e23",
      "bytes": 11934
    },
    "modifications": [
      "Preserved the complete animal silhouette and source materials.",
      "Verified the final model’s initial pose and renderer presentation before deriving or retaining the static image."
    ],
    "attribution": "“似鸡龙” by htqj寒潭秋镜, CC BY 4.0; modified for the Prehistoric Animal Museum. Background art is project-generated and licensed separately under CC BY-NC-SA 4.0.",
    "redistributionAllowed": true,
    "evidencePaths": [
      "provenance/LICENSES/model-license.txt",
      "provenance/LICENSES/model-source.txt",
      "provenance/LICENSES/derived-images.txt"
    ]
  }
] as const satisfies readonly [AssetProvenance, ...AssetProvenance[]]
