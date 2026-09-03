import { readFile } from 'node:fs/promises'

import { describe, expect, it, vi } from 'vitest'

import { handleBadgeRequest } from '../workers/github-stars-badge/index.mjs'

class MemoryCache {
  private readonly entries = new Map<string, Response>()

  match(request: Request): Promise<Response | undefined> {
    return Promise.resolve(this.entries.get(request.url)?.clone())
  }

  put(request: Request, response: Response): Promise<void> {
    this.entries.set(request.url, response.clone())
    return Promise.resolve()
  }
}

function requestDependencies({
  cache = new MemoryCache(),
  fetchImpl,
  now,
}: {
  cache?: MemoryCache
  fetchImpl: typeof fetch
  now: () => number
}) {
  const pending: Promise<unknown>[] = []
  return {
    dependencies: {
      cache,
      fetchImpl,
      now,
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    },
    flush: () => Promise.all(pending),
  }
}

describe('GitHub stars badge Worker', () => {
  it('renders the branded SVG and serves subsequent requests from cache', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ stargazers_count: 857 }),
    )
    const helpers = requestDependencies({ fetchImpl, now: () => 10_000 })
    const request = new Request(
      'https://badges.example.com/github-stars.svg?ignored=true',
    )

    const miss = await handleBadgeRequest(request, helpers.dependencies)
    expect(miss.status).toBe(200)
    expect(miss.headers.get('Content-Type')).toBe(
      'image/svg+xml; charset=utf-8',
    )
    expect(miss.headers.get('Cache-Control')).toBe(
      'public, max-age=3600, stale-while-revalidate=86400, stale-if-error=604800',
    )
    expect(miss.headers.get('X-Badge-Cache')).toBe('MISS')
    const svg = await miss.text()
    expect(svg).toContain('width="240" height="54"')
    expect(svg).toContain('fill="#fffdf7" stroke="#356859"')
    expect(svg).toContain('PRIMARY REPOSITORY')
    expect(svg).toContain('>GitHub</text>')
    expect(svg).toContain('currently has 857 stars')
    expect(svg).toContain('>857</text>')
    await helpers.flush()

    const hit = await handleBadgeRequest(request, helpers.dependencies)
    expect(hit.headers.get('X-Badge-Cache')).toBe('HIT')
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('never interpolates a non-integer GitHub response into SVG', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ stargazers_count: '857"><script>alert(1)</script>' }),
    )
    const helpers = requestDependencies({ fetchImpl, now: () => 20_000 })

    const response = await handleBadgeRequest(
      new Request('https://badges.example.com/github-stars.svg'),
      helpers.dependencies,
    )
    const body = await response.text()

    expect(response.headers.get('X-Badge-Cache')).toBe('FALLBACK')
    expect(body).toContain('currently has 860 stars')
    expect(body).not.toContain('<script>')
  })

  it('serves stale SVG while a failed background refresh is discarded', async () => {
    let now = 30_000
    const cache = new MemoryCache()
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ stargazers_count: 858 }))
      .mockRejectedValueOnce(new Error('GitHub unavailable'))
    const first = requestDependencies({ cache, fetchImpl, now: () => now })
    const request = new Request('https://badges.example.com/github-stars.svg')

    const initial = await handleBadgeRequest(request, first.dependencies)
    await initial.text()
    await first.flush()

    now += 60 * 60 * 1_000 + 1
    const second = requestDependencies({ cache, fetchImpl, now: () => now })
    const stale = await handleBadgeRequest(request, second.dependencies)

    expect(stale.headers.get('X-Badge-Cache')).toBe('STALE')
    expect(await stale.text()).toContain('currently has 858 stars')
    await second.flush()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('uses the last known integer briefly when GitHub and cache are unavailable', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('rate limited', { status: 403 }),
    )
    const helpers = requestDependencies({ fetchImpl, now: () => 40_000 })

    const response = await handleBadgeRequest(
      new Request('https://badges.example.com/github-stars.svg'),
      helpers.dependencies,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300')
    expect(response.headers.get('X-Badge-Cache')).toBe('FALLBACK')
    expect(await response.text()).toContain('currently has 860 stars')
  })

  it('supports HEAD and rejects unrelated paths and methods', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ stargazers_count: 857 }),
    )
    const helpers = requestDependencies({ fetchImpl, now: () => 50_000 })

    const head = await handleBadgeRequest(
      new Request('https://badges.example.com/github-stars.svg', {
        method: 'HEAD',
      }),
      helpers.dependencies,
    )
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')

    const missing = await handleBadgeRequest(
      new Request('https://badges.example.com/other.svg'),
      helpers.dependencies,
    )
    expect(missing.status).toBe(404)

    const post = await handleBadgeRequest(
      new Request('https://badges.example.com/github-stars.svg', {
        method: 'POST',
      }),
      helpers.dependencies,
    )
    expect(post.status).toBe(405)
    expect(post.headers.get('Allow')).toBe('GET, HEAD')
  })
})

describe('README badge sources', () => {
  it.each(['README.md', 'README.zh-CN.md'])(
    '%s uses the deployed Worker URL and 54px height',
    async (filename) => {
      const readme = await readFile(filename, 'utf8')
      expect(readme).toContain(
        '<img src="https://badges.leon-made-this.work/github-stars.svg" height="54" alt="GitHub Stars">',
      )
      expect(readme).not.toContain('./assets/readme/github-stars.svg')
    },
  )
})
