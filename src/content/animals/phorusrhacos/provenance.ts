import type { AssetProvenance } from '../../types'

export const provenance = [
  {
    "assetPath": "model/model.glb",
    "kind": "model",
    "source": {
      "type": "third-party",
      "title": "Phorusrhacos longissimus (terror bird)",
      "author": "Museo [UV] Historia Natural; sculpture Dr. Julio Pitarch Reig; scan Jose A. Villena",
      "url": "https://sketchfab.com/3d-models/phorusrhacos-longissimus-terror-bird-31a09128a2114480b62feeef92a9fba0",
      "accessedOn": "2026-10-28",
      "bytes": 30772372,
      "sha256": "8ed1dd7933958eaac84f413ff9eec1214ce6c0f90b000856d3c8c095c9646ddb"
    },
    "license": {
      "spdx": "CC-BY-4.0",
      "name": "Creative Commons Attribution 4.0 International",
      "url": "https://creativecommons.org/licenses/by/4.0/"
    },
    "runtime": {
      "bytes": 13688836,
      "sha256": "9620e5c0ab96b0d4d2d9211780766df1c08c40d1dcfe4400a5a92973745c62eb"
    },
    "modifications": [
      "Merged/welded source chunks, mild scan and sole-edge smoothing, grounded both soles, 120k geometry, 2K high-to-low tangent normals, mild colour lift, matte material, new anchored-foot rig and exact eight-second Idle. Original jaw pose retained; no jaw motion."
    ],
    "attribution": "Model by Museo [UV] Historia Natural; sculpture Dr. Julio Pitarch Reig; scan Jose A. Villena; museum preparation by Leon Made This.",
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
      "title": "Phorusrhacos landscape palaeoenvironment",
      "tool": "OpenAI image generation",
      "generatedOn": "2026-10-28",
      "prompt": "Use case: historical-scene\nAsset type: realistic natural habitat background for a children's prehistoric animal museum, landscape desktop scene.\nPrimary request: Generate one finished 16:9 LANDSCAPE image, preferably 2560 x 1440 pixels. EMPTY ENVIRONMENT PLATE only; no animal or human.\nScene/backdrop: Miocene Patagonia, a bright open mosaic of natural grassland, low green shrubs and sparse broadleaf woodland, appropriate for a large ground-dwelling bird from this region and period. Broad nearly level firm-earth clearing in the foreground, scattered tufts of wild fine grasses at the margins, a few low spreading broadleaf trees loosely grouped near the far side edges. Gentle low rolling terrain in the far distance, green-gold grass and soft sage shrubs. No tall dense conifer forest, no Jurassic fern jungle, no cycads, no tropical palms, no snow peaks, no cacti or desert dunes.\nStyle/medium: Detailed naturalistic 3D environment with photographic fine soil, bark, grass and leaf textures. Realistic polished nature-exhibit setting, neither cartoon nor painterly. Clear believable structure rather than noisy detail.\nComposition/framing: Compose a wide open horizontal landscape from the start. Camera at low standing eye-height, horizon at 47–49% of the frame height. Distant low shrubs and open meadow form a calm middle band. The central 60% is spacious and visually quiet, with medium-value green and muted golden vegetation behind the later model's silhouette. Preserve a wide uninterrupted standing area across the full lower half: flat firm golden-tan earth with subtle small-scale texture, no rocks, mounds, tall grass or roots in the center. Scattered grasses and shrubs stay at the outer edges. Sparse small trees frame the outer left and right without closing the scene.\nLighting/mood: Bright, welcoming soft daylight from upper left, very gentle natural shadows, airy child-friendly visibility. A gray-brown body and white neck will be composited later. Give the white neck clear contrast with medium blue sky and mid-tone green/gold behind the central silhouette. Keep white clouds small and peripheral; DO NOT place a broad white cloud, near-white haze or pale blank area in the center.\nColor palette: Fresh sage and muted leaf green, sunlit green-gold wild grass, warm medium-light ochre/tan ground and a clean natural medium blue sky. Ground must not be near-white or bleached. Balanced daytime colors, not orange sunset.\nConstraints: No animal, bird, insect, person or animal-shaped silhouette anywhere. No text, letters, logos, watermarks, UI, frame, modern buildings, fences, paved paths, cultivated plants or other human objects. No dense fern forest or jungle. No night, sunset, blue hour, fog, deep black shade, dramatic spotlight or excessive blur. No water or obstacles in the central standing area.\n",
      "bytes": 3515948,
      "sha256": "ce8d92bb4475cc839e71ababbbb1aab3e36ce0460aba7eb12e7831e7fc3c5076"
    },
    "license": {
      "spdx": "LicenseRef-OpenAI-Output",
      "name": "OpenAI generated output",
      "url": "https://openai.com/policies/terms-of-use/"
    },
    "runtime": {
      "bytes": 303602,
      "sha256": "16e0ee708c4ffede46c4cb67e5061628ca7c7fb2eeb0b08932ca9152c8e86d21"
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
      "title": "Phorusrhacos portrait palaeoenvironment",
      "tool": "OpenAI image generation",
      "generatedOn": "2026-10-28",
      "prompt": "Use case: historical-scene\nAsset type: realistic natural habitat background for a children's prehistoric animal museum, independently composed portrait phone scene.\nPrimary request: Generate one finished 9:16 PORTRAIT image, preferably 1440 x 2560 pixels. Compose a new tall scene, not a crop or extension of any wide image. EMPTY HABITAT PLATE; absolutely no animal or human.\nScene/backdrop: Miocene Patagonia, a natural open grassland and low-shrub mosaic with sparse small broadleaf woodland. A broad nearly level firm golden-tan earth clearing opens toward a distant band of sage-green shrubs, green-gold wild grasses and gentle low hills. A loose low spreading broadleaf tree group toward the outer left and a more distant isolated small tree near the outer right give a light sense of shelter. Fine wild grass tufts and low shrubs along the extreme edges, no close foliage wall. This is open Patagonian habitat, not a Jurassic fern jungle, tall dense conifer forest, tropical landscape, modern ranch or barren desert.\nStyle/medium: Detailed realistic natural 3D environment, photographic earth, bark, grass and leaf materials, believable vegetation and gentle lighting. Polished nature-exhibit realism, neither cartoon nor painterly. Fine texture without harsh noise.\nComposition/framing: Design the whole frame vertically from the start, low standing eye-height camera. Distant ground horizon at 47–49% of the total height. Keep the central 60% of frame width spacious and quiet. Use a soft medium-value green and muted gold backdrop in the middle and medium blue sky above it; a white-necked model will occupy this center later. The lower half must be one connected, nearly flat firm-earth standing surface, broad rather than a narrow trail. No tall grass, roots, logs, boulders, mounds or water in the center. Subtle small-scale soil texture and gentle perspective. Keep small white clouds to the outer upper corners, leaving the central sky blue.\nLighting/mood: Bright welcoming soft daylight from upper left, luminous balanced exposure, gentle environmental shade, no glaring white wash. The model to be composited later has a gray-brown body and a white neck. Preserve visible contrast for that neck against the blue/green/gold center; never put a large near-white cloud or pale haze behind it. The ground should be warm ochre/tan rather than pale cream.\nColor palette: Sage and muted green shrubs, fresh green-gold wild grasses, medium-light warm ochre/tan earth, clear natural medium blue sky. Restrained natural saturation, no orange sunset.\nConstraints: Absolutely no animals, birds, insects, people or animal silhouettes. No text, letters, logos, watermark, frame, UI, buildings, fences, paving, cultivated grass lawn or other human objects. No ferns, cycads, palms, cacti, dense jungle or snowy peaks. No sunset, night, blue hour, heavy fog, deep black shadows, theatrical light beams or excessive blur. Keep the central and lower standing ground completely connected and unobstructed.\n",
      "bytes": 3325647,
      "sha256": "37dad9fcb0d385224f7d361f5f58fcb53d9397a8e227f760e19536ebcafc5b0d"
    },
    "license": {
      "spdx": "LicenseRef-OpenAI-Output",
      "name": "OpenAI generated output",
      "url": "https://openai.com/policies/terms-of-use/"
    },
    "runtime": {
      "bytes": 304860,
      "sha256": "e90947eae917c6d6462c14a212243cd4dcffcae964dfc04c70a2e035bb2c2307"
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
      "title": "Phorusrhacos poster",
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
      "bytes": 36374,
      "sha256": "a264eb6e0823282b9f718b4903bc62a21650cc32195c649b710c55ba1650de09"
    },
    "modifications": [
      "Native headed application WebGL export at Idle time zero; transparent silhouette resized to the delivery frame."
    ],
    "attribution": "Model by Museo [UV] Historia Natural; sculpture Dr. Julio Pitarch Reig; scan Jose A. Villena; museum preparation by Leon Made This.",
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
      "title": "Phorusrhacos poster",
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
      "bytes": 14156,
      "sha256": "e0b152ae21758c65f8ae0efb1dfff65235b119b2cd6d573206db89e9007b1040"
    },
    "modifications": [
      "Native headed application WebGL export at Idle time zero; transparent silhouette resized to the delivery frame."
    ],
    "attribution": "Model by Museo [UV] Historia Natural; sculpture Dr. Julio Pitarch Reig; scan Jose A. Villena; museum preparation by Leon Made This.",
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
      "title": "Phorusrhacos thumbnail",
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
      "bytes": 30246,
      "sha256": "85ad877104e4162678ca74f7134d3655c12e73288c441899cb94c1d3036ff532"
    },
    "modifications": [
      "Native transparent model silhouette composited over the independently generated landscape background."
    ],
    "attribution": "Model by Museo [UV] Historia Natural; sculpture Dr. Julio Pitarch Reig; scan Jose A. Villena; museum preparation by Leon Made This.",
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
      "title": "Phorusrhacos Mandarin narration",
      "tool": "Qwen3-TTS",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena",
      "generatedOn": "2026-10-28",
      "prompt": "骇鸟有一双长腿，头上长着一张大大的弯钩嘴。把它转到侧面，找一找嘴巴尖尖的地方朝哪边弯。",
      "bytes": 95325,
      "sha256": "1d5c45843a1261e1232fa93ebf37963cbcd74a314630c1736e4e57042dc9a88d"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "CC BY-NC-SA 4.0 project-owned Qwen3-TTS output",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "bytes": 95325,
      "sha256": "1d5c45843a1261e1232fa93ebf37963cbcd74a314630c1736e4e57042dc9a88d"
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
      "title": "Phorusrhacos English narration",
      "tool": "Qwen3-TTS",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena",
      "generatedOn": "2026-10-28",
      "prompt": "Phorusrhacos had long legs and a large beak with a hooked tip. Turn it to the side and see which way that hook curves.",
      "bytes": 95805,
      "sha256": "f7e8b3b8c119df91c0baaace13c7a602977267fa155124d0722c73289848fe30"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "CC BY-NC-SA 4.0 project-owned Qwen3-TTS output",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "bytes": 95805,
      "sha256": "f7e8b3b8c119df91c0baaace13c7a602977267fa155124d0722c73289848fe30"
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
