import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.glb', 'model/gltf-binary'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.mp3', 'audio/mpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.xml', 'application/xml; charset=utf-8'],
])

const args = process.argv.slice(2)
const rootArgument = args[0]?.startsWith('--') ? 'dist' : (args[0] ?? 'dist')

function option(name, fallback) {
  const index = args.indexOf(name)
  return index === -1 ? fallback : (args[index + 1] ?? fallback)
}

const root = resolve(process.cwd(), rootArgument)
const port = Number(option('--port', process.env.PORT ?? '4173'))
const host = option('--host', process.env.HOST ?? '127.0.0.1')
const rawBase = option('--base', '/')
const base = `/${rawBase.split('/').filter(Boolean).join('/')}${rawBase === '/' ? '' : '/'}`
const fixtureModelDelayMs = Number(option('--fixture-model-delay', '0'))
const cacheHashedAssets = args.includes('--cache-hashed-assets')

if (!Number.isFinite(fixtureModelDelayMs) || fixtureModelDelayMs < 0) {
  console.error('--fixture-model-delay must be a non-negative number')
  process.exit(1)
}

if (!existsSync(root) || !statSync(root).isDirectory()) {
  console.error(`Static root does not exist: ${root}`)
  process.exit(1)
}

function sendFile(filePath, response, delayMs = 0, statusCode = 200) {
  const isHashedAsset = /[/\\]assets[/\\][^/\\]+-[\w-]{8}\.[^/\\]+$/.test(filePath)
  response.writeHead(statusCode, {
    'Content-Type': mimeTypes.get(extname(filePath).toLowerCase()) ?? 'application/octet-stream',
    // This server is only used for local review. Keeping JS, GLB, and audio in
    // Chrome's HTTP cache made a newly synced 4190 build appear to retain old
    // behavior for up to an hour, even though dist had already been replaced.
    // Cache tests opt into production-like caching for fingerprinted assets.
    // Normal local review still always sees newly synced builds immediately.
    'Cache-Control': cacheHashedAssets && isHashedAsset
      ? 'public, max-age=31536000, immutable'
      : 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  if (delayMs > 0) {
    // The opt-in e2e fixture keeps a real network transfer pending long enough
    // to verify the delayed large-model notice and its cache-hit suppression.
    response.flushHeaders()
    setTimeout(() => {
      createReadStream(filePath).pipe(response)
    }, delayMs)
    return
  }
  createReadStream(filePath).pipe(response)
}

function sendNotFound(response) {
  const notFoundPath = resolve(root, '404.html')
  if (existsSync(notFoundPath) && statSync(notFoundPath).isFile()) {
    sendFile(notFoundPath, response, 0, 404)
    return
  }

  response.writeHead(404, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end('Not found')
}

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

  if (!requestUrl.pathname.startsWith(base)) {
    response.writeHead(302, { Location: base })
    response.end()
    return
  }

  const relativePath = decodeURIComponent(requestUrl.pathname.slice(base.length))
  const requestedPath = resolve(root, relativePath)
  const isInsideRoot = requestedPath === root || requestedPath.startsWith(`${root}${sep}`)

  if (!isInsideRoot) {
    response.writeHead(403)
    response.end('Forbidden')
    return
  }

  if (existsSync(requestedPath) && statSync(requestedPath).isFile()) {
    const delayMs =
      requestUrl.searchParams.get('fixture') === 'fixture-slow' &&
      extname(requestedPath).toLowerCase() === '.glb'
        ? fixtureModelDelayMs
        : 0
    sendFile(requestedPath, response, delayMs)
    return
  }

  if (existsSync(requestedPath) && statSync(requestedPath).isDirectory()) {
    if (!requestUrl.pathname.endsWith('/')) {
      response.writeHead(301, {
        Location: `${requestUrl.pathname}/${requestUrl.search}`,
      })
      response.end()
      return
    }

    const directoryIndex = resolve(requestedPath, 'index.html')
    if (existsSync(directoryIndex) && statSync(directoryIndex).isFile()) {
      sendFile(directoryIndex, response)
      return
    }
  }

  sendNotFound(response)
})

server.listen(port, host, () => {
  console.log(`Serving ${root} at http://${host}:${port}${base}`)
})
