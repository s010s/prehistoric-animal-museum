import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  allReadmeScreenshotTargets,
  readmeScreenshotOutputDirectory,
  readmeScreenshotRelativePath,
  readmeScreenshotRoute,
  readmeScreenshotScenes,
} from '../scripts/readme-screenshots'
import { mainCollection } from '../src/content/collections/main'
import type { AnimalDefinitionModule } from '../src/content/types'

const canonicalDefinitionModules = import.meta.glob<AnimalDefinitionModule>(
  '../src/content/animals/*/package.ts',
  { eager: true },
)

describe('README reference screenshot plan', () => {
  it('keeps one matching land, sea, and air scene for each locale', () => {
    expect(readmeScreenshotScenes.map(({ animalId, key }) => ({ animalId, key })))
      .toEqual([
        { animalId: 'stegosaurus', key: 'land' },
        { animalId: 'mosasaurus', key: 'sea' },
        { animalId: 'tupandactylus', key: 'air' },
      ])

    const targets = allReadmeScreenshotTargets()
    expect(targets).toHaveLength(6)
    expect(new Set(targets.map(({ relativePath }) => relativePath)).size).toBe(6)

    for (const scene of readmeScreenshotScenes) {
      const pair = targets.filter(({ scene: targetScene }) => targetScene === scene)
      expect(pair.map(({ locale }) => locale)).toEqual(['zh-CN', 'en'])
      expect(new Set(pair.map(({ viewport }) => JSON.stringify(viewport))).size).toBe(1)
      expect(new Set(pair.map(({ animationTimeSeconds }) => animationTimeSeconds)).size)
        .toBe(1)
    }
  })

  it('uses explicit locale routes and an ignored handoff directory', () => {
    const scene = readmeScreenshotScenes[0]

    expect(readmeScreenshotRoute('zh-CN', scene)).toBe(
      'zh-CN/?animal=stegosaurus',
    )
    expect(readmeScreenshotRoute('en', scene)).toBe(
      'en/?animal=stegosaurus',
    )
    expect(readmeScreenshotOutputDirectory).toBe(
      '.handoff/readme-screenshots',
    )
    expect(readmeScreenshotRelativePath('zh-CN', scene)).toBe(
      'zh-CN/museum-land-stegosaurus.jpg',
    )
    expect(readmeScreenshotRelativePath('en', scene)).toBe(
      'en/museum-land-stegosaurus.jpg',
    )
  })

  it('keeps real interface captures out of both public READMEs', async () => {
    const [englishReadme, chineseReadme] = await Promise.all([
      readFile('README.md', 'utf8'),
      readFile('README.zh-CN.md', 'utf8'),
    ])
    const imageSources = (source: string) => [
      ...[...source.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/giu)].map(
        (match) => match[1] ?? '',
      ),
      ...[...source.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)].map(
        (match) => match[1] ?? '',
      ),
    ]
    const sharedReadmeGraphics = new Set([
      './assets/readme/github-stars.svg',
      'https://atomgit.com/leonleung/prehistoric-animal-museum/star/new_badge.svg',
    ])
    const isAllowedReadmeImage = (source: string, hero: string) =>
      source === hero ||
      sharedReadmeGraphics.has(source) ||
      /^\.\/src\/content\/animals\/[a-z0-9-]+\/images\/thumbnail\.webp$/u.test(
        source,
      )

    expect(
      imageSources(englishReadme).every((source) =>
        isAllowedReadmeImage(source, './assets/readme/hero.svg'),
      ),
    ).toBe(true)
    expect(
      imageSources(chineseReadme).every((source) =>
        isAllowedReadmeImage(source, './assets/readme/hero.zh-CN.svg'),
      ),
    ).toBe(true)
    expect(englishReadme).toContain('./assets/readme/hero.svg')
    expect(chineseReadme).toContain('./assets/readme/hero.zh-CN.svg')
    expect(englishReadme).toContain('./assets/readme/github-stars.svg')
    expect(chineseReadme).toContain('./assets/readme/github-stars.svg')
    expect(englishReadme).toContain('/images/thumbnail.webp')
    expect(chineseReadme).toContain('/images/thumbnail.webp')
  })

  it('keeps maintenance-only rollout details out of both public READMEs', async () => {
    const readmes = await Promise.all([
      readFile('README.md', 'utf8'),
      readFile('README.zh-CN.md', 'utf8'),
    ])
    const privateWorkflowMarkers = [
      '.handoff/',
      '.agents/skills/prehistoric-animal-onboarding',
      'build:cloudflare:assets',
      'capture:readme-screenshots',
      'first public-validation',
      'hreflang',
      'npm run review',
      'npm run test:review',
      'release-gated',
      'x-default',
      '发布门禁',
      '首轮公开验证',
    ]

    for (const readme of readmes) {
      for (const marker of privateWorkflowMarkers) {
        expect(readme).not.toContain(marker)
      }
    }
  })

  it('keeps both README collections count-agnostic and aligned with every published animal', async () => {
    const [englishReadme, chineseReadme] = await Promise.all([
      readFile('README.md', 'utf8'),
      readFile('README.zh-CN.md', 'utf8'),
    ])
    const definitionsById = new Map(
      Object.values(canonicalDefinitionModules).map(({ animalDefinition }) => [
        animalDefinition.id,
        animalDefinition,
      ]),
    )

    expect(englishReadme).toContain('## Exhibits across sea, land, and sky')
    expect(chineseReadme).toContain('## 来自海、陆、空的史前动物展品')
    expect(englishReadme).not.toContain(
      `## ${mainCollection.animalIds.length} animals across sea, land, and sky`,
    )
    expect(chineseReadme).not.toContain(
      `## ${mainCollection.animalIds.length} 种动物，来自海、陆、空`,
    )
    for (const id of mainCollection.animalIds) {
      const definition = definitionsById.get(id)
      if (!definition || definition.status !== 'published') {
        throw new Error(`Missing published README animal ${id}`)
      }
      expect(englishReadme).toContain(definition.content.en.name)
      expect(chineseReadme).toContain(definition.content['zh-CN'].name)
    }
  })

  it('captures the animal h2 only after locale narration is available', async () => {
    const captureSource = await readFile(
      'scripts/readme-screenshot-capture/capture.spec.ts',
      'utf8',
    )
    expect(captureSource).toMatch(/level:\s*2/)
    expect(captureSource).toContain("'Listen to its introduction'")
    expect(captureSource).toContain("'听它的介绍'")
    expect(captureSource).toMatch(/\)\.toBeEnabled\(\)/)
  })
})
