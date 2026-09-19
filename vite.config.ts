import { flightReviewTracePlugin } from './scripts/flight/review-trace-plugin'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import {
  localReviewAssetFiles,
  localReviewAssetPrefix,
} from './scripts/review-assets'
import {
  assertReviewModeIsServeOnly,
  isPrivateLocalMaterialRequest,
  parseAllowedHosts,
  privateLocalMaterialDenyForRoot,
} from './scripts/review-server-security'
import { multilingualSeoPlugin } from './scripts/multilingual-seo'
import { scaleEncounterGlacierAssetUrls } from './scripts/scale-encounter-glacier-assets'

const redistributableNotices = [
  'LICENSE',
  'LICENSING.md',
  'CONTRIBUTING.md',
  'BRAND_POLICY.md',
  'THIRD_PARTY_NOTICES.md',
  'LICENSES/CC-BY-NC-SA-4.0.txt',
  'LICENSES/Lucide-ISC.txt',
  'LICENSES/OFL-1.1.txt',
  'LICENSES/React-MIT.txt',
  'LICENSES/Three.js-MIT.txt',
] as const

const generatedRedistributableNotices = [
  {
    fileName: 'SCALE_ENCOUNTER_ASSET_PROVENANCE.md',
    sourceFile: 'src/scale-encounter/assets/PROVENANCE.md',
  },
] as const

const dependencyNodeModulesRoot = fileURLToPath(
  new URL('..', import.meta.resolve('vite/package.json')),
)

const scaleEncounterEnabledModes = new Set([
  'development',
  'e2e',
  'production',
  'review',
  'test',
])

function scaleEncounterEntryAlias(mode: string): string {
  const entryFile = scaleEncounterEnabledModes.has(mode)
    ? './src/scale-encounter/entry-enabled.ts'
    : './src/scale-encounter/entry-disabled.ts'
  return fileURLToPath(new URL(entryFile, import.meta.url))
}

function viewerControllerEntryAlias(mode: string): string {
  const entryFile = scaleEncounterEnabledModes.has(mode)
    ? './src/viewer/ViewerController.ts'
    : './src/viewer/ViewerController.production.ts'
  return fileURLToPath(new URL(entryFile, import.meta.url))
}

function bundledNotices(flightEnabled = false): Plugin {
  return {
    name: 'bundled-notices',
    generateBundle() {
      if (flightEnabled) this.emitFile({ type: 'asset', fileName: 'FLIGHT_ASSET_PROVENANCE.md', source: readFileSync(new URL('./src/flight-experience/assets/PROVENANCE.md', import.meta.url), 'utf8') })
      for (const fileName of redistributableNotices) {
        this.emitFile({
          type: 'asset',
          fileName,
          source: readFileSync(new URL(fileName, import.meta.url), 'utf8'),
        })
      }
      for (const notice of generatedRedistributableNotices) {
        this.emitFile({
          type: 'asset',
          fileName: notice.fileName,
          source: readFileSync(
            new URL(notice.sourceFile, import.meta.url),
            'utf8',
          ),
        })
      }
    },
  }
}

const virtualReviewCatalog = 'virtual:local-review-catalog'
const resolvedVirtualReviewCatalog = `\0${virtualReviewCatalog}`

function reviewContentType(fileName: string): string {
  if (fileName.endsWith('.glb')) {
    return 'model/gltf-binary'
  }
  if (fileName.endsWith('.mp3')) {
    return 'audio/mpeg'
  }
  if (fileName.endsWith('.png')) {
    return 'image/png'
  }
  if (fileName.endsWith('.webp')) {
    return 'image/webp'
  }
  if (fileName.endsWith('.json')) {
    return 'application/json; charset=utf-8'
  }
  return 'application/octet-stream'
}

// Review URLs are stable while their local files can change. `no-cache` keeps
// the response body reusable after an ETag revalidation; `no-store` would make
// every revisit transfer the full model again over Tailscale.
const reviewAssetCacheControl = 'private, no-cache'

function reviewAssetEtag(size: number, mtimeMs: number): string {
  return `W/"${size.toString(16)}-${Math.trunc(mtimeMs).toString(16)}"`
}

function requestHasFreshReviewAsset(
  request: { readonly headers: Record<string, string | string[] | undefined> },
  etag: string,
  modifiedAt: Date,
): boolean {
  const ifNoneMatch = request.headers['if-none-match']
  if (ifNoneMatch !== undefined) {
    const candidates = Array.isArray(ifNoneMatch)
      ? ifNoneMatch
      : ifNoneMatch.split(',')
    return candidates.some((candidate) => {
      const value = candidate.trim()
      return value === '*' || value === etag
    })
  }

  const ifModifiedSince = request.headers['if-modified-since']
  if (typeof ifModifiedSince !== 'string') {
    return false
  }
  const cachedTime = Date.parse(ifModifiedSince)
  return (
    Number.isFinite(cachedTime) &&
    Math.floor(modifiedAt.getTime() / 1_000) <= Math.floor(cachedTime / 1_000)
  )
}

function streamReviewAsset(
  absolutePath: string,
  response: ServerResponse,
  range?: { readonly start: number; readonly end: number },
): void {
  const stream = createReadStream(absolutePath, range)
  const stopReading = () => {
    if (!stream.destroyed) {
      stream.destroy()
    }
  }
  const stopWatchingResponse = () => {
    response.off('close', stopReading)
  }

  response.once('close', stopReading)
  stream.once('close', stopWatchingResponse)
  stream.once('error', () => {
    stopWatchingResponse()
    if (!response.headersSent) {
      response.statusCode = 404
      response.removeHeader('Content-Length')
      response.removeHeader('Content-Range')
      response.setHeader('Content-Type', 'text/plain; charset=utf-8')
      response.end('Local review asset became unavailable.')
    } else if (!response.destroyed) {
      response.destroy()
    }
  })
  stream.pipe(response)
}

function localReview(enabled: boolean): Plugin {
  return {
    name: 'local-review-catalog',
    resolveId(id) {
      return id === virtualReviewCatalog
        ? resolvedVirtualReviewCatalog
        : undefined
    },
    load(id) {
      if (id !== resolvedVirtualReviewCatalog) {
        return undefined
      }
      return enabled
        ? "export { localReviewAnimals } from '/src/review/catalog.ts'"
        : 'export const localReviewAnimals = []'
    },
    configureServer(server) {
      if (!enabled) {
        return
      }
      server.middlewares.use((request, response, next) => {
        const requestUrl = request.url
        if (!requestUrl) {
          next()
          return
        }
        const pathname = new URL(requestUrl, 'http://localhost').pathname
        if (!pathname.startsWith(`${localReviewAssetPrefix}/`)) {
          next()
          return
        }
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader('X-Content-Type-Options', 'nosniff')
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.statusCode = 405
          response.setHeader('Allow', 'GET, HEAD')
          response.end('Local review assets are read-only.')
          return
        }
        const absolutePath = localReviewAssetFiles.get(pathname)
        if (!absolutePath) {
          response.statusCode = 404
          response.end('Unknown local review asset.')
          return
        }

        let size: number
        let modifiedAt: Date
        let modifiedAtMs: number
        try {
          const fileStat = statSync(absolutePath)
          if (!fileStat.isFile()) {
            throw new Error('Not a regular file.')
          }
          size = fileStat.size
          modifiedAt = fileStat.mtime
          modifiedAtMs = fileStat.mtimeMs
        } catch {
          response.statusCode = 404
          response.end(
            'Local review asset is missing. Run npm run validate:review.',
          )
          return
        }

        const etag = reviewAssetEtag(size, modifiedAtMs)
        response.setHeader('Cache-Control', reviewAssetCacheControl)
        response.setHeader('ETag', etag)
        response.setHeader('Last-Modified', modifiedAt.toUTCString())
        response.setHeader('Accept-Ranges', 'bytes')
        response.setHeader('Content-Type', reviewContentType(absolutePath))

        if (requestHasFreshReviewAsset(request, etag, modifiedAt)) {
          response.statusCode = 304
          response.end()
          return
        }

        const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/)
        if (range) {
          const start = Number(range[1])
          const requestedEnd = range[2] ? Number(range[2]) : size - 1
          const end = Math.min(requestedEnd, size - 1)
          if (
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) ||
            start < 0 ||
            start > end ||
            start >= size
          ) {
            response.statusCode = 416
            response.setHeader('Content-Range', `bytes */${size}`)
            response.end()
            return
          }
          response.statusCode = 206
          response.setHeader('Content-Length', String(end - start + 1))
          response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
          if (request.method === 'HEAD') {
            response.end()
            return
          }
          streamReviewAsset(absolutePath, response, { start, end })
          return
        }

        response.statusCode = 200
        response.setHeader('Content-Length', String(size))
        if (request.method === 'HEAD') {
          response.end()
          return
        }
        streamReviewAsset(absolutePath, response)
      })
    },
  }
}

function privateLocalMaterialGuard(): Plugin {
  return {
    name: 'private-local-material-guard',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url || !isPrivateLocalMaterialRequest(request.url)) {
          next()
          return
        }

        response.statusCode = 404
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader('Content-Type', 'text/plain; charset=utf-8')
        response.setHeader('X-Content-Type-Options', 'nosniff')
        response.end(request.method === 'HEAD' ? undefined : 'Not found.')
      })
    },
  }
}

export default defineConfig(({ command, mode }) => {
  assertReviewModeIsServeOnly(command, mode)
  const env = loadEnv(mode, process.cwd(), '')
  const allowedHosts = parseAllowedHosts(env.MUSEUM_ALLOWED_HOSTS)

  return {
    base: './',
    resolve: {
      alias: {
        'virtual:flight-experience-entry': fileURLToPath(new URL(
          command === 'serve' || mode === 'e2e' || env.MUSEUM_FLIGHT === '1'
            ? './src/flight-experience/entry-enabled.ts'
            : './src/flight-experience/entry-disabled.ts', import.meta.url)),
        'virtual:scale-encounter-entry': scaleEncounterEntryAlias(mode),
        'virtual:viewer-controller': viewerControllerEntryAlias(mode),
      },
    },
    plugins: [
      react(),
      flightReviewTracePlugin(),
      scaleEncounterGlacierAssetUrls(
        scaleEncounterEnabledModes.has(mode) ? 'bundled' : 'disabled',
      ),
      bundledNotices(mode === 'e2e' || env.MUSEUM_FLIGHT === '1'),
      multilingualSeoPlugin(),
      privateLocalMaterialGuard(),
      localReview(
        command === 'serve' &&
          (mode === 'review' || mode === 'development'),
      ),
    ],
    server: {
      allowedHosts,
      fs: {
        allow: [process.cwd(), dependencyNodeModulesRoot],
        deny: [...privateLocalMaterialDenyForRoot(process.cwd())],
      },
    },
    build: {
      manifest: mode === 'production',
      target: 'es2022',
      sourcemap: mode === 'e2e',
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: 'three',
                test: /node_modules[\\/]three/,
                maxSize: 450 * 1024,
                priority: 30,
              },
              {
                name: 'react',
                test: /node_modules[\\/](?:react|react-dom|scheduler)/,
                priority: 20,
              },
              {
                name: 'icons',
                test: /node_modules[\\/]lucide-react/,
                priority: 10,
              },
            ],
          },
        },
      },
    },
  }
})
