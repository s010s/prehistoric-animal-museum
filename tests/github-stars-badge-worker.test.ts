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
  it('serves the upstream star count as an SVG badge', async () => {
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
    const svg = await miss.text()
    expect(svg).toContain('currently has 857 stars')
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

    expect(await stale.text()).toContain('currently has 858 stars')
    await second.flush()
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
