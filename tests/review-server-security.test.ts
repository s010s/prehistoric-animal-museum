// @vitest-environment node
/// <reference types="node" />

import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { join } from 'node:path'

import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'

import {
  localReviewAssetFiles,
  localReviewAssetPrefix,
} from '../scripts/review-assets'

function dispatchHead(
  server: ViteDevServer,
  requestUrl: string,
  method = 'HEAD',
  headers: Readonly<Record<string, string>> = {},
): { readonly response: ServerResponse } {
  const request = new IncomingMessage(new Socket())
  request.method = method
  request.url = requestUrl
  Object.assign(request.headers, headers)
  const response = new ServerResponse(request)
  server.middlewares.handle(request, response, () => {})

  return { response }
}

describe('local review server boundary', () => {
  it('denies direct sources while serving only explicit review routes', async () => {
    const server = await createServer({
      appType: 'custom',
      configFile: join(process.cwd(), 'vite.config.ts'),
      configLoader: 'runner',
      logLevel: 'silent',
      mode: 'review',
      server: { middlewareMode: true },
    })

    try {
      const denied = dispatchHead(
        server,
        '/assets/candidates/example/model.glb',
      )
      expect(denied.response.statusCode).toBe(404)
      expect(denied.response.getHeader('Cache-Control')).toBe('no-store')

      const allowed = dispatchHead(
        server,
        `${localReviewAssetPrefix}/stegosaurus/model.glb`,
      )
      expect(allowed.response.statusCode).toBe(200)
      expect(allowed.response.getHeader('Cache-Control')).toBe(
        'private, no-cache',
      )
      expect(allowed.response.getHeader('Content-Type')).toBe(
        'model/gltf-binary',
      )

      const setupPortrait = dispatchHead(
        server,
        `${localReviewAssetPrefix}/scale-encounter-child-portraits/boy-land-explorer.webp`,
      )
      expect(setupPortrait.response.statusCode).toBe(200)
      expect(setupPortrait.response.getHeader('Content-Type')).toBe(
        'image/webp',
      )

      const etag = allowed.response.getHeader('ETag')
      if (typeof etag !== 'string') {
        throw new Error('Review asset response did not include an ETag.')
      }
      const cached = dispatchHead(
        server,
        `${localReviewAssetPrefix}/stegosaurus/model.glb`,
        'HEAD',
        { 'if-none-match': etag },
      )
      expect(cached.response.statusCode).toBe(304)
      expect(cached.response.getHeader('Cache-Control')).toBe(
        'private, no-cache',
      )
      expect(cached.response.getHeader('ETag')).toBe(etag)

      const unknown = dispatchHead(
        server,
        `${localReviewAssetPrefix}/stegosaurus/not-allowlisted.glb`,
      )
      expect(unknown.response.statusCode).toBe(404)
      expect(unknown.response.getHeader('Cache-Control')).toBe('no-store')

      const reviewNarration = dispatchHead(
        server,
        `${localReviewAssetPrefix}/mammoth/narration.mp3`,
      )
      expect(reviewNarration.response.statusCode).toBe(200)
      expect(reviewNarration.response.getHeader('Cache-Control')).toBe(
        'private, no-cache',
      )
      expect(reviewNarration.response.getHeader('Content-Type')).toBe(
        'audio/mpeg',
      )

      const writeAttempt = dispatchHead(
        server,
        `${localReviewAssetPrefix}/stegosaurus/model.glb`,
        'POST',
      )
      expect(writeAttempt.response.statusCode).toBe(405)
      expect(writeAttempt.response.getHeader('Cache-Control')).toBe('no-store')

      const nonFileRoute = `${localReviewAssetPrefix}/_test/directory`
      const mutableReviewAssets = localReviewAssetFiles as Map<string, string>
      mutableReviewAssets.set(nonFileRoute, process.cwd())
      try {
        const nonFile = dispatchHead(server, nonFileRoute)
        expect(nonFile.response.statusCode).toBe(404)
        expect(nonFile.response.getHeader('Cache-Control')).toBe('no-store')
      } finally {
        mutableReviewAssets.delete(nonFileRoute)
      }
    } finally {
      await server.close()
    }
  })
})
