import type { AssetProvenance } from '../../types'

export const provenance = [
  {
    "assetPath": "model/model.glb",
    "kind": "model",
    "source": {
      "type": "third-party",
      "title": "Pterosaur Quetzalcoatlus",
      "author": "seirogan (https://sketchfab.com/seirogan)",
      "url": "https://sketchfab.com/3d-models/pterosaur-quetzalcoatlus-5ef112b3208d4444a51e480beca56277",
      "accessedOn": "2026-10-28",
      "bytes": 22134100,
      "sha256": "a58eca9afb14947f31919437057bd059ae344ed9890b78958b2797213ea1a29f"
    },
    "license": {
      "spdx": "CC-BY-4.0",
      "name": "Creative Commons Attribution 4.0 International",
      "url": "https://creativecommons.org/licenses/by/4.0/"
    },
    "runtime": {
      "bytes": 6627276,
      "sha256": "e9950c23d9ba58536466cfa72846dac66e1c79981a5328660f9dfcb0a1a70fe5"
    },
    "modifications": [
      "Welded split source chunks while preserving source UV and 37-joint skeleton.",
      "Locally smoothed and thinned lumpy outer wing membranes, reduced crown height and cheek width.",
      "Removed clearcoat and reduced specular reflection; source colour image remains 512 px, without upsampling.",
      "Normalised to Y-up glTF with head +X; identity armature and stationary zero root.",
      "Locally smoothed the rear membrane / hind-limb weight transition; inverse-skin compensated rest coordinates to retain the initial appearance.",
      "Replaced the source fast flight with a restrained two-beat eight-second exhibition Idle on the existing 37-joint skeleton, with phased wings, head and foot motion; no forward travel or added biting.",
      "Animated verified lower-jaw Bone.006_019 through two gentle13-degree closures per eight-second loop; upper-beak Bone.007_00 is not animated as a jaw.",
      "2026-10-30: adapted actual Pteranodon clavicle/upper-arm/forearm/wrist/wingfinger gesture through anatomical basis retargeting, with a longer complete beat than its authored0.7 App speed, a compact powerstroke and longer recovery followed by long glide; fixedRoot and original37-bone mesh/materials/initial pose retained; bounded proximal membrane field repaired with inverse-skin compensation.",
      "True humerus posture compensation addresses Quetz versus reference initial elevation during active beat, returning exactly to original initial pose. Distributed power response and recovery/settling through neck-base,mid-neck,upper-neck,skull with a small glide glance. Original verified13-degree jaw local curves retained exactly.",
      "Adapted flight rotations from Pteranodon (Animated) by Chistodrako._. / Oscar López Riviello, CC BY 4.0, https://sketchfab.com/3d-models/pteranodon-animated-7d7683df41d1405283f160e81a5dff1b; no reference mesh, textures or rig copied."
    ],
    "attribution": "Model by seirogan (https://sketchfab.com/seirogan); flight motion adapted from Pteranodon (Animated) by Chistodrako._. / Oscar López Riviello (https://sketchfab.com/3d-models/pteranodon-animated-7d7683df41d1405283f160e81a5dff1b), CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); museum preparation by Leon Made This.",
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
      "title": "Quetzalcoatlus landscape palaeoenvironment",
      "tool": "OpenAI image generation",
      "generatedOn": "2026-10-28",
      "prompt": "Use case: historical-scene.\nAsset type: ONE landscape background for a child-facing 3D prehistoric animal museum, environment only.\nPrimary request: independent wide 16:9 composition, approximately 1792×1008. Naturalistic photoreal 3D environmental rendering, gentle and bright, consistent with a realistic 3D animal museum scene.\nScene/backdrop: an inland river and floodplain in the latest Cretaceous Javelina Formation region of Texas, inspired by 2021 Quetzalcoatlus habitat research. A very broad low flat floodplain, a gently winding freshwater river and an abandoned shallow channel-lake in the far distance. Small distant bands of evergreen woodland, a few araucarian conifers mixed with low broadleaf tree masses and very sparse fan palms at remote lake margins. Keep all vegetation far away and low. This is inland river terrain, NOT a seacoast, NOT a modern Texas desert. No cacti, no desert mesas, no steep mountains, no sandy dunes, no lawns.\nComposition/framing: quiet clear blue-cyan sky occupies the upper 78–80% of the frame. Actual distant water horizon at 79% of image height, with all terrestrial detail within the bottom fifth. A low muted sage floodplain along the bottom left; a calm sinuous freshwater river enters from bottom right and curves toward a distant narrow channel in the lower center. Small forest band hugs the low horizon. The CENTRAL 60% MUST BE CLEAN UNOBSTRUCTED CYAN SKY. No tall tree, cliff, cloud bank or foreground object enters that area. Optional very small wisps at the extreme top-left and far-right margins only, with no central cloud.\nLighting/mood: bright airy late morning, soft sunlight from upper left with gentle shadows, no visible sun; welcoming and peaceful for children. Even exposure with no dark frame or vignette. Natural details in the riverbanks stay gently lit.\nColor palette: clear light-to-medium cyan-blue central sky, unmistakably blue and never near-white or gray, to outline a white-gray pterosaur neck/body and brown wings with red crest. Sky blue should be calm and luminous, not deep navy. Gentle pale aqua freshwater, muted sage and olive green woodland, warm light earth banks. A thin light atmospheric fade only near the low horizon.\nConstraints: NO animals, NO pterosaurs, dinosaurs, birds, bird silhouettes, insects, humans. No text, UI, labels, logos, watermarks, frames, buildings, roads, fences, boats, modern objects. No large clouds, no broad white central clouds, no dramatic shadows or sunset. No fantasy mountains. Do not create a collage or paired image; produce a single complete independent horizontal background.",
      "bytes": 1940192,
      "sha256": "eda2f62e42bf6bf5c876ad590414ec17faf0b1236d5a50172716f98d8526a12a"
    },
    "license": {
      "spdx": "LicenseRef-OpenAI-Output",
      "name": "OpenAI generated output",
      "url": "https://openai.com/policies/terms-of-use/"
    },
    "runtime": {
      "bytes": 169308,
      "sha256": "20ef4122b9990a69979f75d324006546285689adb3b31e7e8600b71e185d0a7f"
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
      "title": "Quetzalcoatlus portrait palaeoenvironment",
      "tool": "OpenAI image generation",
      "generatedOn": "2026-10-28",
      "prompt": "Use case: historical-scene.\nAsset type: ONE independent tall portrait 9:16 background for a child-facing 3D prehistoric animal museum; environment without creatures.\nPrimary request: vertical composition approximately 1008×1792. High quality naturalistic 3D / photoreal environmental rendering. The main visual subject is a vast clear light cyan-blue sky, bright, gentle, airy and welcoming.\nLayout is essential: SKY 80%, LAND/WATER 20%. Put the nearly flat far horizon exactly around 80% from the top of the portrait. No land or water detail above the lowest fifth of the image. Only the bottom one-fifth shows a distant inland river landscape. Compose this for portrait from the start, never crop a panorama. Central 60% must be plain uncluttered cyan-blue sky with no cloud, branch or other obstruction. A few tiny feathery cloud wisps may occupy only the extreme top-left or far-right edge; keep all main center free.\nScene in the bottom fifth: latest Cretaceous Javelina Formation inland Texas floodplain, following the 2021 Quetzalcoatlus habitat studies. A calm freshwater river winds toward a low distant channel-lake; its near bank sweeps in from the lower left edge, opposite bank very low along the right. Very distant narrow evergreen woodland on the flat horizon, formed of small broadleaf masses and a few low araucarian conifers. A couple of remote fan palms near the lake margin are permissible, tiny only. Restrained low natural floodplain foliage, softly colored earth banks; no lawn or mown grass, no modern crop field. No tall vegetation and NO foreground tree. This is inland freshwater terrain hundreds of kilometers from the sea, with evergreen forest, NOT ocean and NOT today's Texas desert. No cactus, rocky mesa, dune, mountain or cliff.\nLighting: soft bright late-morning sunlight from upper left, no visible sun. Calm child-friendly exposure, gentle shadows only. No dark frame, no vignette, no sunrise or dusk. Thin atmospheric fade is confined just to the low horizon.\nPalette: the CENTRAL SKY is a luminous light-to-medium cyan-blue, visibly blue and sufficiently colored to distinguish a white-gray neck/body and brown wings with red crest. Never near-white across the model area, never deep navy. Pale blue-aqua river water, warm light taupe banks and sage/olive greens match the horizontal inland-river scene.\nConstraints: absolutely no animal, pterosaur, dinosaur, bird, flying silhouette, insect or human. No text, labels, logo, watermark, UI, frame, road, building, fence, boat or any modern object. No large white clouds, no central clouds, no dramatic sunbeams. Single complete vertical image only.",
      "bytes": 1914767,
      "sha256": "89d0d1f27b1415470566f95c87673d2556ee0ebc66b927ce789401a6e831100c"
    },
    "license": {
      "spdx": "LicenseRef-OpenAI-Output",
      "name": "OpenAI generated output",
      "url": "https://openai.com/policies/terms-of-use/"
    },
    "runtime": {
      "bytes": 157136,
      "sha256": "8c8602a2fc855f879d9bee7560e0cca67d1836742ef09140736a1c1a730baff2"
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
      "title": "Quetzalcoatlus poster",
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
      "bytes": 28090,
      "sha256": "42ac040f0322010c349eafb00937ba5df28ddd23b73168d84947fcc470487c99"
    },
    "modifications": [
      "Native headed application WebGL export at Idle time zero; transparent silhouette resized to the delivery frame."
    ],
    "attribution": "Model by seirogan (https://sketchfab.com/seirogan); flight motion adapted from Pteranodon (Animated) by Chistodrako._. / Oscar López Riviello (https://sketchfab.com/3d-models/pteranodon-animated-7d7683df41d1405283f160e81a5dff1b), CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); museum preparation by Leon Made This.",
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
      "title": "Quetzalcoatlus poster",
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
      "bytes": 7592,
      "sha256": "63edf8d0e2fb20198dd6d6e4f810ee543644e90a9e65b597dc64bcf0edd1183f"
    },
    "modifications": [
      "Native headed application WebGL export at Idle time zero; transparent silhouette resized to the delivery frame."
    ],
    "attribution": "Model by seirogan (https://sketchfab.com/seirogan); flight motion adapted from Pteranodon (Animated) by Chistodrako._. / Oscar López Riviello (https://sketchfab.com/3d-models/pteranodon-animated-7d7683df41d1405283f160e81a5dff1b), CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); museum preparation by Leon Made This.",
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
      "title": "Quetzalcoatlus thumbnail",
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
      "bytes": 13680,
      "sha256": "f77e3126fa81c8e417efa36960a91e9d8c50a17aaecb9fa0a029a7e1d9c60019"
    },
    "modifications": [
      "Native transparent model silhouette composited over the independently generated landscape background."
    ],
    "attribution": "Model by seirogan (https://sketchfab.com/seirogan); flight motion adapted from Pteranodon (Animated) by Chistodrako._. / Oscar López Riviello (https://sketchfab.com/3d-models/pteranodon-animated-7d7683df41d1405283f160e81a5dff1b), CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); museum preparation by Leon Made This.",
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
      "title": "Quetzalcoatlus Mandarin narration",
      "tool": "Qwen3-TTS",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena",
      "generatedOn": "2026-10-28",
      "prompt": "这是风神翼龙，一种生活在晚白垩世的飞行爬行动物。看看它长长的脖子和展开的大翅膀。",
      "bytes": 84765,
      "sha256": "e927840192249938731da65e549ccb857cef3bfb02b4692665cec8b6829b10f9"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "CC BY-NC-SA 4.0 project-owned Qwen3-TTS output",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "bytes": 84765,
      "sha256": "e927840192249938731da65e549ccb857cef3bfb02b4692665cec8b6829b10f9"
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
      "title": "Quetzalcoatlus English narration",
      "tool": "Qwen3-TTS",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena",
      "generatedOn": "2026-10-28",
      "prompt": "This is Quetzalcoatlus, a flying reptile from the Late Cretaceous. Look at its long neck and its great outstretched wings.",
      "bytes": 95325,
      "sha256": "b7a8f884abe356f6604e0735539a877caade3e0a6636016ca4255f7400190423"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "CC BY-NC-SA 4.0 project-owned Qwen3-TTS output",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "bytes": 95325,
      "sha256": "b7a8f884abe356f6604e0735539a877caade3e0a6636016ca4255f7400190423"
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
