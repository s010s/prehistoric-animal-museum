import type { AssetProvenance } from '../../types'

export const provenance = [
  {
    "assetPath": "model/model.glb",
    "kind": "model",
    "source": {
      "type": "third-party",
      "title": "Sarcosuchus",
      "author": "Julian Johnson-Mortimer (https://sketchfab.com/FreddyFoxFreddy)",
      "url": "https://sketchfab.com/3d-models/sarcosuchus-6cb4e0c2b53447409cc092f9cfa97c51",
      "accessedOn": "2026-10-28",
      "bytes": 48168276,
      "sha256": "c35b775b5da2510a7fc49aac8da4673fd54cc2e4563c1dc4e6573109476a55c1"
    },
    "license": {
      "spdx": "CC-BY-4.0",
      "name": "Creative Commons Attribution 4.0 International",
      "url": "https://creativecommons.org/licenses/by/4.0/"
    },
    "runtime": {
      "bytes": 17945692,
      "sha256": "f31490d167289a724a77f33b2040fc66f377c52a7f01bb1e361a2e5f011ceb20"
    },
    "modifications": [
      "Merged/welded source chunks; 250k geometry; high-to-low tangent normals; roughness correction; new skin and stationary 8-second Idle with breathing, head/neck/tail and 9-degree jaw closing; brighter warm green/ochre skin midtones."
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
      "title": "Sarcosuchus landscape palaeoenvironment",
      "tool": "OpenAI image generation",
      "generatedOn": "2026-10-29",
      "prompt": "Use case: historical-scene.\nAsset type: empty immersive environment background for a children's natural-history 3D exhibit. ONE LANDSCAPE 16:9 image, independently composed for a wide screen.\nPrimary request: a bright sunlit Early Cretaceous river-marsh wetland in the Elrhaz landscape of what is now Niger. A lush calm freshwater wetland, with GREEN low non-flowering marsh vegetation, ferns and a distant low conifer forest. Environment only, absolutely NO animals.\nComposition and grounding are critical: the distant HORIZON / base of the far tree line sits HIGH in the image at 35 percent of total image height from the top, between 32 and 38 percent. Sky occupies only roughly the top third, not half the picture. Below the horizon, the broad central foreground is a flat continuous WARM BROWN DAMP MUD BANK, gently textured and compacted, extending right out to the bottom edge. At 55–65 percent of total image height, across the central 60 percent of image width, there must be a generous continuous nearly level exposed muddy standing surface for a low long-bodied externally rendered animal. That entire central standing band is solid land, NOT a pool, water, mirror, a ridge, slope, raised pedestal or sand dune.\nHabitat layout: visibly shallow clean blue water channels and small pools sit on BOTH SIDE EDGES and in the BACKGROUND behind the mud bank, framed by low bright olive-green wetland plants and fern beds. The scene must immediately read as a freshwater swamp / river wetland, not a sandy desert clearing. A broad central mud tongue gently meets shallow marsh water far behind the eventual model. Keep plants and little stones out of the central standing patch; all foliage and water detail belongs at side edges or back distance. No foreground trunk, branch or tall stem crosses the central 60 percent.\nCamera/style: immersive realistic 3D / photographic prehistoric environment plate, low natural level viewpoint with a broad view across the damp bank, believable soft physical textures, no illustration or fantasy. Clear silhouette space for a yellow-brown olive-coloured model without drawing that model. The central mud is restrained warm medium-light brown and olive-tan, evenly lit, quiet and low-detail.\nLighting and mood: clear pleasant daytime, VERY BRIGHT, calm, welcoming for toddlers, SOFT NATURAL DIFFUSE DAYLIGHT evenly illuminating the entire scene. Pale clear blue sky with a few soft clouds. Soft low-contrast shadows only. No visible atmospheric light shafts, sunbeams, two beams, glowing rays, spotlight cones, theatrical rim lighting, harsh noon glare or dark damp grotto.\nPalette: lively muted olive and fern greens, clean shallow-water blue, warm moist mud brown, light blue sky. No desert sand yellow expanse, no gloomy black-green shadow.\nConstraints: NO animals of any kind, no crocodile or reptile, no people, fish, birds or insects. No modern buildings, fences, paths, ruins or structures. No modern flowers, flowering lilies, ornamental tropical plants, modern lawn grass, modern palms or decorative garden. No text, letters, logos, labels, watermark, UI or border. No deep ocean, underwater viewpoint, cave, storm, sunset, dramatic light rays or dark swamp horror. One complete wide scene, not a collage or contact sheet.",
      "bytes": 3310779,
      "sha256": "ad9cf97a2a51ccf49f51f77f4c3609d064d8e5147bae81a13b18fc6121743da3"
    },
    "license": {
      "spdx": "LicenseRef-OpenAI-Output",
      "name": "OpenAI generated output",
      "url": "https://openai.com/policies/terms-of-use/"
    },
    "runtime": {
      "bytes": 279752,
      "sha256": "be3d05103fa65731ccbdaaed2ca9de05c4088fef26d9f0b10750ae56046d348c"
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
      "title": "Sarcosuchus portrait palaeoenvironment",
      "tool": "OpenAI image generation",
      "generatedOn": "2026-10-29",
      "prompt": "Use case: historical-scene.\nAsset type: empty immersive environment background for a children's natural-history 3D exhibit. ONE PORTRAIT 9:16 image, independently composed for a tall phone display, not a crop of a wide picture.\nPrimary request: a bright sunlit Early Cretaceous river-marsh wetland in the Elrhaz landscape of what is now Niger. A lush calm freshwater wetland, with GREEN low non-flowering marsh vegetation, ferns and a distant low conifer forest. Environment only, absolutely NO animals.\nComposition and grounding are critical: the distant HORIZON / base of the far tree line lies at 43 percent of the total image height from the top, between 40 and 46 percent. Above that is a pleasant airy light blue sky; below it a generous uninterrupted WARM BROWN DAMP MUD BANK extends through the centre all the way to the bottom. At 55–65 percent of total image height, across the central 60 percent of the image width, show a broad nearly level exposed damp muddy standing surface for a low long-bodied externally rendered animal. That whole standing band is solid flat land, NOT a pool, water, mirror, high ridge, sloping hill, raised pedestal or sand dune.\nTall-screen habitat layout: a central mud tongue sits between shallow clean blue channels and small marsh pools toward BOTH SIDE EDGES, with water also visible far behind it. Low olive-green non-flowering wetland vegetation and fern beds frame those side waters; distant conifers form a soft low horizon. The scene must immediately read as a freshwater swamp / river wetland, not a sandy desert clearing. Use the vertical depth for calm sky above and a long continuous muddy ground plane below; no tall plant, tree, branch, rock or other object enters the central 60 percent of image width.\nCamera/style: immersive realistic 3D / photographic prehistoric environment plate, natural low level viewpoint, believable soft physical texture, no illustration or fantasy. Clear silhouette space for a yellow-brown olive-coloured model without drawing that model. Central mud is restrained warm medium-light brown / olive-tan, evenly lit, quiet and low-detail.\nLighting and mood: clear pleasant daytime, VERY BRIGHT, calm, welcoming for toddlers, SOFT NATURAL DIFFUSE DAYLIGHT evenly illuminating the entire scene. Light blue sky and a few soft clouds. Soft low-contrast shadows only. No visible atmospheric light shafts, sunbeams, two beams, glowing rays, spotlight cones, theatrical rim light, harsh glare or dark damp grotto.\nPalette: same olive and fern greens, clean shallow-water blue, warm moist mud brown and light blue sky as a companion wide marsh scene. No desert sand yellow expanse, no gloomy black-green shadow.\nConstraints: NO animals of any kind, no crocodile or reptile, no people, fish, birds or insects. No modern buildings, fences, paths, ruins or structures. No modern flowers, flowering lilies, ornamental tropical plants, lawn grass, palms or decorative garden. No text, letters, logo, labels, watermark, UI or border. No deep ocean, underwater viewpoint, cave, storm, sunset, dramatic light rays or dark swamp horror. One complete tall scene, not a collage or contact sheet.",
      "bytes": 3104633,
      "sha256": "8eb7015f0b2dc237756fb6e11d52eb7d07f6bbc29c0e1f4c20fa65a7e420a802"
    },
    "license": {
      "spdx": "LicenseRef-OpenAI-Output",
      "name": "OpenAI generated output",
      "url": "https://openai.com/policies/terms-of-use/"
    },
    "runtime": {
      "bytes": 297572,
      "sha256": "10b0111547cadba2186ac9a45318465c94c237b235a0ba39874cdf67649ee9aa"
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
      "title": "Sarcosuchus poster",
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
      "bytes": 21984,
      "sha256": "fad48c532671b0f63d6e3bdae41dbedf95f5298f7dd6fab99473862ab1f3ed8b"
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
      "title": "Sarcosuchus poster",
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
      "bytes": 6342,
      "sha256": "09a86aa8017d805eca1545462add09ddc452dd74465393afd1ebd6331bd3fba8"
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
      "title": "Sarcosuchus thumbnail",
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
      "bytes": 28972,
      "sha256": "035925a28dc386502133d855df3bbd35343308ec1ffa1cdec57a05ddbcaa60f7"
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
      "title": "Sarcosuchus Mandarin narration",
      "tool": "Qwen3-TTS",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena",
      "generatedOn": "2026-10-28",
      "prompt": "帝鳄生活在白垩纪的河流附近，长长的嘴巴里有许多牙齿。顺着它的背往后找，一块块硬硬的骨甲一直排到尾巴上。",
      "bytes": 103485,
      "sha256": "31057fe0538f318c67998e4c1b3878d093da92781e735eeae598b13486a265c0"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "CC BY-NC-SA 4.0 project-owned Qwen3-TTS output",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "bytes": 103485,
      "sha256": "31057fe0538f318c67998e4c1b3878d093da92781e735eeae598b13486a265c0"
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
      "title": "Sarcosuchus English narration",
      "tool": "Qwen3-TTS",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena",
      "generatedOn": "2026-10-28",
      "prompt": "Sarcosuchus lived around Cretaceous rivers and had many teeth inside its long jaws. Follow its back towards the tail and look for the rows of hard, bony armour.",
      "bytes": 120765,
      "sha256": "691a47e4e5de36851a53e52079fc05932306198e5a0108ac9bc41f1d7d49df63"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "CC BY-NC-SA 4.0 project-owned Qwen3-TTS output",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "bytes": 120765,
      "sha256": "691a47e4e5de36851a53e52079fc05932306198e5a0108ac9bc41f1d7d49df63"
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
