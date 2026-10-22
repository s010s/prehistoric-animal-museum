import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { build } from 'vite'
import sharp from 'sharp'

import { writeLocalizedMuseumPrerenders } from './prerender-localized-museum'
import type { InitialAppState } from '../src/app-bootstrap'
import { staticAnimalDetailIds } from '../src/content/static-animal-details'

const projectRoot = resolve(import.meta.dirname, '..')
const modeIndex = process.argv.indexOf('--mode')
const mode = modeIndex === -1 ? 'production' : (process.argv[modeIndex + 1] ?? 'production')
const outputDirectory = resolve(projectRoot, mode === 'release-candidate' ? 'dist-release-candidate' : 'dist')
const serverOutputDirectory = resolve(projectRoot, mode === 'release-candidate' ? '.prerender-ssr-release-candidate' : '.prerender-ssr')

async function writeAnimalSocialImages(): Promise<void> {
  for (const animalId of staticAnimalDetailIds) {
    const targetDirectory = resolve(outputDirectory, 'animals', animalId)
    await mkdir(targetDirectory, { recursive: true })
    const animalDirectory = resolve(
      projectRoot,
      'src/content/animals',
      animalId,
    )
    const hero = await sharp(
      resolve(animalDirectory, 'backgrounds/landscape.webp'),
    )
      .resize(1200, 675, { fit: 'cover' })
      .composite([
        { input: resolve(animalDirectory, 'images/poster.webp') },
      ])
      .webp({ effort: 5, quality: 86 })
      .toBuffer()
    await sharp(hero)
      .resize(1200, 630, { fit: 'cover' })
      .webp({ effort: 5, quality: 86 })
      .toFile(resolve(targetDirectory, 'social.webp'))
  }
}

try {
  await build({
    build: { outDir: outputDirectory },
    configFile: resolve(projectRoot, 'vite.config.ts'),
    mode,
    root: projectRoot,
  })
  await build({
    build: {
      copyPublicDir: false,
      emptyOutDir: true,
      outDir: serverOutputDirectory,
      ssr: resolve(projectRoot, 'src/entry-server.tsx'),
    },
    configFile: resolve(projectRoot, 'vite.config.ts'),
    mode,
    root: projectRoot,
  })

  const serverEntryUrl = pathToFileURL(
    resolve(serverOutputDirectory, 'entry-server.js'),
  )
  serverEntryUrl.searchParams.set('build', String(Date.now()))
  const serverEntry = (await import(serverEntryUrl.href)) as {
    readonly renderMuseumApp: (state: InitialAppState) => string
  }

  await writeLocalizedMuseumPrerenders(
    outputDirectory,
    serverEntry.renderMuseumApp,
  )
  await writeAnimalSocialImages()
} finally {
  await rm(serverOutputDirectory, { force: true, recursive: true })
}
