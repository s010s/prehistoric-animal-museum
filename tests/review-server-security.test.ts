// @vitest-environment node
/// <reference types="node" />

import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { join } from 'node:path'

import {
  createServer,
  isFileLoadingAllowed,
  normalizePath,
  resolveConfig,
} from 'vite'
import type { ViteDevServer } from 'vite'

import {
  localReviewAssetFiles,
  localReviewAssetPrefix,
  scaleEncounterChildAvatarAssetFiles,
  scaleEncounterChildPortraitAssets,
} from '../scripts/review-assets'
import {
  assertReviewModeIsServeOnly,
  isPrivateLocalMaterialRequest,
  parseAllowedHosts,
  privateLocalMaterialDenyForRoot,
  unprefixedRouteMarker,
} from '../scripts/review-server-security'

function dispatchHead(
  server: ViteDevServer,
  requestUrl: string,
  method = 'HEAD',
  headers: Readonly<Record<string, string>> = {},
): { readonly nextCalled: boolean; readonly response: ServerResponse } {
  const request = new IncomingMessage(new Socket())
  request.method = method
  request.url = requestUrl
  Object.assign(request.headers, headers)
  const response = new ServerResponse(request)
  let nextCalled = false

  server.middlewares.handle(request, response, () => {
    nextCalled = true
  })

  return { nextCalled, response }
}

describe('local review server boundary', () => {
  it('parses a comma-separated local host allowlist without duplicates', () => {
    expect(
      parseAllowedHosts(
        'leonleung-mbp-m5pro.tail37fda1.ts.net, tablet.local, tablet.local',
      ),
    ).toEqual([
      'leonleung-mbp-m5pro.tail37fda1.ts.net',
      'tablet.local',
    ])
    expect(parseAllowedHosts(undefined)).toEqual([])
  })

  it('keeps a Wayfinder worktree root servable without opening nested private material', () => {
    const worktreeDeny = privateLocalMaterialDenyForRoot(
      '/project/.wayfinder/worktrees/direct-scale-encounter',
    )

    expect(worktreeDeny).not.toContain('**/.wayfinder/**')
    expect(worktreeDeny).toContain('**/.handoff/**')
    expect(worktreeDeny).toContain('**/assets/candidates/**')
    expect(privateLocalMaterialDenyForRoot('/project')).toContain(
      '**/.wayfinder/**',
    )
  })

  it.each([
    '/.handoff/collection-review/audio/example.mp3',
    '/assets/candidates/example/model.glb',
    '/assets/candidates/sketchfab-round2-2026-07/normalized-glb/tyrannosaurus-marcel-schanz.glb',
    '/assets/candidates/user-sketchfab-review-2026-07/normalized-glb/gigantoraptor.glb',
    '/prototypes/backgrounds/example.png',
    '/docs/research/private-notes.md',
    '/docs/handoff/private-notes.md',
    '/docs/specification/private-notes.md',
    '/spikes/example/index.html',
    '/tools/model-pipeline/private-script.py',
    '/assets%2Fcandidates/example/model.glb',
    '/elsewhere/../docs/research/private-notes.md',
  ])('recognizes direct private-material request %s', (requestUrl) => {
    expect(isPrivateLocalMaterialRequest(requestUrl)).toBe(true)
  })

  it('does not confuse the explicit review allowlist with a source path', () => {
    const reviewRoute = `${localReviewAssetPrefix}/stegosaurus/model.glb`

    expect(isPrivateLocalMaterialRequest(reviewRoute)).toBe(false)
    expect(localReviewAssetFiles.has(reviewRoute)).toBe(true)
    expect(
      localReviewAssetFiles.has(
        `${localReviewAssetPrefix}/gigantoraptor/model.glb`,
      ),
    ).toBe(true)
    expect(
      localReviewAssetFiles.has(
        `${localReviewAssetPrefix}/gigantoraptor/narration.mp3`,
      ),
    ).toBe(true)
    expect(
      localReviewAssetFiles.has(
        `${localReviewAssetPrefix}/mammoth/narration.mp3`,
      ),
    ).toBe(true)
  })

  it('allowlists exactly the eight v4 scene-and-gender child packages and no neighboring candidate files', () => {
    const routePrefix =
      `${localReviewAssetPrefix}/scale-encounter-child-avatar/`
    const avatarRoutes = [...localReviewAssetFiles.keys()]
      .filter((route) => route.startsWith(routePrefix))
      .sort()
    expect(avatarRoutes).toEqual(
      scaleEncounterChildAvatarAssetFiles
        .map((fileName) => `${routePrefix}${fileName}`)
        .sort(),
    )
    expect(avatarRoutes).toHaveLength(8)
    for (const blocked of [
      'meshy-scene-avatar-packages.manifest.json',
      'child-avatar-v4-boy-land-explorer-review-v01.glb.bak',
      'child-avatar-v4-boy-land-explorer-review-v02.glb',
      'child-avatar-v3-boy-land-normal.glb',
      'prepare-scale-encounter-scene-avatars.ts',
      'child-avatar-review-candidates.glb',
    ]) {
      expect(localReviewAssetFiles.has(`${routePrefix}${blocked}`)).toBe(false)
    }
  })

  it('allowlists only the two reviewed setup portraits on their own route', () => {
    const routePrefix =
      `${localReviewAssetPrefix}/scale-encounter-child-portraits/`
    const portraitRoutes = [...localReviewAssetFiles.keys()]
      .filter((route) => route.startsWith(routePrefix))
      .sort()

    expect(portraitRoutes).toEqual(
      scaleEncounterChildPortraitAssets
        .map(({ fileName }) => `${routePrefix}${fileName}`)
        .sort(),
    )
    expect(portraitRoutes).toHaveLength(2)
    expect(
      localReviewAssetFiles.has(`${routePrefix}girl-water-diver-main.png`),
    ).toBe(false)
  })

  it('keeps ignored source files outside Vite file-serving access', async () => {
    const config = await resolveConfig(
      {
        configFile: join(process.cwd(), 'vite.config.ts'),
        // Resolve the config's dynamic TypeScript imports through Vite's runner.
        configLoader: 'runner',
        logLevel: 'silent',
      },
      'serve',
      'review',
    )

    expect(
      isFileLoadingAllowed(
        config,
        normalizePath(join(process.cwd(), 'index.html')),
      ),
    ).toBe(true)

    for (const relativePath of [
      '.handoff/collection-review/audio/example.mp3',
      'assets/candidates/example/model.glb',
      'prototypes/backgrounds/example.png',
      'docs/research/private-notes.md',
    ]) {
      expect(
        isFileLoadingAllowed(
          config,
          normalizePath(join(process.cwd(), relativePath)),
        ),
      ).toBe(false)
    }
  })

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
      expect(denied.nextCalled).toBe(false)
      expect(denied.response.statusCode).toBe(404)
      expect(denied.response.getHeader('Cache-Control')).toBe('no-store')

      const allowed = dispatchHead(
        server,
        `${localReviewAssetPrefix}/stegosaurus/model.glb`,
      )
      expect(allowed.nextCalled).toBe(false)
      expect(allowed.response.statusCode).toBe(200)
      expect(allowed.response.getHeader('Cache-Control')).toBe(
        'private, no-cache',
      )
      expect(allowed.response.getHeader('ETag')).toMatch(
        /^W\/"[\da-f]+-[\da-f]+"$/,
      )
      expect(allowed.response.getHeader('Last-Modified')).toEqual(
        expect.any(String),
      )
      expect(allowed.response.getHeader('Content-Type')).toBe(
        'model/gltf-binary',
      )

      const setupPortrait = dispatchHead(
        server,
        `${localReviewAssetPrefix}/scale-encounter-child-portraits/boy-land-explorer.webp`,
      )
      expect(setupPortrait.nextCalled).toBe(false)
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
      expect(cached.nextCalled).toBe(false)
      expect(cached.response.statusCode).toBe(304)
      expect(cached.response.getHeader('Cache-Control')).toBe(
        'private, no-cache',
      )
      expect(cached.response.getHeader('ETag')).toBe(etag)

      const unknown = dispatchHead(
        server,
        `${localReviewAssetPrefix}/stegosaurus/not-allowlisted.glb`,
      )
      expect(unknown.nextCalled).toBe(false)
      expect(unknown.response.statusCode).toBe(404)
      expect(unknown.response.getHeader('Cache-Control')).toBe('no-store')

      const reviewNarration = dispatchHead(
        server,
        `${localReviewAssetPrefix}/mammoth/narration.mp3`,
      )
      expect(reviewNarration.nextCalled).toBe(false)
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
      expect(writeAttempt.nextCalled).toBe(false)
      expect(writeAttempt.response.statusCode).toBe(405)
      expect(writeAttempt.response.getHeader('Cache-Control')).toBe('no-store')

      const nonFileRoute = `${localReviewAssetPrefix}/_test/directory`
      const mutableReviewAssets = localReviewAssetFiles as Map<string, string>
      mutableReviewAssets.set(nonFileRoute, process.cwd())
      try {
        const nonFile = dispatchHead(server, nonFileRoute)
        expect(nonFile.nextCalled).toBe(false)
        expect(nonFile.response.statusCode).toBe(404)
        expect(nonFile.response.getHeader('Cache-Control')).toBe('no-store')
      } finally {
        mutableReviewAssets.delete(nonFileRoute)
      }
    } finally {
      await server.close()
    }
  })

  it('serves only the allowlisted scale-encounter environment file through the development server pipeline', async () => {
    const server = await createServer({
      appType: 'custom',
      configFile: join(process.cwd(), 'vite.config.ts'),
      configLoader: 'runner',
      logLevel: 'silent',
      mode: 'development',
      server: { middlewareMode: true },
    })

    try {
      const allowed = dispatchHead(
        server,
        `${localReviewAssetPrefix}/scale-encounter-environments/panorama-land-cretaceous-2048.webp`,
      )
      expect(allowed.nextCalled).toBe(false)
      expect(allowed.response.statusCode).toBe(200)
      expect(allowed.response.getHeader('Content-Type')).toBe('image/webp')
      expect(allowed.response.getHeader('Cache-Control')).toBe(
        'private, no-cache',
      )

      const unknown = dispatchHead(
        server,
        `${localReviewAssetPrefix}/scale-encounter-environments/source-polyhaven-forest-slope.jpg`,
      )
      expect(unknown.nextCalled).toBe(false)
      expect(unknown.response.statusCode).toBe(404)
    } finally {
      await server.close()
    }
  })

  it('serves each exact v4 scene-and-gender child package while returning 404 for adjacent files', async () => {
    const server = await createServer({
      appType: 'custom',
      configFile: join(process.cwd(), 'vite.config.ts'),
      configLoader: 'runner',
      logLevel: 'silent',
      mode: 'development',
      server: { middlewareMode: true },
    })

    try {
      const routePrefix =
        `${localReviewAssetPrefix}/scale-encounter-child-avatar/`
      for (const fileName of scaleEncounterChildAvatarAssetFiles) {
        const allowed = dispatchHead(server, `${routePrefix}${fileName}`)
        expect(allowed.nextCalled).toBe(false)
        expect(allowed.response.statusCode).toBe(200)
        expect(allowed.response.getHeader('Content-Type')).toBe(
          'model/gltf-binary',
        )
        expect(allowed.response.getHeader('Cache-Control')).toBe(
          'private, no-cache',
        )
      }

      for (const blocked of [
        'meshy-scene-avatar-packages.manifest.json',
        'child-avatar-v4-boy-land-explorer-review-v01.glb.bak',
        'child-avatar-v4-boy-land-explorer-review-v02.glb',
        'child-avatar-v3-boy-land-normal.glb',
        'prepare-scale-encounter-scene-avatars.ts',
        'child-avatar-review-candidates.glb',
      ]) {
        const unknown = dispatchHead(server, `${routePrefix}${blocked}`)
        expect(unknown.nextCalled).toBe(false)
        expect(unknown.response.statusCode).toBe(404)
        expect(unknown.response.getHeader('Cache-Control')).toBe('no-store')
      }
    } finally {
      await server.close()
    }
  })

  it('rejects review builds while allowing the review development server', () => {
    expect(() => assertReviewModeIsServeOnly('build', 'review')).toThrow(
      'Local review mode is serve-only',
    )
    expect(() => assertReviewModeIsServeOnly('serve', 'review')).not.toThrow()
    expect(() => assertReviewModeIsServeOnly('build', 'production')).not.toThrow()
  })

  it('uses an unprefixed production marker that catches every route form', () => {
    const marker = unprefixedRouteMarker(localReviewAssetPrefix)

    expect(marker).toBe('__museum-review-assets')
    expect(`/${marker}/animal/model.glb`).toContain(marker)
    expect(`${marker}/animal/model.glb`).toContain(marker)
  })
})
