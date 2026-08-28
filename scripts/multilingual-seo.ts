import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import sharp from 'sharp'
import type { Plugin } from 'vite'

import { animalSeoDescription } from '../src/content/animal-seo'
import { animalDefinition as apatosaurusDefinition } from '../src/content/animals/apatosaurus/package'
import { animalDefinition as dilophosaurusDefinition } from '../src/content/animals/dilophosaurus/package'
import { animalDefinition as gigantoraptorDefinition } from '../src/content/animals/gigantoraptor/package'
import { animalDefinition as ichthyosaurDefinition } from '../src/content/animals/ichthyosaur/package'
import { animalDefinition as maiasauraDefinition } from '../src/content/animals/maiasaura/package'
import { animalDefinition as mammothDefinition } from '../src/content/animals/mammoth/package'
import { animalDefinition as megalodonDefinition } from '../src/content/animals/megalodon/package'
import { animalDefinition as meganeuraDefinition } from '../src/content/animals/meganeura/package'
import { animalDefinition as mosasaurusDefinition } from '../src/content/animals/mosasaurus/package'
import { animalDefinition as pachycephalosaurusDefinition } from '../src/content/animals/pachycephalosaurus/package'
import { animalDefinition as plesiosaurusDefinition } from '../src/content/animals/plesiosaurus/package'
import { animalDefinition as pteranodonDefinition } from '../src/content/animals/pteranodon/package'
import { animalDefinition as rhamphorhynchusDefinition } from '../src/content/animals/rhamphorhynchus/package'
import { animalDefinition as sauropeltaDefinition } from '../src/content/animals/sauropelta/package'
import { animalDefinition as stegosaurusDefinition } from '../src/content/animals/stegosaurus/package'
import { animalDefinition as triceratopsDefinition } from '../src/content/animals/triceratops/package'
import { animalDefinition as tupandactylusDefinition } from '../src/content/animals/tupandactylus/package'
import { animalDefinition as tyrannosaurusRexDefinition } from '../src/content/animals/tyrannosaurus-rex/package'
import { mainCollection } from '../src/content/collections/main'
import { staticAnimalDetailIds } from '../src/content/static-animal-details'
import type {
  AnimalContent,
  Habitat,
  Locale,
  PublishedAnimalDefinition,
} from '../src/content/types'

export type SeoPageLocale = 'x-default' | 'zh-CN' | 'en'

export interface SeoSocialCardManifest {
  readonly version: 1
  readonly width: 1200
  readonly height: 630
  readonly cards: Readonly<
    Record<
      SeoPageLocale,
      {
        readonly fileName: string
        readonly sourceSha256: string
      }
    >
  >
}

export interface MultilingualSeoOptions {
  readonly siteOrigin?: string
  readonly museumPath?: string
  readonly notFoundReturnPath?: string
}

interface ResolvedSeoOptions {
  readonly siteOrigin: string
  readonly museumPath: string
  readonly notFoundReturnPath: string
}

interface CatalogueEntry {
  readonly id: string
  readonly habitat: Habitat
  readonly zhCN: string
  readonly en: string
}

interface CatalogueGroup {
  readonly habitat: Habitat
  readonly zhCN: string
  readonly en: string
  readonly animals: readonly CatalogueEntry[]
}

interface SeoPageCopy {
  readonly locale: SeoPageLocale
  readonly htmlLang: 'zh-CN' | 'en'
  readonly brand: string
  readonly title: string
  readonly description: string
  readonly heading: string
  readonly introduction: string
  readonly privacy: string
  readonly catalogueHeading: string
  readonly languageLabel: string
  readonly systemLanguageLabel: string
  readonly socialImageFileName: string
  readonly socialImageAlt: string
}

const defaultOptions = {
  siteOrigin: 'https://leon-made-this.work',
  museumPath: '/museum/',
  notFoundReturnPath: '/prehistoric-animal-museum/',
} satisfies Required<MultilingualSeoOptions>

const canonicalAnimalDefinitions = [
  apatosaurusDefinition,
  dilophosaurusDefinition,
  gigantoraptorDefinition,
  ichthyosaurDefinition,
  maiasauraDefinition,
  mammothDefinition,
  megalodonDefinition,
  meganeuraDefinition,
  mosasaurusDefinition,
  pachycephalosaurusDefinition,
  plesiosaurusDefinition,
  pteranodonDefinition,
  rhamphorhynchusDefinition,
  sauropeltaDefinition,
  stegosaurusDefinition,
  triceratopsDefinition,
  tupandactylusDefinition,
  tyrannosaurusRexDefinition,
] as const satisfies readonly PublishedAnimalDefinition[]

const canonicalAnimalDefinitionsById = new Map(
  canonicalAnimalDefinitions.map((definition) => [definition.id, definition]),
)

const staticAnimalDetailDefinitions = staticAnimalDetailIds.map((animalId) => {
  const definition = canonicalAnimalDefinitionsById.get(animalId)
  if (!definition) {
    throw new Error(
      `Static animal detail cannot find the canonical content package for “${animalId}”.`,
    )
  }
  return definition
})

function createCatalogueEntries(
  animalIds: readonly string[],
  definitions: readonly PublishedAnimalDefinition[],
): CatalogueEntry[] {
  const definitionsById = new Map<string, PublishedAnimalDefinition>()

  for (const definition of definitions) {
    if (definitionsById.has(definition.id)) {
      throw new Error(`SEO catalogue contains duplicate animal “${definition.id}”.`)
    }
    definitionsById.set(definition.id, definition)
  }

  const seenIds = new Set<string>()
  return animalIds.map((id) => {
    if (seenIds.has(id)) {
      throw new Error(`Main collection contains duplicate animal “${id}”.`)
    }
    seenIds.add(id)

    const definition = definitionsById.get(id)
    if (!definition) {
      throw new Error(
        `SEO catalogue cannot find the canonical content package for “${id}”.`,
      )
    }

    const zhCN = definition.content['zh-CN'].name.trim()
    const en = definition.content.en.name.trim()
    if (!zhCN || !en) {
      throw new Error(`SEO catalogue animal “${id}” must have both public names.`)
    }

    return {
      id,
      habitat: definition.habitat,
      zhCN,
      en,
    }
  })
}

const catalogueGroupCopy = {
  land: {
    zhCN: '陆地展厅',
    en: 'Land gallery',
  },
  air: {
    zhCN: '天空展厅',
    en: 'Sky gallery',
  },
  water: {
    zhCN: '水中展厅',
    en: 'Sea gallery',
  },
} as const satisfies Record<Habitat, Pick<CatalogueGroup, 'zhCN' | 'en'>>

const catalogueHabitatOrder = ['land', 'air', 'water'] as const satisfies
  readonly Habitat[]

const catalogueAnimals = createCatalogueEntries(
  mainCollection.animalIds,
  canonicalAnimalDefinitions,
)

const catalogueGroups: readonly CatalogueGroup[] = catalogueHabitatOrder.map(
  (habitat) => ({
    habitat,
    ...catalogueGroupCopy[habitat],
    animals: catalogueAnimals.filter((animal) => animal.habitat === habitat),
  }),
)

export const seoCatalogueAnimalIds = catalogueAnimals.map(({ id }) => id)

const catalogueAnimalCount = seoCatalogueAnimalIds.length
const staticAnimalIds = new Set<string>(staticAnimalDetailIds)

const pageCopy = {
  'x-default': {
    locale: 'x-default',
    htmlLang: 'en',
    brand: 'Leon Made This | Leon做了个',
    title: 'Prehistoric Animal Museum | 史前动物博物馆',
    description: `Choose Simplified Chinese or English for a family-friendly 3D museum featuring ${catalogueAnimalCount} prehistoric animals. 选择简体中文或 English，和孩子一起探索 ${catalogueAnimalCount} 位史前动物朋友。`,
    heading: 'Prehistoric Animal Museum | 史前动物博物馆',
    introduction:
      'A gentle 3D museum for children aged 2–6 and the grown-ups exploring with them. 一座为 2–6 岁孩子和陪伴探索的家长准备的 3D 史前动物博物馆。',
    privacy: `Explore ${catalogueAnimalCount} prehistoric animals from land, sky and sea. No account, advertising or page analytics are used, and narration never starts by itself. 展厅收录陆地、天空与水中的 ${catalogueAnimalCount} 位史前动物，无需账号，没有广告和页面分析，也不会自动播放声音。`,
    catalogueHeading: 'Museum collection | 博物馆藏品',
    languageLabel: 'Choose a language | 选择语言',
    systemLanguageLabel: 'Follow system | 跟随系统',
    socialImageFileName: 'social/museum.png',
    socialImageAlt:
      'Prehistoric Animal Museum — 史前动物博物馆',
  },
  'zh-CN': {
    locale: 'zh-CN',
    htmlLang: 'zh-CN',
    brand: 'Leon做了个',
    title: '史前动物博物馆 | 给 2–6 岁孩子的免费 3D 恐龙与古生物网站',
    description: `和孩子一起走进 3D 史前动物博物馆，观察 ${catalogueAnimalCount} 位来自陆地、天空与水中的史前朋友。`,
    heading: '史前动物博物馆',
    introduction:
      '这是一座面向 2–6 岁孩子和家长的 3D 史前动物博物馆。一起转动模型，听观察引导，再读给家长的科学资料。',
    privacy: `展厅收录 ${catalogueAnimalCount} 位来自陆地、天空与水中的史前动物。无需账号，没有广告和页面分析，声音只会在你主动点击后播放。`,
    catalogueHeading: '博物馆藏品',
    languageLabel: '选择语言',
    systemLanguageLabel: '跟随系统',
    socialImageFileName: 'social/museum.zh-CN.png',
    socialImageAlt: '史前动物博物馆亲子 3D 展馆',
  },
  en: {
    locale: 'en',
    htmlLang: 'en',
    brand: 'Leon Made This',
    title: 'Prehistoric Animal Museum for Kids | Free Interactive 3D Exhibits',
    description: `Explore ${catalogueAnimalCount} prehistoric animals from land, sky and sea in a gentle 3D museum made for young children and their grown-ups.`,
    heading: 'Prehistoric Animal Museum',
    introduction:
      'A gentle 3D museum for children aged 2–6 and the grown-ups exploring with them. Turn each model, listen to a short observation guide and open the grown-up notes when you want to go deeper.',
    privacy: `Meet ${catalogueAnimalCount} prehistoric animals from land, sky and sea. There are no accounts, adverts or page analytics, and narration only plays when you choose it.`,
    catalogueHeading: 'Museum collection',
    languageLabel: 'Choose a language',
    systemLanguageLabel: 'Follow system',
    socialImageFileName: 'social/museum.en.png',
    socialImageAlt:
      'Prehistoric Animal Museum, a 3D family adventure by Leon Made This',
  },
} as const satisfies Record<SeoPageLocale, SeoPageCopy>

const staticShellStyle = `<style id="seo-static-shell-style">
  .seo-static-shell { box-sizing: border-box; min-height: 100vh; height: 100dvh; overflow: auto; padding: clamp(2rem, 6vw, 5rem); color: #20382f; background: linear-gradient(150deg, #eef4df, #d8e7c2 55%, #c2dddb); font-family: "Nunito Variable", "Avenir Next", system-ui, sans-serif; }
  .seo-static-shell :lang(zh-CN) { font-family: "Noto Sans SC Variable", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; }
  .seo-static-shell__inner { width: min(68rem, 100%); margin: 0 auto; }
  .seo-static-shell h1 { max-width: 18ch; margin: 0 0 1rem; font-size: clamp(2rem, 7vw, 5rem); line-height: .98; text-wrap: balance; }
  .seo-static-shell p { max-width: 70ch; font-size: clamp(1rem, 2.2vw, 1.25rem); line-height: 1.65; }
  .seo-static-shell nav { display: flex; flex-wrap: wrap; gap: .75rem; margin: 1.5rem 0 2.5rem; }
  .seo-static-shell a { display: inline-flex; min-height: 3rem; align-items: center; padding: 0 1.1rem; border: 2px solid currentColor; border-radius: 999px; color: inherit; font-weight: 700; }
  .seo-static-shell__catalogue { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: 1rem; }
  .seo-static-shell__catalogue section { padding: 1rem 1.25rem; border-radius: 1rem; background: rgb(255 255 255 / .55); }
  .seo-static-shell__catalogue h2 { margin-top: 0; font-size: 1.15rem; }
  .seo-static-shell__catalogue ul { margin-bottom: 0; padding-inline-start: 1.25rem; line-height: 1.75; }
</style>`

function resolveOptions(options: MultilingualSeoOptions): ResolvedSeoOptions {
  const rawOrigin = options.siteOrigin ?? defaultOptions.siteOrigin
  const rawMuseumPath = options.museumPath ?? defaultOptions.museumPath
  const rawNotFoundReturnPath =
    options.notFoundReturnPath ?? defaultOptions.notFoundReturnPath
  const siteOrigin = rawOrigin.replace(/\/+$/, '')
  const museumPath = `/${rawMuseumPath.split('/').filter(Boolean).join('/')}/`
  const notFoundReturnPath = `/${rawNotFoundReturnPath
    .split('/')
    .filter(Boolean)
    .join('/')}/`

  if (!/^https:\/\//.test(siteOrigin)) {
    throw new Error('SEO siteOrigin must be an absolute HTTPS origin.')
  }
  if (!rawNotFoundReturnPath.startsWith('/') || rawNotFoundReturnPath.startsWith('//')) {
    throw new Error('SEO notFoundReturnPath must be an absolute path.')
  }

  return { siteOrigin, museumPath, notFoundReturnPath }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function canonicalUrl(
  locale: SeoPageLocale,
  options: ResolvedSeoOptions,
): string {
  const suffix = locale === 'x-default' ? '' : `${locale}/`
  return `${options.siteOrigin}${options.museumPath}${suffix}`
}

function museumStructuredData(
  copy: SeoPageCopy,
  options: ResolvedSeoOptions,
): string {
  const personalSite = `${options.siteOrigin}/`
  const museumUrl = canonicalUrl(copy.locale, options)
  const museumName =
    copy.locale === 'en' ? 'Prehistoric Animal Museum' : '史前动物博物馆'
  const alternateMuseumName =
    copy.locale === 'en' ? '史前动物博物馆' : 'Prehistoric Animal Museum'

  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    '@id': `${museumUrl}#museum`,
    alternateName: alternateMuseumName,
    applicationCategory: 'EducationalApplication',
    brand: {
      '@type': 'Brand',
      '@id': `${personalSite}#leon-made-this`,
      alternateName: 'Leon Made This',
      name: 'Leon做了个',
      url: personalSite,
    },
    copyrightHolder: {
      '@type': 'Person',
      '@id': `${personalSite}#leon`,
      name: 'Leon',
      url: personalSite,
    },
    creator: {
      '@type': 'Person',
      '@id': `${personalSite}#leon`,
      name: 'Leon',
      url: personalSite,
    },
    description: copy.description,
    inLanguage: copy.htmlLang,
    isAccessibleForFree: true,
    isPartOf: {
      '@type': 'WebSite',
      '@id': `${personalSite}#website`,
      name: 'Leon做了个',
      url: personalSite,
    },
    name: museumName,
    operatingSystem: 'Any',
    url: museumUrl,
  }).replaceAll('<', '\\u003c')
}

function renderHead(copy: SeoPageCopy, options: ResolvedSeoOptions): string {
  const canonical = canonicalUrl(copy.locale, options)
  const socialImage = `${options.siteOrigin}${options.museumPath}${copy.socialImageFileName}`
  const ogLocale = copy.locale === 'zh-CN' ? 'zh_CN' : 'en_GB'
  const ogAlternate = copy.locale === 'zh-CN' ? 'en_GB' : 'zh_CN'

  return `<title>${escapeHtml(copy.title)}</title>
    <meta name="description" content="${escapeHtml(copy.description)}" />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <link rel="alternate" hreflang="zh-CN" href="${escapeHtml(canonicalUrl('zh-CN', options))}" />
    <link rel="alternate" hreflang="en" href="${escapeHtml(canonicalUrl('en', options))}" />
    <link rel="alternate" hreflang="x-default" href="${escapeHtml(canonicalUrl('x-default', options))}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${escapeHtml(copy.brand)}" />
    <meta property="og:locale" content="${ogLocale}" />
    <meta property="og:locale:alternate" content="${ogAlternate}" />
    <meta property="og:title" content="${escapeHtml(copy.title)}" />
    <meta property="og:description" content="${escapeHtml(copy.description)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:image" content="${escapeHtml(socialImage)}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${escapeHtml(copy.socialImageAlt)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(copy.title)}" />
    <meta name="twitter:description" content="${escapeHtml(copy.description)}" />
    <meta name="twitter:image" content="${escapeHtml(socialImage)}" />
    <meta name="twitter:image:alt" content="${escapeHtml(copy.socialImageAlt)}" />
    <script id="museum-structured-data" type="application/ld+json">${museumStructuredData(copy, options)}</script>
    ${staticShellStyle}`
}

function languageLinks(
  locale: SeoPageLocale,
  copy: SeoPageCopy,
  entryFallback = false,
): string {
  if (locale === 'x-default') {
    return `<nav aria-label="Choose a language | 选择语言">
        <a href="./zh-CN/" hreflang="zh-CN" lang="zh-CN">简体中文</a>
        <a href="./en/" hreflang="en" lang="en">English</a>
      </nav>`
  }

  if (entryFallback) {
    return `<nav aria-label="${escapeHtml(copy.languageLabel)}">
        <a href="./" hreflang="x-default">${escapeHtml(copy.systemLanguageLabel)}</a>
        <a href="./zh-CN/" hreflang="zh-CN" lang="zh-CN">简体中文</a>
        <a href="./en/" hreflang="en" lang="en">English</a>
      </nav>`
  }

  const rootHref = '../'
  const zhCNHref = locale === 'zh-CN' ? './' : '../zh-CN/'
  const enHref = locale === 'en' ? './' : '../en/'
  const navigationLabel = copy.languageLabel
  const systemLabel = escapeHtml(copy.systemLanguageLabel)

  return `<nav aria-label="${escapeHtml(navigationLabel)}">
        <a href="${rootHref}" hreflang="x-default">${systemLabel}</a>
        <a href="${zhCNHref}" hreflang="zh-CN" lang="zh-CN">简体中文</a>
        <a href="${enHref}" hreflang="en" lang="en">English</a>
      </nav>`
}

function catalogueNameMarkup(
  animal: CatalogueEntry,
  locale: SeoPageLocale,
): string {
  if (locale === 'zh-CN') {
    return escapeHtml(animal.zhCN)
  }
  if (locale === 'en') {
    return escapeHtml(animal.en)
  }
  return `<span lang="en">${escapeHtml(animal.en)}</span> / <span lang="zh-CN">${escapeHtml(animal.zhCN)}</span>`
}

function catalogueGroupHeadingMarkup(
  group: CatalogueGroup,
  locale: SeoPageLocale,
): string {
  if (locale === 'zh-CN') {
    return escapeHtml(group.zhCN)
  }
  if (locale === 'en') {
    return escapeHtml(group.en)
  }
  return `<span lang="en">${escapeHtml(group.en)}</span> / <span lang="zh-CN">${escapeHtml(group.zhCN)}</span>`
}

function renderCatalogue(locale: SeoPageLocale): string {
  return catalogueGroups
    .map(
      (group) => `<section data-habitat="${group.habitat}">
          <h2>${catalogueGroupHeadingMarkup(group, locale)}</h2>
          <ul>${group.animals
            .map(
              (animal) => {
                const name = catalogueNameMarkup(animal, locale)
                const content =
                  locale !== 'x-default' && staticAnimalIds.has(animal.id)
                    ? `<a href="./animals/${escapeHtml(animal.id)}/">${name}</a>`
                    : name
                return `<li data-animal-id="${animal.id}">${content}</li>`
              },
            )
            .join('')}</ul>
        </section>`,
    )
    .join('')
}

function renderShell(copy: SeoPageCopy, entryFallback = false): string {
  const heading =
    copy.locale === 'x-default'
      ? '<span lang="en">Prehistoric Animal Museum</span> | <span lang="zh-CN">史前动物博物馆</span>'
      : escapeHtml(copy.heading)
  const introduction =
    copy.locale === 'x-default'
      ? '<span lang="en">A gentle 3D museum for children aged 2–6 and the grown-ups exploring with them.</span> <span lang="zh-CN">一座为 2–6 岁孩子和陪伴探索的家长准备的 3D 史前动物博物馆。</span>'
      : escapeHtml(copy.introduction)
  const privacy =
    copy.locale === 'x-default'
      ? `<span lang="en">Explore ${catalogueAnimalCount} prehistoric animals from land, sky and sea. No account, advertising or page analytics are used, and narration never starts by itself.</span> <span lang="zh-CN">展厅收录陆地、天空与水中的 ${catalogueAnimalCount} 位史前动物，无需账号，没有广告和页面分析，也不会自动播放声音。</span>`
      : escapeHtml(copy.privacy)
  const catalogueHeading =
    copy.locale === 'x-default'
      ? '<span lang="en">Museum collection</span> | <span lang="zh-CN">博物馆藏品</span>'
      : escapeHtml(copy.catalogueHeading)

  if (copy.locale === 'x-default') {
    return `<main class="seo-static-shell" data-seo-shell="${copy.locale}">
    <div class="seo-static-shell__inner">
      <h1>${heading}</h1>
      <p>${introduction}</p>
      ${languageLinks(copy.locale, copy, entryFallback)}
    </div>
</main>`
  }

  return `<main class="seo-static-shell" data-seo-shell="${copy.locale}">
    <div class="seo-static-shell__inner">
      <h1>${heading}</h1>
      <p>${introduction}</p>
      <p>${privacy}</p>
      ${languageLinks(copy.locale, copy, entryFallback)}
      <h2>${catalogueHeading}</h2>
      <div class="seo-static-shell__catalogue" data-seo-catalogue>
        ${renderCatalogue(copy.locale)}
      </div>
    </div>
</main>`
}

const animalPageCopy = {
  'zh-CN': {
    backToMuseum: '返回博物馆',
    classification: '分类',
    diet: '食性',
    dietLabels: {
      carnivore: '食肉',
      herbivore: '食草',
      omnivore: '杂食',
      unknown: '尚不确定',
    },
    discoveryRegions: '化石发现地区',
    explore: '进入 3D 展馆观察',
    facts: '一起认识它',
    keepExploring: '继续参观',
    period: '生活时期',
    size: '体型',
    sources: '科学资料来源',
    uncertainty: '关于复原与不确定性',
  },
  en: {
    backToMuseum: 'Back to the museum',
    classification: 'Classification',
    diet: 'Diet',
    dietLabels: {
      carnivore: 'Meat-eater',
      herbivore: 'Plant-eater',
      omnivore: 'Omnivore',
      unknown: 'Not yet known',
    },
    discoveryRegions: 'Fossil discovery regions',
    explore: 'Explore it in the 3D museum',
    facts: 'Meet this animal',
    keepExploring: 'Keep exploring',
    period: 'When it lived',
    size: 'Size',
    sources: 'Scientific sources',
    uncertainty: 'Reconstruction and uncertainty',
  },
} as const

function formatAnimalSize(content: AnimalContent, locale: Locale): string {
  const size = content.facts.size
  const range =
    size.minMeters === size.maxMeters
      ? `${size.minMeters}`
      : `${size.minMeters}–${size.maxMeters}`
  const unit = locale === 'zh-CN' ? '米' : 'metres'
  return `${range} ${unit}${size.kind === 'group-range' ? ` · ${size.note}` : ''}`
}

function animalCanonicalUrl(
  locale: Locale,
  animalId: string,
  options: ResolvedSeoOptions,
): string {
  return `${options.siteOrigin}${options.museumPath}${locale}/animals/${animalId}/`
}

function renderAnimalDetailDocument(
  definition: PublishedAnimalDefinition,
  locale: Locale,
  options: ResolvedSeoOptions,
): string {
  const content = definition.content[locale]
  const copy = animalPageCopy[locale]
  const canonical = animalCanonicalUrl(locale, definition.id, options)
  const otherLocale = locale === 'zh-CN' ? 'en' : 'zh-CN'
  const description = animalSeoDescription(content.narration.sentences)
  const title =
    locale === 'zh-CN'
      ? `${content.name} | 史前动物博物馆`
      : `${content.name} | Prehistoric Animal Museum`
  const heroPath = `../../../animals/${definition.id}/hero.webp`
  const heroPortraitPath = `../../../animals/${definition.id}/hero-portrait.webp`
  const museumHref = `../../../${locale}/`
  const exhibitHref = `${museumHref}?animal=${encodeURIComponent(definition.id)}`
  const alternateHref = `../../../${otherLocale}/animals/${definition.id}/`
  const socialImage = `${options.siteOrigin}${options.museumPath}animals/${definition.id}/social.webp`
  const cookiePath =
    options.museumPath === '/'
      ? '/'
      : options.museumPath.replace(/\/$/, '')
  const localeCookie = `museum_locale=${otherLocale}; Max-Age=31536000; Path=${cookiePath}; SameSite=Lax; Secure`
  const sources = content.sources
    .map(
      (source) => `<li><a href="${escapeHtml(source.url)}" rel="noreferrer">${escapeHtml(source.title)}</a></li>`,
    )
    .join('')
  const uncertainty = content.editorial.uncertaintyNotes
    .map((note) => `<li>${escapeHtml(note)}</li>`)
    .join('')
  const relatedAnimals = staticAnimalDetailDefinitions
    .filter((animal) => animal.id !== definition.id)
    .map((animal) => {
      const relatedContent = animal.content[locale]
      return `<a data-animal-id="${escapeHtml(animal.id)}" href="../${escapeHtml(animal.id)}/">
        <img src="../../../animals/${escapeHtml(animal.id)}/thumbnail.webp" width="320" height="320" loading="lazy" decoding="async" alt="" />
        <span><strong>${escapeHtml(relatedContent.name)}</strong><small>${escapeHtml(relatedContent.classificationLabel)}</small></span>
      </a>`
    })
    .join('')
  const museumName =
    locale === 'zh-CN' ? '史前动物博物馆' : 'Prehistoric Animal Museum'
  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: museumName,
          item: canonicalUrl(locale, options),
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: content.name,
          item: canonical,
        },
      ],
    },
    copyrightHolder: {
      '@type': 'Person',
      '@id': `${options.siteOrigin}/#leon`,
      name: 'Leon',
      url: `${options.siteOrigin}/`,
    },
    creator: {
      '@type': 'Person',
      '@id': `${options.siteOrigin}/#leon`,
      name: 'Leon',
      url: `${options.siteOrigin}/`,
    },
    description,
    image: socialImage,
    inLanguage: locale,
    isPartOf: {
      '@type': 'WebApplication',
      '@id': `${canonicalUrl(locale, options)}#museum`,
      brand: {
        '@type': 'Brand',
        '@id': `${options.siteOrigin}/#leon-made-this`,
        alternateName: 'Leon Made This',
        name: 'Leon做了个',
        url: `${options.siteOrigin}/`,
      },
      name: museumName,
      url: canonicalUrl(locale, options),
    },
    name: content.name,
    url: canonical,
  }).replaceAll('<', '\\u003c')

  return `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#d8e7c2" />
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <link rel="alternate" hreflang="${locale}" href="${escapeHtml(canonical)}" />
    <link rel="alternate" hreflang="${otherLocale}" href="${escapeHtml(animalCanonicalUrl(otherLocale, definition.id, options))}" />
    <link rel="icon" type="image/svg+xml" href="../../../favicon.svg" />
    <link data-animal-detail-fallback rel="preload" as="image" href="${heroPath}" type="image/webp" media="(orientation: landscape)" />
    <link data-animal-detail-fallback rel="preload" as="image" href="${heroPortraitPath}" type="image/webp" media="(orientation: portrait)" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:image" content="${escapeHtml(socialImage)}" />
    <meta property="og:image:type" content="image/webp" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${escapeHtml(content.name)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <script id="animal-structured-data" type="application/ld+json">${structuredData}</script>
    <title>${escapeHtml(title)}</title>
    <style id="animal-detail-fallback-style">
      :root { color-scheme: light; font-family: ${locale === 'zh-CN' ? '"Noto Sans SC", "PingFang SC",' : '"Nunito",'} system-ui, sans-serif; color: #20382f; background: #d8e7c2; }
      * { box-sizing: border-box; }
      body { margin: 0; background: radial-gradient(circle at 82% 8%, rgb(255 255 255 / .72), transparent 32rem), linear-gradient(155deg, #eef4df, #d8e7c2 55%, #b9d7d2); }
      a { color: inherit; }
      .animal-page { width: min(76rem, 100%); margin: 0 auto; padding: clamp(1rem, 3vw, 2.5rem); }
      .animal-page__nav { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: clamp(1.5rem, 4vw, 3.5rem); }
      .animal-page__nav a { min-height: 2.75rem; display: inline-flex; align-items: center; font-weight: 800; text-decoration-thickness: .1em; text-underline-offset: .22em; }
      .animal-page__language { padding: .15rem .8rem; border: 1px solid rgb(32 56 47 / .35); border-radius: 999px; text-decoration: none; }
      .animal-hero { display: grid; grid-template-columns: minmax(0, 1.02fr) minmax(18rem, .98fr); align-items: center; gap: clamp(1.5rem, 5vw, 5rem); }
      .animal-hero__eyebrow { margin: 0 0 .75rem; color: #50756a; font-size: .82rem; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
      h1 { margin: 0; max-width: 11ch; font-family: "Fredoka", ${locale === 'zh-CN' ? '"Noto Sans SC",' : ''} system-ui, sans-serif; font-size: clamp(3.3rem, 10vw, 7.4rem); line-height: .88; letter-spacing: -.045em; text-wrap: balance; }
      .animal-hero__lead { max-width: 42rem; margin: 1.35rem 0; font-size: clamp(1.08rem, 2vw, 1.35rem); line-height: 1.7; }
      .animal-hero__question { max-width: 38rem; margin: 0; padding-left: 1rem; border-left: .3rem solid #d6724d; font-weight: 750; line-height: 1.6; }
      .animal-hero__media { position: relative; aspect-ratio: 16 / 10; overflow: hidden; border: .7rem solid rgb(255 255 255 / .6); border-radius: clamp(1.4rem, 4vw, 3rem); box-shadow: 0 1.8rem 4rem rgb(24 67 59 / .18); transform: rotate(1.2deg); }
      .animal-hero__media img { width: 100%; height: 100%; display: block; object-fit: cover; }
      .animal-content { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(17rem, .85fr); gap: clamp(1.5rem, 4vw, 3.5rem); margin-top: clamp(3rem, 8vw, 7rem); }
      .animal-card { padding: clamp(1.4rem, 3.5vw, 2.6rem); border: 1px solid rgb(32 56 47 / .12); border-radius: 2rem; background: rgb(255 255 255 / .62); box-shadow: 0 1rem 3rem rgb(32 56 47 / .08); }
      h2 { margin: 0 0 1.4rem; font-size: clamp(1.45rem, 3vw, 2.15rem); line-height: 1.1; }
      .animal-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin: 0; }
      .animal-facts div { padding: 1rem; border-radius: 1.2rem; background: rgb(216 231 194 / .58); }
      .animal-facts dt { color: #5e796f; font-size: .8rem; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; }
      .animal-facts dd { margin: .35rem 0 0; font-weight: 800; line-height: 1.45; }
      .animal-card p, .animal-card li { line-height: 1.7; }
      .animal-card ul { padding-inline-start: 1.25rem; }
      .animal-card--notes > * + * { margin-top: 1.8rem; }
      .animal-card details { padding-top: 1rem; border-top: 1px solid rgb(32 56 47 / .16); }
      .animal-card summary { cursor: pointer; font-weight: 850; }
      .animal-cta { display: inline-flex; min-height: 3.5rem; align-items: center; justify-content: center; margin-top: 1.7rem; padding: .75rem 1.35rem; border-radius: 999px; color: #fff; background: #d6724d; box-shadow: 0 .8rem 1.7rem rgb(152 72 45 / .25); font-weight: 900; text-decoration: none; }
      .animal-related { margin-top: clamp(2rem, 5vw, 4rem); }
      .animal-related__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
      .animal-related a { display: flex; align-items: center; gap: 1rem; min-height: 6.5rem; padding: .8rem; border: 1px solid rgb(32 56 47 / .14); border-radius: 1.35rem; background: rgb(255 255 255 / .5); text-decoration: none; transition: transform 160ms ease, background 160ms ease; }
      .animal-related a:hover { background: rgb(255 255 255 / .78); transform: translateY(-2px); }
      .animal-related img { width: 5rem; height: 5rem; flex: none; border-radius: 1rem; object-fit: cover; }
      .animal-related span { display: grid; gap: .25rem; }
      .animal-related strong { font-size: 1.05rem; }
      .animal-related small { color: #5e796f; line-height: 1.35; }
      .animal-footer { padding: 3rem 0 1rem; color: #4f6c63; text-align: center; }
      @media (max-width: 760px) { .animal-hero, .animal-content { grid-template-columns: 1fr; } .animal-hero__copy { order: 1; } .animal-hero__media { order: 2; aspect-ratio: 390 / 560; transform: none; } .animal-facts, .animal-related__grid { grid-template-columns: 1fr; } }
      @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; } }
    </style>
  </head>
  <body>
    <main class="animal-page" data-animal-detail="${escapeHtml(definition.id)}">
      <nav class="animal-page__nav" aria-label="${escapeHtml(copy.backToMuseum)}">
        <a href="${museumHref}">← ${escapeHtml(copy.backToMuseum)}</a>
        <a class="animal-page__language" data-locale-choice="${otherLocale}" href="${alternateHref}" hreflang="${otherLocale}">${otherLocale === 'zh-CN' ? '简体中文' : 'English'}</a>
      </nav>
      <article>
        <header class="animal-hero">
          <div class="animal-hero__copy">
            <p class="animal-hero__eyebrow">${escapeHtml(content.classificationLabel)}</p>
            <h1>${escapeHtml(content.name)}</h1>
            <p class="animal-hero__lead">${escapeHtml(content.narration.sentences[0])}</p>
            <p class="animal-hero__question">${escapeHtml(content.visibleFeature)}</p>
            <a class="animal-cta" data-open-exhibit href="${exhibitHref}">${escapeHtml(copy.explore)} →</a>
          </div>
          <picture class="animal-hero__media">
            <source media="(orientation: portrait)" srcset="${heroPortraitPath}" />
            <img src="${heroPath}" width="1200" height="675" fetchpriority="high" decoding="async" alt="${escapeHtml(content.name)}" />
          </picture>
        </header>
        <div class="animal-content">
          <section class="animal-card" aria-labelledby="facts-heading">
            <h2 id="facts-heading">${escapeHtml(copy.facts)}</h2>
            <dl class="animal-facts">
              <div><dt>${escapeHtml(copy.period)}</dt><dd>${escapeHtml(content.facts.period)}</dd></div>
              <div><dt>${escapeHtml(copy.discoveryRegions)}</dt><dd>${escapeHtml(content.facts.discoveryRegions.join(locale === 'zh-CN' ? '、' : ', '))}</dd></div>
              <div><dt>${escapeHtml(copy.size)}</dt><dd>${escapeHtml(formatAnimalSize(content, locale))}</dd></div>
              <div><dt>${escapeHtml(copy.diet)}</dt><dd>${escapeHtml(copy.dietLabels[content.facts.diet])}</dd></div>
              <div><dt>${escapeHtml(copy.classification)}</dt><dd>${escapeHtml(content.classificationLabel)}</dd></div>
            </dl>
            <p>${escapeHtml(content.parentClassificationNote)}</p>
          </section>
          <aside class="animal-card animal-card--notes">
            <section>
              <h2>${escapeHtml(copy.sources)}</h2>
              <ul>${sources}</ul>
            </section>
            <details>
              <summary>${escapeHtml(copy.uncertainty)}</summary>
              <ul>${uncertainty}</ul>
            </details>
          </aside>
        </div>
        <section class="animal-related" data-related-animals aria-labelledby="related-heading">
          <h2 id="related-heading">${escapeHtml(copy.keepExploring)}</h2>
          <div class="animal-related__grid">${relatedAnimals}</div>
        </section>
      </article>
      <footer class="animal-footer">Prehistoric Animal Museum · 史前动物博物馆</footer>
    </main>
    <script data-locale-cookie>document.querySelector('[data-locale-choice]')?.addEventListener('click',function(){document.cookie=${JSON.stringify(localeCookie)}})</script>
  </body>
</html>
`
}

function renderHydratableAnimalDetailDocument(
  builtAppHtml: string,
  definition: PublishedAnimalDefinition,
  locale: Locale,
  options: ResolvedSeoOptions,
): string {
  const fallbackDocument = renderAnimalDetailDocument(
    definition,
    locale,
    options,
  )
  const headAssets = (
    builtAppHtml.match(
      /<link\b(?=[^>]*\brel=["'](?:modulepreload|stylesheet)["'])[^>]*>/gi,
    ) ?? []
  ).join('\n    ')
  const applicationScripts = (
    builtAppHtml.match(
      /<script\b(?=[^>]*\btype=["']module["'])(?=[^>]*\bsrc=["'][^"']+["'])[^>]*><\/script>/gi,
    ) ?? []
  ).join('\n    ')
  if (!headAssets || !applicationScripts) {
    throw new Error(
      'Built application HTML must include its stylesheet and module script.',
    )
  }

  const rebasedHeadAssets = rebaseDocumentAssets(headAssets, '../../../')
  const rebasedScripts = rebaseDocumentAssets(applicationScripts, '../../../')
  return fallbackDocument
    .replace('</head>', `    ${rebasedHeadAssets}\n  </head>`)
    .replace(
      '<body>',
      `<body>\n    <div id="root"><!--museum-root-start-->`,
    )
    .replace(
      '</body>',
      `<!--museum-root-end--></div>\n    ${rebasedScripts}\n  </body>`,
    )
}

function removeExistingSeoHead(html: string): string {
  return html
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>\s*/gi, '')
    .replace(
      /<meta\b(?=[^>]*(?:name=["'](?:description|robots|twitter:[^"']+)["']|property=["']og:[^"']+["']))[^>]*>\s*/gi,
      '',
    )
    .replace(
      /<link\b(?=[^>]*rel=["'](?:canonical|alternate)["'])[^>]*>\s*/gi,
      '',
    )
    .replace(
      /<style\b[^>]*id=["']seo-static-shell-style["'][^>]*>[\s\S]*?<\/style>\s*/gi,
      '',
    )
}

function rebaseDocumentAssets(html: string, assetBase = '../'): string {
  return html.replace(
    /<(?:script|link|img|source|video)\b[^>]*>/gi,
    (assetTag) =>
      assetTag.replace(
        /\b(src|href|poster)=(['"])\.\//g,
        `$1=$2${assetBase}`,
      ),
  )
}

function removeApplicationAssets(html: string): string {
  return html
    .replace(
      /<script\b(?=[^>]*\btype=["']module["'])(?=[^>]*\bsrc=["'][^"']+["'])[^>]*><\/script>\s*/gi,
      '',
    )
    .replace(
      /<link\b(?=[^>]*\brel=["'](?:modulepreload|stylesheet)["'])[^>]*>\s*/gi,
      '',
    )
}

function restoreEntryDocumentAssets(html: string): string {
  return html.replace(
    /<(?:script|link|img|source|video)\b[^>]*>/gi,
    (assetTag) =>
      assetTag.replace(/\b(src|href|poster)=(['"])\.\.\//g, '$1=$2./'),
  )
}

export function renderSeoDocument(
  builtAppHtml: string,
  locale: SeoPageLocale,
  rawOptions: MultilingualSeoOptions = {},
  entryFallback = false,
): string {
  const options = resolveOptions(rawOptions)
  const copy = pageCopy[locale]
  let html = removeExistingSeoHead(builtAppHtml)

  if (!/<html\b[^>]*\blang=["'][^"']*["']/i.test(html)) {
    throw new Error('Built application HTML must declare an html lang attribute.')
  }
  if (!/<\/head>/i.test(html)) {
    throw new Error('Built application HTML is missing </head>.')
  }
  if (!/<div\s+id=["']root["'][^>]*>[\s\S]*?<\/div>/i.test(html)) {
    throw new Error('Built application HTML is missing the #root element.')
  }

  html = html.replace(
    /(<html\b[^>]*\blang=)["'][^"']*["']/i,
    `$1"${copy.htmlLang}"`,
  )
  html = html.replace(/<\/head>/i, `    ${renderHead(copy, options)}\n  </head>`)
  html = html.replace(
    /<div\s+id=["']root["'][^>]*>[\s\S]*?<\/div>/i,
    `<div id="root"><!--museum-root-start-->${renderShell(copy, entryFallback)}<!--museum-root-end--></div>`,
  )

  // The locale-neutral entry is an intentional, stable language chooser. It
  // never starts the application, so visitors do not see an SEO shell replaced
  // by a visually unrelated interface while JavaScript downloads.
  if (entryFallback) {
    return restoreEntryDocumentAssets(rebaseDocumentAssets(html))
  }
  return locale === 'x-default'
    ? removeApplicationAssets(html)
    : rebaseDocumentAssets(html)
}

function renderSitemap(options: ResolvedSeoOptions): string {
  const urls = [
    canonicalUrl('zh-CN', options),
    canonicalUrl('en', options),
    ...staticAnimalDetailIds.flatMap((animalId) => [
      animalCanonicalUrl('zh-CN', animalId, options),
      animalCanonicalUrl('en', animalId, options),
    ]),
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
    .map(
    (url) => `  <url>
    <loc>${escapeHtml(url)}</loc>
  </url>`,
  )
  .join('\n')}
</urlset>
`
}

function renderNotFound(options: ResolvedSeoOptions): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, follow" />
    <title>Page not found | 页面没有找到</title>
    <style>body{margin:0;padding:3rem;background:#d8e7c2;color:#20382f;font:1.1rem/1.6 system-ui,sans-serif}main{max-width:42rem;margin:auto}a{color:inherit;font-weight:700}</style>
  </head>
  <body>
    <main>
      <h1>404 · Page not found · <span lang="zh-CN">页面没有找到</span></h1>
      <p><span lang="en">The trail ends here.</span> <span lang="zh-CN">这条参观路线暂时走不通。</span></p>
      <p><a data-museum-return href="${escapeHtml(options.notFoundReturnPath)}"><span lang="en">Return to the museum</span> · <span lang="zh-CN">返回博物馆</span></a></p>
    </main>
  </body>
</html>
`
}

const socialLatinFontData = readFileSync(
  resolve(
    process.cwd(),
    'node_modules/@fontsource-variable/fredoka/files/fredoka-latin-wght-normal.woff2',
  ),
).toString('base64')
const socialChineseFontData = readFileSync(
  resolve(
    process.cwd(),
    'node_modules/@fontsource/zcool-kuaile/files/zcool-kuaile-chinese-simplified-400-normal.woff2',
  ),
).toString('base64')

function socialCardFontStyles(): string {
  return `<style>
    @font-face { font-family: "Museum Latin"; src: url("data:font/woff2;base64,${socialLatinFontData}") format("woff2"); font-style: normal; font-weight: 300 700; }
    @font-face { font-family: "Museum Chinese"; src: url("data:font/woff2;base64,${socialChineseFontData}") format("woff2"); font-style: normal; font-weight: 400; }
  </style>`
}

function renderSocialCard(
  locale: SeoPageLocale,
  embedFonts = false,
): string {
  const copy = pageCopy[locale]
  const titleLines =
    locale === 'zh-CN'
      ? ['史前动物博物馆']
      : locale === 'en'
        ? ['Prehistoric Animal', 'Museum']
        : ['Prehistoric Animal Museum', '史前动物博物馆']
  const titleFontSize = locale === 'x-default' ? 58 : 68
  const titleStartY = titleLines.length === 1 ? 270 : 225
  const titleMarkup = titleLines
    .map(
      (line, index) =>
        `<tspan x="125" y="${titleStartY + index * 76}">${escapeHtml(line)}</tspan>`,
    )
    .join('')
  const subtitle =
    locale === 'zh-CN'
      ? `和孩子一起探索 ${catalogueAnimalCount} 位史前动物朋友`
      : locale === 'en'
        ? `Meet ${catalogueAnimalCount} prehistoric animals in 3D`
        : 'A bilingual 3D family museum · 双语亲子 3D 博物馆'
  const galleryLabel =
    locale === 'zh-CN'
      ? '陆地 · 天空 · 水中'
      : locale === 'en'
        ? 'Land · Sky · Sea'
        : 'Land · Sky · Sea | 陆地 · 天空 · 水中'
  const fontFamily = embedFonts
    ? 'Museum Latin, Museum Chinese'
    : 'ui-rounded, system-ui, sans-serif'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title description">
  <title id="title">${escapeHtml(copy.socialImageAlt)}</title>
  <desc id="description">${escapeHtml(subtitle)}</desc>
  <defs>
    ${embedFonts ? socialCardFontStyles() : ''}
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#eef4df"/><stop offset=".58" stop-color="#d8e7c2"/><stop offset="1" stop-color="#9dc8c5"/></linearGradient>
    <filter id="shadow"><feDropShadow dx="0" dy="16" stdDeviation="14" flood-color="#173a35" flood-opacity=".2"/></filter>
  </defs>
  <rect width="1200" height="630" fill="url(#background)"/>
  <circle cx="1030" cy="120" r="180" fill="#fff" opacity=".25"/>
  <circle cx="1040" cy="570" r="270" fill="#487e70" opacity=".13"/>
  <g fill="#315f53" opacity=".7"><path d="M920 430c65-90 153-100 222-34-52 1-77 24-84 70-42-46-85-57-138-36Z"/><path d="M827 494c53-64 119-63 166-7-40-5-62 11-73 46-28-38-58-51-93-39Z"/></g>
  <g filter="url(#shadow)">
    <rect x="72" y="70" width="860" height="490" rx="44" fill="#fff" opacity=".84"/>
    <text x="125" y="145" fill="#51766b" font-family="${fontFamily}" font-size="28" font-weight="700">${escapeHtml(copy.brand)}</text>
    <text fill="#20382f" font-family="${fontFamily}" font-size="${titleFontSize}" font-weight="700">${titleMarkup}</text>
    <text x="125" y="382" fill="#355b50" font-family="${fontFamily}" font-size="31" font-weight="600">${escapeHtml(subtitle)}</text>
    <g transform="translate(125 420)" fill="#d6724d"><circle cx="33" cy="33" r="33"/><circle cx="111" cy="33" r="33"/><circle cx="189" cy="33" r="33"/></g>
    <text x="125" y="525" fill="#527a6e" font-family="${fontFamily}" font-size="25">${escapeHtml(galleryLabel)}</text>
  </g>
</svg>
`
}

export async function renderSocialCardPng(
  locale: SeoPageLocale,
): Promise<Buffer> {
  return sharp(Buffer.from(renderSocialCard(locale, true)))
    .png({ compressionLevel: 9 })
    .toBuffer()
}

export function createSeoSocialCardManifest(): SeoSocialCardManifest {
  const cards = Object.fromEntries(
    (['x-default', 'zh-CN', 'en'] as const).map((locale) => [
      locale,
      {
        fileName: pageCopy[locale].socialImageFileName.replace('social/', ''),
        sourceSha256: createHash('sha256')
          .update(renderSocialCard(locale, true))
          .digest('hex'),
      },
    ]),
  ) as SeoSocialCardManifest['cards']
  return { version: 1, width: 1200, height: 630, cards }
}

export function createMultilingualSeoArtifacts(
  builtAppHtml: string,
  rawOptions: MultilingualSeoOptions = {},
): ReadonlyMap<string, string> {
  const options = resolveOptions(rawOptions)
  const artifacts = new Map<string, string>([
    [
      'index.html',
      renderSeoDocument(builtAppHtml, 'zh-CN', options, true),
    ],
    ['zh-CN/index.html', renderSeoDocument(builtAppHtml, 'zh-CN', options)],
    ['en/index.html', renderSeoDocument(builtAppHtml, 'en', options)],
  ])

  for (const definition of staticAnimalDetailDefinitions) {
    for (const locale of ['zh-CN', 'en'] as const) {
      artifacts.set(
        `${locale}/animals/${definition.id}/index.html`,
        renderHydratableAnimalDetailDocument(
          builtAppHtml,
          definition,
          locale,
          options,
        ),
      )
    }
  }

  artifacts.set(
    'robots.txt',
    `User-agent: *\nAllow: /\nSitemap: ${options.siteOrigin}/sitemap.xml\n`,
  )
  artifacts.set('sitemap.xml', renderSitemap(options))
  artifacts.set('404.html', renderNotFound(options))
  artifacts.set('social/museum.svg', renderSocialCard('x-default'))
  artifacts.set('social/museum.zh-CN.svg', renderSocialCard('zh-CN'))
  artifacts.set('social/museum.en.svg', renderSocialCard('en'))
  return artifacts
}

export function multilingualSeoPlugin(
  options: MultilingualSeoOptions = {},
): Plugin {
  let isSsrBuild = false
  return {
    name: 'multilingual-static-seo',
    apply: 'build',
    configResolved(config) {
      isSsrBuild = Boolean(config.build.ssr)
    },
    async writeBundle(outputOptions) {
      if (isSsrBuild) {
        return
      }
      const outputDirectory = resolve(outputOptions.dir ?? 'dist')
      const indexPath = resolve(outputDirectory, 'index.html')
      const builtAppHtml = await readFile(indexPath, 'utf8')
      const artifacts = createMultilingualSeoArtifacts(builtAppHtml, options)

      for (const [fileName, source] of artifacts) {
        const outputPath = resolve(outputDirectory, fileName)
        await mkdir(dirname(outputPath), { recursive: true })
        await writeFile(outputPath, source, 'utf8')
      }

      const expectedManifest = createSeoSocialCardManifest()
      const manifestPath = resolve(outputDirectory, 'social/manifest.json')
      const actualManifest = JSON.parse(
        await readFile(manifestPath, 'utf8'),
      ) as unknown
      if (
        JSON.stringify(actualManifest) !== JSON.stringify(expectedManifest)
      ) {
        throw new Error(
          `SEO social card manifest is stale; run npm run generate:seo-social-cards: ${manifestPath}`,
        )
      }

      // Raster output can vary between librsvg/Pango versions. The manifest
      // binds each checked-in image to all copy, layout and embedded-font
      // inputs; the build separately verifies the scraper-required dimensions.
      for (const locale of ['x-default', 'zh-CN', 'en'] as const) {
        const cardPath = resolve(
          outputDirectory,
          pageCopy[locale].socialImageFileName,
        )
        const actualCard = await readFile(cardPath)
        const metadata = await sharp(actualCard).metadata()
        if (
          metadata.format !== 'png' ||
          metadata.width !== 1200 ||
          metadata.height !== 630
        ) {
          throw new Error(
              `SEO social card must be a 1200×630 PNG: ${cardPath}`,
            )
        }
      }
    },
  }
}
