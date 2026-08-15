import type { Locale } from '../i18n/locale'
import type { ScaleEncounterAnimalId } from './types'

export type { ChildProfile, ScaleEncounterAnimalId } from './types'
export { isScaleEncounterAnimal } from './types'

export type GuidedLineKind = 'intro' | 'transition' | 'arrival'

export interface ScaleEncounterCopy {
  readonly arrival: string
  readonly audioLabel: string
  readonly audioOff: string
  readonly audioOn: string
  readonly backToOverview: string
  readonly childView: string
  readonly close: string
  readonly controls: {
    readonly closer: string
    readonly farther: string
    readonly overviewHint: string
    readonly overviewTitle: string
    readonly povHint: string
    readonly povTitle: string
  }
  readonly intro: string
  readonly loading: (animal: string) => string
  readonly loadingDelayed: (animal: string) => string
  readonly measurement: string
  readonly overview: string
  readonly retry: string
  readonly setup: {
    readonly boy: string
    readonly boyDescription: string
    readonly confirm: string
    readonly fieldGender: string
    readonly fieldHeight: string
    readonly girl: string
    readonly girlDescription: string
    readonly heightHelp: string
    readonly privacy: string
    readonly step: string
    readonly subtitle: string
    readonly title: string
  }
  readonly skip: string
  readonly staticFallback: string
  readonly title: string
  readonly transition: string
  readonly unavailable: string
  readonly viewFromMyEyes: string
}

export interface ScaleEncounterContent {
  readonly animalId: ScaleEncounterAnimalId
  readonly audio: Readonly<Record<GuidedLineKind, string>>
  readonly copy: ScaleEncounterCopy
  readonly sceneLabel: string
  /** Rounded ffprobe duration of this locale's transition MP3. */
  readonly transitionDurationMs: number
}

const audioUrls = {
  'tyrannosaurus-rex': {
    'zh-CN': {
      intro: new URL(
        './audio/tyrannosaurus-rex-intro.zh-CN.mp3',
        import.meta.url,
      ).href,
      transition: new URL(
        './audio/tyrannosaurus-rex-transition.zh-CN.mp3',
        import.meta.url,
      ).href,
      arrival: new URL(
        './audio/tyrannosaurus-rex-arrival.zh-CN.mp3',
        import.meta.url,
      ).href,
    },
    en: {
      intro: new URL(
        './audio/tyrannosaurus-rex-intro.en.mp3',
        import.meta.url,
      ).href,
      transition: new URL(
        './audio/tyrannosaurus-rex-transition.en.mp3',
        import.meta.url,
      ).href,
      arrival: new URL(
        './audio/tyrannosaurus-rex-arrival.en.mp3',
        import.meta.url,
      ).href,
    },
  },
  pteranodon: {
    'zh-CN': {
      intro: new URL('./audio/pteranodon-intro.zh-CN.mp3', import.meta.url)
        .href,
      transition: new URL(
        './audio/pteranodon-transition.zh-CN.mp3',
        import.meta.url,
      ).href,
      arrival: new URL(
        './audio/pteranodon-arrival.zh-CN.mp3',
        import.meta.url,
      ).href,
    },
    en: {
      intro: new URL('./audio/pteranodon-intro.en.mp3', import.meta.url).href,
      transition: new URL(
        './audio/pteranodon-transition.en.mp3',
        import.meta.url,
      ).href,
      arrival: new URL('./audio/pteranodon-arrival.en.mp3', import.meta.url)
        .href,
    },
  },
  mosasaurus: {
    'zh-CN': {
      intro: new URL('./audio/mosasaurus-intro.zh-CN.mp3', import.meta.url)
        .href,
      transition: new URL(
        './audio/mosasaurus-transition.zh-CN.mp3',
        import.meta.url,
      ).href,
      arrival: new URL(
        './audio/mosasaurus-arrival.zh-CN.mp3',
        import.meta.url,
      ).href,
    },
    en: {
      intro: new URL('./audio/mosasaurus-intro.en.mp3', import.meta.url).href,
      transition: new URL(
        './audio/mosasaurus-transition.en.mp3',
        import.meta.url,
      ).href,
      arrival: new URL('./audio/mosasaurus-arrival.en.mp3', import.meta.url)
        .href,
    },
  },
  mammoth: {
    'zh-CN': {
      intro: new URL('./audio/mammoth-intro.zh-CN.mp3', import.meta.url).href,
      transition: new URL(
        './audio/mammoth-transition.zh-CN.mp3',
        import.meta.url,
      ).href,
      arrival: new URL('./audio/mammoth-arrival.zh-CN.mp3', import.meta.url)
        .href,
    },
    en: {
      intro: new URL('./audio/mammoth-intro.en.mp3', import.meta.url).href,
      transition: new URL(
        './audio/mammoth-transition.en.mp3',
        import.meta.url,
      ).href,
      arrival: new URL('./audio/mammoth-arrival.en.mp3', import.meta.url)
        .href,
    },
  },
} as const

const zhCN: Readonly<Record<ScaleEncounterAnimalId, Omit<ScaleEncounterContent, 'audio'>>> = {
  'tyrannosaurus-rex': {
    animalId: 'tyrannosaurus-rex',
    sceneLabel: '共同地面 · 侧面相遇',
    transitionDurationMs: 8_204,
    copy: {
      title: '和霸王龙比一比',
      measurement: '约 12 米体长 · 等比例相遇',
      intro: '小朋友，准备好了吗？我们去和霸王龙比一比，看看它到底有多大。',
      transition:
        '先来到你身边，看看今天的探险装。现在绕到你身后，跟着你的目光，再轻轻来到你的眼睛这里。',
      arrival:
        '看，霸王龙就在前面。它的腿又粗又高，我们要把眼睛抬起来，才能看到它的大脑袋。',
      ...sharedZhCNCopy(),
    },
  },
  pteranodon: {
    animalId: 'pteranodon',
    sceneLabel: '俯视翼展 · 随后平视',
    transitionDurationMs: 9_638,
    copy: {
      title: '和无齿翼龙比一比',
      measurement: '约 7 米翼展 · 等比例相遇',
      intro:
        '小朋友，准备好了吗？我们在想象里穿上飞行装备，去和无齿翼龙一起飞，看看它的翅膀有多宽。',
      transition:
        '先从后上方看看你的翼装，像一只小飞鸟。无齿翼龙就在前面，准备好，我们来到你的眼睛这里啦。',
      arrival:
        '看，无齿翼龙就在正前方，和我们飞得一样高。它的两只大翅膀一左一右，展开得真宽！',
      ...sharedZhCNCopy(),
    },
  },
  mosasaurus: {
    animalId: 'mosasaurus',
    sceneLabel: '水下错层 · 斜向上观察',
    transitionDurationMs: 8_918,
    copy: {
      title: '和沧龙比一比',
      measurement: '约 12 米体长 · 等比例相遇',
      intro:
        '小朋友，准备好了吗？我们在想象里换上潜水装备，一起去看看沧龙吧。它到底有多大呢？',
      transition:
        '先游到你右边，看看潜水服和大脚蹼。再来到你身后，准备好，我们来到你的眼睛这里啦。',
      arrival:
        '看，沧龙正在斜上方慢慢游过去。阳光从水面照下来，我们能看见它的肚子、四只大鳍，还有长长的尾巴。',
      ...sharedZhCNCopy(),
    },
  },
  mammoth: {
    animalId: 'mammoth',
    sceneLabel: '寒冷草原 · 共同地面侧视',
    transitionDurationMs: 10_466,
    copy: {
      title: '和长毛猛犸象比一比',
      measurement: '成年个体肩高约 3–3.5 米 · 比例示意',
      intro:
        '小朋友，穿好暖暖的羽绒服，我们去寒冷的草原上和长毛猛犸象比一比，看看它的肩膀有多高。',
      transition:
        '先来到你身边，看看羽绒服和围巾。现在绕到你身后，长毛猛犸象就在前面，我们再轻轻来到你的眼睛这里。',
      arrival:
        '看，长毛猛犸象站在前面。它光是肩膀就比我们高好多，厚厚的长毛下面还有四条像柱子一样的腿。',
      ...sharedZhCNCopy(),
    },
  },
}

function sharedZhCNCopy() {
  return {
  audioLabel: '开关讲解员姐姐的声音',
  audioOff: '声音关',
  audioOn: '声音开',
  backToOverview: '退后看全身',
  childView: '小朋友视角',
  close: '返回展台',
  controls: {
    closer: '靠近一点',
    farther: '退后一点',
    overviewHint: '滚轮、双指或点按 · 长按按钮连续缩放',
    overviewTitle: '缩放全景',
    povHint: '点按平滑移动 · 长按按钮连续前后移动',
    povTitle: '观察距离',
  },
  loading: (animal: string) => `正在准备和${animal}见面…`,
  loadingDelayed: (animal: string) => `正在请${animal}来到场景里，请稍等一下。`,
  overview: '全身比较',
  retry: '再试一次',
  setup: {
    boy: '男孩',
    boyDescription: '使用男孩 3D 模型',
    confirm: '进入比一比',
    fieldGender: '小朋友是男孩还是女孩？',
    fieldHeight: '小朋友大约有多高？',
    girl: '女孩',
    girlDescription: '使用女孩 3D 模型',
    heightHelp: '不用量得很精确，选一个最接近的数字就好。',
    privacy: '这两项只留在当前页面，不会写入网址、账号或分析数据。',
    step: '第一次进入，只设置这两项',
    subtitle: '身高用来还原视角和比例，其他外观、动作和装备会由场景准备好。',
    title: '先认识一下你家的小朋友',
  },
  skip: '直接进入',
  staticFallback: '先看静态比一比',
  unavailable: '这个设备暂时不能打开 3D 相遇。你可以返回展台，继续看动物模型。',
  viewFromMyEyes: '从我的眼睛看',
  } as const
}

function sharedEnCopy() {
  return {
  audioLabel: 'Turn the guide voice on or off',
  audioOff: 'Sound off',
  audioOn: 'Sound on',
  backToOverview: 'Step back to see both',
  childView: "Child's view",
  close: 'Back to exhibit',
  controls: {
    closer: 'Move closer',
    farther: 'Move farther away',
    overviewHint: 'Wheel, pinch or tap · hold a button for continuous zoom',
    overviewTitle: 'Frame both',
    povHint: 'Tap for a smooth step · hold for continuous movement',
    povTitle: 'Viewing distance',
  },
  loading: (animal: string) => `Getting ready to meet ${animal}…`,
  loadingDelayed: (animal: string) => `Inviting ${animal} into the scene. This may take a moment.`,
  overview: 'Full-body comparison',
  retry: 'Try again',
  setup: {
    boy: 'Boy',
    boyDescription: 'Use the boy 3D character',
    confirm: 'Start comparing',
    fieldGender: 'Is your child a boy or a girl?',
    fieldHeight: 'About how tall is your child?',
    girl: 'Girl',
    girlDescription: 'Use the girl 3D character',
    heightHelp: 'It does not need to be exact. Choose the closest number.',
    privacy: 'These two choices stay on this page. They are not added to a URL, account or analytics.',
    step: 'First visit · just two choices',
    subtitle: 'Height sets the viewpoint and scale. The scene chooses the outfit and movement.',
    title: 'Tell us about your young explorer',
  },
  skip: 'Go there now',
  staticFallback: 'See a still comparison',
  unavailable: 'This device cannot open the 3D encounter just now. You can return to the exhibit and keep exploring.',
  viewFromMyEyes: 'See through my eyes',
  } as const
}

const en: Readonly<Record<ScaleEncounterAnimalId, Omit<ScaleEncounterContent, 'audio'>>> = {
  'tyrannosaurus-rex': {
    animalId: 'tyrannosaurus-rex',
    sceneLabel: 'Shared ground · side-by-side encounter',
    transitionDurationMs: 10_018,
    copy: {
      title: 'Compare with Tyrannosaurus rex',
      measurement: 'About 12 m long · same-scale encounter',
      intro: 'Ready, explorer? Let’s stand beside Tyrannosaurus rex and see just how big it was.',
      transition: 'First, let’s come alongside and see today’s explorer outfit. Now we move behind you, follow your gaze, and gently arrive at your eyes.',
      arrival: 'Look! Tyrannosaurus rex is right in front of us. Its legs are thick and tall—we have to look up to find its enormous head.',
      ...sharedEnCopy(),
    },
  },
  pteranodon: {
    animalId: 'pteranodon',
    sceneLabel: 'Wingspan from above · then eye level',
    transitionDurationMs: 9_101,
    copy: {
      title: 'Compare with Pteranodon',
      measurement: 'About 7 m across · same-scale encounter',
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
      measurement: 'About 12 m long · same-scale encounter',
      intro: 'Ready, explorer? In our imagination, let’s put on diving gear and find out how big Mosasaurus was.',
      transition: 'First, we swim to your right and see the diving suit and big fins. Then we move behind you—ready? Now we arrive at your eyes.',
      arrival: 'Look! Mosasaurus is gliding past above us. Sunlight shines through the surface, and we can see its belly, four big flippers and long tail.',
      ...sharedEnCopy(),
    },
  },
  mammoth: {
    animalId: 'mammoth',
    sceneLabel: 'Cold grassland · shared-ground side view',
    transitionDurationMs: 11_062,
    copy: {
      title: 'Compare with a woolly mammoth',
      measurement: 'Adult shoulder height about 3–3.5 m · scale illustration',
      intro:
        'Ready, explorer? Pull on a warm coat and come to the cold grassland to see how high a woolly mammoth’s shoulders could reach.',
      transition:
        'First, see your warm coat and scarf. Now we move behind you. The woolly mammoth is ahead, and we gently arrive at your eyes.',
      arrival:
        'Look! The woolly mammoth is standing ahead. Even its shoulders rise far above us, with four pillar-like legs beneath its thick coat.',
      ...sharedEnCopy(),
    },
  },
}

export function scaleEncounterContentFor(
  animalId: ScaleEncounterAnimalId,
  locale: Locale,
): ScaleEncounterContent {
  const localized = locale === 'zh-CN' ? zhCN[animalId] : en[animalId]
  return {
    ...localized,
    audio: audioUrls[animalId][locale],
  }
}
