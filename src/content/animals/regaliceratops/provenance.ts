import type { AssetProvenance } from '../../types'

export const provenance = [
  {
    "assetPath": "model/model.glb",
    "kind": "model",
    "source": {
      "type": "third-party",
      "title": "Regaliceratops",
      "author": "Julian Johnson-Mortimer (https://sketchfab.com/FreddyFoxFreddy)",
      "url": "https://sketchfab.com/3d-models/regaliceratops-fb292480dc88483f919c3b11637da3da",
      "accessedOn": "2026-10-28",
      "bytes": 69621916,
      "sha256": "19c584d91819ae9bb598651755249f3b98bce03b10326a9259c55ac1b068b9c3"
    },
    "license": {
      "spdx": "CC-BY-4.0",
      "name": "Creative Commons Attribution 4.0 International",
      "url": "https://creativecommons.org/licenses/by/4.0/"
    },
    "runtime": {
      "bytes": 17652732,
      "sha256": "01d95a9184c58ff23d81c66d9c1b580cda9d4e5369c384835f981527788d25f2"
    },
    "modifications": [
      "Welded material chunks before reduction",
      "Reduced geometry while allocating more faces to horns and frill",
      "Shifted repeated colA UV island from U=-1..0 to U=0..1",
      "Baked high-source tangent normals at 1536px; neutralized invalid projections",
      "Corrected overly glossy skin and horn roughness",
      "Normalized glTF Y-up, head +X, horizontal center, planted feet, length about 3.2",
      "New weighted skeleton and one eight-second 24fps stationary Idle",
      "v2: moderately lifted dark-green and warm-brown sRGB albedo midtones; unchanged normal maps, geometry, weights, skeleton and eight-second Idle."
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
      "title": "Regaliceratops landscape palaeoenvironment",
      "tool": "OpenAI image generation",
      "generatedOn": "2026-10-28",
      "prompt": "Use case: historical-scene\nAsset type: realistic natural environment background for a children's prehistoric animal museum, landscape desktop scene.\nPrimary request: Generate one finished 16:9 landscape image, preferably 2560 x 1440 pixels. This is an EMPTY HABITAT PLATE; absolutely no animal or human is present.\nScene/backdrop: A Late Cretaceous Alberta woodland-edge alluvial plain appropriate for Regaliceratops. Broad open, nearly level floodplain clearing, a distant low line of mixed conifer and early broadleaf woodland, delicate low ferns and scattered unobtrusive understory only along the lateral edges. A little distant topographic depth, soft pale blue sky with a few diffuse white clouds. No modern grass lawn, no cultivation, no dramatic mountains.\nStyle/medium: Detailed natural 3D environment with photographic materials, naturalistic plant structure, fine believable soil and leaf textures. High-quality realistic game environment like a gently lit nature exhibit. Neither cartoon nor painterly.\nComposition/framing: Compose this as a wide landscape scene from the start. Camera at low standing eye height looking almost horizontally across a broad empty clearing. Distant ground horizon at 47% of image height. The central 60% of the whole image is calm and low contrast with soft distant sage foliage. The entire bottom half is one continuous, flat, firm pale earth standing surface, with gentle perspective and subtle fine soil texture. Keep large roots, stones, ferns, fallen logs and shrubs outside the central standing area. Frame the far left and right with natural vegetation without overhanging dark masses. The clearing spreads laterally, with pale tree trunks grouped far left and a lower understory silhouette on the right.\nLighting/mood: Bright, welcoming soft daylight from upper left, diffuse open shade with delicate contact shadows. Exposure stays luminous and easy for children to see. A dark olive-brown animal with muted red and blue neck-frill details will be composited later, so the scene must support it through a medium-light sage and warm light-earth central backdrop; do not create a flat white wash or a dark forest wall.\nColor palette: Soft sage greens, light olive foliage, warm pale tan soil, pale blue sky; restrained natural saturation.\nConstraints: Environment only, no creatures, no birds, no insects, no people, no silhouettes of animals. No text, letters, logo, watermark, frame, UI, modern structures, paths with paving, fences or artifacts. No sunset, blue hour, night, heavy fog, dramatic shafts of light, deep black shadows or excessive blur. No large foreground objects. Keep the full center and lower central ground uninterrupted and walkable.\n",
      "bytes": 3160964,
      "sha256": "f904832f319d3b17aaf8373aba1b47b07d6e2774749ee6230f0ec943802acb62"
    },
    "license": {
      "spdx": "LicenseRef-OpenAI-Output",
      "name": "OpenAI generated output",
      "url": "https://openai.com/policies/terms-of-use/"
    },
    "runtime": {
      "bytes": 303546,
      "sha256": "3df9d61a65bca94a9e3d45ad93ef35efe384aa599b5ce25f738b37fbea7eb0b8"
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
      "title": "Regaliceratops portrait palaeoenvironment",
      "tool": "OpenAI image generation",
      "generatedOn": "2026-10-28",
      "prompt": "Use case: historical-scene\nAsset type: realistic natural environment background for a children's prehistoric animal museum, independently composed portrait phone scene.\nPrimary request: Generate one finished 9:16 PORTRAIT image, preferably 1440 x 2560 pixels. This is a new tall composition, not a crop or extension of a wide image. EMPTY HABITAT PLATE only; absolutely no animal or human.\nScene/backdrop: Late Cretaceous Alberta, a woodland-edge alluvial plain appropriate for Regaliceratops. A broad clear patch of nearly level firm warm-tan earth opens toward a distant floodplain and a low mixed conifer and early broadleaf tree line. A few fine ferns and leafy understory plants live at the extreme edges. Tall but airy light-barked trees at the outer left and a more distant loose group of conifers toward the outer right frame a calm open middle. Small pale blue sky clouds. Gentle natural depth, no dramatic mountains.\nStyle/medium: Detailed natural 3D environment with photographic soil, bark and leaf materials, believable vegetation and gentle realistic lighting. A polished realistic nature exhibit environment, neither cartoon nor painterly.\nComposition/framing: Design the whole frame vertically. The distant ground horizon is at 47–49% of the portrait height. Keep the central 60% of image width calm, spacious and clear, with only a soft sage distant tree line behind the future model silhouette. The lower half is a continuous, nearly flat, dry pale-earth standing surface from edge to edge, extending toward the viewer with fine subtle texture. No large rocks, roots, logs, shrubs or water in the central ground. Edge vegetation must stay slim rather than form a tunnel. Show enough pale sky above to give the tall scene air, without letting clouds become the main subject.\nLighting/mood: Bright welcoming soft daylight from upper left, luminous open shade on the ground, soft gentle shadows. This will accompany a dark olive-brown animal with muted red and blue neck-frill accents, so use medium-light sage and tan behind its silhouette. Preserve texture and warm environmental shade, with no flat white or deep dark forest in the center.\nColor palette: Soft sage and light olive greens, warm pale tan earth, a light natural blue sky, restrained realistic color.\nConstraints: Environment only, no animals, birds, insects, people or animal-shaped silhouettes. No text, letters, logos, watermarks, frames, UI, buildings, fences, cultivated plants or paved paths. No sunset, blue hour, night, heavy fog, deep black shadows, dramatic spotlight or excessive blur. Keep the full central and lower ground uninterrupted and walkable. No modern grass lawn.\n",
      "bytes": 3533455,
      "sha256": "f5760381f119196d4e49a143efa72998540c658432a51d5af90e39bd83650db6"
    },
    "license": {
      "spdx": "LicenseRef-OpenAI-Output",
      "name": "OpenAI generated output",
      "url": "https://openai.com/policies/terms-of-use/"
    },
    "runtime": {
      "bytes": 303788,
      "sha256": "80042ed58d83fd1cfcb1af1998c5178dde10f1d5d4df3c5afb795a348ae2332a"
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
      "title": "Regaliceratops poster",
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
      "bytes": 40966,
      "sha256": "c697e92857d3838dcdeee81b46a9443c16bc5abafe8076cda95042d23345d6b4"
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
      "title": "Regaliceratops poster",
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
      "bytes": 12948,
      "sha256": "660c390897fbb07c0540d7fd7216765379578bf1f6fe6224a97dbf6c468a84e8"
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
      "title": "Regaliceratops thumbnail",
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
      "bytes": 24336,
      "sha256": "77e7c5cc146bae6cbb369e0b1ec85e2df581e17d66cb42b94e1d0a771bb2b488"
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
      "title": "Regaliceratops Mandarin narration",
      "tool": "Qwen3-TTS",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena",
      "generatedOn": "2026-10-28",
      "prompt": "帝王角龙头后的大颈盾，边缘一片片凸起，像一顶王冠。再看看它的鼻子和眼睛上方，哪边的角更长？",
      "bytes": 100605,
      "sha256": "1a27c3caeaafde5a3785ea76076d338d11626e52570aa58c1856cfaf41875df0"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "CC BY-NC-SA 4.0 project-owned Qwen3-TTS output",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "bytes": 100605,
      "sha256": "1a27c3caeaafde5a3785ea76076d338d11626e52570aa58c1856cfaf41875df0"
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
      "title": "Regaliceratops English narration",
      "tool": "Qwen3-TTS",
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
      "revision": "85e237c12c027371202489a0ec509ded67b5e4b5; Serena",
      "generatedOn": "2026-10-28",
      "prompt": "The frill behind Regaliceratops’s head has bony points around the edge, like a crown. Look at the horn on its nose, then the little horns above its eyes.",
      "bytes": 126525,
      "sha256": "52dec52f8117a388e2b73d18e049537218263882c8121ffa5ea81dd113d5d633"
    },
    "license": {
      "spdx": "CC-BY-NC-SA-4.0",
      "name": "CC BY-NC-SA 4.0 project-owned Qwen3-TTS output",
      "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    },
    "runtime": {
      "bytes": 126525,
      "sha256": "52dec52f8117a388e2b73d18e049537218263882c8121ffa5ea81dd113d5d633"
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
