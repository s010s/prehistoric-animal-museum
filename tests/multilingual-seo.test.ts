import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'
import sharp from 'sharp'

import {
  createSeoSocialCardManifest,
  createMultilingualSeoArtifacts,
  seoCatalogueAnimalIds,
} from '../scripts/multilingual-seo'
import { mainCollection } from '../src/content/collections/main'
import type { AnimalDefinitionModule } from '../src/content/types'

const canonicalDefinitionModules = import.meta.glob<AnimalDefinitionModule>(
  '../src/content/animals/*/package.ts',
  { eager: true },
)
const locales = ['zh-CN', 'en'] as const
const canonicalDefinitionsById = new Map(
  Object.values(canonicalDefinitionModules).map(({ animalDefinition }) => [
    animalDefinition.id,
    animalDefinition,
  ]),
)
const detailCases = locales.flatMap((locale) =>
  mainCollection.animalIds.map((animalId) => ({ animalId, locale })),
)

const builtAppHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="old description" />
    <meta property="og:title" content="old title" />
    <link rel="icon" href="./favicon.svg" />
    <script type="module" crossorigin src="./assets/app-123.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/app-123.css" />
    <title>Old title</title>
  </head>
  <body><div id="root"></div></body>
</html>`

function artifactSource(
  artifacts: ReadonlyMap<string, string>,
  fileName: string,
): string {
  const source = artifacts.get(fileName)
  expect(source, `missing ${fileName}`).toBeTypeOf('string')
  return source ?? ''
}

function parseHtml(source: string): Document {
  return new DOMParser().parseFromString(source, 'text/html')
}

describe('multilingual SEO artifacts', () => {
  const artifacts = createMultilingualSeoArtifacts(builtAppHtml, {
    siteOrigin: 'https://example.test',
    museumPath: '/museum/',
  })

  it('derives every crawlable ID, localized name and gallery from canonical content', () => {
    const canonicalAnimals = mainCollection.animalIds.map((id) => {
      const definition = canonicalDefinitionsById.get(id)
      if (!definition || definition.status !== 'published') {
        throw new Error(`Missing canonical published animal ${id}`)
      }
      return definition
    })

    expect(new Set(seoCatalogueAnimalIds).size).toBe(seoCatalogueAnimalIds.length)
    expect(seoCatalogueAnimalIds).toEqual(mainCollection.animalIds)

    for (const [fileName, locale] of [
      ['zh-CN/index.html', 'zh-CN'],
      ['en/index.html', 'en'],
    ] as const) {
      const document = parseHtml(artifactSource(artifacts, fileName))
      const entries = document.querySelectorAll<HTMLElement>(
        '[data-seo-catalogue] [data-animal-id]',
      )
      expect(entries).toHaveLength(canonicalAnimals.length)

      for (const animal of canonicalAnimals) {
        const entry = document.querySelector<HTMLElement>(
          `[data-animal-id="${animal.id}"]`,
        )
        expect(entry?.textContent).toBe(animal.content[locale].name)
        expect(entry?.closest('section')?.getAttribute('data-habitat')).toBe(
          animal.habitat,
        )
      }
    }
  })

  it('renders a Chinese museum template as the fail-open entry', () => {
    const document = parseHtml(artifactSource(artifacts, 'index.html'))

    expect(document.documentElement.lang).toBe('zh-CN')
    expect(document.title).toBe(
      '史前动物博物馆 | 给 2–6 岁孩子的免费 3D 恐龙与古生物网站',
    )
    expect(document.querySelector('h1')?.textContent).toBe('史前动物博物馆')
    expect(document.querySelectorAll('[data-seo-catalogue] li')).toHaveLength(
      mainCollection.animalIds.length,
    )
    expect(
      document.querySelector<HTMLAnchorElement>('a[hreflang="zh-CN"]')?.getAttribute(
        'href',
      ),
    ).toBe('./zh-CN/')
    expect(
      document.querySelector<HTMLAnchorElement>('a[hreflang="en"]')?.getAttribute(
        'href',
      ),
    ).toBe('./en/')
    expect(
      document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
    ).toBe('https://example.test/museum/zh-CN/')
    expect(
      document.querySelector('link[rel="alternate"][hreflang="x-default"]')
        ?.getAttribute('href'),
    ).toBe('https://example.test/museum/')
    expect(
      document.querySelector('script[type="module"]')?.getAttribute('src'),
    ).toBe('./assets/app-123.js')
    expect(
      document.querySelector('link[rel="stylesheet"]')?.getAttribute('href'),
    ).toBe('./assets/app-123.css')
  })

  it('keeps the no-JS static shell viewport-height and independently scrollable', () => {
    const document = parseHtml(artifactSource(artifacts, 'index.html'))
    const style = document.querySelector('#seo-static-shell-style')?.textContent

    expect(style).toMatch(
      /\.seo-static-shell\s*\{[^}]*height:\s*100dvh;[^}]*overflow:\s*auto;/s,
    )
    expect(style).toContain('.seo-static-shell :lang(zh-CN)')
    expect(style).toContain('"Noto Sans SC Variable"')
    expect(style).toContain('"Nunito Variable"')
  })

  it.each([
    {
      fileName: 'zh-CN/index.html',
      lang: 'zh-CN',
      canonical: 'https://example.test/museum/zh-CN/',
      title: '史前动物博物馆 | 给 2–6 岁孩子的免费 3D 恐龙与古生物网站',
      heading: '史前动物博物馆',
      catalogueEntries: ['剑龙', '沧龙', '无齿翼龙'],
      descriptionFragment: `${mainCollection.animalIds.length} 位来自陆地、天空与水中`,
      brand: 'Leon做了个',
      ownLanguage: 'zh-CN',
      otherLanguage: 'en',
      languageLink: '../en/',
    },
    {
      fileName: 'en/index.html',
      lang: 'en',
      canonical: 'https://example.test/museum/en/',
      title: 'Prehistoric Animal Museum for Kids | Free Interactive 3D Exhibits',
      heading: 'Prehistoric Animal Museum',
      catalogueEntries: ['Stegosaurus', 'Mosasaurus', 'Pteranodon'],
      descriptionFragment: `${mainCollection.animalIds.length} prehistoric animals from land, sky and sea`,
      brand: 'Leon Made This',
      ownLanguage: 'en',
      otherLanguage: 'zh-CN',
      languageLink: '../zh-CN/',
    },
  ])(
    'renders crawlable localized content and metadata for $lang',
    ({
      fileName,
      lang,
      canonical,
      title,
      heading,
      catalogueEntries,
      descriptionFragment,
      brand,
      ownLanguage,
      otherLanguage,
      languageLink,
    }) => {
      const document = parseHtml(artifactSource(artifacts, fileName))

      expect(document.documentElement.lang).toBe(lang)
      expect(document.title).toBe(title)
      expect(document.querySelector('h1')?.textContent).toBe(heading)
      expect(document.body.textContent).toContain(descriptionFragment)
      expect(document.querySelectorAll('[data-seo-catalogue] li')).toHaveLength(
        mainCollection.animalIds.length,
      )
      for (const entry of catalogueEntries) {
        expect(document.body.textContent).toContain(entry)
      }
      expect(
        document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
      ).toBe(canonical)
      expect(
        document.querySelector('meta[property="og:url"]')?.getAttribute('content'),
      ).toBe(canonical)
      expect(
        document.querySelector('meta[property="og:title"]')?.getAttribute('content'),
      ).toBe(title)
      expect(
        document
          .querySelector('meta[property="og:site_name"]')
          ?.getAttribute('content'),
      ).toBe(brand)
      const museumStructuredData = JSON.parse(
        document.querySelector('#museum-structured-data')?.textContent ?? '{}',
      ) as Record<string, unknown>
      expect(museumStructuredData).toMatchObject({
        '@type': 'WebApplication',
        brand: {
          '@type': 'Brand',
          alternateName: 'Leon Made This',
          name: 'Leon做了个',
          url: 'https://example.test/',
        },
        creator: {
          '@type': 'Person',
          name: 'Leon',
          url: 'https://example.test/',
        },
        url: canonical,
      })
      expect(
        document
          .querySelector(`nav a[hreflang="${otherLanguage}"]`)
          ?.getAttribute('href'),
      ).toBe(languageLink)
      expect(
        document
          .querySelector(`nav a[hreflang="${ownLanguage}"]`)
          ?.getAttribute('href'),
      ).toBe('./')
    },
  )

  it.each(detailCases)(
    'prepares a hydratable $locale $animalId detail document for museum SSR',
    ({ locale, animalId }) => {
      const fileName = `${locale}/animals/${animalId}/index.html`
      const source = artifactSource(artifacts, fileName)
      const document = parseHtml(source)
      const definition = canonicalDefinitionsById.get(animalId)
      if (!definition || definition.status !== 'published') {
        throw new Error(`Missing canonical published animal ${animalId}`)
      }
      const content = definition.content[locale]
      const otherLocale = locale === 'zh-CN' ? 'en' : 'zh-CN'
      const canonical = `https://example.test/museum/${locale}/animals/${animalId}/`
      const otherCanonical = `https://example.test/museum/${otherLocale}/animals/${animalId}/`
      const root = document.querySelector('#root')
      const fallback = root?.querySelector(
        `[data-animal-detail="${animalId}"]`,
      )
      const description =
        document
          .querySelector('meta[name="description"]')
          ?.getAttribute('content') ?? ''

      expect(document.documentElement.lang).toBe(locale)
      expect(description).not.toBe('')
      expect(description.length).toBeLessThanOrEqual(160)
      expect(root).not.toBeNull()
      expect(source).toMatch(
        /<div id="root"><!--museum-root-start-->[\s\S]*<!--museum-root-end--><\/div>/,
      )
      expect(fallback).not.toBeNull()
      expect(fallback?.textContent).toContain(content.name)
      expect(fallback?.textContent).toContain(content.narration.sentences[0])
      expect(fallback?.textContent).toContain(content.visibleFeature)
      expect(
        document
          .querySelector<HTMLImageElement>(
            `[data-animal-detail="${animalId}"] img[alt="${content.name}"]`,
          )
          ?.getAttribute('src'),
      ).toBe(`../../../animals/${animalId}/hero.webp`)
      expect(document.querySelector('#animal-detail-fallback-style')).not.toBeNull()
      expect(
        document.querySelectorAll('link[data-animal-detail-fallback]'),
      ).toHaveLength(2)
      expect(
        document.querySelector<HTMLScriptElement>('script[type="module"]')
          ?.getAttribute('src'),
      ).toBe('../../../assets/app-123.js')
      expect(
        document.querySelector<HTMLLinkElement>('link[rel="stylesheet"]')
          ?.getAttribute('href'),
      ).toBe('../../../assets/app-123.css')
      expect(
        document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
      ).toBe(canonical)
      expect(
        document
          .querySelector(`link[rel="alternate"][hreflang="${locale}"]`)
          ?.getAttribute('href'),
      ).toBe(canonical)
      expect(
        document
          .querySelector(`link[rel="alternate"][hreflang="${otherLocale}"]`)
          ?.getAttribute('href'),
      ).toBe(otherCanonical)

      const structuredDataSource = document.querySelector(
        '#animal-structured-data',
      )?.textContent
      expect(structuredDataSource).toBeTypeOf('string')
      const structuredData = JSON.parse(structuredDataSource ?? '{}') as {
        '@type'?: string
        breadcrumb?: {
          itemListElement?: Array<{ item?: string; name?: string }>
        }
        description?: string
        inLanguage?: string
        isPartOf?: { brand?: { name?: string }; url?: string }
        name?: string
        url?: string
      }
      expect(structuredData).toMatchObject({
        '@type': 'WebPage',
        description,
        inLanguage: locale,
        name: content.name,
        url: canonical,
      })
      expect(structuredData.breadcrumb?.itemListElement).toEqual([
        {
          '@type': 'ListItem',
          position: 1,
          name:
            locale === 'zh-CN'
              ? '史前动物博物馆'
              : 'Prehistoric Animal Museum',
          item: `https://example.test/museum/${locale}/`,
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: content.name,
          item: canonical,
        },
      ])
      expect(structuredData.isPartOf).toMatchObject({
        brand: {
          name: 'Leon做了个',
        },
        url: `https://example.test/museum/${locale}/`,
      })
    },
  )

  it('emits exactly one localized detail artifact for all 18 animals', () => {
    const expectedDetailArtifacts = detailCases
      .map(
        ({ animalId, locale }) =>
          `${locale}/animals/${animalId}/index.html`,
      )
      .sort()

    expect(
      [...artifacts.keys()]
        .filter((fileName) => fileName.includes('/animals/'))
        .sort(),
    ).toEqual(expectedDetailArtifacts)
  })

  it('links the localized catalogue to every published detail page', () => {
    for (const locale of locales) {
      const document = parseHtml(
        artifactSource(artifacts, `${locale}/index.html`),
      )

      for (const animalId of mainCollection.animalIds) {
        expect(
          document
            .querySelector<HTMLAnchorElement>(
              `[data-animal-id="${animalId}"] a`,
            )
            ?.getAttribute('href'),
        ).toBe(`./animals/${animalId}/`)
      }
    }
  })

  it('declares the complete reciprocal hreflang set on every page', () => {
    for (const fileName of ['index.html', 'zh-CN/index.html', 'en/index.html']) {
      const document = parseHtml(artifactSource(artifacts, fileName))
      const alternates = Object.fromEntries(
        [...document.querySelectorAll<HTMLLinkElement>('link[rel="alternate"]')].map(
          (link) => [link.hreflang, link.href],
        ),
      )

      expect(alternates).toEqual({
        'zh-CN': 'https://example.test/museum/zh-CN/',
        en: 'https://example.test/museum/en/',
        'x-default': 'https://example.test/museum/',
      })
    }
  })

  it('rebases only document assets for nested locale pages', () => {
    const localizedHtml = artifactSource(artifacts, 'en/index.html')

    expect(localizedHtml).toContain('src="../assets/app-123.js"')
    expect(localizedHtml).toContain('href="../assets/app-123.css"')
    expect(localizedHtml).toContain('href="../favicon.svg"')
    expect(localizedHtml).not.toContain('src="./assets/app-123.js"')
  })

  it('emits distinct localized museum-level social cards', () => {
    const zhCN = artifactSource(artifacts, 'social/museum.zh-CN.svg')
    const en = artifactSource(artifacts, 'social/museum.en.svg')

    expect(zhCN).toContain('史前动物博物馆')
    expect(zhCN).toContain('Leon做了个')
    expect(en).toContain('Prehistoric Animal Museum')
    expect(en).toContain('Leon Made This')
    expect(en).toContain('font-family="ui-rounded, system-ui, sans-serif"')
    expect(zhCN).not.toBe(en)
  })

  it.each([
    ['entry-fallback', 'index.html', 'museum.zh-CN.png'],
    ['zh-CN', 'zh-CN/index.html', 'museum.zh-CN.png'],
    ['en', 'en/index.html', 'museum.en.png'],
  ] as const)(
    'emits a scraper-compatible 1200×630 PNG social card for %s',
    async (locale, documentName, imageName) => {
      const png = await readFile(`public/social/${imageName}`)
      const metadata = await sharp(png).metadata()
      expect(metadata.format).toBe('png')
      expect(metadata.width).toBe(1200)
      expect(metadata.height).toBe(630)

      const document = parseHtml(artifactSource(artifacts, documentName))
      expect(
        document
          .querySelector('meta[property="og:image"]')
          ?.getAttribute('content'),
      ).toBe(`https://example.test/museum/social/${imageName}`)
      expect(
        document
          .querySelector('meta[property="og:image:type"]')
          ?.getAttribute('content'),
      ).toBe('image/png')
      expect(
        document
          .querySelector('meta[name="twitter:image:alt"]')
          ?.getAttribute('content'),
      ).toBe(
        document
          .querySelector('meta[property="og:image:alt"]')
          ?.getAttribute('content'),
      )
    },
  )

  it('binds checked-in cards to copy, layout and embedded font inputs', async () => {
    const manifest: unknown = JSON.parse(
      await readFile('public/social/manifest.json', 'utf8'),
    )
    const expectedManifest = createSeoSocialCardManifest()
    expect(manifest).toEqual(expectedManifest)
    for (const locale of ['x-default', 'zh-CN', 'en'] as const) {
      expect(expectedManifest.cards[locale].sourceSha256).toMatch(
        /^[a-f0-9]{64}$/,
      )
    }
  })

  it('emits a root robots file, canonical-only sitemap and a real noindex 404', () => {
    expect(artifactSource(artifacts, 'robots.txt')).toBe(
      'User-agent: *\nAllow: /\nSitemap: https://example.test/sitemap.xml\n',
    )

    const sitemap = artifactSource(artifacts, 'sitemap.xml')
    const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
      .map((match) => match[1])
      .sort()
    const expectedSitemapUrls = [
      'https://example.test/museum/zh-CN/',
      'https://example.test/museum/en/',
      ...detailCases.map(
        ({ animalId, locale }) =>
          `https://example.test/museum/${locale}/animals/${animalId}/`,
      ),
    ].sort()

    expect(sitemapUrls).toEqual(expectedSitemapUrls)
    expect(sitemapUrls).toHaveLength(38)
    expect(sitemapUrls).not.toContain('https://example.test/museum/')

    const notFound = parseHtml(artifactSource(artifacts, '404.html'))
    expect(
      notFound.querySelector('meta[name="robots"]')?.getAttribute('content'),
    ).toBe('noindex, follow')
    expect(notFound.querySelector('h1')?.textContent).toContain('404')
    const returnLink = notFound.querySelector('a[data-museum-return]')
    expect(returnLink?.getAttribute('href')).toBe(
      '/prehistoric-animal-museum/',
    )
  })
})
