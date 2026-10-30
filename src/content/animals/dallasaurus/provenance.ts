import type { AssetProvenance } from '../../types'

export const provenance = [
  {
    "assetPath": "model/model.glb",
    "kind": "model",
    "source": {
      "type": "third-party",
      "title": "Dallasaurus",
      "author": "Julian Johnson-Mortimer (FreddyFoxFreddy)",
      "url": "https://sketchfab.com/3d-models/dallasaurus-bfec76fbd5624d9fa9375668565af45c",
      "accessedOn": "2026-10-28",
      "bytes": 54302092,
      "sha256": "4a1a08cfd51e2d2e02360167b99fffe509c1a530f416cfc0ca24391e39b2a2f0"
    },
    "license": {
      "spdx": "CC-BY-4.0",
      "name": "Creative Commons Attribution 4.0 International",
      "url": "https://creativecommons.org/licenses/by/4.0/"
    },
    "runtime": {
      "bytes": 12114960,
      "sha256": "dbc02f36ad7e9dddcf8ad38b59068ab95f3bdd85b77a932ae95fa1096f2cac8f"
    },
    "modifications": [
      "Mesh decimation, texture repacking, existing Idle, static normalization; existing warm skin colour retained."
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
      "title": "Dallasaurus landscape palaeoenvironment",
      "tool": "OpenAI image generation",
      "generatedOn": "2026-10-29",
      "prompt": "Use case: historical-scene.\nAsset type: empty immersive underwater environment background plate for a young children's 3D prehistoric animal museum. Generate ONE finished LANDSCAPE image, exact 16:9 wide aspect ratio, composed independently for a horizontal screen.\nPrimary request: a calm, BRIGHT, clear shallow nearshore sea in Late Cretaceous Texas. Environment only, absolutely NO animals.\nScene/backdrop: camera underwater looking horizontally through clean translucent blue-green water. A softly rippled sunlit water surface across the upper 12 percent. A pale buff sandy sea floor recedes gently along the bottom 20 percent, with only a few small subdued stone clusters at the outermost lower left and right edges. Clear softly graded cyan water occupies most of the image; the distant sea floor fades smoothly into pale turquoise haze. No dense underwater vegetation and no decorative reef.\nComposition: wide open quiet water is the main subject. Keep the central 60 percent low-detail, unobstructed, and softly lit for an externally rendered elongated swimming animal. No vertical object, rock, reef, plant or strong sun streak behind the model silhouette. Gentle depth from side-edge rocks only, not tall cliffs. Broad lateral breathing room. Avoid a narrow cave, tunnel, aquarium or enclosure.\nLighting/mood: bright shallow water in gentle daytime, airy, welcoming and safe for young children. Soft broad underwater daylight and very mild diffuse rays from the upper left. Keep the lower corners readable and the central water luminous without a white glare hotspot or dramatic dark blue shadows. Harmonise with a gold, orange and warm brown striped reptile model, but DO NOT depict that model or any animal.\nStyle/medium: polished naturalistic 3D environment with believable photographic water, modest physical detail and soft natural textures, matching a realistic museum exhibit. Not cartoon, not painterly, no fantasy.\nPalette: clean light turquoise and blue-green, gentle pale sandy beige at the bottom margins, soft silvery cyan surface; moderate saturation.\nConstraints: NO animal of any kind, no fish, no reptile, no turtle, no shark, no invertebrate, no humans; no coral garden, modern tropical ornamental fish, kelp forest, sea grass meadow or modern aquarium details. No text, letters, labels, UI, logo, watermark or border. No deep-sea blackness, night, storm, cave, wreck, ruins, man-made objects, predation or disaster. Late Cretaceous coastal context rather than a modern tropical reef. Deliver one complete wide composition, not a collage or contact sheet.",
      "bytes": 2263206,
      "sha256": "921019485711f0757b9637d9686929c5b3f507d4640d469f8ec08df5022c5b1b"
    },
    "license": {
      "spdx": "LicenseRef-OpenAI-Output",
      "name": "OpenAI generated output",
      "url": "https://openai.com/policies/terms-of-use/"
    },
    "runtime": {
      "bytes": 239636,
      "sha256": "64b04f2739f462a2d7ada5840eb5a4ee26bb02357c793ba430d65c0a842b641a"
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
      "title": "Dallasaurus portrait palaeoenvironment",
      "tool": "OpenAI image generation",
      "generatedOn": "2026-10-29",
      "prompt": "Use case: historical-scene.\nAsset type: empty immersive underwater environment background plate for a young children's 3D prehistoric animal museum. Generate ONE finished PORTRAIT image, exact 9:16 tall aspect ratio, composed independently for a vertical phone screen.\nPrimary request: a calm, BRIGHT, clear shallow nearshore sea in Late Cretaceous Texas. Environment only, absolutely NO animals.\nScene/backdrop: camera underwater looking horizontally through clean translucent blue-green water. A softly rippled sunlit water surface occupies the upper 15 percent of this tall scene. A pale buff sandy sea floor recedes gently in the bottom 20 percent. A few small subdued rocks remain at the extreme bottom corners, never as tall central features. The middle is luminous open cyan water with a smooth pale turquoise distance gradient. No dense vegetation and no decorative reef.\nComposition: vertical composition designed for a tall phone display, with a long quiet open water column from the lit surface down to the low sand floor. Keep the central 60 percent of the image width low-detail and unobstructed for an externally rendered swimming animal. No vertical object, rock, reef, plant or harsh sun streak behind the model silhouette. Create depth with only small distant edge stones, not tall cliffs. No narrow cave, tunnel, aquarium or enclosure.\nLighting/mood: bright shallow daytime water, airy, welcoming and safe for young children. Soft broad underwater daylight and very mild diffuse rays from upper left. The central and lower water remain clear and readable, with no white glare hotspot, dramatic shadows or deep blue-black zone.\nStyle/medium: polished naturalistic 3D environment with believable photographic water and soft natural textures, matching a realistic museum exhibit. Same clear light turquoise, blue-green, gentle pale sandy beige and soft silvery cyan surface as a wide companion scene. Harmonise with a separately composited gold, orange and warm brown striped reptile model, but DO NOT depict that model or any animal. Moderate saturation, not cartoon, not painterly, no fantasy.\nConstraints: NO animal of any kind, no fish, reptile, turtle, shark, invertebrate or humans; no coral garden, modern tropical ornamental fish, kelp forest, sea grass meadow or modern aquarium details. No text, letters, labels, UI, logo, watermark or border. No deep-sea blackness, night, storm, cave, wreck, ruins, man-made objects, predation or disaster. Late Cretaceous coastal context rather than a modern tropical reef. Deliver one complete tall composition, not a wide-image crop, not a collage or contact sheet.",
      "bytes": 2252776,
      "sha256": "4623d70e0dfc60d05e0ab0c660e8202a3a02dee0376890873c92a180ebcb5635"
    },
    "license": {
      "spdx": "LicenseRef-OpenAI-Output",
      "name": "OpenAI generated output",
      "url": "https://openai.com/policies/terms-of-use/"
    },
    "runtime": {
      "bytes": 233484,
      "sha256": "70aa83e2a765100b8131b41e6154d06085ec4bf2cd100e821f4bda69114e1f2c"
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
      "title": "Dallasaurus poster",
      "generatedOn": "2026-10-28",
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
      "bytes": 15328,
      "sha256": "2772139f62e929e16a717ad0a1f8e6d88985692de27a6f7bb2f826698ab694ef"
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
      "title": "Dallasaurus poster",
      "generatedOn": "2026-10-28",
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
      "bytes": 4436,
      "sha256": "312d5301dc508a1f8593134cb84a81cfe4aae725719e82b7fcd57789a1b01850"
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
      "title": "Dallasaurus thumbnail",
      "generatedOn": "2026-10-28",
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
      "bytes": 20312,
      "sha256": "4560817d2e85c0d57fc5d6c03dbb741af88d3a1a7472346461cd046dbfde3834"
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
      "title": "Dallasaurus Mandarin narration",
      "tool": "Qwen3-TTS",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena",
      "generatedOn": "2026-10-28",
      "prompt": "达拉斯蜥蜴是一种小型沧龙类动物，从头到尾大约一米长。看看它的四条小腿和脚趾，再顺着身体找到长长的尾巴。",
      "bytes": 102525,
      "sha256": "302b6802d16ec051ac6857e6b02cc0f3b90cc1ced362636c1cd075cba6cf1f7b"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "CC BY-NC-SA 4.0 project-owned Qwen3-TTS output",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "bytes": 102525,
      "sha256": "302b6802d16ec051ac6857e6b02cc0f3b90cc1ced362636c1cd075cba6cf1f7b"
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
      "title": "Dallasaurus English narration",
      "tool": "Qwen3-TTS",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena",
      "generatedOn": "2026-10-28",
      "prompt": "Dallasaurus was a small early mosasaur, about one metre from head to tail. Look for its four little legs and toes, then follow the long tail behind.",
      "bytes": 136125,
      "sha256": "678b8755e9445abdca05fa12f2bef2c274dc1bd335a4f3ff0ace9ae05e54ff97"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "CC BY-NC-SA 4.0 project-owned Qwen3-TTS output",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "bytes": 136125,
      "sha256": "678b8755e9445abdca05fa12f2bef2c274dc1bd335a4f3ff0ace9ae05e54ff97"
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
