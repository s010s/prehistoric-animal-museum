import type { Locale } from '../i18n/locale'
import narrationScripts from './audio/narration-scripts.json'
import transitionDurations from './audio/transition-durations.json'
import {
  isProductionScaleEncounterAnimal,
  NARRATED_REVIEW_SCALE_ENCOUNTER_ANIMAL_IDS,
  type ProductionScaleEncounterAnimalId,
  type ScaleEncounterAnimalId,
} from './types'

export type { ChildProfile, ScaleEncounterAnimalId } from './types'
export { isScaleEncounterAnimal } from './types'

export type GuidedLineKind =
  | 'intro'
  | 'transition'
  | 'arrival'
  | 'toChildEyes'
  | 'toChildRear'

export interface ScaleEncounterCopy {
  readonly arrival: string
  readonly ambientHint: string
  readonly ambientLabel: string
  readonly ambientOff: string
  readonly ambientOn: string
  readonly audioLabel: string
  readonly audioOff: string
  readonly audioOn: string
  readonly backToOverview: string
  readonly childEyesView: string
  readonly childRearView: string
  readonly childView: string
  readonly close: string
  readonly captionsHint: string
  readonly captionsLabel: string
  readonly captionsOff: string
  readonly captionsOn: string
  readonly captionsTitle: string
  readonly controls: {
    readonly closer: string
    readonly farther: string
    readonly orbitLeft: string
    readonly orbitRight: string
    readonly overviewHint: string
    readonly overviewTitle: string
    readonly povHint: string
    readonly povTitle: string
  }
  readonly intro: string
  readonly loading: (animal: string) => string
  readonly loadingDelayed: (animal: string) => string
  readonly measurement: string
  readonly narrationHint: string
  readonly narrationLabel: string
  readonly overview: string
  readonly playbackLabel: string
  readonly playbackShortLabel: string
  readonly playbackTitle: string
  readonly retry: string
  readonly setup: {
    readonly approachClose: string
    readonly approachCloseDescription: string
    readonly approachComfortable: string
    readonly approachComfortableDescription: string
    readonly approachHelp: string
    readonly boy: string
    readonly boyDescription: string
    readonly confirm: string
    readonly fieldApproach: string
    readonly fieldGender: string
    readonly fieldHeight: string
    readonly girl: string
    readonly girlDescription: string
    readonly heightHelp: string
    readonly subtitle: string
    readonly title: string
  }
  readonly skip: string
  readonly staticFallback: string
  readonly title: string
  readonly toChildEyes: string
  readonly toChildRear: string
  readonly transition: string
  readonly unavailable: string
  readonly viewFromMyEyes: string
  readonly viewSwitcherLabel: string
}

export interface ScaleEncounterContent {
  readonly animalId: ScaleEncounterAnimalId
  readonly audio: Readonly<Record<GuidedLineKind, string>>
  readonly copy: ScaleEncounterCopy
  readonly narrationAvailable: boolean
  readonly sceneLabel: string
  /** Rounded ffprobe duration of this locale's transition MP3. */
  readonly transitionDurationMs: number
}

type AnimalGuidedAudioFiles = Readonly<
  Record<Locale, Readonly<Record<'intro' | 'transition' | 'arrival', string>>>
>

type NarratedScaleEncounterAnimalId =
  ProductionScaleEncounterAnimalId

const REVIEW_NARRATED_ANIMAL_ID_SET: ReadonlySet<string> = new Set(
  NARRATED_REVIEW_SCALE_ENCOUNTER_ANIMAL_IDS,
)

function reviewNarrationEnabled(): boolean {
  return (
    import.meta.env.MODE === 'review' ||
    import.meta.env.MODE === 'development' ||
    import.meta.env.MODE === 'test'
  )
}

function isNarratedScaleEncounterAnimal(
  animalId: ScaleEncounterAnimalId,
): animalId is NarratedScaleEncounterAnimalId {
  return (
    isProductionScaleEncounterAnimal(animalId) ||
    (reviewNarrationEnabled() &&
      REVIEW_NARRATED_ANIMAL_ID_SET.has(animalId))
  )
}

const audioFiles: Readonly<
  Record<NarratedScaleEncounterAnimalId, AnimalGuidedAudioFiles>
> = {
  stegosaurus: standardAudioFiles('stegosaurus'),
  pachycephalosaurus: standardAudioFiles('pachycephalosaurus'),
  ichthyosaur: standardAudioFiles('ichthyosaur'),
  rhamphorhynchus: standardAudioFiles('rhamphorhynchus'),
  triceratops: standardAudioFiles('triceratops'),
  apatosaurus: standardAudioFiles('apatosaurus'),
  plesiosaurus: standardAudioFiles('plesiosaurus'),
  gigantoraptor: standardAudioFiles('gigantoraptor'),
  tupandactylus: standardAudioFiles('tupandactylus'),
  megalodon: standardAudioFiles('megalodon'),
  maiasaura: standardAudioFiles('maiasaura'),
  sauropelta: standardAudioFiles('sauropelta'),
  meganeura: standardAudioFiles('meganeura'),
  dilophosaurus: standardAudioFiles('dilophosaurus'),
  'tyrannosaurus-rex': {
    'zh-CN': {
      intro: 'tyrannosaurus-rex-intro-v3.zh-CN.mp3',
      transition: 'tyrannosaurus-rex-transition-v4.zh-CN.mp3',
      arrival: 'tyrannosaurus-rex-arrival-v3.zh-CN.mp3',
    },
    en: {
      intro: 'tyrannosaurus-rex-intro.en.mp3',
      transition: 'tyrannosaurus-rex-transition.en.mp3',
      arrival: 'tyrannosaurus-rex-arrival.en.mp3',
    },
  },
  pteranodon: {
    'zh-CN': {
      intro: 'pteranodon-intro-v2.zh-CN.mp3',
      transition: 'pteranodon-transition-v2.zh-CN.mp3',
      arrival: 'pteranodon-arrival-v2.zh-CN.mp3',
    },
    en: {
      intro: 'pteranodon-intro.en.mp3',
      transition: 'pteranodon-transition.en.mp3',
      arrival: 'pteranodon-arrival.en.mp3',
    },
  },
  mosasaurus: {
    'zh-CN': {
      intro: 'mosasaurus-intro-v2.zh-CN.mp3',
      transition: 'mosasaurus-transition-v2.zh-CN.mp3',
      arrival: 'mosasaurus-arrival-v4.zh-CN.mp3',
    },
    en: {
      intro: 'mosasaurus-intro.en.mp3',
      transition: 'mosasaurus-transition.en.mp3',
      arrival: 'mosasaurus-arrival.en.mp3',
    },
  },
  mammoth: {
    'zh-CN': {
      intro: 'mammoth-intro-v4.zh-CN.mp3',
      transition: 'mammoth-transition-v6.zh-CN.mp3',
      arrival: 'mammoth-arrival-v4.zh-CN.mp3',
    },
    en: {
      intro: 'mammoth-intro-v3.en.mp3',
      transition: 'mammoth-transition-v5.en.mp3',
      arrival: 'mammoth-arrival-v3.en.mp3',
    },
  },
  spinosaurus: standardAudioFiles('spinosaurus'),
  lystrosaurus: standardAudioFiles('lystrosaurus'),
  baryonyx: standardAudioFiles('baryonyx'),
  archaeopteryx: standardAudioFiles('archaeopteryx'),
  carnotaurus: standardAudioFiles('carnotaurus'),
  anomalocaris: standardAudioFiles('anomalocaris'),
}

function standardAudioFiles(animalId: string): AnimalGuidedAudioFiles {
  return {
    'zh-CN': {
      intro: `${animalId}-intro.zh-CN.mp3`,
      transition: `${animalId}-transition.zh-CN.mp3`,
      arrival: `${animalId}-arrival.zh-CN.mp3`,
    },
    en: {
      intro: `${animalId}-intro.en.mp3`,
      transition: `${animalId}-transition.en.mp3`,
      arrival: `${animalId}-arrival.en.mp3`,
    },
  }
}

const bundledAudioUrls = import.meta.glob(
  './audio/*.mp3',
  {
    eager: true,
    import: 'default',
    query: '?url',
  },
) as Readonly<Record<string, string>>

function bundledAudioUrl(file: string): string {
  const url = bundledAudioUrls[`./audio/${file}`]
  if (!url) throw new Error(`missing-scale-encounter-audio:${file}`)
  return url
}

function guidedAudioUrl(
  animalId: NarratedScaleEncounterAnimalId,
  file: string,
): string {
  if (
    (import.meta.env.MODE === 'review' ||
      import.meta.env.MODE === 'development' ||
      import.meta.env.MODE === 'test') &&
    REVIEW_NARRATED_ANIMAL_ID_SET.has(animalId)
  ) {
    return `/__museum-review-assets/scale-encounter-audio/${file}`
  }
  return bundledAudioUrl(file)
}

const viewSwitchAudioUrls = {
  'zh-CN': {
    toChildEyes: new URL(
      './audio/view-switch-to-eyes-v4.zh-CN.mp3',
      import.meta.url,
    ).href,
    toChildRear: new URL(
      './audio/view-switch-to-rear-v4.zh-CN.mp3',
      import.meta.url,
    ).href,
  },
  en: {
    toChildEyes: new URL(
      './audio/view-switch-to-eyes.en.mp3',
      import.meta.url,
    ).href,
    toChildRear: new URL(
      './audio/view-switch-to-rear.en.mp3',
      import.meta.url,
    ).href,
  },
} as const

type AuthoredScaleEncounterContent = Omit<
  ScaleEncounterContent,
  'audio' | 'narrationAvailable'
>

const zhCN: Readonly<
  Record<ScaleEncounterAnimalId, AuthoredScaleEncounterContent>
> = {
  stegosaurus: {
    animalId: 'stegosaurus',
    sceneLabel: '森林相遇 · 小朋友眼睛视角',
    transitionDurationMs: 7_930,
    copy: {
      title: '和剑龙比一比',
      measurement: '从头到尾约 8 米',
      intro:
        '小朋友，准备好了吗？我们背上小包，走进森林空地，去看看一只八米长的剑龙。站在它旁边，你会到它身体的什么位置呢？',
      transition:
        '脚步慢一点，剑龙就在前面。先看它贴近地面的四条腿，再顺着长长的身体往尾巴看。',
      arrival:
        '看，剑龙的身体比你长好多。背上的骨板一块接一块，尾巴末端还有四根长刺，站在旁边才能看清它有多大。',
      ...sharedZhCNCopy(),
    },
  },
  pachycephalosaurus: {
    animalId: 'pachycephalosaurus',
    sceneLabel: '森林相遇 · 小朋友眼睛视角',
    transitionDurationMs: 9_403,
    copy: {
      title: '和肿头龙比一比',
      measurement: '从头到尾约 4 米',
      intro:
        '小朋友，准备好了吗？我们走进森林，去见一只大约四米长的肿头龙。它没有霸王龙那么大，可还是比你长得多。',
      transition:
        '背好小包，沿着空地轻轻走过去。肿头龙就在前面，圆圆的头顶已经露出来了。',
      arrival:
        '看，它的头顶像戴着一顶厚厚的圆帽。你的眼睛差不多能看到它身体中间，整条尾巴还向后伸出很远。',
      ...sharedZhCNCopy(),
    },
  },
  ichthyosaur: {
    animalId: 'ichthyosaur',
    sceneLabel: '海底相遇 · 小朋友眼睛视角',
    transitionDurationMs: 7_761,
    copy: {
      title: '和鱼龙比一比',
      measurement: '从鼻尖到尾巴约 4 米',
      intro:
        '小朋友，准备好了吗？我们戴上潜水装备，去见一只按四米左右体长展示的鱼龙类动物。不同鱼龙类的大小差别很大。',
      transition:
        '面镜、气瓶和脚蹼都准备好了。轻轻摆动脚蹼，看看那道像海豚一样的身影正从前面游来。',
      arrival:
        '看，它有尖长的嘴、流线形的身体和四只鳍。这个模型从头到尾大约四米，比两个小朋友平躺在一起还要长。',
      ...sharedZhCNCopy(),
    },
  },
  'tyrannosaurus-rex': {
    animalId: 'tyrannosaurus-rex',
    sceneLabel: '森林相遇 · 小朋友眼睛视角',
    transitionDurationMs: 9_422,
    copy: {
      title: '和霸王龙比一比',
      measurement: '从鼻尖到尾巴约 12 米',
      intro:
        '小朋友，准备好了吗？我们在想象里走进白垩纪的森林，去见一只霸王龙。站在它面前，会是什么感觉呢？',
      transition:
        '背好小背包，脚步放轻一点。霸王龙就在前面。先看看它的大脚，再沿着两条腿慢慢往上看。',
      arrival:
        '哇，它真高！两条粗壮的腿像大柱子。再把头抬高一点，它的大脑袋还在更上面呢。',
      ...sharedZhCNCopy(),
    },
  },
  rhamphorhynchus: {
    animalId: 'rhamphorhynchus',
    sceneLabel: '空中相遇 · 小朋友眼睛视角',
    transitionDurationMs: 9_022,
    copy: {
      title: '和喙嘴翼龙比一比',
      measurement: '双翼展开约 1.5 米',
      intro:
        '小朋友，准备好了吗？我们穿上飞行装备，去看一只翼展大约一米半的喙嘴翼龙。它展开翅膀，会比你的手臂宽多少呢？',
      transition:
        '身体伸平，慢慢向前滑。喙嘴翼龙就在前面，细长的尾巴和尾端的小帆已经看得见了。',
      arrival:
        '看，它正在你的眼前展开两片皮膜翅膀。翼展比大多数小朋友张开的双臂还宽，长尾巴一直拖在身体后面。',
      ...sharedZhCNCopy(),
    },
  },
  triceratops: {
    animalId: 'triceratops',
    sceneLabel: '森林相遇 · 小朋友眼睛视角',
    transitionDurationMs: 8_854,
    copy: {
      title: '和三角龙比一比',
      measurement: '从头到尾约 8.5 米',
      intro:
        '小朋友，准备好了吗？我们走进森林空地，去见一只八米多长的三角龙。它低着头站在那里，也像一辆大车。',
      transition:
        '脚步放轻，先看它稳稳站住的四条腿。再往前看，三只角和宽大的颈盾就在眼前。',
      arrival:
        '看，你站在三角龙旁边只到它身体下面。它的头很大，颈盾像一面宽宽的盾牌，两根眉角从上方向前伸出。',
      ...sharedZhCNCopy(),
    },
  },
  apatosaurus: {
    animalId: 'apatosaurus',
    sceneLabel: '森林相遇 · 小朋友眼睛视角',
    transitionDurationMs: 7_372,
    copy: {
      title: '和迷惑龙比一比',
      measurement: '从头到尾约 23 米',
      intro:
        '小朋友，准备好了吗？前面的林间空地很大，因为我们要见的是一只大约二十三米长的迷惑龙。要退远一些，才能把它看完整。',
      transition:
        '背好小包，站稳脚步。先看四条柱子一样的腿，再从长长的脖子看到更长的尾巴。',
      arrival:
        '看，你站在它脚边显得很小。迷惑龙的身体横过整片空地，从头看到尾，大约能排下十几个小朋友。',
      ...sharedZhCNCopy(),
    },
  },
  plesiosaurus: {
    animalId: 'plesiosaurus',
    sceneLabel: '海底相遇 · 小朋友眼睛视角',
    transitionDurationMs: 7_751,
    copy: {
      title: '和蛇颈龙比一比',
      measurement: '从头到尾约 5 米',
      intro:
        '小朋友，准备好了吗？我们戴上潜水装备，去见一只按五米左右体长展示的蛇颈龙类动物。这个类群里有大有小。',
      transition:
        '脚蹼轻轻摆动，保持一点距离。前面的长脖子慢慢靠近，四只鳍正在水里划动。',
      arrival:
        '看，它的身体像一只大船，长脖子从前面伸出去。这个代表性模型大约五米长，四只鳍分布在身体两侧。',
      ...sharedZhCNCopy(),
    },
  },
  gigantoraptor: {
    animalId: 'gigantoraptor',
    sceneLabel: '森林相遇 · 小朋友眼睛视角',
    transitionDurationMs: 8_331,
    copy: {
      title: '和巨盗龙比一比',
      measurement: '从头到尾约 8 米',
      intro:
        '小朋友，准备好了吗？背上小包，我们走进白垩纪的森林，去寻找巨盗龙。它从嘴尖到尾巴有八米，比你想象中大得多。',
      transition:
        '背好小包，慢慢向前走。先看它长长的双腿，再往上找身体、脖子和小小的脑袋。',
      arrival:
        '看，巨盗龙站起来比小朋友高好多。它的身体和尾巴向前后伸开，整条轮廓足足有八米长。',
      ...sharedZhCNCopy(),
    },
  },
  tupandactylus: {
    animalId: 'tupandactylus',
    sceneLabel: '空中相遇 · 小朋友眼睛视角',
    transitionDurationMs: 10_212,
    copy: {
      title: '和古神翼龙比一比',
      measurement: '双翼展开约 2.7 米',
      intro:
        '小朋友，准备好了吗？我们穿上飞行装备，去看一只翼展大约二点七米的古神翼龙。它头上的大冠饰也很醒目。',
      transition:
        '身体伸平，慢慢向前滑。古神翼龙就在前面，翅膀和高高的头冠一起出现在天空里。',
      arrival:
        '看，它展开的翅膀比小朋友张开的双臂宽得多。头顶的大冠饰向上伸出，让整个轮廓显得更高。',
      ...sharedZhCNCopy(),
    },
  },
  pteranodon: {
    animalId: 'pteranodon',
    sceneLabel: '空中相遇 · 小朋友眼睛视角',
    transitionDurationMs: 7_270,
    copy: {
      title: '和无齿翼龙比一比',
      measurement: '双翼展开约 7 米',
      intro:
        '小朋友，准备好了吗？我们在想象里穿上飞行装备，和无齿翼龙一起滑翔。它的翅膀到底有多宽呢？',
      transition:
        '手臂张开，身体伸平，像小飞鸟一样向前滑。无齿翼龙就在前面，离我们越来越近啦。',
      arrival:
        '看，它正和我们飞在一样的高度。两只大翅膀向左右展开，差不多有七米宽，眼前的天空都快被它占满了！',
      ...sharedZhCNCopy(),
    },
  },
  mosasaurus: {
    animalId: 'mosasaurus',
    sceneLabel: '海底相遇 · 小朋友眼睛视角',
    transitionDurationMs: 9_039,
    copy: {
      title: '和沧龙比一比',
      measurement: '从鼻尖到尾巴约 12 米',
      intro:
        '小朋友，准备好了吗？我们在想象里戴上潜水装备，潜到海里去见沧龙。十二米长的沧龙游过来，会有多大呢？',
      transition:
        '戴好面镜，背好气瓶，脚蹼轻轻摆一摆。水面在上方发亮，沧龙正朝这边游来。',
      arrival:
        '快看上面，沧龙正从斜上方游过去。我们能看见它的肚子、四只大鳍和长长的尾巴。从头看到尾，足足有十二米长！',
      ...sharedZhCNCopy(),
    },
  },
  mammoth: {
    animalId: 'mammoth',
    sceneLabel: '寒冷草原 · 小朋友眼睛视角',
    transitionDurationMs: 8_866,
    copy: {
      title: '和长毛猛犸象比一比',
      measurement: '肩膀离地约 3–3.5 米',
      intro:
        '小朋友，准备好了吗？我们在想象里来到寒冷的草原，去见一只长毛猛犸象。站在它面前，你大约能到它腿上的什么位置呢？',
      transition:
        '护目镜戴好了，手套也戴好了。厚厚的防寒外套、雪裤和雪地靴也都准备好了。走，我们去见猛犸象！',
      arrival:
        '抬头看，猛犸象正站在你面前。它的肩膀有三米多高，四条粗腿稳稳踩在雪地上。两根长牙从脸旁弯出来，真长啊！',
      ...sharedZhCNCopy(),
    },
  },
  megalodon: {
    animalId: 'megalodon',
    sceneLabel: '海底相遇 · 小朋友眼睛视角',
    transitionDurationMs: 8_620,
    copy: {
      title: '和巨齿鲨比一比',
      measurement: '从鼻尖到尾巴约 16 米',
      intro:
        '小朋友，准备好了吗？戴好潜水装备，我们潜进远古海洋，去寻找巨齿鲨。它有十六米长，正从蓝色海水里向我们游来。先找找那片大大的背鳍吧。',
      transition:
        '面镜、气瓶和脚蹼都准备好了。我们留在安全的位置，静静看着前方。大背鳍划过海水，巨齿鲨摆着尾巴游来。',
      arrival:
        '看，它从对面游过来啦！宽宽的脑袋、大大的背鳍，还有有力的尾巴，全都能看清。十六米，比一辆大巴还要长！',
      ...sharedZhCNCopy(),
    },
  },
  maiasaura: {
    animalId: 'maiasaura',
    sceneLabel: '森林相遇 · 小朋友眼睛视角',
    transitionDurationMs: 7_170,
    copy: {
      title: '和慈母龙比一比',
      measurement: '从头到尾约 8 米',
      intro:
        '小朋友，准备好了吗？我们走进森林空地，去见一只大约八米长的慈母龙。它的身体又长又结实。',
      transition:
        '背好小包，慢慢走近一点。先看它踩在地上的四肢，再沿着背部看到长长的尾巴。',
      arrival:
        '看，你站在慈母龙旁边只占很小一块地方。它的身体像一辆长长的大车，扁宽的嘴就在头部前端。',
      ...sharedZhCNCopy(),
    },
  },
  sauropelta: {
    animalId: 'sauropelta',
    sceneLabel: '森林相遇 · 小朋友眼睛视角',
    transitionDurationMs: 10_239,
    copy: {
      title: '和胄甲龙比一比',
      measurement: '从头到尾约 5.5 米',
      intro:
        '小朋友，准备好了吗？我们走进森林，去见一只五米多长的胄甲龙。它的身体不算很高，却像一辆披着护甲的小坦克。',
      transition:
        '脚步放轻，沿着它的侧面看过去。颈部和肩部的骨刺已经露出来，背上还铺着一排排骨质护甲。',
      arrival:
        '看，你的眼睛差不多能看到它身体侧面。胄甲龙从头到尾有五米多长，低矮的背部覆盖着结实的护甲。',
      ...sharedZhCNCopy(),
    },
  },
  meganeura: {
    animalId: 'meganeura',
    sceneLabel: '森林相遇 · 小朋友眼睛视角',
    transitionDurationMs: 8_457,
    copy: {
      title: '和巨脉蜻蜓比一比',
      measurement: '双翼展开约 70 厘米',
      intro:
        '小朋友，准备好了吗？我们走进远古森林里的开阔地，去寻找巨脉蜻蜓。它的双翼展开有七十厘米，你能在树叶间发现它吗？',
      transition:
        '背好小包，站在原地仔细看。它正在和你眼睛差不多高的地方飞，四片翅膀一闪一闪。',
      arrival:
        '看，它展开翅膀也没有小朋友高。七十厘米大约是一张小桌子的宽度，可放在昆虫里，它已经大得惊人了。',
      ...sharedZhCNCopy(),
    },
  },
  dilophosaurus: {
    animalId: 'dilophosaurus',
    sceneLabel: '森林相遇 · 小朋友眼睛视角',
    transitionDurationMs: 7_867,
    copy: {
      title: '和双冠龙比一比',
      measurement: '从头到尾约 6.5 米',
      intro:
        '小朋友，准备好了吗？背上小包，我们走进侏罗纪的森林，去寻找双冠龙。它从嘴尖到尾巴有六点五米，头顶还有两片特别的冠。',
      transition:
        '背好小包，慢慢向前走。先看它站立的双腿，再抬头找找头顶并排的两片冠。',
      arrival:
        '看，双冠龙比小朋友高出很多，长尾巴一直伸到身后。头顶的双冠很薄，像两片竖起来的扇子。',
      ...sharedZhCNCopy(),
    },
  },
  spinosaurus: {
    animalId: 'spinosaurus',
    sceneLabel: '森林相遇 · 小朋友眼睛视角',
    transitionDurationMs: 9_856,
    copy: {
      title: '和棘龙比一比',
      measurement: '从鼻尖到尾巴约 14.5 米',
      intro:
        '小朋友，准备好了吗？背上探险包，我们走进白垩纪的森林，去寻找十四米多长的棘龙。高高的背帆会不会先从树影后面露出来？',
      transition:
        '沿着林间空地慢慢向前走。看，棘龙的长嘴、相对较短的后腿和像船帆一样的高背一点点出现啦。',
      arrival:
        '它来到对面啦！从鼻尖到尾巴大约十四米半，差不多能排下三辆小汽车。长长的嘴和高高的背帆，你先发现了哪一样？',
      ...sharedZhCNCopy(),
    },
  },
  lystrosaurus: {
    animalId: 'lystrosaurus',
    sceneLabel: '林地相遇 · 小朋友眼睛视角',
    transitionDurationMs: 9_990,
    copy: {
      title: '和水龙兽比一比',
      measurement: '从头到尾约 1.5 米',
      intro:
        '小朋友，准备好了吗？我们走进二叠纪末到三叠纪初的河漫滩，去找一只一米半长的水龙兽。它嘴边的两枚小獠牙，会不会先被你看到？',
      transition:
        '脚步放轻一点，沿着干燥泥地往前走。看，水龙兽的短脸、像喙一样的嘴和四条敦实的腿出现啦。',
      arrival:
        '它来到对面啦！一米半差不多和一位大人的身高一样。水龙兽的家族挺过了地球上最大的一次大灭绝，你能找到它的喙和两枚獠牙吗？',
      ...sharedZhCNCopy(),
    },
  },
  baryonyx: {
    animalId: 'baryonyx',
    sceneLabel: '森林相遇 · 小朋友眼睛视角',
    transitionDurationMs: 9_285,
    copy: {
      title: '和重爪龙比一比',
      measurement: '从鼻尖到尾巴约 8.75 米',
      intro:
        '小朋友，准备好了吗？我们走进白垩纪的森林，去寻找将近九米长的重爪龙。它手上那枚特别大的爪子，会藏在哪片树影后面？',
      transition:
        '沿着林间小路慢慢向前走。先找细长的嘴，再看看它的两只手。重爪龙的大爪子露出来啦。',
      arrival:
        '它来到对面啦！从鼻尖到尾巴将近九米，差不多能排下两辆小汽车。长嘴和大爪子都很特别，你觉得它们会怎样帮助重爪龙寻找食物？',
      ...sharedZhCNCopy(),
    },
  },
  archaeopteryx: {
    animalId: 'archaeopteryx',
    sceneLabel: '森林倒木相遇 · 小朋友眼睛视角',
    transitionDurationMs: 4_400,
    copy: {
      title: '和始祖鸟比一比',
      measurement: '从嘴尖到尾尖的总长约 50 厘米',
      intro:
        '小朋友，准备好了吗？背上探险包，我们走进侏罗纪的森林，去寻找始祖鸟。它从嘴尖到尾巴大约半米，你能发现站在低矮倒木上的它吗？',
      transition:
        '脚步放轻一点，沿着林地慢慢走近倒木。看，始祖鸟正站在上面，羽毛、翅膀上的小爪子和长尾巴都看清楚啦。',
      arrival:
        '我们来到倒木旁啦！始祖鸟从嘴尖到尾巴大约半米。看看它的羽毛、翅膀上的小爪子和长长的尾巴，你先发现了哪一样？',
      ...sharedZhCNCopy(),
    },
  },
  carnotaurus: {
    animalId: 'carnotaurus',
    sceneLabel: '森林相遇 · 小朋友眼睛视角',
    transitionDurationMs: 13_418,
    copy: {
      title: '和食肉牛龙比一比',
      measurement: '从鼻尖到尾巴约 8 米',
      intro:
        '小朋友，准备好了吗？背上小包，我们走进白垩纪的森林，去寻找八米长的食肉牛龙。它的短脸和小得出奇的前肢，你会先发现哪一样？',
      transition:
        '脚步放轻一点。先找稳稳踩在地上的两只大脚，再沿着粗壮的腿往上看。短脸、眼睛上方的小角，还有小小的前肢，都出现啦。',
      arrival:
        '哇，它从鼻尖到尾巴大约八米，差不多能排下两辆小汽车！身体这么大，前肢却小小的，这个反差是不是很有趣？你想先看哪里？',
      ...sharedZhCNCopy(),
    },
  },
  anomalocaris: {
    animalId: 'anomalocaris',
    sceneLabel: '海底相遇 · 小朋友眼睛视角',
    transitionDurationMs: 12_525,
    copy: {
      title: '和奇虾比一比',
      measurement: '从头到尾约 60 厘米',
      intro:
        '小朋友，准备好了吗？戴好潜水装备，我们潜进五亿多年前的寒武纪海洋，去寻找六十厘米长的奇虾。它会怎样摆动身体两侧的游泳叶，在海水里向前滑行呢？',
      transition:
        '轻轻摆动脚蹼，留在安全的位置。看，奇虾两边的游泳叶像波浪一样一片接一片地摆动，两只带刺的捕食附肢也伸向前方。',
      arrival:
        '它游到对面啦！从头到尾大约六十厘米，在寒武纪海洋里已经是醒目的大动物。圆圆的嘴藏在身体下面，你能找到吗？',
      ...sharedZhCNCopy(),
    },
  },
}

function sharedZhCNCopy() {
  return {
  ambientHint: '轻快的田野探险配乐，默认关闭',
  ambientLabel: '环境音乐',
  ambientOff: '音乐关',
  ambientOn: '音乐开',
  audioLabel: '开关讲解旁白',
  audioOff: '讲解关',
  audioOn: '讲解开',
  captionsHint: '在画面上同步显示讲解内容',
  captionsLabel: '开关旁白文字',
  captionsOff: '文字关',
  captionsOn: '文字开',
  captionsTitle: '旁白文字',
  backToOverview: '退后看全身',
  childEyesView: '眼睛视角',
  childRearView: '身后视角',
  childView: '小朋友视角',
  close: '返回展台',
  controls: {
    closer: '靠近一点',
    farther: '退后一点',
    orbitLeft: '向左绕着动物看',
    orbitRight: '向右绕着动物看',
    overviewHint: '滚轮或双指缩放',
    overviewTitle: '缩放全景',
    povHint: '方向键 / WASD 绕行和前后移动 · 松开即停',
    povTitle: '观察距离',
  },
  loading: (animal: string) => `正在准备和${animal}见面…`,
  loadingDelayed: (animal: string) => `正在请${animal}来到场景里，请稍等一下。`,
  narrationHint: '跟随视角变化，带小朋友一起探索',
  narrationLabel: '讲解旁白',
  overview: '全身比较',
  playbackLabel: '打开声音与文字设置',
  playbackShortLabel: '声音与文字',
  playbackTitle: '声音与文字',
  retry: '再试一次',
  setup: {
    approachClose: '靠近观察',
    approachCloseDescription: '靠近观察，也能从身后打卡',
    approachComfortable: '留点距离',
    approachComfortableDescription: '保持宽松的观察空间',
    approachHelp: '选择靠近观察后，小朋友会停在动物身体外面一点点。从身后看时，也可以靠近动物一起打卡。',
    boy: '男孩',
    boyDescription: '选择男孩探险员',
    confirm: '进入比一比',
    fieldApproach: '想离动物多近？',
    fieldGender: '小朋友是男孩还是女孩？',
    fieldHeight: '小朋友大约有多高？',
    girl: '女孩',
    girlDescription: '选择女孩探险员',
    heightHelp: '不用量得很精确，选一个最接近的数字就好。',
    subtitle: '身高会决定眼睛视角和人物比例。进入场景后，小朋友会换上探险装备，在想象里和动物相遇。',
    title: '设置小朋友的探险形象',
  },
  skip: '直接进入',
  staticFallback: '先看静态比一比',
  toChildEyes:
    '好，再回到你的眼睛这里。看看动物离你有多远，再顺着它的身体慢慢看一圈。',
  toChildRear:
    '想看看自己刚才在什么位置吗？我们到你身后看一眼。你还可以向左或向右移动，换个方向再看看动物。',
  unavailable: '这个设备暂时不能打开 3D 相遇。你可以返回展台，继续认识这只动物。',
  viewFromMyEyes: '从我的眼睛看',
  viewSwitcherLabel: '观察视角',
  } as const
}

function sharedEnCopy() {
  return {
  ambientHint: 'Light pastoral adventure music, off by default',
  ambientLabel: 'Background music',
  ambientOff: 'Music off',
  ambientOn: 'Music on',
  audioLabel: 'Turn guide narration on or off',
  audioOff: 'Guide off',
  audioOn: 'Guide on',
  captionsHint: 'Show the guide text on screen',
  captionsLabel: 'Turn narration text on or off',
  captionsOff: 'Text off',
  captionsOn: 'Text on',
  captionsTitle: 'Narration text',
  backToOverview: 'Step back to see both',
  childEyesView: 'Eyes',
  childRearView: 'Behind',
  childView: "Child's view",
  close: 'Back to exhibit',
  controls: {
    closer: 'Move closer',
    farther: 'Move farther away',
    orbitLeft: 'Circle left around the animal',
    orbitRight: 'Circle right around the animal',
    overviewHint: 'Wheel or pinch to zoom',
    overviewTitle: 'Frame both',
    povHint: 'Arrow keys / WASD to circle and move · release to stop',
    povTitle: 'Viewing distance',
  },
  loading: (animal: string) => `Getting ready to meet ${animal}…`,
  loadingDelayed: (animal: string) => `Inviting ${animal} into the scene. This may take a moment.`,
  narrationHint: 'Guides the child as the viewpoint changes',
  narrationLabel: 'Guide narration',
  overview: 'Full-body comparison',
  playbackLabel: 'Open sound and text settings',
  playbackShortLabel: 'Sound & text',
  playbackTitle: 'Sound & text',
  retry: 'Try again',
  setup: {
    approachClose: 'Move in close',
    approachCloseDescription: 'Move closer or pose from behind',
    approachComfortable: 'Leave more room',
    approachComfortableDescription: 'Keep a roomy viewing distance',
    approachHelp: 'Close viewing stops just beyond the animal’s body with a little room to spare. From behind, the child can also move in for a keepsake pose.',
    boy: 'Boy',
    boyDescription: 'Use the boy 3D character',
    confirm: 'Start comparing',
    fieldApproach: 'How close would you like to get?',
    fieldGender: 'Is your child a boy or a girl?',
    fieldHeight: 'About how tall is your child?',
    girl: 'Girl',
    girlDescription: 'Use the girl 3D character',
    heightHelp: 'It does not need to be exact. Choose the closest number.',
    subtitle: 'Height sets the viewpoint and scale. The child wears the same functional scene gear, and each animal meeting remains an imaginative encounter.',
    title: 'Set up your young explorer',
  },
  skip: 'Go there now',
  staticFallback: 'See a still comparison',
  toChildEyes:
    "We’re moving to the child’s eyes now. Look up at the animal, notice how far away it is, and feel just how big it looks from this height.",
  toChildRear:
    "Now we’re moving a little above and behind the child. Both the child and the animal stay fully in view, so you can see yourself while observing the animal ahead.",
  unavailable: 'This device cannot open the 3D encounter just now. You can return to the exhibit and keep exploring.',
  viewFromMyEyes: 'See through my eyes',
  viewSwitcherLabel: 'Viewpoint',
  } as const
}

const en: Readonly<
  Record<ScaleEncounterAnimalId, AuthoredScaleEncounterContent>
> = {
  stegosaurus: {
    animalId: 'stegosaurus',
    sceneLabel: 'Forest encounter · child eye level',
    transitionDurationMs: 7_918,
    copy: {
      title: 'Compare with Stegosaurus',
      measurement: 'About 8 m from head to tail',
      intro:
        'Ready, explorer? Let’s walk into a forest clearing and meet a Stegosaurus about eight metres long. How small will you look beside it?',
      transition:
        'Walk slowly. First look at its four low legs, then follow the long body all the way to the tail.',
      arrival:
        'Look! Stegosaurus is much longer than you. Plates run along its back, and four long spikes point out from the end of its tail.',
      ...sharedEnCopy(),
    },
  },
  pachycephalosaurus: {
    animalId: 'pachycephalosaurus',
    sceneLabel: 'Forest encounter · child eye level',
    transitionDurationMs: 7_961,
    copy: {
      title: 'Compare with Pachycephalosaurus',
      measurement: 'About 4 m from head to tail',
      intro:
        'Ready, explorer? Let’s meet a Pachycephalosaurus about four metres long. It is smaller than Tyrannosaurus rex but still much longer than you.',
      transition:
        'Put on your daypack and walk gently into the clearing. Its round, thick skull dome is already coming into view.',
      arrival:
        'Look at that rounded head. Your eyes reach only partway up its body, and its tail stretches far behind it.',
      ...sharedEnCopy(),
    },
  },
  ichthyosaur: {
    animalId: 'ichthyosaur',
    sceneLabel: 'Underwater encounter · child eye level',
    transitionDurationMs: 7_108,
    copy: {
      title: 'Compare with an ichthyosaur',
      measurement: 'About 4 m from nose to tail',
      intro:
        'Ready, explorer? Let’s put on diving gear and meet an ichthyosaur shown at about four metres long. Members of this group varied greatly in size.',
      transition:
        'Mask, tank and fins are ready. Kick gently and watch the streamlined shape swimming toward us.',
      arrival:
        'Look at its long snout, smooth body and four flippers. This representative model is about four metres from nose to tail.',
      ...sharedEnCopy(),
    },
  },
  'tyrannosaurus-rex': {
    animalId: 'tyrannosaurus-rex',
    sceneLabel: 'Shared ground · side-by-side encounter',
    transitionDurationMs: 10_018,
    copy: {
      title: 'Compare with Tyrannosaurus rex',
      measurement: 'About 12 m from nose to tail',
      intro: 'Ready, explorer? Let’s stand beside Tyrannosaurus rex and see just how big it was.',
      transition: 'First, let’s come alongside and see your full height. Now we move a little above and behind you, keeping both you and Tyrannosaurus rex fully in view.',
      arrival: 'Look! Tyrannosaurus rex is right in front of us. Its legs are thick and tall—we have to look up to find its enormous head.',
      ...sharedEnCopy(),
    },
  },
  rhamphorhynchus: {
    animalId: 'rhamphorhynchus',
    sceneLabel: 'Sky encounter · child eye level',
    transitionDurationMs: 7_554,
    copy: {
      title: 'Compare with Rhamphorhynchus',
      measurement: 'About 1.5 m across the wings',
      intro:
        'Ready, explorer? Put on flying gear and meet a Rhamphorhynchus with a wingspan of about one and a half metres.',
      transition:
        'Stretch out and glide forward. Its long tail and the small vane at the tip are already visible ahead.',
      arrival:
        'Look! Its two membrane wings spread wider than the outstretched arms of most young children, while the long tail trails behind.',
      ...sharedEnCopy(),
    },
  },
  triceratops: {
    animalId: 'triceratops',
    sceneLabel: 'Forest encounter · child eye level',
    transitionDurationMs: 7_594,
    copy: {
      title: 'Compare with Triceratops',
      measurement: 'About 8.5 m from head to tail',
      intro:
        'Ready, explorer? Let’s meet a Triceratops more than eight metres long. Even with its head held low, it is as imposing as a large vehicle.',
      transition:
        'Walk quietly and look at its four sturdy legs. Ahead are three horns and the broad frill behind its head.',
      arrival:
        'Look! You stand below the middle of its body. The head is enormous, with a wide frill and two long brow horns pointing forward.',
      ...sharedEnCopy(),
    },
  },
  apatosaurus: {
    animalId: 'apatosaurus',
    sceneLabel: 'Forest encounter · child eye level',
    transitionDurationMs: 7_541,
    copy: {
      title: 'Compare with Apatosaurus',
      measurement: 'About 23 m from head to tail',
      intro:
        'Ready, explorer? This clearing is wide because the Apatosaurus ahead is shown at about twenty-three metres long. We need to step back to see all of it.',
      transition:
        'Stand steady. Start with its four pillar-like legs, then follow the long neck and the even longer tail.',
      arrival:
        'Look how small you are beside one foot. From head to tail, Apatosaurus stretches across almost the whole clearing.',
      ...sharedEnCopy(),
    },
  },
  plesiosaurus: {
    animalId: 'plesiosaurus',
    sceneLabel: 'Underwater encounter · child eye level',
    transitionDurationMs: 8_278,
    copy: {
      title: 'Compare with a plesiosaur',
      measurement: 'About 5 m from head to tail',
      intro:
        'Ready, explorer? Let’s put on diving gear and meet a plesiosaur shown at about five metres long. Animals in this group came in many sizes.',
      transition:
        'Kick your fins gently and keep some distance. A long neck is approaching while four flippers sweep through the water.',
      arrival:
        'Look! Its body is shaped like a broad boat, with a long neck reaching ahead. This representative model is about five metres long.',
      ...sharedEnCopy(),
    },
  },
  gigantoraptor: {
    animalId: 'gigantoraptor',
    sceneLabel: 'Forest encounter · child eye level',
    transitionDurationMs: 7_307,
    copy: {
      title: 'Compare with Gigantoraptor',
      measurement: 'About 8 m from head to tail',
      intro:
        'Ready, explorer? Pack your day bag and enter a Cretaceous forest in search of Gigantoraptor. It is eight metres from beak to tail, far bigger than you might expect.',
      transition:
        'Walk forward slowly. Start with the long legs, then look up toward the body, neck and small head.',
      arrival:
        'Look! Gigantoraptor towers over a young child. Its body and tail stretch into a silhouette about eight metres long.',
      ...sharedEnCopy(),
    },
  },
  tupandactylus: {
    animalId: 'tupandactylus',
    sceneLabel: 'Sky encounter · child eye level',
    transitionDurationMs: 6_904,
    copy: {
      title: 'Compare with Tupandactylus',
      measurement: 'About 2.7 m across the wings',
      intro:
        'Ready, explorer? Put on flying gear and meet a Tupandactylus with a wingspan of about 2.7 metres and a remarkable tall crest.',
      transition:
        'Stretch out and glide forward. Its wings and towering head crest are appearing together in the sky.',
      arrival:
        'Look! Its wings spread much wider than a young child’s arms, and the huge crest makes the whole outline look taller.',
      ...sharedEnCopy(),
    },
  },
  pteranodon: {
    animalId: 'pteranodon',
    sceneLabel: 'Wingspan from above · then eye level',
    transitionDurationMs: 9_101,
    copy: {
      title: 'Compare with Pteranodon',
      measurement: 'About 7 m across the wings',
      intro: 'Ready, explorer? In our imagination, let’s put on flying gear and fly beside Pteranodon to see how wide its wings were.',
      transition: 'First, let’s see your wingsuit from behind and above. Pteranodon is ahead—ready? Now we gently arrive at your eyes.',
      arrival: 'Look straight ahead! Pteranodon is right in front of us, flying at our height. Its two great wings stretch far out to either side!',
      ...sharedEnCopy(),
    },
  },
  mosasaurus: {
    animalId: 'mosasaurus',
    sceneLabel: 'Underwater layers · looking diagonally up',
    transitionDurationMs: 10_370,
    copy: {
      title: 'Compare with Mosasaurus',
      measurement: 'About 12 m from nose to tail',
      intro: 'Ready, explorer? In our imagination, let’s put on diving gear and find out how big Mosasaurus was.',
      transition: 'First, we swim to your right and see the diving suit and big fins. Then we move behind you—ready? Now we arrive at your eyes.',
      arrival: 'Look! Mosasaurus is gliding past above us. Sunlight shines through the surface, and we can see its belly, four big flippers and long tail.',
      ...sharedEnCopy(),
    },
  },
  mammoth: {
    animalId: 'mammoth',
    sceneLabel: 'Cold grassland · shared-ground side view',
    transitionDurationMs: 8_697,
    copy: {
      title: 'Compare with a woolly mammoth',
      measurement: 'Shoulders about 3–3.5 m above the ground',
      intro:
        'Stand beside the woolly mammoth and compare your heights. Its shoulders are over three metres high. How far up one leg could you reach?',
      transition:
        'Look at your thick puffer jacket, trousers and trainers. You’re ready for an icy adventure. Now let’s go and meet the mammoth.',
      arrival:
        'Standing in front of the mammoth, you have to look up to see its high shoulders. Four pillar-like legs hold up its enormous body.',
      ...sharedEnCopy(),
    },
  },
  megalodon: {
    animalId: 'megalodon',
    sceneLabel: 'Underwater encounter · child eye level',
    transitionDurationMs: 7_591,
    copy: {
      title: 'Compare with Megalodon',
      measurement: 'About 16 m from nose to tail',
      intro:
        'Ready, explorer? Put on your diving gear and descend into an ancient sea in search of Megalodon. It is sixteen metres long and is already swimming toward us through the blue water. Can you spot its great dorsal fin?',
      transition:
        'Mask, tank and fins are ready. We stay safely back and watch. A dorsal fin cuts through the water as Megalodon swims closer.',
      arrival:
        'Look, it is swimming past us! We can see its broad head, tall dorsal fin and powerful tail. Sixteen metres is longer than a large bus.',
      ...sharedEnCopy(),
    },
  },
  maiasaura: {
    animalId: 'maiasaura',
    sceneLabel: 'Forest encounter · child eye level',
    transitionDurationMs: 7_382,
    copy: {
      title: 'Compare with Maiasaura',
      measurement: 'About 8 m from head to tail',
      intro:
        'Ready, explorer? Let’s meet a Maiasaura about eight metres long. Its body is long, deep and powerfully built.',
      transition:
        'Put on your daypack and walk closer. Start with the limbs on the ground, then follow the back to the long tail.',
      arrival:
        'Look how little space you take up beside Maiasaura. Its body is as long as a large vehicle, with a broad, flat beak at the front.',
      ...sharedEnCopy(),
    },
  },
  sauropelta: {
    animalId: 'sauropelta',
    sceneLabel: 'Forest encounter · child eye level',
    transitionDurationMs: 9_717,
    copy: {
      title: 'Compare with Sauropelta',
      measurement: 'About 5.5 m from head to tail',
      intro:
        'Ready, explorer? Let’s meet a Sauropelta more than five metres long. Its body is low, broad and covered in armour.',
      transition:
        'Walk quietly along its side. Spikes rise from the neck and shoulders, with rows of bony armour across the back.',
      arrival:
        'Look! Your eyes are close to the side of its body. Sauropelta is more than five metres long and protected by a low armoured back.',
      ...sharedEnCopy(),
    },
  },
  meganeura: {
    animalId: 'meganeura',
    sceneLabel: 'Forest encounter · child eye level',
    transitionDurationMs: 7_818,
    copy: {
      title: 'Compare with Meganeura',
      measurement: 'About 70 cm across the wings',
      intro:
        'Ready, explorer? Enter an open patch of ancient forest in search of Meganeura. Its wings stretch seventy centimetres across. Can you spot it between the leaves?',
      transition:
        'Keep your daypack on and stand still. It is flying near eye level, with four wings flashing as they move.',
      arrival:
        'Look! Even with its wings spread, it is shorter than a young child. Seventy centimetres is astonishingly large for an insect.',
      ...sharedEnCopy(),
    },
  },
  dilophosaurus: {
    animalId: 'dilophosaurus',
    sceneLabel: 'Forest encounter · child eye level',
    transitionDurationMs: 7_947,
    copy: {
      title: 'Compare with Dilophosaurus',
      measurement: 'About 6.5 m from head to tail',
      intro:
        'Ready, explorer? Pack your day bag and enter a Jurassic forest in search of Dilophosaurus. It is six and a half metres from nose to tail, with two special crests on its head.',
      transition:
        'Walk forward slowly. Start with its two standing legs, then look up for the pair of crests side by side.',
      arrival:
        'Look! Dilophosaurus stands much taller than a young child, with a long tail behind and two thin, fan-like crests on its head.',
      ...sharedEnCopy(),
    },
  },
  spinosaurus: {
    animalId: 'spinosaurus',
    sceneLabel: 'Forest encounter · child eye level',
    transitionDurationMs: 10_661,
    copy: {
      title: 'Compare with Spinosaurus',
      measurement: 'About 14.5 m from nose to tail',
      intro:
        'Ready, explorer? Pack your day bag and enter a Cretaceous forest in search of a Spinosaurus more than fourteen metres long. Will its tall sail appear from behind the trees first?',
      transition:
        'Walk slowly through the forest clearing. Look! Its long snout, relatively short hind legs, and sail-like back are appearing.',
      arrival:
        'It has reached the other side! Fourteen and a half metres is about as long as three small cars. Which did you spot first, the long snout or the tall sail?',
      ...sharedEnCopy(),
    },
  },
  lystrosaurus: {
    animalId: 'lystrosaurus',
    sceneLabel: 'Woodland encounter · child eye level',
    transitionDurationMs: 7_885,
    copy: {
      title: 'Compare with Lystrosaurus',
      measurement: 'About 1.5 m from head to tail',
      intro:
        'Ready, explorer? Let’s visit a floodplain from the end of the Permian and start of the Triassic in search of a Lystrosaurus about one and a half metres long. Will you spot its two little tusks first?',
      transition:
        'Step softly along the dry mud. Look! Its short face, beak-like mouth, and four sturdy legs are appearing.',
      arrival:
        'It has reached the other side! One and a half metres is about as tall as a grown-up. Its relatives survived Earth’s biggest mass extinction. Can you find its beak and two tusks?',
      ...sharedEnCopy(),
    },
  },
  baryonyx: {
    animalId: 'baryonyx',
    sceneLabel: 'Forest encounter · child eye level',
    transitionDurationMs: 9_833,
    copy: {
      title: 'Compare with Baryonyx',
      measurement: 'About 8.75 m from nose to tail',
      intro:
        'Ready, explorer? Let’s enter a Cretaceous forest in search of Baryonyx, nearly nine metres long. Where might its enormous hand claw be hiding?',
      transition:
        'Walk slowly along the forest path. Find the long snout, then look at its two hands. There is Baryonyx’s great claw!',
      arrival:
        'It has reached the other side! At nearly nine metres from nose to tail, it is about as long as two small cars. Its long snout and giant claw are both unusual. How might each one have helped Baryonyx find food?',
      ...sharedEnCopy(),
    },
  },
  archaeopteryx: {
    animalId: 'archaeopteryx',
    sceneLabel: 'Forest fallen-log encounter · child eye level',
    transitionDurationMs: 4_400,
    copy: {
      title: 'Compare with Archaeopteryx',
      measurement: 'About 50 cm in total from beak tip to tail tip',
      intro:
        'Ready, explorer? Pack your day bag and enter a Jurassic forest in search of Archaeopteryx. It is about half a metre from beak to tail. Can you spot it standing on a low fallen log?',
      transition:
        'Step quietly through the forest and move closer to the fallen log. Look! Archaeopteryx is standing on top, and we can see its feathers, tiny wing claws, and long tail.',
      arrival:
        'We have reached the fallen log! Archaeopteryx is about half a metre from beak to tail. Look at its feathers, tiny wing claws, and long tail. What did you spot first?',
      ...sharedEnCopy(),
    },
  },
  carnotaurus: {
    animalId: 'carnotaurus',
    sceneLabel: 'Forest encounter · child eye level',
    transitionDurationMs: 13_870,
    copy: {
      title: 'Compare with Carnotaurus',
      measurement: 'About 8 m from nose to tail',
      intro:
        'Ready, explorer? Pack your day bag and enter a Cretaceous forest in search of an eight-metre Carnotaurus. Will you notice its short face or its surprisingly tiny arms first?',
      transition:
        'Step softly. Find the two huge feet planted on the ground, then follow the powerful legs upward. There are its short face, small horns above the eyes, and tiny arms.',
      arrival:
        'Wow! From nose to tail it is about as long as two small cars parked end to end. Such a big body with such tiny arms is a funny contrast. Which part would you inspect first?',
      ...sharedEnCopy(),
    },
  },
  anomalocaris: {
    animalId: 'anomalocaris',
    sceneLabel: 'Underwater encounter · child eye level',
    transitionDurationMs: 11_415,
    copy: {
      title: 'Compare with Anomalocaris',
      measurement: 'About 60 cm from head to tail',
      intro:
        'Ready, explorer? Put on your diving gear and descend into a Cambrian sea more than five hundred million years ago. We are looking for an Anomalocaris about sixty centimetres long. How will it ripple the swimming flaps along its sides to glide forward?',
      transition:
        'Kick your fins gently and stay in our safe spot. Look! The swimming flaps ripple one after another, while two spiny grasping limbs reach forward.',
      arrival:
        'It is swimming right across from us! At about sixty centimetres from head to tail, Anomalocaris was a striking animal in the Cambrian sea. Can you find its round mouth underneath?',
      ...sharedEnCopy(),
    },
  },
}

export function scaleEncounterContentFor(
  animalId: ScaleEncounterAnimalId,
  locale: Locale,
): ScaleEncounterContent {
  const localized = locale === 'zh-CN' ? zhCN[animalId] : en[animalId]
  const sceneLabel = localized.sceneLabel
    .replace(' · 小朋友眼睛视角', '')
    .replace(' · child eye level', '')

  if (!isNarratedScaleEncounterAnimal(animalId)) {
    return {
      ...localized,
      sceneLabel,
      narrationAvailable: false,
      audio: {
        intro: '',
        transition: '',
        arrival: '',
        ...viewSwitchAudioUrls[locale],
      },
    }
  }

  const guidedFiles = audioFiles[animalId][locale]
  const guidedScripts = narrationScripts[locale][animalId]
  return {
    ...localized,
    sceneLabel,
    narrationAvailable: true,
    transitionDurationMs: transitionDurations[locale][animalId],
    copy: {
      ...localized.copy,
      ...guidedScripts,
    },
    audio: {
      intro: guidedAudioUrl(animalId, guidedFiles.intro),
      transition: guidedAudioUrl(animalId, guidedFiles.transition),
      arrival: guidedAudioUrl(animalId, guidedFiles.arrival),
      ...viewSwitchAudioUrls[locale],
    },
  }
}
