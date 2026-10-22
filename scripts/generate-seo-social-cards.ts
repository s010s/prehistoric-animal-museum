import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createSeoSocialCardManifest,
  renderSocialCardPng,
} from './multilingual-seo'

const outputIndex = process.argv.indexOf('--out')
const outputDirectory = outputIndex >= 0
  ? resolve(process.argv[outputIndex + 1] ?? '')
  : fileURLToPath(new URL('../public/social/', import.meta.url))

const manifest = createSeoSocialCardManifest()

// librsvg/Pango share a process-wide font cache. Render in a fixed sequence so
// two cards cannot race while registering the embedded project fonts.
for (const locale of ['x-default', 'zh-CN', 'en'] as const) {
  const { fileName } = manifest.cards[locale]
  const outputPath = resolve(outputDirectory, fileName)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, await renderSocialCardPng(locale))
}
await writeFile(
  resolve(outputDirectory, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
)

console.log(`Generated localized SEO social cards in ${outputDirectory}.`)
