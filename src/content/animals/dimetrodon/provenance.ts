import type { AssetProvenance } from '../../types'

export const provenance = [
  {
    "assetPath": "model/model.glb",
    "kind": "model",
    "source": {
      "type": "third-party",
      "title": "异齿龙",
      "author": "cp4096",
      "url": "https://sketchfab.com/3d-models/dimetrodon-3ac7c6aada5e4c03849f9544bbc1afed",
      "accessedOn": "2026-10-20",
      "bytes": 4589688,
      "sha256": "1fea2d12d5d2fc88d1153c061b5faca8270333536db701cd8e830a780d7db251"
    },
    "license": {
      "spdx": "CC-BY-4.0",
      "name": "Creative Commons Attribution 4.0 International",
      "url": "https://creativecommons.org/licenses/by/4.0/"
    },
    "runtime": {
      "sha256": "5843890d9a33da3cbdedc84c30763881c347264c96af67340bdb8e11e1216b3c",
      "bytes": 6578256
    },
    "modifications": [
      "Prepared a self-contained glTF derivative with calibrated material, coordinates and budget.",
      "Authored an eight-second standing Idle with a larger flexible tail sway and compatible tail-follow joints; preserved the complete Walk deformation and original skin weights."
    ],
    "attribution": "“异齿龙” by cp4096, CC BY 4.0; modified for the Prehistoric Animal Museum.",
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
      "title": "Dimetrodon habitat — landscape",
      "tool": "built-in image_gen",
      "generatedOn": "2026-10-22",
      "prompt": "Use case: historical-scene. Asset: a new environment background for a calm preschool 3D natural history museum. Scene: Early Permian red-bed wetland margin, broad level brick-red and pale tan damp silt foreground, still narrow pool far back on right, tall horsetails and seed ferns behind far left margin, dry rust cliffs very distant, no flowering plants or grass. Soft naturalistic hand-painted gouache, convincing landscape depth with subtle natural textures, inviting readable midtones. Empty environment only. Keep central 75% visually quiet for a separately rendered animal and upper corners uncluttered for controls. For underwater scenes keep seabed in lowest 18% and a large clear middle water volume. For land scenes foreground must be one continuous level ground surface across full width with no ledge/platform/ridge or trench; horizon near upper third. No animals, fish, birds, humans, skeletons, shells, fossils, modern lawns/flowers, text, logos, UI, watermarks, floating particles, baked animal shadows, spotlit plinths or collage. Independently compose one LANDSCAPE 16:9 wide image.",
      "bytes": 2641925,
      "sha256": "f2986131b75be53f46d19ae2579d284febb8201e15d14a2ed35ed2d6a0ac7342"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International — project-authored content",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "sha256": "a438c13d26203898bc3e23d37b9a6b96267a145079363d6580e9c4d77e3fc48d",
      "bytes": 235994
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
      "title": "Dimetrodon habitat — portrait",
      "tool": "built-in image_gen",
      "generatedOn": "2026-10-22",
      "prompt": "Use case: historical-scene. Asset: a new environment background for a calm preschool 3D natural history museum. Scene: Early Permian red-bed wetland margin, broad level brick-red and pale tan damp silt foreground, still narrow pool far back on right, tall horsetails and seed ferns behind far left margin, dry rust cliffs very distant, no flowering plants or grass. Soft naturalistic hand-painted gouache, convincing landscape depth with subtle natural textures, inviting readable midtones. Empty environment only. Keep central 75% visually quiet for a separately rendered animal and upper corners uncluttered for controls. For underwater scenes keep seabed in lowest 18% and a large clear middle water volume. For land scenes foreground must be one continuous level ground surface across full width with no ledge/platform/ridge or trench; horizon near upper third. No animals, fish, birds, humans, skeletons, shells, fossils, modern lawns/flowers, text, logos, UI, watermarks, floating particles, baked animal shadows, spotlit plinths or collage. Independently compose one PORTRAIT 9:16 tall image, with ample empty vertical space. This is a fresh tall composition, not a crop of a wide scene.",
      "bytes": 2815969,
      "sha256": "0446df5bc5e92a0bc96240dd338df02e6b9699f5341d4c48f969758ed3be08f4"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International — project-authored content",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "sha256": "ca7bdd0b2872e25e1c055fc46f9a8d7ba14bc9baff3f97a164a2262d6be53fa1",
      "bytes": 254296
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
      "title": "Dimetrodon Chinese narration",
      "tool": "Qwen3-TTS CustomVoice",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena built-in voice",
      "generatedOn": "2026-10-22",
      "prompt": "异齿龙背上的大帆高高竖起，像背着一座小山。它生活得比恐龙还早，和今天的哺乳动物有亲缘关系。",
      "bytes": 85725,
      "sha256": "23675dc953aef513be90e7d453e904be3d8f7df55c2b5cd488790102b63360ab"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International — project-authored content",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "bytes": 85725,
      "sha256": "23675dc953aef513be90e7d453e904be3d8f7df55c2b5cd488790102b63360ab"
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
      "title": "Dimetrodon English narration",
      "tool": "Qwen3-TTS CustomVoice",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena built-in voice",
      "generatedOn": "2026-10-22",
      "prompt": "Dimetrodon’s tall sail rose above its back like a little hill. It lived before dinosaurs and was a distant relative of today’s mammals.",
      "bytes": 104925,
      "sha256": "631c006baf89d3fdccc9cb0140f6ef24fb0dd8982967a43321f9604b16f98119"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International — project-authored content",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "bytes": 104925,
      "sha256": "631c006baf89d3fdccc9cb0140f6ef24fb0dd8982967a43321f9604b16f98119"
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
      "title": "Dimetrodon transparent model poster",
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
      "sha256": "d4467106b46e70ae8c899561bb824b4eb8815d8e6143796f98a18ddbfb6b7b44",
      "bytes": 107274
    },
    "modifications": [
      "Preserved the complete animal silhouette and source materials.",
      "Verified the final model’s initial pose and renderer presentation before deriving or retaining the static image."
    ],
    "attribution": "“异齿龙” by cp4096, CC BY 4.0; modified for the Prehistoric Animal Museum.",
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
      "title": "Dimetrodon transparent model poster",
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
      "sha256": "683e3af93dc376d8795b28065a797616538a3a84d7e8f7157f8b0df65ec16fbd",
      "bytes": 21898
    },
    "modifications": [
      "Preserved the complete animal silhouette and source materials.",
      "Verified the final model’s initial pose and renderer presentation before deriving or retaining the static image."
    ],
    "attribution": "“异齿龙” by cp4096, CC BY 4.0; modified for the Prehistoric Animal Museum.",
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
      "title": "Dimetrodon collection thumbnail",
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
      "sha256": "8468422d43e77787c6da58004ea47d04ccacc1976d52d56a4334ac25be17ea0e",
      "bytes": 17798
    },
    "modifications": [
      "Preserved the complete animal silhouette and source materials.",
      "Verified the final model’s initial pose and renderer presentation before deriving or retaining the static image."
    ],
    "attribution": "“异齿龙” by cp4096, CC BY 4.0; modified for the Prehistoric Animal Museum. Background art is project-generated and licensed separately under CC BY-NC-SA 4.0.",
    "redistributionAllowed": true,
    "evidencePaths": [
      "provenance/LICENSES/model-license.txt",
      "provenance/LICENSES/model-source.txt",
      "provenance/LICENSES/derived-images.txt"
    ]
  }
] as const satisfies readonly [AssetProvenance, ...AssetProvenance[]]
