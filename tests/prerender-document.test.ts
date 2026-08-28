import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  renderPrerenderedMuseumDocument,
  writeLocalizedMuseumPrerenders,
} from '../scripts/prerender-localized-museum'
import { mainAnimals } from '../src/content/catalog'
import { mainCollection } from '../src/content/collections/main'
import { renderMuseumApp } from '../src/entry-server'

const locales = ['zh-CN', 'en'] as const
const detailPages = locales.flatMap((locale) =>
  mainCollection.animalIds.map((animalId) => ({ animalId, locale })),
)
const animalsById = new Map(mainAnimals.map((animal) => [animal.id, animal]))

describe('localized museum prerender document', () => {
  it('replaces the temporary shell with real application markup and bootstrap state', () => {
    const source = `<!doctype html>
      <html lang="en">
        <head><title>Museum</title><style id="seo-static-shell-style">.seo-static-shell { display: block; }</style></head>
        <body>
          <div id="root"><!--museum-root-start--><main class="seo-static-shell">Temporary</main><!--museum-root-end--></div>
          <script type="module" src="../assets/app.js"></script>
        </body>
      </html>`

    const result = renderPrerenderedMuseumDocument(
      source,
      {
        animalId: 'stegosaurus',
        locale: 'en',
        pageKind: 'museum',
        preference: 'en',
      },
      '<main id="museum-experience" data-locale="en"><img src="/assets/stegosaurus.webp" alt="" />Stegosaurus</main>',
    )

    const document = new DOMParser().parseFromString(result, 'text/html')
    expect(document.querySelector('.seo-static-shell')).toBeNull()
    expect(document.querySelector('#seo-static-shell-style')).toBeNull()
    expect(document.querySelector('#museum-experience')?.textContent).toBe(
      'Stegosaurus',
    )
    expect(
      document.querySelector('#museum-bootstrap')?.textContent,
    ).toBe(
      '{"animalId":"stegosaurus","locale":"en","pageKind":"museum","preference":"en"}',
    )
    expect(
      document.querySelector('script[type="module"]')?.getAttribute('src'),
    ).toBe('../assets/app.js')
    expect(
      document.querySelector('#museum-experience img')?.getAttribute('src'),
    ).toBe('../assets/stegosaurus.webp')
  })

  it('keeps fallback application assets relative to the museum entry', () => {
    const source = `<!doctype html><html lang="zh-CN"><head></head><body><div id="root"><!--museum-root-start-->Temporary<!--museum-root-end--></div><script type="module" src="./assets/app.js"></script></body></html>`
    const result = renderPrerenderedMuseumDocument(
      source,
      {
        animalId: 'stegosaurus',
        locale: 'zh-CN',
        pageKind: 'museum',
        preference: 'zh-CN',
        rootFallback: true,
      },
      '<main id="museum-experience"><img src="/assets/stegosaurus.webp" alt="" /></main>',
    )
    const document = new DOMParser().parseFromString(result, 'text/html')

    expect(
      document.querySelector('script[type="module"]')?.getAttribute('src'),
    ).toBe('./assets/app.js')
    expect(
      document.querySelector('#museum-experience img')?.getAttribute('src'),
    ).toBe('./assets/stegosaurus.webp')
  })

  it('keeps nested animal-detail application assets relative to the deep link', () => {
    const source = `<!doctype html><html lang="en"><head><link rel="stylesheet" href="../../../assets/app.css" /></head><body><div id="root"><!--museum-root-start--><main class="animal-page">Temporary</main><!--museum-root-end--></div><script type="module" src="../../../assets/app.js"></script></body></html>`
    const result = renderPrerenderedMuseumDocument(
      source,
      {
        animalId: 'mosasaurus',
        locale: 'en',
        pageKind: 'animal-detail',
        preference: 'en',
      },
      '<main id="museum-experience" data-page-kind="animal-detail"><img src="/assets/mosasaurus.webp" alt="" />Mosasaurus</main>',
    )
    const document = new DOMParser().parseFromString(result, 'text/html')

    expect(
      document.querySelector('#museum-bootstrap')?.textContent,
    ).toBe(
      '{"animalId":"mosasaurus","locale":"en","pageKind":"animal-detail","preference":"en"}',
    )
    expect(
      document.querySelector('script[type="module"]')?.getAttribute('src'),
    ).toBe('../../../assets/app.js')
    expect(
      document.querySelector('link[rel="stylesheet"]')?.getAttribute('href'),
    ).toBe('../../../assets/app.css')
    expect(
      document.querySelector('#museum-experience img')?.getAttribute('src'),
    ).toBe('../../../assets/mosasaurus.webp')
  })

  it('writes real server-rendered first frames to the fallback and localized build documents', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'museum-prerender-'))
    const template = `<!doctype html><html lang="en"><head></head><body><div id="root"><!--museum-root-start--><main class="seo-static-shell">Temporary</main><!--museum-root-end--></div></body></html>`
    const detailTemplate = `<!doctype html><html lang="en"><head><style id="animal-detail-fallback-style">.animal-page { display: block; }</style></head><body><div id="root"><!--museum-root-start--><main class="animal-page">Temporary</main><!--museum-root-end--></div><script type="module" src="../../../assets/app.js"></script></body></html>`
    try {
      await mkdir(join(outputDirectory, 'en'), { recursive: true })
      await mkdir(join(outputDirectory, 'zh-CN'), { recursive: true })
      await Promise.all(
        detailPages.map(({ locale, animalId }) =>
          mkdir(join(outputDirectory, locale, 'animals', animalId), {
            recursive: true,
          }),
        ),
      )
      await writeFile(join(outputDirectory, 'index.html'), template)
      await writeFile(join(outputDirectory, 'en/index.html'), template)
      await writeFile(join(outputDirectory, 'zh-CN/index.html'), template)
      await Promise.all(
        detailPages.map(({ locale, animalId }) =>
          writeFile(
            join(
              outputDirectory,
              locale,
              'animals',
              animalId,
              'index.html',
            ),
            detailTemplate,
          ),
        ),
      )

      await writeLocalizedMuseumPrerenders(
        outputDirectory,
        renderMuseumApp,
      )

      const english = await readFile(
        join(outputDirectory, 'en/index.html'),
        'utf8',
      )
      const chinese = await readFile(
        join(outputDirectory, 'zh-CN/index.html'),
        'utf8',
      )
      const fallback = await readFile(
        join(outputDirectory, 'index.html'),
        'utf8',
      )
      const englishMosasaurus = await readFile(
        join(
          outputDirectory,
          'en/animals/mosasaurus/index.html',
        ),
        'utf8',
      )
      expect(english).toContain('data-locale="en"')
      expect(english).toContain('data-page-kind="museum"')
      expect(english).toContain('Stegosaurus')
      expect(chinese).toContain('data-locale="zh-CN"')
      expect(chinese).toContain('剑龙')
      expect(fallback).toContain('id="museum-experience"')
      expect(fallback).toContain('data-locale="zh-CN"')
      expect(fallback).toContain('剑龙')
      expect(fallback).not.toContain('seo-static-shell')
      expect(fallback).toContain(
        'href="./zh-CN/animals/mosasaurus/"',
      )

      const localizedDetails = await Promise.all(
        detailPages.map(async ({ animalId, locale }) => ({
          animalId,
          locale,
          source: await readFile(
            join(
              outputDirectory,
              locale,
              'animals',
              animalId,
              'index.html',
            ),
            'utf8',
          ),
        })),
      )

      expect(localizedDetails).toHaveLength(36)
      for (const { animalId, locale, source } of localizedDetails) {
        const animal = animalsById.get(animalId)
        if (!animal) {
          throw new Error(`Missing canonical published animal ${animalId}`)
        }
        const content = animal.content[locale]
        const document = new DOMParser().parseFromString(source, 'text/html')
        const museum = document.querySelector('#museum-experience')
        const bootstrapSource = document.querySelector(
          '#museum-bootstrap',
        )?.textContent

        expect(museum).not.toBeNull()
        expect(museum?.getAttribute('data-locale')).toBe(locale)
        expect(museum?.getAttribute('data-page-kind')).toBe('animal-detail')
        expect(museum?.getAttribute('data-requested-animal-id')).toBe(animalId)
        expect(document.querySelector('h1.animal-title')?.textContent).toBe(
          content.name,
        )
        expect(document.querySelector('.child-intro')?.textContent).toContain(
          content.visibleFeature,
        )
        expect(
          document
            .querySelector<HTMLImageElement>('.model-still img')
            ?.getAttribute('src'),
        ).toContain(`/animals/${animalId}/`)
        expect(JSON.parse(bootstrapSource ?? '{}')).toEqual({
          animalId,
          locale,
          pageKind: 'animal-detail',
          preference: locale,
        })
        expect(
          document
            .querySelector('[data-museum-return]')
            ?.getAttribute('href'),
        ).toBe(`../../../${locale}/?animal=${animalId}`)
        expect(
          document.querySelectorAll('[data-animal-detail-link]'),
        ).toHaveLength(mainCollection.animalIds.length)
        for (const linkedAnimalId of mainCollection.animalIds) {
          expect(
            document
              .querySelector(
                `[data-animal-detail-link][data-animal-id="${linkedAnimalId}"]`,
              )
              ?.getAttribute('href'),
          ).toBe(`../${linkedAnimalId}/`)
        }
        expect(
          document.querySelector('script[type="module"]')?.getAttribute('src'),
        ).toBe('../../../assets/app.js')
        expect(document.querySelector('#animal-detail-fallback-style')).toBeNull()
        expect(document.querySelector('.animal-page')).toBeNull()
        expect(document.querySelector('.seo-static-shell')).toBeNull()
        expect(document.querySelector('.museum-reading-room')).toBeNull()
        expect(document.querySelectorAll('.drawer-layer[hidden]')).toHaveLength(2)
        expect(
          document.querySelector('.research-disclosure')?.textContent,
        ).toContain(content.facts.period)
        expect(
          document.querySelector('.research-disclosure')?.textContent,
        ).toContain(content.parentClassificationNote)
        if (content.facts.size.kind === 'group-range') {
          const researchText =
            document.querySelector('.research-disclosure')?.textContent ?? ''
          expect(researchText).toContain(content.facts.size.note)
          expect(researchText).not.toContain(
            locale === 'zh-CN'
              ? `参考范围为${content.facts.size.note}`
              : `uses ${content.facts.size.note}`,
          )
        }
        expect(
          document.querySelector('.research-disclosure summary')?.textContent,
        ).toContain(content.name)
        expect(
          document.querySelector('.research-disclosure')?.hasAttribute('open'),
        ).toBe(false)
        expect(
          document.querySelector<HTMLAnchorElement>(
            '.parent-drawer a[href="https://leon-made-this.work/"]',
          ),
        ).not.toBeNull()
      }

      expect(englishMosasaurus).toContain('id="museum-experience"')
      expect(englishMosasaurus).toContain('data-locale="en"')
      expect(englishMosasaurus).toContain(
        'data-page-kind="animal-detail"',
      )
      expect(englishMosasaurus).toContain(
        'data-requested-animal-id="mosasaurus"',
      )
      expect(englishMosasaurus).toContain(
        '<h1 class="animal-title">Mosasaurus</h1>',
      )
      expect(englishMosasaurus).toContain('Prehistoric Animal Museum')
      expect(englishMosasaurus).toContain(
        'data-museum-return="" href="../../../en/?animal=mosasaurus"',
      )
      expect(englishMosasaurus).toContain('href="../stegosaurus/"')
      expect(englishMosasaurus).toContain(
        '<script type="module" src="../../../assets/app.js"></script>',
      )
      expect(englishMosasaurus).not.toContain('animal-detail-fallback-style')
      expect(englishMosasaurus).not.toContain('class="animal-page"')
    } finally {
      await rm(outputDirectory, { recursive: true })
    }
  })
})
