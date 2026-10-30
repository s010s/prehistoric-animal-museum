import type { AssetProvenance } from '../../types'

export const provenance = [
  {
    "assetPath": "model/model.glb",
    "kind": "model",
    "source": {
      "type": "third-party",
      "title": "Sordes Pilosus — mesh and rig only",
      "author": "victory_mirosya (embedded credit); Paleo Modelist / victory_ (current model owner)",
      "url": "https://sketchfab.com/3d-models/sordes-pilosus-45afc7fc47f3402db1bca10e5b1ca6c5",
      "accessedOn": "2026-10-29",
      "bytes": 761452,
      "sha256": "e252e472ba3916b7a4557ce3d5080fac0d6a712201950380efaf493c81dcfeef"
    },
    "license": {
      "spdx": "CC-BY-4.0",
      "name": "Creative Commons Attribution 4.0 International",
      "url": "https://creativecommons.org/licenses/by/4.0/"
    },
    "runtime": {
      "bytes": 1928200,
      "sha256": "4a21b059e3a3d820eaf19dcced5b8eba079af7a69dd6457ce70956c92fd1adae"
    },
    "modifications": [
      "Preserved the source mesh, UVs, skinning, rig and wing, head and long-tail motion; retimed the stationary loop to exactly eight seconds at 24 fps.",
      "Excluded the original AMNH illustration completely; replaced all original image payloads with independent original procedural body-fur and membrane textures.",
      "Applied uniform axis and scale normalisation and matte warm-brown materials."
    ],
    "attribution": "Model by victory_mirosya (embedded credit); Paleo Modelist / victory_ (current model owner); museum preparation by Leon Made This.",
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
      "title": "Sordes landscape palaeoenvironment",
      "tool": "OpenAI image generation",
      "generatedOn": "2026-10-29",
      "prompt": "Use case: historical-scene.\nAsset type: single landscape environment background for a child-facing 3D prehistoric animal museum. No creature in the image.\nPrimary request: ONE independently generated wide 16:9 composition, approximately 1672×940. Naturalistic high-quality 3D / photoreal environment rendering, bright, gentle and softly exposed.\nScene: plausible artistic Late Jurassic freshwater lake near Karatau / Karabastau, Kazakhstan, the fossil region of Sordes. This is an imagined lake habitat, not a precise recovered location. Calm muted blue freshwater, pale beige very low rocky/earthen banks, only a thin band of small distant conifer forms and nonflowering fern-like plants. A few very faint low rounded gray-taupe hills in the far distance. No sea, no tropical lagoon, no towering mountains or desert mesas.\nCritical layout: make the ENTIRE top 75% an almost-empty clean LIGHT CYAN BLUE SKY. Put the far shore at 82% of image height. All land, all trees, ALL HILLS including the very highest hill tips must be BELOW the 75% line, entirely in the bottom quarter. The hills should be shallow distant undulations only a few pixels tall; do not let a hill rise into either side of the main sky. Sky extends freely across the full width with no tall side framing. Lake water fills the lower fifth. One small gently sloping beige lakeshore touches the extreme bottom-left corner with two tiny low fern clusters; open lake along bottom-right. No foreground tree or tall rock. The CENTRAL 60% must be uninterrupted consistent clear blue sky, with no cloud, tree, branch, landform or object, spacious for a flying 3D Sordes with brown wings and warm-gold body.\nLighting/mood: bright, soft diffuse natural daylight and clear pleasant air, cheerful and inviting for young children. Even gentle illumination, light shallow shadows only. No visible sun, hard hotspot, spotlight, god ray, light column, light beam, fog, dark mist, vignette or sunset. Use a soft restrained palette, not tropical postcard saturation.\nColor: luminous pale-to-mid cyan blue sky, visibly blue rather than near-white, complementary contrast for brown membranes and golden body, and sufficient contrast for pale wingtips. Muted cool blue lake, subdued gray-taupe far hills, sage green ancient vegetation, light warm beige bank. Atmospheric softness only in the very distant bottom horizon.\nClouds: none in central sky; only one or two tiny feathery wisps at extreme upper corners. No large white cloud or cloud bank.\nConstraints: no animals, pterosaurs, dinosaurs, birds, flying silhouettes, insects, humans, text, labels, logo, watermark, UI, border, roads, fences, boats, buildings, modern objects. No modern grass meadow, lawn, flowers, crop field, cacti, palms or modern landscaping. No large foreground foliage or rocks. No collage or split view. Single whole horizontal image only.",
      "bytes": 1784740,
      "sha256": "58e82d9da24f4fbabcbe2ab7fb772e6d75f02150aebea564298e0d75aa19438a"
    },
    "license": {
      "spdx": "LicenseRef-OpenAI-Output",
      "name": "OpenAI generated output",
      "url": "https://openai.com/policies/terms-of-use/"
    },
    "runtime": {
      "bytes": 119436,
      "sha256": "4b392b262e0b3598192c1b4f1dd15bd1b1e4db7173fe41de2825db30607ecd2e"
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
      "title": "Sordes portrait palaeoenvironment",
      "tool": "OpenAI image generation",
      "generatedOn": "2026-10-29",
      "prompt": "Use case: historical-scene.\nAsset type: one independent portrait background for a child-facing 3D prehistoric animal museum. Environment only, absolutely no creature.\nPrimary request: a tall vertical 9:16 composition, approximately 940×1672, composed vertically from the beginning, never cropped from a panorama. Naturalistic high-quality 3D / photoreal environment rendering, soft, clear and child-friendly.\nScene: plausible artistic reconstruction of a Late Jurassic freshwater lakeshore inspired by the Karatau / Karabastau lake deposits of Kazakhstan, where Sordes fossils are known. This is not an exact recovered landscape. A still muted blue lake, distant very low rounded gray-taupe hills, scattered small ancient conifer-like trees and restrained nonflowering fern-like plants far below the model. No sea or coral lagoon, no modern Tian Shan peaks, no desert mesa, no tropical palm resort.\nIndependent portrait composition: calm light blue sky is the dominant 68–72% of the frame. The thin distant shoreline and low hills are around 70% of portrait height, always within the lower third. A low gently curving pale beige earthen/rocky lakeshore enters from the BOTTOM RIGHT corner, then tapers toward a small headland at lower right; open tranquil blue lake water is visible toward lower left, with a short far lake bank just across the bottom third. The hills are distant and very low, without dramatic peaks. A few tiny low fern fronds can touch the very bottom-right frame only; no tall tree. The entire CENTRAL 60% must be clean continuous soft light cyan-blue sky, without branch, tree, cloud, hill or object. Keep a tall open sky column for a flying 3D Sordes model with brown wing membranes and a warm golden body. This must look like a different view of the same lake environment as a wide horizontal background, with the same palette and lighting.\nLighting: bright diffuse natural daylight, softly and evenly illuminating the scene. No sun disk, hard hotspot, beam, column of light, god ray, spotlight, visible shaft of light, vignette, dark mist or fog. Light shadows only. Cheerful airy calm for young children, no gloomy storm or dusk.\nPalette: softly luminous pale-to-mid cyan-blue sky, clearly blue rather than near-white across the model area so pale wing tips remain visible; complementary contrast for warm brown and gold. Muted cool blue lake water, light warm beige bank, desaturated gray-taupe hills, sparse sage greenery. Restrain saturation and make the sky feel naturally soft, not a saturated tropical postcard.\nClouds: none in the center; at most one tiny delicate wisp at the extreme top-left corner. Environment detail stays within the bottom 25–35%.\nConstraints: no animals, pterosaurs, dinosaurs, birds, insects or flying silhouettes. No people, text, logos, watermark, UI, labels, border, building, fence, road, boat, aircraft or modern object. No modern grass meadow, lawn, crop field, grasses, flowers or modern ornamental plants. No large white cloud or central cloud bank. No close tree, tall shrub or foreground branch. One complete independent vertical image only, no split view or collage.",
      "bytes": 2104956,
      "sha256": "ec498d117db194f742b389cb2b030c8534525eef78426f45940d14c18c47fc5b"
    },
    "license": {
      "spdx": "LicenseRef-OpenAI-Output",
      "name": "OpenAI generated output",
      "url": "https://openai.com/policies/terms-of-use/"
    },
    "runtime": {
      "bytes": 211854,
      "sha256": "d98cb4cc421beb7aa01914b98a285f919122d7701d1b886a74efc120b46e0f24"
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
      "title": "Sordes poster",
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
      "bytes": 15110,
      "sha256": "3106f3b2a73d0ddfdb97d430846d0628a7ea0284edafb9a2dd79b96fc8a01dbe"
    },
    "modifications": [
      "Native headed application WebGL export at Idle time zero; transparent silhouette resized to the delivery frame."
    ],
    "attribution": "Model by victory_mirosya (embedded credit); Paleo Modelist / victory_ (current model owner); museum preparation by Leon Made This.",
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
      "title": "Sordes poster",
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
      "bytes": 3480,
      "sha256": "2c00b5456eef05c82b34bc83565cd9c70f0ad00ce323f011ba0ce5f299c3f3b7"
    },
    "modifications": [
      "Native headed application WebGL export at Idle time zero; transparent silhouette resized to the delivery frame."
    ],
    "attribution": "Model by victory_mirosya (embedded credit); Paleo Modelist / victory_ (current model owner); museum preparation by Leon Made This.",
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
      "title": "Sordes thumbnail",
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
      "bytes": 8308,
      "sha256": "d75a976475c8d192f001e529b98e34f8ef149756fecb4d4afbcb9b48772f8857"
    },
    "modifications": [
      "Native transparent model silhouette composited over the independently generated landscape background."
    ],
    "attribution": "Model by victory_mirosya (embedded credit); Paleo Modelist / victory_ (current model owner); museum preparation by Leon Made This.",
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
      "title": "Sordes Mandarin narration",
      "tool": "Qwen3-TTS",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena",
      "generatedOn": "2026-10-29",
      "prompt": "这位长尾巴的小飞行家叫索德斯翼龙。它身上有毛一样的细丝，翅膀由薄薄的皮膜组成。",
      "bytes": 87885,
      "sha256": "66be037fcd3b62c3d7695b179f496af7b58149afa5ea5e13eeb1d1713cc532a3"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "CC BY-NC-SA 4.0 project-owned Qwen3-TTS output",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "bytes": 87885,
      "sha256": "66be037fcd3b62c3d7695b179f496af7b58149afa5ea5e13eeb1d1713cc532a3"
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
      "title": "Sordes English narration",
      "tool": "Qwen3-TTS",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena",
      "generatedOn": "2026-10-29",
      "prompt": "Meet Sordes, a little flying reptile with a long tail. Its body had hair-like threads, and thin skin membranes formed its wings.",
      "bytes": 98685,
      "sha256": "b72b150575119fae3a459ae797412ceb0c86d7224d28dec327e5b3bb3c55769a"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "CC BY-NC-SA 4.0 project-owned Qwen3-TTS output",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "bytes": 98685,
      "sha256": "b72b150575119fae3a459ae797412ceb0c86d7224d28dec327e5b3bb3c55769a"
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
