import type {
  AnimalContentEn,
  AssetProvenance,
  IsoDate,
  Sha256,
} from './types'

interface RuntimeFile {
  readonly bytes: number
  readonly sha256: Sha256
}

interface SourceFile extends RuntimeFile {
  readonly title: string
}

interface ModelSource extends SourceFile {
  readonly accessedOn: IsoDate
  readonly author: string
  readonly url: `https://${string}`
}

interface BackgroundSource extends SourceFile {
  readonly generatedOn: IsoDate
  readonly prompt: string
}

const sharedBackgroundPrompt =
  'Refined layered paper-cut picture-book art with soft gouache texture; an empty calm prehistoric habitat behind a full-body 3D animal; quiet central safe area; no animal, person, text, UI, logo, or watermark.'

const habitatBackgroundPrompt =
  'Refined layered paper-cut picture-book art with soft gouache texture, tactile matte paper, and shallow soft shadows; an empty scientifically era-appropriate habitat behind a full-body 3D animal; quiet central safe area; no animal, person, text, UI, logo, watermark, photorealism, or baked-in particles because CSS supplies the atmosphere.'

const brightChildBackgroundPrompt =
  'Bright premium semi-realistic children\'s natural-history illustration, using the approved Stegosaurus habitat as the composition and tonal reference: a high vegetation-to-ground boundary, abundant tall plants framing the sides, pale blue cloud-filtered daylight, and a continuous calm ground plane behind a live full-body 3D animal. No dark or gloomy lighting, low horizon, plant-covered foot band, all-over cracks, pebble carpet, dense dots, repeated cellular texture, animal, person, footprint, bone, text, UI, logo, watermark, platform, or baked-in shadow.'

export const reviewedBackgroundSources = {
  apatosaurus: {
    landscape: {
      title: 'Apatosaurus green Morrison gallery forest — landscape',
      generatedOn: '2026-08-09',
      prompt: `${brightChildBackgroundPrompt} True 16:9 Late-Jurassic Morrison river-corridor clearing with towering araucarian-like conifers and ginkgoes, tree ferns, cycads, fern beds, and horsetails. Use a consistent low-saturation moss, sage, and gray-green palette that complements a cool gray Apatosaurus. Keep the vegetation-to-ground boundary near 47–49% and preserve uninterrupted level ground through the 55–63% foot band. Render genuine compact moist woodland loam with broad irregular gray-brown soil and thin sage-moss patches, sparse low-contrast non-repeating grain, and no cement-like flat field or dense patterned texture.`,
      bytes: 2_628_083,
      sha256:
        'db41886d28add93a817ea7a7d4b17bd2c6222d7b6b4e33daff946ccce1e4ba92',
    },
    portrait: {
      title: 'Apatosaurus green Morrison gallery forest — portrait',
      generatedOn: '2026-08-09',
      prompt: `${brightChildBackgroundPrompt} Separately compose a 9:16 Late-Jurassic Morrison gallery-forest clearing with very tall araucarian-like conifers, ginkgoes, tree ferns, cycads, ferns, and horsetails. Match the landscape's low-saturation moss, sage, and gray-green palette instead of mustard yellow. Keep the vegetation-to-ground boundary near 50–52% and preserve uninterrupted level ground through the 59–65% centred foot band. Render genuine compact moist woodland loam with broad irregular gray-brown soil and thin sage-moss patches, sparse low-contrast non-repeating grain, and no cement-like flat field or dense patterned texture.`,
      bytes: 2_840_653,
      sha256:
        '79a3135c86652a7278ceafc719c05b334e5b2966f8c9dc73860b38f11fbe642d',
    },
  },
  gigantoraptor: {
    landscape: {
      title: 'Gigantoraptor Gobi alluvial plain — landscape',
      generatedOn: '2026-07-29',
      prompt: `${habitatBackgroundPrompt} Late-Cretaceous Inner Mongolian Gobi gravel plain with muted-red badlands, dry braided channels, distant dunes, stones, and sparse arid scrub; open wind-shaped true 16:9 landscape composition.`,
      bytes: 2_624_644,
      sha256:
        '406757106acc93a47e3994e9b3caae8e3ac06ef4afe7bda2b2366087d74ec578',
    },
    portrait: {
      title: 'Gigantoraptor Gobi alluvial plain — portrait',
      generatedOn: '2026-07-29',
      prompt: `${habitatBackgroundPrompt} Separately composed 9:16 late-Cretaceous Inner Mongolian Gobi plain beneath a tall pale-blue sky, with layered badland towers, dry channels, stones, and sparse low plants; explicitly not a lush swamp forest.`,
      bytes: 2_537_524,
      sha256:
        '2de6012b3a98f2c537b6cd23edf8b180fdd36cfdd491d499bd9d81a0717bebd6',
    },
  },
  mammoth: {
    landscape: {
      title: 'Clarified woolly mammoth steppe-tundra — landscape',
      generatedOn: '2026-08-16',
      prompt:
        "Use case: precise-object-edit\nAsset type: responsive museum exhibit background, landscape 16:9\nInput image 1: edit target and composition reference\nPrimary request: Restore clarity and believable environmental detail throughout this Ice Age mammoth-steppe background. Remove the excessive soft-focus, hazy gouache blur, and oversized paper texture. Make the snowy mountain ridges, glacier faces, scattered conifers, rocks, frozen shrubs, residual snow and dry tundra soil cleanly legible, with a natural foreground-to-midground-to-distance depth progression. Keep a refined educational illustration look with realistic materials and crisp controlled edges, not a photograph and not a flat children's paper-cut scene.\nComposition/framing: Preserve the original wide composition exactly. Keep the broad open central ground and the current horizon height so the live 3D mammoth can stand in the center-right and a large information card can cover the lower-left. Preserve the framing trees and rocks along the outside edges.\nLighting/mood: Clear cold daylight, gentle atmospheric perspective only in the farthest distance, no artificial depth-of-field.\nColor palette: Cold blue-white snow and ice, restrained tan-gray frozen soil, muted conifers and shrubs.\nConstraints: Edit only the background rendering and detail. No mammoth, no animal, no person, no text, no interface, no logo, no watermark, no platform or hard ground seam. Keep every major landform and the empty staging area.\nAvoid: blur, bloom, fog veil, shallow depth of field, dreamy soft focus, painterly smearing, plastic 3D look, high-saturation fantasy color, repeated vegetation patterns.",
      bytes: 3_131_168,
      sha256:
        'd7a5d95a736b8742aec9959ea09ebd105590688db4a02d2116502e334b458e79',
    },
    portrait: {
      title: 'Clarified woolly mammoth steppe-tundra — portrait',
      generatedOn: '2026-08-16',
      prompt:
        "Use case: precise-object-edit\nAsset type: responsive museum exhibit background, portrait 9:16\nInput image 1: edit target and composition reference\nPrimary request: Match the newly clarified landscape direction by restoring crisp, believable environmental detail throughout this Ice Age mammoth-steppe background. Remove excessive soft-focus, hazy gouache blur, oversized paper texture, and flat paper-cut softness. Make the snowy mountain ridges, glacier face, conifers, rocks, frozen shrubs, residual snow and dry tundra soil cleanly legible, with a natural foreground-to-midground-to-distance depth progression. Keep a refined educational illustration look with realistic materials and crisp controlled edges, not a photograph.\nComposition/framing: Preserve the original portrait composition exactly. Keep the broad open central ground, current horizon height and upper-sky breathing room so the live 3D mammoth can stand around the middle-lower area and mobile interface elements remain readable. Preserve the framing conifers, rocks and shrubs along the outside edges.\nLighting/mood: Clear cold daylight, gentle atmospheric perspective only in the farthest distance, no artificial depth-of-field.\nColor palette: Cold blue-white snow and ice, restrained tan-gray frozen soil, muted conifers and shrubs.\nConstraints: Edit only the background rendering and detail. No mammoth, no animal, no person, no text, no interface, no logo, no watermark, no platform or hard ground seam. Keep every major landform and the empty staging area.\nAvoid: blur, bloom, fog veil, shallow depth of field, dreamy soft focus, painterly smearing, plastic 3D look, high-saturation fantasy color, repeated vegetation patterns.",
      bytes: 2_456_282,
      sha256:
        '13af5d95f704c61893e3ce550bd2d467c4786a3eeb57581e8fbf19d9e269d700',
    },
  },
  maiasaura: {
    landscape: {
      title: 'Maiasaura Late Cretaceous floodplain — landscape',
      generatedOn: '2026-07-30',
      prompt:
        '为中文亲子史前动物博物馆生成一张纯环境背景图。晚白垩世北美河漫滩与疏林，温暖自然、半写实高品质自然史绘本风格，金棕色草地、低矮蕨类、远处针叶林与轻薄云层，柔和清晨散射光。横向 16:9 构图；明确把地平线抬高到画面顶部向下约 43% 的位置；画面中央约 60% 宽度必须是一整片连续、平整、可供居中 3D 陆生动物落脚的地面，脚下区域不要有沟、石块或高草，透视与地面接触关系清晰；重要景物只放在两侧和远景。不要出现任何动物、人物、骨骼、文字、标志、展柜、UI 或水印。背景本身，不要画边框。',
      bytes: 2_975_870,
      sha256:
        'e846a70132530a19e00f3024b447f96d1df9c72f1f05c55bfd9f489c2b3b70ff',
    },
    portrait: {
      title: 'Maiasaura Late Cretaceous floodplain — portrait',
      generatedOn: '2026-07-30',
      prompt:
        '为中文亲子史前动物博物馆生成一张纯环境背景图。晚白垩世北美河漫滩与疏林，温暖自然、半写实高品质自然史绘本风格，金棕色草地、低矮蕨类、远处针叶林与轻薄云层，柔和清晨散射光。竖向 9:16 构图；明确把远处林线和地平线放在画面顶部向下约 52% 的位置；画面中央约 78% 宽度从地平线到底部必须是一整片连续、平整、可供居中 3D 陆生动物落脚的地面，脚下区域不要有沟、石块或高草，透视与地面接触关系清晰；高树和重要景物只放在两侧边缘和远景，不遮挡中央。不要出现任何动物、人物、骨骼、文字、标志、展柜、UI 或水印。背景本身，不要画边框。',
      bytes: 2_711_111,
      sha256:
        '08188ebe1a8fe68e3c667b2ee5344a9d744922b48579ecc991c539d034a664f9',
    },
  },
  megalodon: {
    landscape: {
      title: 'Megalodon Neogene continental shelf — landscape',
      generatedOn: '2026-07-30',
      prompt:
        '为中文亲子史前动物博物馆生成一张纯环境背景图。新近纪开放大陆架海域，广阔而沉静的深蓝海水，半写实高品质自然史绘本风格；水面与明亮波纹仅占画面顶部约 16%，柔和斜射光束制造巨大尺度感，远方水体渐变为较深的蓝色，沙质海床和低矮岩脊只在底部约 82% 以下隐约出现。横向 16:9 构图；画面中央约 70% 宽度和 60% 高度必须是开阔、低对比、无遮挡的游动空间，适合居中叠加一只巨型史前鲨鱼 3D 模型；两侧可有极少量远处水下地形作为尺度线索，但不可以有鱼群或其他动物。气氛壮阔但不恐怖，不要血腥。不要出现任何动物、鱼、人物、潜水员、船、骨骼、牙齿、文字、标志、展柜、UI 或水印。背景本身，不要画边框。',
      bytes: 1_784_569,
      sha256:
        'b0275ed9c9990046d6aaa394ea71cec2aacbc36c2b7bb40e3d4dd28d80333664',
    },
    portrait: {
      title: 'Megalodon Neogene continental shelf — portrait',
      generatedOn: '2026-07-30',
      prompt:
        '为中文亲子史前动物博物馆生成一张纯环境背景图。新近纪开放大陆架海域，广阔而沉静的深蓝海水，半写实高品质自然史绘本风格；水面与明亮波纹仅占画面顶部约 12%，柔和斜射光束制造巨大尺度感，远方水体渐变为较深的蓝色，沙质海床与低矮岩脊只在底部约 84% 以下隐约出现。竖向 9:16 构图；画面中央约 80% 宽度从顶部 16% 到底部 80% 必须是开阔、低对比、无遮挡的游动空间，适合居中叠加一只巨型史前鲨鱼 3D 模型；两侧和底部可有极少量远处水下地形作为尺度线索，但不可以有鱼群或其他动物。气氛壮阔但不恐怖，不要血腥。不要出现任何动物、鱼、人物、潜水员、船、骨骼、牙齿、文字、标志、展柜、UI 或水印。背景本身，不要画边框。',
      bytes: 1_553_752,
      sha256:
        '47382f7aaa07e1cccfbcfc3a70572b239bba857777e3fa812a355c7bcb0821a2',
    },
  },
  pachycephalosaurus: {
    landscape: {
      title: 'Pachycephalosaurus fern forest — landscape',
      generatedOn: '2026-07-29',
      prompt: `${habitatBackgroundPrompt} Intimate humid late-Cretaceous North American conifer-and-fern woodland, with tall trunks, cycads, mossy logs, layered ferns, a high canopy opening, and an oval central clearing; true 16:9 landscape composition.`,
      bytes: 3_088_444,
      sha256:
        '5162f97e99025e3744f5cdf3d12405b1150b8be9d16f9e1453fa1184aa2606b5',
    },
    portrait: {
      title: 'Pachycephalosaurus fern forest — portrait',
      generatedOn: '2026-07-29',
      prompt: `${habitatBackgroundPrompt} Separately composed 9:16 humid late-Cretaceous forest with towering conifer trunks, tree-fern crowns, mossy logs, layered ferns, a high canopy opening, and a clear path-like centre.`,
      bytes: 2_692_184,
      sha256:
        '6c1eb3b4810efc3009e0a6dbc5f111aa275f1014ecd7e2f17a021de8aca13984',
    },
  },
  plesiosaurus: {
    landscape: {
      title: 'Plesiosaur Jurassic shallow sea — landscape',
      generatedOn: '2026-07-30',
      prompt:
        '为中文亲子史前动物博物馆生成一张纯环境背景图。侏罗纪温暖浅海与外海交界，半写实高品质自然史绘本风格，清澈蓝绿色海水，水面光带位于画面顶部约 15%，微弱阳光束，下方约 78% 处才出现低矮沙质海床与少量远处海草、菊石壳和岩礁作为时代线索。横向 16:9 构图；画面中央约 65% 宽度和 55% 高度必须保持开阔、安静、低对比的可游动水域，适合居中叠加一只长颈海生爬行动物的 3D 模型；不要让海草、岩石、气泡群或光束切过动物轮廓。色彩柔和但有层次，环境可信、亲子友好。不要出现任何动物、鱼、人物、潜水员、船、骨骼、文字、标志、展柜、UI 或水印。背景本身，不要画边框。',
      bytes: 1_540_514,
      sha256:
        '4b8d6632120bb2d79a4361e6b2e4b3b3bc99980de24f6e07d26f599a04f97dd4',
    },
    portrait: {
      title: 'Plesiosaur Jurassic shallow sea — portrait',
      generatedOn: '2026-07-30',
      prompt:
        '为中文亲子史前动物博物馆生成一张纯环境背景图。侏罗纪温暖浅海与外海交界，半写实高品质自然史绘本风格，清澈蓝绿色海水，水面光带位于画面顶部约 12%，微弱阳光束，沙质海床只在画面底部约 82% 以下出现，边缘有少量远处海草、菊石壳与低矮岩礁作为时代线索。竖向 9:16 构图；画面中央约 78% 宽度从顶部 18% 到底部 78% 必须保持开阔、安静、低对比的可游动水域，适合居中叠加一只长颈海生爬行动物的 3D 模型；不要让海草、岩石、气泡群或强光束切过动物轮廓。色彩柔和但有层次，环境可信、亲子友好。不要出现任何动物、鱼、人物、潜水员、船、骨骼、文字、标志、展柜、UI 或水印。背景本身，不要画边框。',
      bytes: 1_727_512,
      sha256:
        'd6336b8c329a4191b2f4d4e21c87ca894083673d7a30f33f374f941efe51e97f',
    },
  },
  pteranodon: {
    landscape: {
      title: 'Pteranodon inland-sea cliffs — landscape',
      generatedOn: '2026-07-29',
      prompt: `${habitatBackgroundPrompt} Late-Cretaceous chalk and limestone coastal cliffs around an immense pale-blue sky and distant calm inland sea, with sparse ledge plants, a low horizon, and open airborne centre; true 16:9 landscape composition.`,
      bytes: 2_170_121,
      sha256:
        '0af35c7711306719b18c9ba8612a2dd28545782004251929985e9abc1655ec60',
    },
    portrait: {
      title: 'Pteranodon inland-sea cliffs — portrait',
      generatedOn: '2026-07-29',
      prompt: `${habitatBackgroundPrompt} Separately composed 9:16 late-Cretaceous cliff-and-inland-sea scene with a very large open vertical sky, low horizon, and narrow limestone side framing to create a strong sense of altitude.`,
      bytes: 2_233_292,
      sha256:
        '9c1fc047d7fb26461f83ebd5c9f45592ede469e782661414f670a068c33e2351',
    },
  },
  ichthyosaur: {
    landscape: {
      title: 'Ichthyosaur ancient shallow sea — landscape',
      generatedOn: '2026-07-26',
      prompt: `${sharedBackgroundPrompt} Ancient shallow sea with rock shelves and sparse edge plants, true 16:9 landscape composition.`,
      bytes: 2_221_760,
      sha256:
        'f65f777996b711eb5ec07b9634593aba5b7ac7ad85e2ae5e97ba943194f3cdb3',
    },
    portrait: {
      title: 'Ichthyosaur ancient shallow sea — portrait',
      generatedOn: '2026-07-26',
      prompt: `${sharedBackgroundPrompt} Ancient shallow sea, separately composed 9:16 portrait counterpart.`,
      bytes: 2_492_307,
      sha256:
        '560ccd0c595ca1aa13bae01ef58f06fb696d295dded3641e4261785516e4e501',
    },
  },
  triceratops: {
    landscape: {
      title: 'Triceratops sage meadow — landscape',
      generatedOn: '2026-07-29',
      prompt: `${sharedBackgroundPrompt} Preserve the accepted broad sage meadow, but raise the horizon to about 43% of the 16:9 frame and extend level central ground beneath a centred Triceratops.`,
      bytes: 2_779_171,
      sha256:
        'd4c30c73854217caf6a81992ba0c09ac25d5d7c2d37616fc09f087a44bf0cbc7',
    },
    portrait: {
      title: 'Triceratops sage meadow — portrait',
      generatedOn: '2026-07-29',
      prompt: `${sharedBackgroundPrompt} Preserve the accepted 9:16 sage meadow, but raise the beginning of the open ground to the central staging band so a centred Triceratops stands firmly on level terrain.`,
      bytes: 2_581_499,
      sha256:
        'b5f6c6747f4da60682e5de591d287170be2befeee28b109f3268d6761eadaee3',
    },
  },
  tyrannosaurusRex: {
    landscape: {
      title: 'Tyrannosaurus bright Hell Creek woodland — landscape',
      generatedOn: '2026-08-09',
      prompt: `${brightChildBackgroundPrompt} True 16:9 late-Maastrichtian Hell Creek riverbank woodland with irregular broadleaf trees, some tall swamp conifers, ferns, shrubs, and wetland plants. Keep the vegetation-to-ground boundary between 43–46%, begin uninterrupted level ground by 46%, and keep the 52–65% foot band clear for a warm rust-brown Tyrannosaurus.`,
      bytes: 2_969_995,
      sha256:
        'bd34865c23d3eae3ea613bd53be3994582afe9df42e44d245a3e4423049e6d95',
    },
    portrait: {
      title: 'Tyrannosaurus bright Hell Creek woodland — portrait',
      generatedOn: '2026-08-09',
      prompt: `${brightChildBackgroundPrompt} Separately compose a 9:16 late-Maastrichtian Hell Creek riverbank woodland with bright layered broadleaf trees, some swamp conifers, ferns, shrubs, and wetland plants. Keep the vegetation-to-ground boundary between 42–46%, begin uninterrupted level ground by 46%, and keep the 53–68% centred foot band completely clear.`,
      bytes: 2_788_568,
      sha256:
        '120421c8eaf21622cd3437f6542fe98cc7af54d25d6676cf78a91bd841c9b9c0',
    },
  },
} as const satisfies Readonly<
  Record<
    string,
    {
      readonly landscape: BackgroundSource
      readonly portrait: BackgroundSource
    }
  >
>

export const reviewedEnglishNarrationArtifacts = {
  'dire-wolf': {
    generatedOn: '2026-11-22',
    bytes: 145_484,
    sha256:
      'c27decdef12a7f4fbff6dfc8ba83ca1d0cedeba4eb8f856a98c37e49a30138e3',
  },
  anomalocaris: {
    generatedOn: '2026-08-29',
    bytes: 130_365,
    sha256:
      '4aeade799e623ad6063decad6056639a0734098b23b28ba9b7d6e9565eb7dd0e',
  },
  archaeopteryx: {
    generatedOn: '2026-08-29',
    bytes: 149_805,
    sha256:
      'af758bee30c4c51e3e556af561c90ee8de4ec5676bbb24df3acee36443c0a6e3',
  },
  baryonyx: {
    generatedOn: '2026-08-29',
    bytes: 160_845,
    sha256:
      '33e75861cbf2b44dfedb6e7e7f36e961b1f920e378b3bf3bac6d610851b7c135',
  },
  carnotaurus: {
    generatedOn: '2026-08-29',
    bytes: 151_245,
    sha256:
      'adeb2ea856e62ea21148c9450a9506d09e5580ae29e3c03518b01cd7c4b312b0',
  },
  lystrosaurus: {
    generatedOn: '2026-08-31',
    bytes: 159_165,
    sha256:
      '92d59b949042a63557f0ab8abaaa13823d68d89faa029136efd0b8160f2fed46',
  },
  spinosaurus: {
    generatedOn: '2026-08-29',
    bytes: 167_325,
    sha256:
      '7775ec734bf9c411413a89a832856ba71fa69308948b2258cd0a934178e4b5df',
  },
  apatosaurus: {
    generatedOn: '2026-08-07',
    bytes: 111_165,
    sha256:
      'e8cf97fca62ebcd999aa07097e13672214455508cc19843374beb1e3b6f8be79',
  },
  dilophosaurus: {
    generatedOn: '2026-08-07',
    bytes: 164_685,
    sha256:
      '05bb9c7ad3db9abcbf016f12a98df0a0c1ae8d1adbd7c2bf5a67074ad5a8eded',
  },
  gigantoraptor: {
    generatedOn: '2026-08-07',
    bytes: 119_325,
    sha256:
      '1fb80903c1ff64245d9b3199a2c7dd34ae6e3880f2c1a18c9d6ba9de8db27392',
  },
  ichthyosaur: {
    generatedOn: '2026-08-07',
    bytes: 149_805,
    sha256:
      '2e31f92e8bd54eb08971b3b6bb6d3279fa31242149f43f70917fb67709c139c8',
  },
  maiasaura: {
    generatedOn: '2026-08-07',
    bytes: 146_925,
    sha256:
      'baeba1370388b5299cd7e7dd28ec4830e89ce9f77aeb9c66920738ecd9bb4bc1',
  },
  mammoth: {
    generatedOn: '2026-08-07',
    bytes: 175_485,
    sha256:
      '8bf9a31a9d7f9fb9811a037dfda34c9195912d4bc1e3ab0d3b810103bb3498f9',
  },
  megalodon: {
    generatedOn: '2026-08-07',
    bytes: 158_685,
    sha256:
      'b79326f2bb4db6bb1436c38a777f059a4eeb077404c5d5c972391bf23d42b969',
  },
  meganeura: {
    generatedOn: '2026-08-07',
    bytes: 170_925,
    sha256:
      '0e64580c4e23e2a87a5bf11b199eec51579ed3d09c70708be440220a4eb5fd9a',
  },
  mosasaurus: {
    generatedOn: '2026-08-07',
    bytes: 163_485,
    sha256:
      'c38635ea87ab13cc11582094f5957fdb4d28549f9c1f82f81c13bc0d6ce9fd62',
  },
  pachycephalosaurus: {
    generatedOn: '2026-08-07',
    bytes: 128_205,
    sha256:
      'b80a946b9a91553cf92e47a99b2c9843f0fd533c1c6fcce648c95acb7e7af2b9',
  },
  plesiosaurus: {
    generatedOn: '2026-08-07',
    bytes: 174_285,
    sha256:
      '8bd7a297842516bd023982ec6a2ac7d0836e346e0cbea8f28b87fb6296784c18',
  },
  pteranodon: {
    generatedOn: '2026-08-07',
    bytes: 133_485,
    sha256:
      '72a17d2c2952066b9ec7729ed4ae16fef9ad922c110aab0b2dfdab866c46a1a4',
  },
  rhamphorhynchus: {
    generatedOn: '2026-08-07',
    bytes: 152_685,
    sha256:
      'fb6833123c194204addbecf4001b180416dba86e6a82740a9097fcaf5b3ead67',
  },
  sauropelta: {
    generatedOn: '2026-08-07',
    bytes: 162_045,
    sha256:
      '5eb570b5695afb2be679d922931c9311c17328442af711d8500c1339a769c78d',
  },
  stegosaurus: {
    generatedOn: '2026-08-07',
    bytes: 109_725,
    sha256:
      '149e9c47a9e2e9c58f6cfbeda8a776cdadea3a6fe484ede260f5c085640699f2',
  },
  triceratops: {
    generatedOn: '2026-08-07',
    bytes: 147_885,
    sha256:
      '37ab3b9c99951ae50ffb14e1ffffff8ae34a54941595a8d9347ea758f0e131fb',
  },
  tupandactylus: {
    generatedOn: '2026-08-07',
    bytes: 167_565,
    sha256:
      '35e1cedc16daca46f1e46b58503f8d33df301b06195902865f56f857d3cc83d3',
  },
  'tyrannosaurus-rex': {
    generatedOn: '2026-08-07',
    bytes: 129_405,
    sha256:
      '7320895ee5b83b9eb51f90ae76586f5a67ffbe16778e7216097a81b404617d3e',
  },
} as const satisfies Readonly<
  Record<string, RuntimeFile & { readonly generatedOn: IsoDate }>
>

export interface PublishedAssetProvenanceInput {
  readonly animalName: string
  readonly model: {
    readonly source: ModelSource
    readonly runtime: RuntimeFile
    readonly modifications: readonly [string, ...string[]]
  }
  readonly backgrounds: {
    readonly landscape: {
      readonly source: BackgroundSource
      readonly runtime: RuntimeFile
      readonly runtimeModifications?: readonly [string, ...string[]]
    }
    readonly portrait: {
      readonly source: BackgroundSource
      readonly runtime: RuntimeFile
      readonly runtimeModifications?: readonly [string, ...string[]]
    }
  }
  readonly poster: RuntimeFile
  readonly posterPortrait: RuntimeFile
  readonly thumbnail: RuntimeFile
  readonly thumbnailDerivation?: {
    readonly generatedOn: IsoDate
    readonly method: string
    readonly modifications: readonly [string, ...string[]]
  }
  readonly derivedImagesGeneratedOn?: IsoDate
  readonly narration: RuntimeFile & {
    readonly generatedOn: IsoDate
    readonly script: string
  }
}

export const recomposedCollectionThumbnailDerivation = {
  generatedOn: '2026-08-10',
  method:
    'Composited the central square of the accepted landscape background with the complete alpha-preserving transparent poster silhouette, using the reviewed pixel dimensions and placement recorded in derived-images.txt.',
  modifications: [
    'Resized and centred the complete silhouette with animal-specific safe margins.',
    'Encoded as 320 × 320 lossy WebP at quality 88 without text, controls, labels, logos, or watermarks.',
  ],
} as const satisfies NonNullable<
  PublishedAssetProvenanceInput['thumbnailDerivation']
>

const modelLicense = {
  spdx: 'CC-BY-4.0',
  name: 'Creative Commons Attribution 4.0 International',
  url: 'https://creativecommons.org/licenses/by/4.0/',
} as const

const generatedImageLicense = {
  spdx: 'CC-BY-NC-SA-4.0',
  name: 'CC BY-NC-SA 4.0 project-owned ImageGen output',
  url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
} as const

const qwenOutputLicense = {
  spdx: 'CC-BY-NC-SA-4.0',
  name: 'CC BY-NC-SA 4.0 project-owned Qwen3-TTS output',
  url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
} as const

export function createReviewedEnglishNarrationProvenance(
  animalId: keyof typeof reviewedEnglishNarrationArtifacts,
  content: AnimalContentEn,
): AssetProvenance {
  const artifact = reviewedEnglishNarrationArtifacts[animalId]
  return {
    assetPath: 'audio/narration.en.mp3',
    kind: 'narration',
    source: {
      type: 'generated',
      title: `${content.name} English narration`,
      tool: 'Qwen3-TTS CustomVoice',
      model: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
      revision:
        '85e237c12c027371202489a0ec509ded67b5e4b5; Serena built-in voice; deterministic local generation',
      generatedOn: artifact.generatedOn,
      prompt: content.narration.sentences.join(' '),
      sha256: artifact.sha256,
      bytes: artifact.bytes,
    },
    license: qwenOutputLicense,
    runtime: {
      bytes: artifact.bytes,
      sha256: artifact.sha256,
    },
    modifications: [
      'Generated offline from the exact reviewed English two-sentence script with the Serena voice.',
      'Normalized to a reviewed 48 kHz mono MP3 without runtime synthesis.',
    ],
    attribution:
      'Project-generated English narration produced locally with Qwen3-TTS 0.6B CustomVoice (Serena).',
    redistributionAllowed: true,
    evidencePaths: ['provenance/LICENSES/narration-rights.txt'],
  }
}

export function createPublishedAssetProvenance(
  input: PublishedAssetProvenanceInput,
): readonly [AssetProvenance, ...AssetProvenance[]] {
  const modelAttribution = `“${input.model.source.title}” by ${input.model.source.author}, CC BY 4.0; modified for the Prehistoric Animal Museum.`
  const modelEvidence = [
    'provenance/LICENSES/model-license.txt',
    'provenance/LICENSES/model-source.txt',
  ] as const

  return [
    {
      assetPath: 'model/model.glb',
      kind: 'model',
      source: {
        type: 'third-party',
        title: input.model.source.title,
        author: input.model.source.author,
        url: input.model.source.url,
        accessedOn: input.model.source.accessedOn,
        sha256: input.model.source.sha256,
        bytes: input.model.source.bytes,
      },
      license: modelLicense,
      runtime: input.model.runtime,
      modifications: input.model.modifications,
      attribution: modelAttribution,
      redistributionAllowed: true,
      evidencePaths: modelEvidence,
    },
    {
      assetPath: 'backgrounds/landscape.webp',
      kind: 'background',
      source: {
        type: 'generated',
        title: input.backgrounds.landscape.source.title,
        tool: 'OpenAI built-in image_gen',
        generatedOn: input.backgrounds.landscape.source.generatedOn,
        prompt: input.backgrounds.landscape.source.prompt,
        sha256: input.backgrounds.landscape.source.sha256,
        bytes: input.backgrounds.landscape.source.bytes,
      },
      license: generatedImageLicense,
      runtime: input.backgrounds.landscape.runtime,
      modifications: input.backgrounds.landscape.runtimeModifications ?? [
          'Converted the reviewed PNG to lossy WebP at quality 82.',
          'Removed ancillary metadata without applying a runtime tint or filter.',
        ],
      attribution: `Project-generated ${input.animalName} landscape created with OpenAI ImageGen.`,
      redistributionAllowed: true,
      evidencePaths: ['provenance/LICENSES/background-generation.txt'],
    },
    {
      assetPath: 'backgrounds/portrait.webp',
      kind: 'background',
      source: {
        type: 'generated',
        title: input.backgrounds.portrait.source.title,
        tool: 'OpenAI built-in image_gen',
        generatedOn: input.backgrounds.portrait.source.generatedOn,
        prompt: input.backgrounds.portrait.source.prompt,
        sha256: input.backgrounds.portrait.source.sha256,
        bytes: input.backgrounds.portrait.source.bytes,
      },
      license: generatedImageLicense,
      runtime: input.backgrounds.portrait.runtime,
      modifications: input.backgrounds.portrait.runtimeModifications ?? [
          'Converted the separately composed reviewed PNG to lossy WebP at quality 82.',
          'Removed ancillary metadata without applying a runtime tint or filter.',
        ],
      attribution: `Project-generated ${input.animalName} portrait created with OpenAI ImageGen.`,
      redistributionAllowed: true,
      evidencePaths: ['provenance/LICENSES/background-generation.txt'],
    },
    {
      assetPath: 'images/poster.webp',
      kind: 'poster',
      source: {
        type: 'derived',
        title: `${input.animalName} transparent model still`,
        generatedOn: input.derivedImagesGeneratedOn ?? '2026-08-05',
        inputAssetPaths: ['model/model.glb'],
        method:
          'Rendered the deterministic first animation frame at the normal 1200 × 675 landscape runtime camera, composition, size, pose, and lighting; preserved transparent pixels outside the model and contact shadow.',
      },
      license: modelLicense,
      runtime: input.poster,
      modifications: [
        'Removed the habitat composite and all interface chrome; kept only the model and contact shadow on a transparent background.',
        'Encoded as lossless WebP without text, controls, labels, logos, or watermarks.',
      ],
      attribution: modelAttribution,
      redistributionAllowed: true,
      evidencePaths: [
        ...modelEvidence,
        'provenance/LICENSES/derived-images.txt',
      ],
    },
    {
      assetPath: 'images/poster-portrait.webp',
      kind: 'poster',
      source: {
        type: 'derived',
        title: `${input.animalName} transparent portrait model still`,
        generatedOn: input.derivedImagesGeneratedOn ?? '2026-08-05',
        inputAssetPaths: ['model/model.glb'],
        method:
          'Rendered the deterministic first animation frame at the normal 390 × 844 portrait runtime camera, composition, size, pose, and lighting; preserved transparent pixels outside the model and contact shadow.',
      },
      license: modelLicense,
      runtime: input.posterPortrait,
      modifications: [
        'Removed the habitat composite and all interface chrome; kept only the model and contact shadow on a transparent background.',
        'Encoded as exact lossless WebP without text, controls, labels, logos, or watermarks.',
      ],
      attribution: modelAttribution,
      redistributionAllowed: true,
      evidencePaths: [
        ...modelEvidence,
        'provenance/LICENSES/derived-images.txt',
      ],
    },
    {
      assetPath: 'images/thumbnail.webp',
      kind: 'thumbnail',
      source: {
        type: 'derived',
        title: `${input.animalName} collection thumbnail`,
        generatedOn:
          input.thumbnailDerivation?.generatedOn ??
          input.derivedImagesGeneratedOn ??
          '2026-07-28',
        inputAssetPaths: input.thumbnailDerivation
          ? ['images/poster.webp', 'backgrounds/landscape.webp']
          : ['model/model.glb', 'backgrounds/landscape.webp'],
        method:
          input.thumbnailDerivation?.method ??
          'Deterministic square crop from the accepted desktop review presentation after hiding all interface chrome.',
      },
      license: modelLicense,
      runtime: input.thumbnail,
      modifications: input.thumbnailDerivation?.modifications ?? [
          'Selected a card-size crop that keeps the animal readable.',
          'Exported without embedded text, controls, labels, logos, or watermarks.',
        ],
      attribution: `${modelAttribution} Scene art generated for this project.`,
      redistributionAllowed: true,
      evidencePaths: [
        ...modelEvidence,
        'provenance/LICENSES/derived-images.txt',
      ],
    },
    {
      assetPath: 'audio/narration.zh-CN.mp3',
      kind: 'narration',
      source: {
        type: 'generated',
        title: `${input.animalName} Mandarin narration`,
        tool: 'Qwen3-TTS CustomVoice',
        model: 'Qwen3-TTS-12Hz-0.6B-CustomVoice',
        revision: 'Serena built-in voice; deterministic local generation',
        generatedOn: input.narration.generatedOn,
        prompt: input.narration.script,
        sha256: input.narration.sha256,
        bytes: input.narration.bytes,
      },
      license: qwenOutputLicense,
      runtime: {
        bytes: input.narration.bytes,
        sha256: input.narration.sha256,
      },
      modifications: [
        'Generated offline from the exact reviewed two-sentence script.',
        'Normalized to a reviewed 48 kHz mono MP3 without runtime synthesis.',
      ],
      attribution:
        'Project-generated Mandarin narration produced locally with Qwen3-TTS 0.6B CustomVoice (Serena).',
      redistributionAllowed: true,
      evidencePaths: ['provenance/LICENSES/narration-rights.txt'],
    },
  ]
}
