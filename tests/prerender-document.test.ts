import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeLocalizedMuseumPrerenders } from '../scripts/prerender-localized-museum'
import { mainAnimals } from '../src/content/catalog'
import { mainCollection } from '../src/content/collections/main'
import { renderMuseumApp } from '../src/entry-server'

const locales = ['zh-CN', 'en'] as const
const detailPages = locales.flatMap((locale) =>
  mainCollection.animalIds.map((animalId) => ({ animalId, locale })),
)
const animalsById = new Map(mainAnimals.map((animal) => [animal.id, animal]))

describe('localized museum prerender document', () => {
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
      expect(english).toContain('Stegosaurus')
      expect(chinese).toContain('剑龙')
      expect(fallback).toContain('剑龙')
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

      for (const { animalId, locale, source } of localizedDetails) {
        const animal = animalsById.get(animalId)
        if (!animal) {
          throw new Error(`Missing canonical published animal ${animalId}`)
        }
        const content = animal.content[locale]
        const document = new DOMParser().parseFromString(source, 'text/html')
        expect(document.querySelector('h1.animal-title')?.textContent).toBe(
          content.name,
        )
        expect(document.querySelector('.child-intro')?.textContent).toContain(
          content.visibleFeature,
        )
        expect(
          document
            .querySelector('[data-museum-return]')
            ?.getAttribute('href'),
        ).toBe(`../../../${locale}/?animal=${animalId}`)
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
          document.querySelector('.research-disclosure')?.textContent,
        ).toContain(content.facts.period)
        expect(
          document.querySelector('.fact-grid')?.textContent,
        ).toContain(content.parentClassificationNote)
        if (content.facts.size.kind === 'group-range') {
          expect(document.querySelector('.fact-grid')?.textContent).toContain(content.facts.size.note)
        }
      }
    } finally {
      await rm(outputDirectory, { recursive: true })
    }
  }, 15_000)
})
