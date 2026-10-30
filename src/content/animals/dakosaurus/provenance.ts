import type { AssetProvenance } from '../../types'

export const provenance = [
  {
    "assetPath": "model/model.glb",
    "kind": "model",
    "source": {
      "type": "third-party",
      "title": "Dakosaurus",
      "author": "Julian Johnson-Mortimer (FreddyFoxFreddy)",
      "url": "https://sketchfab.com/3d-models/dakosaurus-a531d5bca7f3477d97b50212300c8271",
      "accessedOn": "2026-10-28",
      "bytes": 90681984,
      "sha256": "a64c734467e99c85e3111eadbc17426be4c2fd2ca94a65f79fd056f90a9919fd"
    },
    "license": {
      "spdx": "CC-BY-4.0",
      "name": "Creative Commons Attribution 4.0 International",
      "url": "https://creativecommons.org/licenses/by/4.0/"
    },
    "runtime": {
      "bytes": 16936480,
      "sha256": "20de5bdd4423fb6cf46bd7fd2756ccb44aa879b3557b4daa8a6da26e611b06b0"
    },
    "modifications": [
      "Mesh decimation, texture repacking, existing Idle, static normalization; gentle skin colour lift and roughness adjustment.",
      "Repaired attached-island skin weights locally while preserving geometry, textures, global transforms and animation."
    ],
    "attribution": "Model by Julian Johnson-Mortimer (FreddyFoxFreddy); museum preparation by Leon Made This.",
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
      "title": "Dakosaurus landscape palaeoenvironment",
      "tool": "OpenAI image generation",
      "generatedOn": "2026-10-29",
      "prompt": "Use case: historical-scene.\nAsset type: empty immersive underwater environment background plate for a young children's 3D prehistoric animal museum. Generate ONE finished LANDSCAPE image, exact 16:9 wide aspect ratio, composed independently for a horizontal screen.\nPrimary request: a calm, clear, BRIGHT Late Jurassic open marine environment. This is a Late Jurassic reconstruction, NOT a Cretaceous scene. Environment only, absolutely NO animals.\nScene/backdrop: underwater viewpoint looking horizontally into a broad expanse of clean blue-cyan seawater. A softly rippled water surface, lit by gentle daylight, is visible along the very top. A modest pale fine-sand sea floor recedes across the bottom 15 to 20 percent. A distant low limestone shelf is visible toward the extreme left edge, softly faded in the water; a very small low limestone form may balance the extreme right distance. Use light grey and pale beige rock, not massive dark sea cliffs. The majority of the image is quiet open water.\nComposition: immersive naturalistic 3D/photographic environment plate. Preserve wide lateral space for an externally composited swimming animal. Central 60 percent is uninterrupted low-detail luminous blue-cyan water with a gentle depth gradient. No rocks, plants, reef, wall, ledge or sharp beam crosses the model area. Rocks stay low and distant at the far margins, no looming foreground rocks and no enclosing canyon.\nLighting/mood: soft, bright, calm daytime seawater suitable for small children. A few subtle broad diffused sunlight shafts from high above, with evenly readable blue-cyan midwater and pale sandy bottom. Avoid a blinding hotspot and high-contrast theatrical shadows. Match a separately rendered dark olive-grey marine crocodilian model: the central cyan water must be light enough to clearly reveal that silhouette, but DO NOT depict the animal.\nStyle/medium: polished naturalistic 3D environment with realistic photographic water, soft scattering and believable limestone/sand texture, matching a realistic museum exhibit. Gentle atmosphere and moderate saturation, not cartoon, not painterly, no fantasy.\nPalette: bright clear blue-cyan water, softly silvery cyan surface, restrained pale beige sand, distant light limestone.\nConstraints: no animal of any kind, no fish, reptile, crocodile, shark, turtle, mollusc, invertebrate or humans. No modern reef, coral garden, ornamental fish, kelp forest, sea grass meadow or aquarium features. No deep ocean darkness, black trench, cave, tunnel, wreck, ruins, man-made objects, storm, hunting, predation, horror, disaster or bones. No text, letters, labels, logo, watermark, UI or border. Deliver one complete wide composition, not a collage or contact sheet.",
      "bytes": 2313908,
      "sha256": "ffb7387297630a15be52f8d9e64e99ca8802f99997106676296205146f9bf921"
    },
    "license": {
      "spdx": "LicenseRef-OpenAI-Output",
      "name": "OpenAI generated output",
      "url": "https://openai.com/policies/terms-of-use/"
    },
    "runtime": {
      "bytes": 242304,
      "sha256": "567646fe919baf9da22119c9881d82829d2fd5bfc8aaf8847bf63fd0f2f5f9a7"
    },
    "modifications": [
      "Independently generated composition for this orientation; resized and encoded as WebP without changing the scene."
    ],
    "attribution": "Environment generated for Prehistoric Animal Museum.",
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
      "title": "Dakosaurus portrait palaeoenvironment",
      "tool": "OpenAI image generation",
      "generatedOn": "2026-10-29",
      "prompt": "Use case: historical-scene.\nAsset type: empty immersive underwater environment background plate for a young children's 3D prehistoric animal museum. Generate ONE finished PORTRAIT image, exact 9:16 tall aspect ratio, composed independently for a vertical phone screen.\nPrimary request: a calm, clear, BRIGHT Late Jurassic open marine environment. This is a Late Jurassic reconstruction, NOT a Cretaceous scene. Environment only, absolutely NO animals.\nScene/backdrop: underwater viewpoint looking horizontally into a broad expanse of clean blue-cyan seawater. A softly rippled water surface, gently lit from above, sits near the top of this tall composition. A modest pale fine-sand sea floor recedes across the bottom 18 percent. Small distant low limestone shelves are visible only at the far lower left and right margins, softly faded in cyan water. Use light grey and pale beige rock, no massive dark sea cliff. Most of the scene is quiet open water.\nComposition: a purpose-built tall marine scene with a long open water column, not a crop of a wide frame. Immersive naturalistic 3D/photographic backdrop. Keep the central 60 percent of image width uninterrupted low-detail luminous blue-cyan water above a low simple sand floor, reserved for an externally rendered swimming animal. Rocks stay low, tiny and distant near the extreme margins; no rock ledge, plant, reef, wall, tall shelf or sharp beam crosses the model area. No looming foreground rock, canyon, cave or enclosed tunnel.\nLighting/mood: soft, bright, calm daytime seawater suitable for small children. A few very gentle broad diffused sunlight shafts from high above, evenly readable blue-cyan midwater and pale sand. Avoid a blinding hotspot and high-contrast theatrical shadows. Central water must be lighter than a separately rendered dark olive-grey marine crocodilian silhouette, but DO NOT depict the animal.\nStyle/medium: polished naturalistic 3D environment with realistic photographic water, soft scattering and believable limestone/sand texture, matching a realistic museum exhibit. Same bright clear blue-cyan, silvery cyan surface, pale beige sand and distant light limestone palette as a wide companion scene. Gentle atmosphere, moderate saturation, not cartoon, not painterly, no fantasy.\nConstraints: no animal of any kind, no fish, reptile, crocodile, shark, turtle, mollusc, invertebrate or humans. No modern reef, coral garden, ornamental fish, kelp forest, sea grass meadow or aquarium features. No deep ocean darkness, black trench, cave, tunnel, wreck, ruins, man-made objects, storm, hunting, predation, horror, disaster or bones. No text, letters, labels, logo, watermark, UI or border. Deliver one complete tall composition, not a collage or contact sheet.",
      "bytes": 2337140,
      "sha256": "763db0ed9ba43be881c0d97cda4b0056374f831dfa88bb1d6a75beaa986e01f0"
    },
    "license": {
      "spdx": "LicenseRef-OpenAI-Output",
      "name": "OpenAI generated output",
      "url": "https://openai.com/policies/terms-of-use/"
    },
    "runtime": {
      "bytes": 239310,
      "sha256": "923cf9654971cb7391f895de0c185f473317ccfac407168abd05fb0f920fa331"
    },
    "modifications": [
      "Independently generated composition for this orientation; resized and encoded as WebP without changing the scene."
    ],
    "attribution": "Environment generated for Prehistoric Animal Museum.",
    "redistributionAllowed": true,
    "evidencePaths": [
      "provenance/LICENSES/background-generation.txt"
    ]
  },
  {
    "assetPath": "images/poster.webp",
    "kind": "poster",
    "source": {
      "type": "derived",
      "title": "Dakosaurus poster",
      "generatedOn": "2026-10-29",
      "inputAssetPaths": [
        "model/model.glb"
      ],
      "method": "Native headed application WebGL export at Idle time zero; transparent silhouette resized to the delivery frame."
    },
    "license": {
      "spdx": "CC-BY-4.0",
      "name": "Creative Commons Attribution 4.0 International",
      "url": "https://creativecommons.org/licenses/by/4.0/"
    },
    "runtime": {
      "bytes": 19704,
      "sha256": "743f1fb21c858db4fcef2df1037453ca3b3eea07880ebcf558203916785118ce"
    },
    "modifications": [
      "Native headed application WebGL export at Idle time zero; transparent silhouette resized to the delivery frame."
    ],
    "attribution": "Model by Julian Johnson-Mortimer (FreddyFoxFreddy); museum preparation by Leon Made This.",
    "redistributionAllowed": true,
    "evidencePaths": [
      "provenance/LICENSES/model-license.txt",
      "provenance/LICENSES/derived-images.txt"
    ]
  },
  {
    "assetPath": "images/poster-portrait.webp",
    "kind": "poster",
    "source": {
      "type": "derived",
      "title": "Dakosaurus poster",
      "generatedOn": "2026-10-29",
      "inputAssetPaths": [
        "model/model.glb"
      ],
      "method": "Native headed application WebGL export at Idle time zero; transparent silhouette resized to the delivery frame."
    },
    "license": {
      "spdx": "CC-BY-4.0",
      "name": "Creative Commons Attribution 4.0 International",
      "url": "https://creativecommons.org/licenses/by/4.0/"
    },
    "runtime": {
      "bytes": 5004,
      "sha256": "8372d817a8b20a908960bb2dc6c8282badf5e7d3b1bf2d062bae9ec7d8248688"
    },
    "modifications": [
      "Native headed application WebGL export at Idle time zero; transparent silhouette resized to the delivery frame."
    ],
    "attribution": "Model by Julian Johnson-Mortimer (FreddyFoxFreddy); museum preparation by Leon Made This.",
    "redistributionAllowed": true,
    "evidencePaths": [
      "provenance/LICENSES/model-license.txt",
      "provenance/LICENSES/derived-images.txt"
    ]
  },
  {
    "assetPath": "images/thumbnail.webp",
    "kind": "thumbnail",
    "source": {
      "type": "derived",
      "title": "Dakosaurus thumbnail",
      "generatedOn": "2026-10-29",
      "inputAssetPaths": [
        "model/model.glb",
        "backgrounds/landscape.webp"
      ],
      "method": "Native transparent model silhouette composited over the independently generated landscape background."
    },
    "license": {
      "spdx": "CC-BY-4.0",
      "name": "Creative Commons Attribution 4.0 International",
      "url": "https://creativecommons.org/licenses/by/4.0/"
    },
    "runtime": {
      "bytes": 19800,
      "sha256": "64dcea6ef18b2c10926a0a36b13c709e36af6768ea970465da2b3457f7896902"
    },
    "modifications": [
      "Native transparent model silhouette composited over the independently generated landscape background."
    ],
    "attribution": "Model by Julian Johnson-Mortimer (FreddyFoxFreddy); museum preparation by Leon Made This.",
    "redistributionAllowed": true,
    "evidencePaths": [
      "provenance/LICENSES/model-license.txt",
      "provenance/LICENSES/derived-images.txt"
    ]
  },
  {
    "assetPath": "audio/narration.zh-CN.mp3",
    "kind": "narration",
    "source": {
      "type": "generated",
      "title": "Dakosaurus Mandarin narration",
      "tool": "Qwen3-TTS",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena",
      "generatedOn": "2026-10-28",
      "prompt": "达科龙是鳄鱼的古代亲戚，生活在海里，身体两边有四只鳍状肢。顺着身体找到尾巴，看看末端像鱼尾一样的尾鳍。",
      "bytes": 112365,
      "sha256": "bd2631de203d8ab8df378854297af7186b22be9b90dd847bfe046d42e84f0a9c"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "CC BY-NC-SA 4.0 project-owned Qwen3-TTS output",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "bytes": 112365,
      "sha256": "bd2631de203d8ab8df378854297af7186b22be9b90dd847bfe046d42e84f0a9c"
    },
    "modifications": [
      "Generated independently in Chinese or English with the Serena speaker; encoded as mono MP3 for browser playback."
    ],
    "attribution": "Project-authored script, generated with Qwen3-TTS Serena.",
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
      "title": "Dakosaurus English narration",
      "tool": "Qwen3-TTS",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena",
      "generatedOn": "2026-10-28",
      "prompt": "Dakosaurus was an ancient crocodile relative that lived in the sea and had four flippers. Follow its body to the tail and look for the fish-like fin at the end.",
      "bytes": 119805,
      "sha256": "023f0ca3436b30e9e191e730e206835c7cf5b7c26c94c7fad992c6109fb9d4bf"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "CC BY-NC-SA 4.0 project-owned Qwen3-TTS output",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "bytes": 119805,
      "sha256": "023f0ca3436b30e9e191e730e206835c7cf5b7c26c94c7fad992c6109fb9d4bf"
    },
    "modifications": [
      "Generated independently in Chinese or English with the Serena speaker; encoded as mono MP3 for browser playback."
    ],
    "attribution": "Project-authored script, generated with Qwen3-TTS Serena.",
    "redistributionAllowed": true,
    "evidencePaths": [
      "provenance/LICENSES/narration-rights.txt"
    ]
  }
] as const satisfies readonly [AssetProvenance, ...AssetProvenance[]]
