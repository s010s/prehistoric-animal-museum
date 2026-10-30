/// <reference types="node" />

import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'

import { localReviewAssetFiles } from '../scripts/review-assets'
import { mainAnimals } from '../src/content/catalog'
import { modelPreviewProfiles } from '../src/viewer/model-preview-profiles'
import { modelPreviewFor } from '../src/viewer/responsive-model-stills'
import {
  buildLocalReviewCatalog,
  localReviewAnimals,
} from '../src/review/catalog'
import { animal as sauropeltaDraft } from '../src/review/animals/sauropelta/package'
import {
  reviewNarrationAssetFor,
  reviewNarrationPlanFor,
  type DisplayableAnimalPackage,
} from '../src/review/types'

const expansionAnimalIds = [
  'spinosaurus',
  'lystrosaurus',
  'baryonyx',
  'archaeopteryx',
  'carnotaurus',
  'anomalocaris',
] as const

// These canonical scripts were authored separately from the visible-feature
// caption. Keep their exact spoken wording alongside the legacy verbatim rule.
const canonicalSecondNarrationSentences: Readonly<Record<string, string>> = {
  'allosaurus-pandras': '张开你的小手和它比一比，再找找它眼睛上方的小突起。',
  ammonite: '用眼睛沿着螺旋慢慢往里走，一直找到最里面的那一圈。',
  ankylosaurus: '从背上顺着尾巴往后找，末端还有一个圆钝的尾槌。',
  anurognathus: '看看它宽宽的小脸和展开的皮膜翅膀。',
  dakosaurus: '顺着身体找到尾巴，看看末端像鱼尾一样的尾鳍。',
  dallasaurus: '看看它的四条小腿和脚趾，再顺着身体找到长长的尾巴。',
  dimetrodon: '它生活得比恐龙还早，和今天的哺乳动物有亲缘关系。',
  gallimimus: '似鸡龙有长长的腿和像鸟一样的喙，嘴巴里面没有牙齿。',
  hallucigenia: '它的背上有成对的尖刺，身体下面还排着一条条细腿。',
  livyatan: '把它转到侧面，顺着嘴边慢慢找，上下两排你都发现了吗？',
  opabinia: '再沿着它细长的吻部往前找，最前端还有一对小爪子。',
  parasaurolophus: '用手指跟着它的轮廓画一画，头冠里面还有弯弯曲曲的通道。',
  phorusrhacos: '把它转到侧面，找一找嘴巴尖尖的地方朝哪边弯。',
  quetzalcoatlus: '看看它长长的脖子和展开的大翅膀。',
  regaliceratops: '再看看它的鼻子和眼睛上方，哪边的角更长？',
  sarcosuchus: '顺着它的背往后找，一块块硬硬的骨甲一直排到尾巴上。',
  sordes: '它身上有毛一样的细丝，翅膀由薄薄的皮膜组成。',
  styxosaurus: '身体两侧还有四只鳍状肢，像四把划水的小桨。',
  therizinosaurus: '把它转到侧面，看看这些爪子伸出去有多远。',
  tullimonstrum: '你能在眼睛前面，找到那条细长的吻部吗？',
  xiphactinus: '有的从头到尾超过五米，这样的大鱼装得进小小的鱼缸吗？',
}

describe('local collection review catalog', () => {
  it('switches an allowlisted draft to production assets without a catalog edit', () => {
    const beforePromotion = buildLocalReviewCatalog(
      mainAnimals.filter(({ id }) => id !== 'sauropelta'),
      [],
      [sauropeltaDraft],
    )
    expect(beforePromotion.at(-1)).toMatchObject({
      id: 'sauropelta',
      status: 'draft',
    })
    expect(beforePromotion.at(-1)?.assets.model).toContain(
      '/__museum-review-assets/sauropelta/model.glb',
    )

    const afterPromotion = buildLocalReviewCatalog(
      mainAnimals,
      [],
      [sauropeltaDraft],
    )
    const promoted = afterPromotion.find(({ id }) => id === 'sauropelta')
    expect(promoted).toMatchObject({
      id: 'sauropelta',
      status: 'published',
      review: { badge: '已验收' },
    })
    expect(promoted?.assets.model).toContain(
      '/src/content/animals/sauropelta/model/model.glb',
    )
  })

  it('keeps all forty-five production animals in the accepted collection order', () => {
    expect(localReviewAnimals.map(({ id }) => id)).toEqual([
      'stegosaurus',
      'pteranodon',
      'pachycephalosaurus',
      'ankylosaurus',
      'regaliceratops',
      'ichthyosaur',
      'opabinia',
      'tyrannosaurus-rex',
      'rhamphorhynchus',
      'anurognathus',
      'hallucigenia',
      'triceratops',
      'apatosaurus',
      'livyatan',
      'sarcosuchus',
      'plesiosaurus',
      'gigantoraptor',
      'parasaurolophus',
      'tupandactylus',
      'therizinosaurus',
      'mammoth',
      'gallimimus',
      'megalodon',
      'tullimonstrum',
      'phorusrhacos',
      'maiasaura',
      'sauropelta',
      'allosaurus-pandras',
      'meganeura',
      'sordes',
      'dilophosaurus',
      'dimetrodon',
      'mosasaurus',
      'spinosaurus',
      'quetzalcoatlus',
      'xiphactinus',
      'lystrosaurus',
      'baryonyx',
      'ammonite',
      'dallasaurus',
      'archaeopteryx',
      'carnotaurus',
      'styxosaurus',
      'anomalocaris',
      'dakosaurus',
    ])
    expect(
      localReviewAnimals.every(({ status }) => status === 'published'),
    ).toBe(true)
    expect(
      localReviewAnimals
        .map(({ habitat }, index) => habitat === 'water' ? index : -1)
        .filter((index) => index >= 0),
    ).toEqual([5, 6, 10, 13, 15, 22, 23, 32, 35, 38, 39, 42, 43, 44])
    expect(
      localReviewAnimals
        .map(({ habitat }, index) => habitat === 'air' ? index : -1)
        .filter((index) => index >= 0),
    ).toEqual([1, 8, 9, 18, 28, 29, 34, 40])
  })

  it('provides complete visual assets and locally reviewable narration', async () => {
    const publishedIds = new Set(mainAnimals.map(({ id }) => id))
    for (const animal of localReviewAnimals) {
      if (publishedIds.has(animal.id)) {
        expect(animal.assets.model).toContain(
          `/src/content/animals/${animal.id}/model/model.glb`,
        )
      } else {
        expect(animal.assets.model).toMatch(
          new RegExp(`/__museum-review-assets/${animal.id}/model\\.glb$`),
        )
      }
      expect(animal.assets.poster).toMatch(/poster\.webp$/)
      expect(animal.assets.thumbnail).toMatch(/thumbnail\.webp$/)
      if (publishedIds.has(animal.id)) {
        expect(animal.assets.backgrounds.landscape).toContain(
          `/src/content/animals/${animal.id}/backgrounds/landscape.webp`,
        )
        expect(animal.assets.backgrounds.portrait).toContain(
          `/src/content/animals/${animal.id}/backgrounds/portrait.webp`,
        )
      } else {
        expect(animal.assets.backgrounds.landscape).toContain(
          `/__museum-review-assets/${animal.id}/background-landscape`,
        )
        expect(animal.assets.backgrounds.portrait).toContain(
          `/__museum-review-assets/${animal.id}/background-portrait`,
        )
      }
      const zhNarrationPlan = reviewNarrationPlanFor(
        animal.narration,
        'zh-CN',
      )
      const zhNarrationAsset = reviewNarrationAssetFor(
        animal.assets.narration,
        'zh-CN',
      )
      expect(zhNarrationPlan?.status).toBe('ready')
      expect(zhNarrationAsset?.status).toBe('ready')
      if (zhNarrationAsset?.status !== 'ready') {
        throw new Error(`Expected ready narration for ${animal.id}`)
      }
      if (publishedIds.has(animal.id)) {
        expect(zhNarrationAsset.url).toContain(
          `/src/content/animals/${animal.id}/audio/narration.zh-CN.mp3`,
        )
      } else {
        expect(zhNarrationAsset.url).toBe(
          `/__museum-review-assets/${animal.id}/narration.mp3`,
        )
      }
      const narrationPath = publishedIds.has(animal.id)
        ? resolve(`src/content/animals/${animal.id}/audio/narration.zh-CN.mp3`)
        : localReviewAssetFiles.get(`/__museum-review-assets/${animal.id}/narration.mp3`)
      expect(narrationPath, animal.id).toBeDefined()
      expect((await stat(narrationPath!)).isFile(), animal.id).toBe(true)
      if (animal.review) {
        expect(animal.review.checks.length).toBeGreaterThanOrEqual(2)
      } else {
        expect(publishedIds.has(animal.id)).toBe(true)
      }
    }
  })

  it('does not reuse a legacy Mandarin review track for English', () => {
    expect(
      reviewNarrationPlanFor(sauropeltaDraft.narration, 'en'),
    ).toBeUndefined()
    expect(
      reviewNarrationAssetFor(sauropeltaDraft.assets.narration, 'en'),
    ).toBeUndefined()
  })

  it('keeps English content and narration bound to the matching locale', () => {
    for (const animal of localReviewAnimals) {
      expect(animal.content.en?.name).toBeTruthy()
      const narration = reviewNarrationPlanFor(animal.narration, 'en')
      const narrationAsset = reviewNarrationAssetFor(
        animal.assets.narration,
        'en',
      )
      expect(narration?.status).toBe('ready')
      expect(narrationAsset?.status).toBe('ready')
      if (narration?.status !== 'ready') {
        throw new Error(`Expected ready English narration for ${animal.id}`)
      }
      expect(narration.sourcePath).toBe('audio/narration.en.mp3')
      if (animal.status === 'draft') {
        expect(narrationAsset).toMatchObject({
          status: 'ready',
          sourcePath: 'audio/narration.en.mp3',
          url: `/__museum-review-assets/${animal.id}/narration.en.mp3`,
        })
        expect(
          localReviewAssetFiles.has(
            `/__museum-review-assets/${animal.id}/narration.en.mp3`,
          ),
        ).toBe(true)
      }
    }
  })

  it('records final owner approval for all six expansion animals', () => {
    for (const animalId of expansionAnimalIds) {
      const animal = localReviewAnimals.find(({ id }) => id === animalId)
      expect(animal?.status).toBe('published')
      expect(animal?.review?.badge).toBe('已验收')
      expect(animal?.review?.status).toContain('已晋升生产')
      expect(animal?.review?.note).toContain('2026-09-01')
      expect(animal?.content['zh-CN'].editorial).toMatchObject({
        reviewedBy: 'Leon（产品负责人）',
        reviewedOn: '2026-09-01',
      })
      expect(animal?.content.en?.editorial).toMatchObject({
        reviewedBy: 'Leon (product owner)',
        reviewedOn: '2026-09-01',
      })
      expect(
        animal
          ? reviewNarrationPlanFor(animal.narration, 'zh-CN')
          : undefined,
      ).toMatchObject({
        humanReviewStatus: 'approved',
        language: 'Chinese',
        speaker: 'Serena',
      })
      expect(
        animal
          ? reviewNarrationPlanFor(animal.narration, 'en')
          : undefined,
      ).toMatchObject({
        humanReviewStatus: 'approved',
        language: 'English',
        speaker: 'Serena',
      })
    }
  })

  it('assigns the authored atmosphere to every exhibit', () => {
    expect(
      localReviewAnimals.map(({ id, atmosphere }) => [id, atmosphere]),
    ).toEqual([
      ['stegosaurus', 'forest'],
      ['pteranodon', 'air'],
      ['pachycephalosaurus', 'forest'],
      ['ankylosaurus', 'forest'],
      ['regaliceratops', 'forest'],
      ['ichthyosaur', 'underwater'],
      ['opabinia', 'underwater'],
      ['tyrannosaurus-rex', 'forest'],
      ['rhamphorhynchus', 'air'],
      ['anurognathus', 'air'],
      ['hallucigenia', 'underwater'],
      ['triceratops', 'plains'],
      ['apatosaurus', 'plains'],
      ['livyatan', 'underwater'],
      ['sarcosuchus', 'forest'],
      ['plesiosaurus', 'underwater'],
      ['gigantoraptor', 'plains'],
      ['parasaurolophus', 'forest'],
      ['tupandactylus', 'air'],
      ['therizinosaurus', 'forest'],
      ['mammoth', 'ice'],
      ['gallimimus', 'forest'],
      ['megalodon', 'underwater'],
      ['tullimonstrum', 'underwater'],
      ['phorusrhacos', 'plains'],
      ['maiasaura', 'plains'],
      ['sauropelta', 'plains'],
      ['allosaurus-pandras', 'forest'],
      ['meganeura', 'air'],
      ['sordes', 'air'],
      ['dilophosaurus', 'plains'],
      ['dimetrodon', 'forest'],
      ['mosasaurus', 'underwater'],
      ['spinosaurus', 'plains'],
      ['quetzalcoatlus', 'air'],
      ['xiphactinus', 'underwater'],
      ['lystrosaurus', 'plains'],
      ['baryonyx', 'plains'],
      ['ammonite', 'underwater'],
      ['dallasaurus', 'underwater'],
      ['archaeopteryx', 'air'],
      ['carnotaurus', 'plains'],
      ['styxosaurus', 'underwater'],
      ['anomalocaris', 'underwater'],
      ['dakosaurus', 'underwater'],
    ])
  })

  it('serves the seven refreshed scenes in local review mode', () => {
    const refreshedSceneIds = [
      'pachycephalosaurus',
      'pteranodon',
      'tyrannosaurus-rex',
      'triceratops',
      'apatosaurus',
      'gigantoraptor',
      'mammoth',
    ] as const

    for (const animalId of refreshedSceneIds) {
      const routePrefix = `/__museum-review-assets/${animalId}`
      expect(
        localReviewAssetFiles.get(`${routePrefix}/background-landscape`),
      ).toContain(
        `/src/content/animals/${animalId}/backgrounds/landscape.webp`,
      )
      expect(
        localReviewAssetFiles.get(`${routePrefix}/background-portrait`),
      ).toContain(
        `/src/content/animals/${animalId}/backgrounds/portrait.webp`,
      )
      expect(localReviewAssetFiles.get(`${routePrefix}/poster.webp`)).toContain(
        `/src/content/animals/${animalId}/images/poster.webp`,
      )
      expect(
        localReviewAssetFiles.get(`${routePrefix}/poster-portrait.webp`),
      ).toContain(
        `/src/content/animals/${animalId}/images/poster-portrait.webp`,
      )
      const thumbnailPath = localReviewAssetFiles.get(
        `${routePrefix}/thumbnail.webp`,
      )
      expect(thumbnailPath).toContain(
        `/src/content/animals/${animalId}/images/thumbnail.webp`,
      )
    }
  })

  it('serves production assets for the six promoted expansion animals', () => {
    for (const animalId of expansionAnimalIds) {
      const routePrefix = `/__museum-review-assets/${animalId}`
      const productionPrefix = `/src/content/animals/${animalId}`

      expect(
        localReviewAssetFiles.get(`${routePrefix}/background-landscape`),
      ).toContain(`${productionPrefix}/backgrounds/landscape.webp`)
      expect(
        localReviewAssetFiles.get(`${routePrefix}/background-portrait`),
      ).toContain(`${productionPrefix}/backgrounds/portrait.webp`)
      expect(localReviewAssetFiles.get(`${routePrefix}/poster.webp`)).toContain(
        `${productionPrefix}/images/poster.webp`,
      )
      expect(
        localReviewAssetFiles.get(`${routePrefix}/poster-portrait.webp`),
      ).toContain(`${productionPrefix}/images/poster-portrait.webp`)
      expect(
        localReviewAssetFiles.get(`${routePrefix}/thumbnail.webp`),
      ).toContain(`${productionPrefix}/images/thumbnail.webp`)
      expect(
        localReviewAssetFiles.get(`${routePrefix}/narration.mp3`),
      ).toContain(`${productionPrefix}/audio/narration.zh-CN.mp3`)
      expect(
        localReviewAssetFiles.get(`${routePrefix}/narration.en.mp3`),
      ).toContain(`${productionPrefix}/audio/narration.en.mp3`)
    }
  })

  it('serves shared-profile first-frame previews for every review model', async () => {
    for (const animal of localReviewAnimals) {
      const animalId = animal.id
      const routePrefix = `/__museum-review-assets/${animalId}`
      const expectedPathFragment =
        `/assets/review-generated/model-previews/${animalId}/`

      for (const { fileName } of modelPreviewProfiles) {
        const route = `${routePrefix}/${fileName}`
        const canonicalPath = `src/content/animals/${animalId}/images/${fileName}`
        expect(modelPreviewFor(animalId, fileName), animalId).toContain(`/${canonicalPath}`)
        expect((await stat(resolve(canonicalPath))).isFile(), animalId).toBe(true)
        const legacyReviewPath = localReviewAssetFiles.get(route)
        if (animal.review) {
          expect(legacyReviewPath).toContain(`${expectedPathFragment}${fileName}`)
        }
      }
    }
  })

  it('records the exact encoded GLB size for every promoted expansion animal', async () => {
    for (const animalId of expansionAnimalIds) {
      const animal = localReviewAnimals.find(({ id }) => id === animalId)
      expect(animal).toBeDefined()
      if (!animal) throw new Error(`Missing promoted animal: ${animalId}`)
      const route = `/__museum-review-assets/${animal.id}/model.glb`
      const modelPath = localReviewAssetFiles.get(route)
      expect(modelPath, route).toBeDefined()
      if (!modelPath) {
        throw new Error(`Missing model route: ${route}`)
      }
      const file = await stat(modelPath).catch((error: unknown) => {
        throw new Error(`${route} resolved to ${modelPath}`, {
          cause: error,
        })
      })
      expect(animal.assets.modelBytes, route).toBe(file.size)
    }
  })

  it('uses the correct size semantics for the active review animal types', () => {
    const byId = new Map(
      localReviewAnimals.map((animal) => [
        animal.id,
        animal.content['zh-CN'].facts.size,
      ]),
    )

    expect(byId.get('pachycephalosaurus')).toMatchObject({
      kind: 'body-length',
      minMeters: 3,
      maxMeters: 4.5,
    })
    expect(byId.get('ichthyosaur')).toMatchObject({
      kind: 'group-range',
      minMeters: 0.9,
      maxMeters: 25,
    })
    expect(byId.get('pteranodon')).toMatchObject({
      kind: 'wingspan',
      minMeters: 6,
      maxMeters: 8,
    })
    expect(byId.get('tyrannosaurus-rex')).toMatchObject({
      kind: 'body-length',
      minMeters: 11.5,
      maxMeters: 13,
    })
    expect(byId.get('triceratops')).toMatchObject({
      kind: 'body-length',
      minMeters: 8,
      maxMeters: 9,
    })
    expect(byId.get('apatosaurus')).toMatchObject({
      kind: 'body-length',
      minMeters: 21,
      maxMeters: 24,
    })
    expect(byId.get('gigantoraptor')).toMatchObject({
      kind: 'body-length',
      minMeters: 8,
      maxMeters: 8,
    })
    expect(byId.get('mammoth')).toMatchObject({
      kind: 'shoulder-height',
      minMeters: 3,
      maxMeters: 3.5,
    })
    expect(byId.get('maiasaura')).toMatchObject({
      kind: 'body-length',
      minMeters: 7,
      maxMeters: 9,
    })
    expect(byId.get('plesiosaurus')).toMatchObject({
      kind: 'group-range',
      minMeters: 1.5,
      maxMeters: 13,
    })
    expect(byId.get('megalodon')).toMatchObject({
      kind: 'body-length',
      minMeters: 15,
      maxMeters: 18,
    })
    expect(byId.get('rhamphorhynchus')).toMatchObject({
      kind: 'wingspan',
      minMeters: 1,
      maxMeters: 1.8,
    })
    expect(byId.get('tupandactylus')).toMatchObject({
      kind: 'wingspan',
      minMeters: 2.7,
      maxMeters: 2.7,
    })
    expect(byId.get('meganeura')).toMatchObject({
      kind: 'wingspan',
      minMeters: 0.7,
      maxMeters: 0.7,
    })
  })

  it('records the selected free ichthyosaur replacement as owner accepted', () => {
    const stegosaurus = localReviewAnimals.find(
      (animal) => animal.id === 'stegosaurus',
    )
    const pteranodon = localReviewAnimals.find(
      (animal) => animal.id === 'pteranodon',
    )
    const ichthyosaur = localReviewAnimals.find(
      (animal) => animal.id === 'ichthyosaur',
    )

    expect(stegosaurus?.review?.badge).toBe('已听审')
    expect(pteranodon?.review?.badge).toBe('已验收')
    expect(ichthyosaur?.review?.badge).toBe('已验收')
    expect(ichthyosaur?.review?.note).toContain('候选 B')
    expect(ichthyosaur?.animation).toEqual({
      clip: 'Idle',
      loop: 'repeat',
      speed: 0.95,
    })
    expect(ichthyosaur?.review?.status).toBe(
      '替换模型、皮肤、Idle 与静态图已晋升生产',
    )
    expect(ichthyosaur?.review?.note).toContain('80,398 tris')
    expect(ichthyosaur?.review?.note).toContain('14 骨骼')
    expect(ichthyosaur?.review?.note).toContain('0 error、0 warning')
    expect(ichthyosaur?.assets.modelBytes).toBe(5_737_920)
    expect(
      [pteranodon, ichthyosaur].every(
        (animal) => animal?.status === 'published',
      ),
    ).toBe(true)
  })

  it('records the repaired Pteranodon Idle as owner accepted', () => {
    const pteranodon: DisplayableAnimalPackage | undefined =
      localReviewAnimals.find((animal) => animal.id === 'pteranodon')

    expect(pteranodon?.animation).toEqual({
      clip: 'Idle',
      loop: 'repeat',
      speed: 0.7,
    })
    expect(pteranodon?.review?.badge).toBe('已验收')
    expect(pteranodon?.review?.status).toBe(
      'Blender Idle 已通过本地评审',
    )
  })

  it('fits the replacement ichthyosaur at reviewed desktop and portrait sizes', () => {
    const ichthyosaur: DisplayableAnimalPackage | undefined =
      localReviewAnimals.find((animal) => animal.id === 'ichthyosaur')

    expect(ichthyosaur?.presentation.safeAreaPadding).toBe(0.1)
    expect(ichthyosaur?.presentation.initialYawDegrees).toBe(0)
    expect(ichthyosaur?.presentation.landscapeHorizontalOffset).toBe(0)
    expect(ichthyosaur?.presentation.portraitHorizontalOffset).toBe(0)
    expect(ichthyosaur?.presentation.portraitSafeAreaPadding).toBe(0.1)
    expect(ichthyosaur?.presentation.preciseBounds).toBe(true)
  })

  it('records the three newly rigged dinosaur Idles for review', () => {
    const findAnimal = (id: string): DisplayableAnimalPackage | undefined =>
      localReviewAnimals.find((animal) => animal.id === id)
    const tyrannosaurus = findAnimal('tyrannosaurus-rex')
    const triceratops = findAnimal('triceratops')
    const apatosaurus = findAnimal('apatosaurus')

    for (const animal of [tyrannosaurus, triceratops, apatosaurus]) {
      expect(animal?.status).toBe('published')
      expect(
        animal
          ? reviewNarrationPlanFor(animal.narration, 'zh-CN')?.status
          : undefined,
      ).toBe('ready')
      expect(animal?.content['zh-CN'].sources.length).toBeGreaterThanOrEqual(1)
      expect(animal?.content['zh-CN'].sources.length).toBeLessThanOrEqual(3)
    }

    expect(tyrannosaurus?.review?.badge).toBe('待复看')
    expect(tyrannosaurus?.review?.status).toBe('嘴部、髋部与前爪连接待复看')
    expect(tyrannosaurus?.animation).toEqual({
      clip: 'Idle',
      loop: 'repeat',
      speed: 0.9,
    })
    expect(tyrannosaurus?.review?.note).toContain('13 骨骼')
    expect(tyrannosaurus?.review?.note).toContain('约 4°')
    expect(tyrannosaurus?.review?.note).toContain('指甲组件')
    expect(tyrannosaurus?.review?.note).toContain('两段式')
    expect(tyrannosaurus?.review?.note).toContain('髋部')
    expect(triceratops?.animation).toEqual({
      clip: 'Idle',
      loop: 'repeat',
      speed: 0.9,
    })
    expect(triceratops?.review?.badge).toBe('待复看')
    expect(triceratops?.review?.status).toBe(
      '头部与尾部 Blender Idle 待复看',
    )
    expect(triceratops?.review?.note).toContain('约 11°')
    expect(triceratops?.review?.note).toContain('固定桥接')
    expect(apatosaurus?.review?.badge).toBe('已验收')
    expect(apatosaurus?.animation).toEqual({
      clip: 'Idle',
      loop: 'repeat',
      speed: 0.9,
    })
    expect(apatosaurus?.presentation.landscapeHorizontalOffset).toBe(0.01)
    expect(apatosaurus?.assets.modelBytes).toBe(3_513_136)
    expect(apatosaurus?.review?.status).toBe(
      '新迷惑龙模型、Idle 与静态图已晋升生产',
    )
    expect(apatosaurus?.review?.note).toContain('真实法线微表面')
    expect(apatosaurus?.review?.note).toContain('四脚与下肢固定')
    expect(apatosaurus?.review?.note).toContain('生产目录已安装')
    expect(apatosaurus?.review?.modelCredit?.sourceUrl).toContain(
      'fecabec8e4ef42ef98b5480dbf50c57d',
    )
  })

  it('keeps both additions in the release and marks the Gigantoraptor Idle for review', () => {
    const gigantoraptor: DisplayableAnimalPackage | undefined =
      localReviewAnimals.find(({ id }) => id === 'gigantoraptor')
    const mammoth: DisplayableAnimalPackage | undefined =
      localReviewAnimals.find(({ id }) => id === 'mammoth')
    const additions: readonly (DisplayableAnimalPackage | undefined)[] = [
      gigantoraptor,
      mammoth,
    ]

    for (const animal of additions) {
      expect(animal?.status).toBe('published')
      expect(
        animal
          ? reviewNarrationAssetFor(animal.assets.narration, 'zh-CN')
              ?.status
          : undefined,
      ).toBe('ready')
    }

    expect(gigantoraptor?.animation).toEqual({
      clip: 'Idle',
      loop: 'repeat',
      speed: 0.9,
    })
    expect(gigantoraptor?.review?.badge).toBe('待复看')
    expect(gigantoraptor?.review?.status).toBe(
      '头颈与双前爪加强版 Blender Idle 待复看',
    )
    expect(gigantoraptor?.review?.note).toContain('225%')
    expect(gigantoraptor?.review?.note).toContain('450%')
    expect(gigantoraptor?.review?.note).toContain('500%')
    expect(
      gigantoraptor
        ? reviewNarrationPlanFor(gigantoraptor.narration, 'zh-CN')?.status
        : undefined,
    ).toBe('ready')
    expect(gigantoraptor?.review?.note).toContain('很高科学不确定性')
    expect(gigantoraptor?.content['zh-CN'].facts.diet).toBe('unknown')

    expect(mammoth?.animation).toEqual({
      clip: 'Idle',
      loop: 'repeat',
      speed: 0.9,
    })
    expect(mammoth?.review?.badge).toBe('待复看')
    expect(mammoth?.review?.status).toBe(
      '头部长牙与尾部 Blender Idle 待复看',
    )
    expect(
      mammoth
        ? reviewNarrationPlanFor(mammoth.narration, 'zh-CN')?.status
        : undefined,
    ).toBe('ready')
    expect(mammoth?.review?.note).toContain('cháng máo')
    expect(mammoth?.review?.note).toContain('约 7°')
    expect(mammoth?.review?.note).toContain('固定尾根')
    expect(mammoth?.review?.modelCredit?.sourceUrl).toBe(
      'https://sketchfab.com/3d-models/3d-high-poly-baby-woolly-mammoth-fce1c86ccedf47a5b9627098be6719d5',
    )
    expect(mammoth?.review?.modelCredit?.attribution).toContain('SDPM Esare')
    expect(mammoth?.review?.modelCredit?.attribution).not.toContain('kenchoo')
  })

  it('keeps all three accepted expansion animals published with narration', () => {
    const expansionIds = new Set([
      'maiasaura',
      'megalodon',
      'plesiosaurus',
    ])
    const expansionCandidates: readonly DisplayableAnimalPackage[] =
      localReviewAnimals.filter(({ id }) => expansionIds.has(id))

    expect(expansionCandidates.map(({ id }) => id)).toEqual([
      'plesiosaurus',
      'megalodon',
      'maiasaura',
    ])

    for (const animal of expansionCandidates) {
      expect(animal.status).toBe('published')
      expect(animal.review?.badge).toBe('已验收')
      expect(animal.review?.status).toContain('已通过本地评审')
      expect(animal.review?.note).toContain('产品负责人已于 2026-07-31')
      expect(animal.animation).toEqual({
        clip: 'Idle',
        loop: 'repeat',
        speed: animal.id === 'maiasaura' ? 0.9 : 1,
      })
      expect(
        reviewNarrationPlanFor(animal.narration, 'zh-CN')?.status,
      ).toBe('ready')
      expect(
        reviewNarrationAssetFor(animal.assets.narration, 'zh-CN')?.status,
      ).toBe('ready')
      expect(animal.review?.modelCredit?.licenseUrl).toBe(
        'https://creativecommons.org/licenses/by/4.0/',
      )
      expect(animal.content['zh-CN'].editorial.uncertaintyNotes.length).toBeGreaterThanOrEqual(
        2,
      )
    }
  })

  it('loads the three promoted onboarding animals from production packages', () => {
    const promotedIds = ['sauropelta', 'dilophosaurus', 'mosasaurus']
    const promoted: readonly DisplayableAnimalPackage[] =
      localReviewAnimals.filter(({ id }) => promotedIds.includes(id))

    expect(promoted.map(({ id }) => id)).toEqual(promotedIds)
    for (const animal of promoted) {
      expect(animal.status).toBe('published')
      expect(animal.provenance).toHaveLength(8)
      expect(
        animal.provenance.find(({ assetPath }) => assetPath === 'model/model.glb')
          ?.source,
      ).toMatchObject({
        type: 'third-party',
      })
      const englishNarrationSource = animal.provenance.find(
        ({ assetPath }) => assetPath === 'audio/narration.en.mp3',
      )?.source
      expect(englishNarrationSource?.type).toBe('generated')
      if (englishNarrationSource?.type !== 'generated') {
        throw new Error(`Expected generated English narration for ${animal.id}`)
      }
      expect(englishNarrationSource.revision).toContain('Serena')
      expect('draftNotes' in animal).toBe(false)
    }

    const dilophosaurus = promoted.find(({ id }) => id === 'dilophosaurus')
    expect(dilophosaurus?.presentation.initialYawDegrees).toBe(180)
    expect(dilophosaurus?.content['zh-CN'].visibleFeature).toBe(
      '看看它头顶并排的两片冠，再找找弯曲的尖牙和有力的后腿。',
    )
    expect(
      JSON.stringify(dilophosaurus?.content['zh-CN']),
    ).not.toMatch(/颈褶|喷毒/)
  })

  it('keeps the corrected composition settings for all three expansion animals', () => {
    const maiasaura = localReviewAnimals.find(
      ({ id }) => id === 'maiasaura',
    )
    const megalodon = localReviewAnimals.find(
      ({ id }) => id === 'megalodon',
    )
    const plesiosaurus = localReviewAnimals.find(
      ({ id }) => id === 'plesiosaurus',
    )

    expect(maiasaura?.presentation).toMatchObject({
      landscapeVerticalOffset: 0.04,
      portraitVerticalOffset: 0.04,
      preciseBounds: true,
      shadow: 'ground',
      shadowDepthScale: 0.8,
      shadowHorizontalOffset: -0.98,
      shadowOpacity: 0.38,
      shadowScale: 0.32,
      shadowYOffset: -0.04,
    })
    expect(megalodon?.presentation).toMatchObject({
      landscapeHorizontalOffset: 0,
      landscapeVerticalOffset: 0.04,
      portraitHorizontalOffset: 0,
      portraitVerticalOffset: 0.04,
      preciseBounds: true,
      shadow: 'none',
    })
    expect(plesiosaurus?.presentation).toMatchObject({
      portraitVerticalOffset: 0,
    })
  })

  it('keeps the Apatosaurus contact shadow under its four-foot cluster', () => {
    const apatosaurus = localReviewAnimals.find(
      ({ id }) => id === 'apatosaurus',
    )

    expect(apatosaurus?.presentation).toMatchObject({
      cameraLightScale: 1.05,
      landscapeVerticalOffset: 0.035,
      portraitVerticalOffset: 0.05,
      shadow: 'ground',
      shadowDepthScale: 0.9,
      shadowHorizontalOffset: -0.61,
      shadowOpacity: 0.56,
      shadowScale: 0.38,
      shadowYOffset: 0.11,
      toneMappingExposure: 1.28,
    })
  })

  it('keeps each two-sentence narration aligned with its exact authored wording', () => {
    expect(localReviewAnimals.filter(({ review }) => !review).map(({ id }) => id).sort())
      .toEqual(Object.keys(canonicalSecondNarrationSentences).sort())
    for (const animal of localReviewAnimals) {
      const content = animal.content['zh-CN']
      expect(content.narration.sentences).toHaveLength(2)
      expect(content.narration.sentences[1]).toBe(
        canonicalSecondNarrationSentences[animal.id] ?? content.visibleFeature,
      )
      expect(content.narration.sentences.join('')).not.toContain('undefined')
    }
  })
})
