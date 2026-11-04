import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'
import sharp from 'sharp'

import { createMultilingualSeoArtifacts } from '../scripts/multilingual-seo'
import { mainCollection } from '../src/content/collections/main'

const locales = ['zh-CN', 'en'] as const
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

  it.each([
    ['entry-fallback', 'index.html', 'museum.zh-CN.png'],
    ['zh-CN', 'zh-CN/index.html', 'museum.zh-CN.png'],
    ['en', 'en/index.html', 'museum.en.png'],
  ] as const)(
    'emits a scraper-compatible 1200×630 PNG social card for %s',
    async (_locale, documentName, imageName) => {
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
    },
  )

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
    expect(sitemapUrls).not.toContain('https://example.test/museum/')

    const notFound = parseHtml(artifactSource(artifacts, '404.html'))
    expect(
      notFound.querySelector('meta[name="robots"]')?.getAttribute('content'),
    ).toBe('noindex, follow')
  })
})
