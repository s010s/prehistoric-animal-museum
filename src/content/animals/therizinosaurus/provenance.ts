import type { AssetProvenance } from '../../types'

export const provenance = [
  {
    "assetPath": "model/model.glb",
    "kind": "model",
    "source": {
      "type": "third-party",
      "title": "Therizinosaurus",
      "author": "Julian Johnson-Mortimer (https://sketchfab.com/FreddyFoxFreddy)",
      "url": "https://sketchfab.com/3d-models/therizinosaurus-1fa8b9e2dd4b40c9b8ffcaead0bd8e66",
      "accessedOn": "2026-10-28",
      "bytes": 117492832,
      "sha256": "72ba0e59b4bafd65336c002734a9a410c0690d3461ecab1571001543fae1da81"
    },
    "license": {
      "spdx": "CC-BY-4.0",
      "name": "Creative Commons Attribution 4.0 International",
      "url": "https://creativecommons.org/licenses/by/4.0/"
    },
    "runtime": {
      "bytes": 16199980,
      "sha256": "9311e4108c29cfc9f5efe78ea4335a7a6a247a96a068a8559ae25facf13af440"
    },
    "modifications": [
      "adult-only connected component cleanup; selective decimation preserving head and claws; original alpha feather cards removed; compact opaque textured feathers rebuilt; skin textures resized and gently brightened/desaturated; roughness adjusted; 15-bone custom deformation rig; true stationary eight-second Idle; museum coordinate and scale normalization"
    ],
    "attribution": "Model by Julian Johnson-Mortimer (https://sketchfab.com/FreddyFoxFreddy); museum preparation by Leon Made This.",
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
      "title": "Therizinosaurus landscape palaeoenvironment",
      "tool": "OpenAI image generation",
      "generatedOn": "2026-10-28",
      "prompt": "Use case: historical-scene\nAsset type: realistic natural habitat background for a children's prehistoric animal museum, landscape desktop scene.\nPrimary request: Generate one finished 16:9 LANDSCAPE image, preferably 2560 x 1440 pixels. EMPTY ENVIRONMENT PLATE, with no animal or human.\nScene/backdrop: Late Cretaceous Nemegt river alluvial plain in Mongolia, an open woodland edge with a broad nearly level warm-earth clearing. A humid green floodplain with a low winding river visible only far in the distance at the left edge, scattered airy conifers and early broadleaf tree clusters, low ferns, horsetails and unobtrusive river-edge plants confined to lateral margins. This is a living green riparian landscape, not a modern Mongolian desert. No dunes, canyon, dry wasteland, spectacular mountains or Jurassic jungle.\nStyle/medium: Detailed naturalistic 3D environment with photographic bark, leaf and fine soil materials, realistic plants, polished nature-exhibit atmosphere. Natural realistic environment, neither cartoon nor painted illustration.\nComposition/framing: Independently designed wide horizontal composition with low standing eye-height camera. Distant ground horizon at 47% of frame height. Broad river plain spreads to the left and a loose group of airy trees frames the far right; retain a large calm open center. Central 60% must have low-detail medium-light green and tan visual fields that allow a tall rust-brown and black feathered model to remain readable when composited later. The entire lower half is a single connected, nearly level, firm warm light-brown soil surface, extending smoothly toward the viewer. Restrained fine ground texture without large stones, roots, mounds or shrubs in the center. Sparse plants stay at the edges and must not make a tall front border. Pale blue sky with a few soft small clouds.\nLighting/mood: Bright, child-friendly soft daylight from upper left, luminous open shade beneath light tree canopy, gentle natural shadows. The future model is warm rusty brown with dark black feathered areas; support that darker palette with soft green distant foliage and warm pale soil, not a white blast of sun or a dark wall of trees. Clear air, no heavy mist.\nColor palette: Fresh but restrained sage and warm leaf greens, warm tan and light ochre earth, pale natural blue sky. Gentle color variation and realistic environmental detail.\nConstraints: Absolutely no animals, dinosaurs, birds, insects, people or animal silhouettes; no text, lettering, logos, watermark, frame or UI. No buildings, fences, paved paths, human objects or cultivated plants. No lawn-like modern grass field. No sunset, night, blue hour, heavy fog, deep shadows, fantasy colors, dramatic light beams or blur. No water in the foreground or central standing surface.\n",
      "bytes": 3712982,
      "sha256": "8ed682a5a9d984a57a0ac3073c17cdcfb5036f41005c020e3db7c5d7ae063694"
    },
    "license": {
      "spdx": "LicenseRef-OpenAI-Output",
      "name": "OpenAI generated output",
      "url": "https://openai.com/policies/terms-of-use/"
    },
    "runtime": {
      "bytes": 301746,
      "sha256": "0a304aee257ecf93648dcf670edad09e36fa6cae9cbb06fc7f6390689af88fe5"
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
      "title": "Therizinosaurus portrait palaeoenvironment",
      "tool": "OpenAI image generation",
      "generatedOn": "2026-10-28",
      "prompt": "Use case: historical-scene\nAsset type: realistic natural habitat background for a children's prehistoric animal museum, independently composed portrait phone scene.\nPrimary request: Generate one finished 9:16 PORTRAIT image, preferably 1440 x 2560 pixels. Create a new tall scene composition, not a crop or extension of any wide image. EMPTY ENVIRONMENT PLATE, absolutely no animal or human.\nScene/backdrop: Late Cretaceous Mongolia's Nemegt river alluvial plain, a green open woodland edge and broad firm silt clearing. A distant gentle river bend may be glimpsed at the far right outside the center, amid low riverbank plants. Scattered airy conifers and early broadleaf trees; a small group of light trunks with loose rounded crowns toward the outer left and slender more distant trees at the right. Fine ferns, horsetails and low understory only at outer edges. This is a well-watered riparian plain, not the modern Gobi, not dunes, dry canyon or bare desert, and not a dense Jurassic jungle.\nStyle/medium: Detailed natural 3D environment with photographic materials, natural plant architecture, fine realistic bark and soil. A polished nature-exhibit scene, neither cartoon nor painted.\nComposition/framing: Compose for a tall phone screen from the start, with low standing eye-height camera. Put the meeting of the open clearing and distant woodland at 48–50% of the total image height. Keep the central 60% of image width spacious and calm, backed by soft medium-light green distant foliage and pale blue sky. The lower half must be a single continuous nearly level firm warm-tan standing surface, smooth packed silt with restrained small-scale texture. The open patch is broad, not a narrow footpath, and stays free of big stones, exposed roots, logs, mounds, tall plants or water. Plants can softly frame the extreme side margins without forming a dark tunnel. Small soft white clouds, clear open sky.\nLighting/mood: Bright welcoming diffuse daylight from upper left, luminous open shade, gentle realistic shadows. It will accompany a tall rust-brown and black feathered model, so keep enough local contrast with lighter warm ground and fresh soft greens, while preserving warm environmental shade and texture. Do not produce a white washed-out center or a dark dense forest wall.\nColor palette: Fresh restrained warm greens, sage in the distance, warm light tan earth and a clear pale blue sky. No fantasy saturation.\nConstraints: No animals, dinosaurs, birds, insects, people or animal silhouettes. No text, lettering, logos, watermarks, frame, UI, buildings, fences, cultivated crops, paved paths or other human objects. No modern turf lawn. No foreground or central water. No night, sunset, blue hour, heavy fog, black shadows, dramatic spotlights, excessive blur or grainy noisy texture. Keep all of the central lower ground connected and walkable.\n",
      "bytes": 3530424,
      "sha256": "0bc49bec766f5d16ee488c3f5bf776ee2d66c33adedcdc2acb5418d7145f343e"
    },
    "license": {
      "spdx": "LicenseRef-OpenAI-Output",
      "name": "OpenAI generated output",
      "url": "https://openai.com/policies/terms-of-use/"
    },
    "runtime": {
      "bytes": 306934,
      "sha256": "f6eeacafa42896774a080b215ef4293f2e3e57237cc5898811b923cfd0624a03"
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
      "title": "Therizinosaurus poster",
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
      "bytes": 42386,
      "sha256": "4746b3cf6155e5c0deba673a4c943d7bd106e839c1574a0bfe8c57ffa60c4278"
    },
    "modifications": [
      "Native headed application WebGL export at Idle time zero; transparent silhouette resized to the delivery frame."
    ],
    "attribution": "Model by Julian Johnson-Mortimer (https://sketchfab.com/FreddyFoxFreddy); museum preparation by Leon Made This.",
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
      "title": "Therizinosaurus poster",
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
      "bytes": 12072,
      "sha256": "dc237627e71a1d2638e5bfc4b5c9d35c4d00480eabeca9973003d71e67ac1aa7"
    },
    "modifications": [
      "Native headed application WebGL export at Idle time zero; transparent silhouette resized to the delivery frame."
    ],
    "attribution": "Model by Julian Johnson-Mortimer (https://sketchfab.com/FreddyFoxFreddy); museum preparation by Leon Made This.",
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
      "title": "Therizinosaurus thumbnail",
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
      "bytes": 36374,
      "sha256": "72741b1a7ba24d520dafc848fb177e397bfc17678758f431c570a7ab8513d201"
    },
    "modifications": [
      "Native transparent model silhouette composited over the independently generated landscape background."
    ],
    "attribution": "Model by Julian Johnson-Mortimer (https://sketchfab.com/FreddyFoxFreddy); museum preparation by Leon Made This.",
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
      "title": "Therizinosaurus Mandarin narration",
      "tool": "Qwen3-TTS",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena",
      "generatedOn": "2026-10-28",
      "prompt": "镰刀龙的两只手上，长着又细又长的爪子。把它转到侧面，看看这些爪子伸出去有多远。",
      "bytes": 77565,
      "sha256": "e9ffda753cf399ab6d2af7275dd45bf2f7217f1b4ab5e3619ec2587bc309e1f4"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "CC BY-NC-SA 4.0 project-owned Qwen3-TTS output",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "bytes": 77565,
      "sha256": "e9ffda753cf399ab6d2af7275dd45bf2f7217f1b4ab5e3619ec2587bc309e1f4"
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
      "title": "Therizinosaurus English narration",
      "tool": "Qwen3-TTS",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena",
      "generatedOn": "2026-10-28",
      "prompt": "Therizinosaurus had long, slender claws on its hands. Turn it to the side and follow each claw all the way to the tip.",
      "bytes": 92445,
      "sha256": "454c00d0528ea5e0577b0da8b67427827912a8aa7a5f95d96a21d48d875046fa"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "CC BY-NC-SA 4.0 project-owned Qwen3-TTS output",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "bytes": 92445,
      "sha256": "454c00d0528ea5e0577b0da8b67427827912a8aa7a5f95d96a21d48d875046fa"
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
