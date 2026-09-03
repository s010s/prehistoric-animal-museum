import { FALLBACK_STAR_COUNT, parseStarCount, renderBadge } from './badge.mjs'

const BADGE_PATH = '/github-stars.svg'
const GITHUB_REPOSITORY_API =
  'https://api.github.com/repos/s010s/prehistoric-animal-museum'
const FRESH_FOR_MS = 60 * 60 * 1_000
const KEEP_STALE_FOR_SECONDS = 7 * 24 * 60 * 60
const PUBLIC_CACHE_CONTROL =
  'public, max-age=3600, stale-while-revalidate=86400, stale-if-error=604800'
const FALLBACK_CACHE_CONTROL = 'public, max-age=300'

function responseHeaders({ cacheControl, cacheStatus, count, fetchedAt }) {
  return new Headers({
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': cacheControl,
    'Content-Type': 'image/svg+xml; charset=utf-8',
    ETag: `"github-stars-${count}"`,
    'X-Badge-Cache': cacheStatus,
    'X-Badge-Fetched-At': String(fetchedAt),
    'X-Content-Type-Options': 'nosniff',
  })
}

function storedBadgeResponse(count, fetchedAt) {
  return new Response(renderBadge(count), {
    headers: responseHeaders({
      cacheControl: `public, max-age=${KEEP_STALE_FOR_SECONDS}`,
      cacheStatus: 'STORED',
      count,
      fetchedAt,
    }),
  })
}

function publicBadgeResponse(stored, cacheStatus, method) {
  const headers = new Headers(stored.headers)
  headers.set('Cache-Control', PUBLIC_CACHE_CONTROL)
  headers.set('X-Badge-Cache', cacheStatus)
  return new Response(method === 'HEAD' ? null : stored.body, {
    status: stored.status,
    headers,
  })
}

function fallbackBadgeResponse(method, fetchedAt) {
  const headers = responseHeaders({
    cacheControl: FALLBACK_CACHE_CONTROL,
    cacheStatus: 'FALLBACK',
    count: FALLBACK_STAR_COUNT,
    fetchedAt,
  })
  headers.set('Warning', '110 - "GitHub unavailable; showing last known stars"')
  return new Response(
    method === 'HEAD' ? null : renderBadge(FALLBACK_STAR_COUNT),
    { headers },
  )
}

async function fetchCurrentBadge(fetchImpl, fetchedAt) {
  const response = await fetchImpl(GITHUB_REPOSITORY_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'prehistoric-animal-museum-github-stars-badge',
      'X-GitHub-Api-Version': '2026-03-10',
    },
    signal: AbortSignal.timeout(5_000),
  })

  if (!response.ok) {
    throw new Error(`GitHub returned HTTP ${response.status}.`)
  }

  const count = parseStarCount(await response.json())
  return storedBadgeResponse(count, fetchedAt)
}

async function safelyMatch(cache, cacheKey) {
  try {
    return await cache.match(cacheKey)
  } catch {
    return undefined
  }
}

async function safelyStore(cache, cacheKey, response) {
  try {
    await cache.put(cacheKey, response)
  } catch {
    // A cache write must never make the badge unavailable.
  }
}

export async function handleBadgeRequest(request, dependencies) {
  const method = request.method.toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD' },
    })
  }

  const url = new URL(request.url)
  if (url.pathname !== BADGE_PATH) {
    return new Response('Not Found', { status: 404 })
  }

  const now = dependencies.now()
  const cacheKeyUrl = new URL(BADGE_PATH, url.origin)
  const cacheKey = new Request(cacheKeyUrl, { method: 'GET' })
  const cached = await safelyMatch(dependencies.cache, cacheKey)

  if (cached) {
    const fetchedAt = Number(cached.headers.get('X-Badge-Fetched-At'))
    const isFresh =
      Number.isFinite(fetchedAt) && now - fetchedAt >= 0 && now - fetchedAt <= FRESH_FOR_MS

    if (isFresh) {
      return publicBadgeResponse(cached, 'HIT', method)
    }

    dependencies.waitUntil(
      fetchCurrentBadge(dependencies.fetchImpl, now)
        .then((fresh) => safelyStore(dependencies.cache, cacheKey, fresh))
        .catch(() => undefined),
    )
    return publicBadgeResponse(cached, 'STALE', method)
  }

  try {
    const fresh = await fetchCurrentBadge(dependencies.fetchImpl, now)
    dependencies.waitUntil(
      safelyStore(dependencies.cache, cacheKey, fresh.clone()),
    )
    return publicBadgeResponse(fresh, 'MISS', method)
  } catch {
    return fallbackBadgeResponse(method, now)
  }
}

export default {
  fetch(request, _environment, context) {
    return handleBadgeRequest(request, {
      cache: globalThis.caches.default,
      fetchImpl: fetch,
      now: Date.now,
      waitUntil: (promise) => context.waitUntil(promise),
    })
  },
}
