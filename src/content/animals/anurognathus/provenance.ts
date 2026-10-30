import type { AssetProvenance } from '../../types'

export const provenance = [
  {
    "assetPath": "model/model.glb",
    "kind": "model",
    "source": {
      "type": "third-party",
      "title": "Anurognathus pterosaur",
      "author": "Robert_the_whale (https://sketchfab.com/Robert_the_whale)",
      "url": "https://sketchfab.com/3d-models/anurognathus-pterosaur-bc7fe93b9c254bd2bd9f905e063ec86c",
      "accessedOn": "2026-10-28",
      "bytes": 1384240,
      "sha256": "c236995e2d9e76eabcf62874c9252ba497194039a14ff428363fcaf640b750dd"
    },
    "license": {
      "spdx": "CC-BY-4.0",
      "name": "Creative Commons Attribution 4.0 International",
      "url": "https://creativecommons.org/licenses/by/4.0/"
    },
    "runtime": {
      "bytes": 2299268,
      "sha256": "1111268fa0b96095febb8741053dddc0a2119b4f7f8d671c0c90499e0a0fff70"
    },
    "modifications": [
      "Preserved the source mesh identity, UV and colour texture; refined matte materials and recessed eyes, with bounded articulated jaw motion.",
      "Normalised to glTF Y-up, head +X, with a centred stationary exhibition rig.",
      "Rebuilt the eight-second 24 fps Idle with articulated shoulder, elbow, wrist and outer-wing motion, membrane recovery and bounded head glances."
    ],
    "attribution": "Model by Robert_the_whale (https://sketchfab.com/Robert_the_whale); museum preparation by Leon Made This.",
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
      "title": "Anurognathus landscape palaeoenvironment",
      "tool": "OpenAI image generation",
      "generatedOn": "2026-10-28",
      "prompt": "Use case: historical-scene.\nAsset type: standalone landscape background for a child-facing 3D prehistoric animal museum; no creature in the image.\nPrimary request: create ONE wide 16:9 environment image, a fresh landscape composition, intended output 1792×1008 or comparable exact 16:9. Naturalistic high quality 3D / photoreal environmental rendering, matching a museum model scene, gentle and inviting for children.\nScene: Late Jurassic Solnhofen tropical island archipelago, about 150 million years ago. A distant pale cream limestone island and very low scattered limestone islets enclose a clear shallow turquoise lagoon. Only sparse Jurassic-looking conifers and fern-like greenery on the distant island edges; no flowering plants, no grass lawns, no modern tropical resort palms. Do not depict a water-dwelling animal: this is an atmospheric sky backdrop above the archipelago.\nComposition: the sky is the main subject, occupying at least the top 74% of the frame. Very low, nearly flat horizon at about 76% from the top; distant islands and lagoon confined to the bottom quarter. Central 60% of the entire image must be quietly unobstructed blue-cyan sky for a small flying 3D creature. Place a few very small soft cloud wisps only near the extreme upper side edges. Wide panoramic archipelago view, a small low limestone shelf entering at the lower left and a distant low vegetated islet toward the lower right; no tall tree, cliff, hill, rock or cloud enters the central model area.\nLighting/mood: bright, soft, airy late-morning daylight, evenly exposed; cheerful calm natural light, a slight warm sun from upper left but no visible sun. No dusk, no darkness, no heavy vignette or hard shadows. Lower shore detail must stay softly lit.\nPalette: central sky softly luminous light-to-medium cyan-blue, visibly blue rather than near-white; the sky must complement an orange and charcoal model with blue eye-spots, softly distinguish its dark edges. Pale warm limestone, restrained sage green, clear muted turquoise water. Maintain natural texture and subtle atmospheric depth rather than painterly effects.\nConstraints: environment ONLY. No animals, no pterosaurs, no dinosaurs, no birds or bird silhouettes, no insects, no humans. No text, logos, watermarks, UI, frames, buildings, roads, fences, boats. No huge clouds, storm clouds, mountains, dramatic cliffs, sun rays or oversized foreground vegetation. Do not divide the canvas or create a collage. This image must be a complete independent horizontal composition.",
      "bytes": 1857926,
      "sha256": "2ee11e674385abe9e20b47e83473e34278e38b731c492d5b54d3521821390f7a"
    },
    "license": {
      "spdx": "LicenseRef-OpenAI-Output",
      "name": "OpenAI generated output",
      "url": "https://openai.com/policies/terms-of-use/"
    },
    "runtime": {
      "bytes": 160984,
      "sha256": "3ceae6078d3d576200d7daaaf6ad5fa099ebe78f6df12f04d38feee929533695"
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
      "title": "Anurognathus portrait palaeoenvironment",
      "tool": "OpenAI image generation",
      "generatedOn": "2026-10-28",
      "prompt": "Use case: historical-scene.\nAsset type: standalone portrait 9:16 background for a child-facing 3D prehistoric animal museum; environment only with NO creatures.\nPrimary request: generate ONE tall vertical 9:16 composition, a fresh independently composed portrait, intended 1008×1792 or a comparable 9:16 format. Naturalistic high quality 3D / photoreal environment rendering, with inviting soft bright daylight.\nScene: Late Jurassic Solnhofen tropical archipelago around 150 million years ago: clear pale turquoise lagoon and low warm cream limestone islands, with only a few small distant Jurassic conifers and low fern/cycad-like nonflowering foliage. No palm trees, no grass lawns, no flowering plants. Do not suggest that Anurognathus lived underwater: the backdrop is viewed in the open air above a lagoon landscape.\nPortrait composition: a spacious tall column of empty blue-cyan sky filling the top 77% of the frame. Nearly flat distant island horizon at 78% of image height. The bottom 22% contains a very low limestone shore gently entering from the lower right and a low curved islet along the lower left distance, with the open lagoon between. This is a different camera arrangement from a wide panorama, designed vertically from the start. Absolutely no tall vegetation. The central 60% of the image must be uninterrupted sky; keep the calm entire center free of clouds and branches. If any clouds appear, only tiny feathery wisps at the extreme top left or far right edge.\nLighting: bright soft late morning, a slight warm light from upper left, no visible sun. Cheerful, airy, child-friendly; evenly lit limestone shore, soft shallow shadows, no dark corners, no vignette, no dramatic sunset.\nColor palette: light-to-medium clean cyan-blue central sky, clearly blue rather than near-white, a gentle natural atmospheric fade just above the distant horizon; warm cream limestone, restrained sage-green foliage and gentle turquoise water. Match the sunny but gentle palette of a Solnhofen landscape pair. This sky is behind a small orange and charcoal winged model with blue eyespots, so the center needs quiet clear color and softly luminous exposure.\nConstraints: absolutely no animals, pterosaurs, dinosaurs, birds, bird silhouettes, insects, humans, text, logos, watermark, UI, borders, buildings, roads, fences, boats. No large white cloud, no central cloud, no mountain or cliff, no imposing foreground tree, no dramatic sun rays. Do not make a collage, pair, or split view. Deliver one whole independent vertical scene; never a crop of a horizontal composition.",
      "bytes": 2134133,
      "sha256": "4d710dda660d5a579d9bfa42e952552b962e1162dc1bab37be759092d6964749"
    },
    "license": {
      "spdx": "LicenseRef-OpenAI-Output",
      "name": "OpenAI generated output",
      "url": "https://openai.com/policies/terms-of-use/"
    },
    "runtime": {
      "bytes": 228226,
      "sha256": "0ddb1e1441089e9cde4f02bc90371fd2e01d913c770f885622dd41f844f82e82"
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
      "title": "Anurognathus poster",
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
      "bytes": 19366,
      "sha256": "3de9805987a6a3d9b0c96541ee28eb2bd340b524fe7058d2a73910c2007dfe04"
    },
    "modifications": [
      "Native headed application WebGL export at Idle time zero; transparent silhouette resized to the delivery frame."
    ],
    "attribution": "Model by Robert_the_whale (https://sketchfab.com/Robert_the_whale); museum preparation by Leon Made This.",
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
      "title": "Anurognathus poster",
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
      "bytes": 4902,
      "sha256": "8716a77e79ca2110a76e8753b1bb899c65d44faf93a00baaa75847b63c6d6f4a"
    },
    "modifications": [
      "Native headed application WebGL export at Idle time zero; transparent silhouette resized to the delivery frame."
    ],
    "attribution": "Model by Robert_the_whale (https://sketchfab.com/Robert_the_whale); museum preparation by Leon Made This.",
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
      "title": "Anurognathus thumbnail",
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
      "bytes": 10974,
      "sha256": "366e85e5c0a66118c78f7936f16f795abb2055e175c58d867b452c898c3bc703"
    },
    "modifications": [
      "Native transparent model silhouette composited over the independently generated landscape background."
    ],
    "attribution": "Model by Robert_the_whale (https://sketchfab.com/Robert_the_whale); museum preparation by Leon Made This.",
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
      "title": "Anurognathus Mandarin narration",
      "tool": "Qwen3-TTS",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena",
      "generatedOn": "2026-10-28",
      "prompt": "这是蛙嘴翼龙，一种生活在晚侏罗世的小型飞行爬行动物。看看它宽宽的小脸和展开的皮膜翅膀。",
      "bytes": 86925,
      "sha256": "b3394baa4832659b8467488da03d567430f57b5528f2e0d7f86598f8d92197da"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "CC BY-NC-SA 4.0 project-owned Qwen3-TTS output",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "bytes": 86925,
      "sha256": "b3394baa4832659b8467488da03d567430f57b5528f2e0d7f86598f8d92197da"
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
      "title": "Anurognathus English narration",
      "tool": "Qwen3-TTS",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena",
      "generatedOn": "2026-10-28",
      "prompt": "This is Anurognathus, a small flying reptile from the Late Jurassic. Look at its short, wide face and its outstretched membrane wings.",
      "bytes": 110685,
      "sha256": "d51c8f59eac02e8265038e21b4b760a3471ee9f5f0e23db8c6e7246b69fac529"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "CC BY-NC-SA 4.0 project-owned Qwen3-TTS output",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "bytes": 110685,
      "sha256": "d51c8f59eac02e8265038e21b4b760a3471ee9f5f0e23db8c6e7246b69fac529"
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
