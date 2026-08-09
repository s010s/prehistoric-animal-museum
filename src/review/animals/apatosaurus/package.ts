import type { CompleteDraftAnimalPackage } from '../../types'
import { reviewAssetUrl } from '../../assets'
import { zhCN } from './content.zh-CN'

export const animal = {
  id: 'apatosaurus',
  status: 'published',
  kind: 'dinosaur',
  habitat: 'land',
  atmosphere: 'plains',
  content: {
    'zh-CN': zhCN,
  },
  presentation: {
    cameraLightScale: 1.05,
    initialYawDegrees: 0,
    landscapeHorizontalOffset: 0.01,
    landscapeVerticalOffset: 0.035,
    portraitVerticalOffset: 0.05,
    safeAreaPadding: 0.12,
    shadow: 'ground',
    shadowDepthScale: 0.9,
    shadowHorizontalOffset: -0.61,
    shadowOpacity: 0.56,
    shadowScale: 0.38,
    shadowYOffset: 0.11,
    toneMappingExposure: 1.28,
  },
  animation: {
    clip: 'Idle',
    loop: 'repeat',
    speed: 0.9,
  },
  narration: {
    status: 'ready',
    sourcePath: 'audio/narration.zh-CN.mp3',
    mimeType: 'audio/mpeg',
  },
  provenance: [],
  assets: {
    model: reviewAssetUrl('apatosaurus', 'model.glb'),
    modelBytes: 6_222_396,
    poster: reviewAssetUrl('apatosaurus', 'poster.webp'),
    posterPortrait: reviewAssetUrl('apatosaurus', 'poster-portrait.webp'),
    thumbnail: reviewAssetUrl('apatosaurus', 'thumbnail.webp'),
    backgrounds: {
      landscape: reviewAssetUrl('apatosaurus', 'background-landscape'),
      portrait: reviewAssetUrl('apatosaurus', 'background-portrait'),
    },
    narration: {
      status: 'ready',
      sourcePath: 'audio/narration.zh-CN.mp3',
      mimeType: 'audio/mpeg',
      url: reviewAssetUrl('apatosaurus', 'narration.mp3'),
    },
  },
  review: {
    badge: '已验收',
    status: '新迷惑龙模型、Idle 与静态图已晋升生产',
    note:
      '负责人已选定新的迷惑龙派生模型，并要求恢复候选的原始颜色与原有展台亮度；模型保留新的真实法线微表面和 8 秒原地 Idle。四脚与下肢固定，缩放中心、接地、闭环、接缝分离和新增穿模均已通过专项检查。2026-08-04 负责人完成模型与小图验收；2026-08-05 负责人确认来源权利后，生产目录已安装经压缩的替换模型、缩略图和六套响应式静态预览。',
    checks: [
      '确认浏览器场景中的完整轮廓、初始缩放中心和滚轮或双指缩放行为。',
      '观看完整 8 秒 Idle，确认四脚固定、身体连接连续，尾部与颈部动作自然。',
      '确认原始配色已经恢复，皮肤皱褶和微表面在原有展台亮度下自然，不出现规则条纹或塑料感。',
      '确认保持张嘴但不做嘴部动画可以接受。',
    ],
    accent: {
      strong: '#477b76',
      soft: '#d2e5df',
    },
    modelCredit: {
      attribution:
        '“Apatosaurus” by toro ardido modelos 3d, CC BY 4.0; locally rebuilt with welded duplicate vertices, project-authored PBR skin maps, canonical transforms, and an eight-second morph-target Idle.',
      licenseName: 'Creative Commons Attribution 4.0 International',
      licenseUrl:
        'https://creativecommons.org/licenses/by/4.0/',
      sourceTitle: 'Apatosaurus',
      sourceUrl:
        'https://sketchfab.com/3d-models/apatosaurus-fecabec8e4ef42ef98b5480dbf50c57d',
    },
  },
  draftNotes: [
    '本包保留在 npm run review 中，用于复核已晋升的生产模型与本地源证据。',
    '新模型、材质源、Blender 工作文件和离线检查图保留在忽略的本地候选区；生产仓库只跟踪经审核和压缩的运行时派生物与署名记录。',
    '生产版本使用相同的验收模型、构图契约和响应式静态预览，不再保留旧迷惑龙模型。',
  ],
} satisfies CompleteDraftAnimalPackage
