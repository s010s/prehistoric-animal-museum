import type { Plugin } from 'vite'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadAnimalDefinitions } from './content-data'
import { buildCreditEntries, renderThirdPartyNotices } from './credits'
import { releaseCandidateAnimalIds } from '../src/content/release-candidate'
import { mainCollection } from '../src/content/collections/main'

export async function canonicalAnimalCatalog(mode: string): Promise<{
  plugin: Plugin
  notices?: string
}> {
  const candidate = mode === 'release-candidate'
  const allowed = new Set<string>(releaseCandidateAnimalIds)
  const packages = (await loadAnimalDefinitions(mainCollection.animalIds)).filter(({ definition }) =>
    definition.status === 'published' || (candidate && allowed.has(definition.id)),
  )
  if (candidate && (process.env.MUSEUM_RELEASE_CANDIDATE !== '1' ||
      packages.length !== 36 || ![...allowed].every(id => packages.some(p => p.definition.id === id)))) {
    throw new Error('Use build:release-candidate with all12complete canonical packages.')
  }
  const selectedIds = new Set(packages.map(p => p.definition.id))
  const readJson = (file: string) => JSON.parse(readFileSync(resolve('src/scale-encounter', file), 'utf8')) as Record<string, unknown>
  const select = (record: Record<string, unknown>) => Object.fromEntries(Object.entries(record).filter(([key]) => selectedIds.has(key)))
  const metadata = select(readJson('canonical-comparison-metadata.json'))
  const contacts = select(readJson('canonical-idle-contacts.json'))
  const footprints = select(readJson('canonical-motion-footprints.json'))
  const audioManifest = JSON.parse(readFileSync(resolve('src/scale-encounter/audio/additions-manifest.json'), 'utf8')) as { tracks: { animalId: string; locale: string; phase: string; file: string; script: string; sha256: string; durationMs: number }[] }
  const audio = audioManifest.tracks.filter(t => selectedIds.has(t.animalId))
  const previewId = '\0virtual:canonical-model-previews'
  const previews = packages.flatMap(({ definition }) => readdirSync(resolve('src/content/animals', definition.id, 'images'), { withFileTypes: true }).filter(f => f.isFile() && /^preview-.*\.webp$/.test(f.name)).map(f => ({id:definition.id,file:f.name})))
  const extensionId = '\0virtual:canonical-comparison-extension'
  const id = '\0virtual:canonical-animal-catalog'
  const creditsId = '\0virtual:canonical-credits'
  return {
    ...(candidate ? { notices: renderThirdPartyNotices(packages, true) } : {}),
    plugin: {
      name: 'canonical-animal-catalog',
      resolveId(source) {
        if (source === 'virtual:canonical-animal-catalog') return id
        if (source === 'virtual:canonical-comparison-extension') return extensionId
        if (source === 'virtual:canonical-model-previews') return previewId
        if (source === 'virtual:canonical-credits') return creditsId
      },
      load(source) {
        if (source === previewId) {
          return previews.map((p, i) => `import preview${i} from '/src/content/animals/${p.id}/images/${p.file}?url'`).join('\n') + `\nexport const modelPreviewModules={${previews.map((p, i) => `${JSON.stringify(`../content/animals/${p.id}/images/${p.file}`)}:preview${i}`).join(',')}}`
        }
        if (source === extensionId) {
          const imports = audio.map((t, i) => `import audio${i} from '/src/scale-encounter/audio/${t.file}?url'`)
          const rows: Record<string, Record<string, Record<string, string>>> = {}
          audio.forEach((t, i) => {
            const localized = rows[t.animalId] ??= {}
            const phases = localized[t.locale] ??= {}
            phases[t.phase] = `{url:audio${i},script:${JSON.stringify(t.script)},sha256:${JSON.stringify(t.sha256)},durationMs:${t.durationMs}}`
          })
          const audioObject = Object.entries(rows).map(([id, locales]) => `${JSON.stringify(id)}:{${Object.entries(locales).map(([locale, phases]) => `${JSON.stringify(locale)}:{${Object.entries(phases).map(([phase, value]) => `${JSON.stringify(phase)}:${value}`).join(',')}}`).join(',')}}`).join(',')
          return `${imports.join('\n')}\nexport const comparisonMetadata=${JSON.stringify(metadata)};export const comparisonAudio={${audioObject}};export const idleContacts=${JSON.stringify(contacts)};export const motionFootprints=${JSON.stringify(footprints)}`
        }
        if (source === creditsId) {
          return `export const credits=${JSON.stringify(buildCreditEntries(packages, candidate))}`
        }
        if (source !== id) return
        const imports = packages.map(({ definition }, i) =>
          `import * as animal${i} from '/src/content/animals/${definition.id}/animal.ts'`,
        )
        const entries = packages.map(({ definition }, i) =>
          `${JSON.stringify(`./animals/${definition.id}/animal.ts`)}:animal${i}`,
        )
        return `${imports.join('\n')}\nexport const animalModules={${entries.join(',')}}`
      },
    },
  }
}
