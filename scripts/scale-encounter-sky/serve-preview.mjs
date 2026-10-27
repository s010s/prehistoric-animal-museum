import { build, preview } from 'vite'
import { fileURLToPath } from 'node:url'

const configFile = fileURLToPath(
  new URL('../../prototypes/scale-encounter-sky/vite.config.ts', import.meta.url),
)

await build({ configFile, mode: 'sky-review' })
const server = await preview({ configFile, mode: 'sky-review' })
server.printUrls()

const stop = async () => {
  await server.close()
  process.exit(0)
}

process.once('SIGINT', () => void stop())
process.once('SIGTERM', () => void stop())
