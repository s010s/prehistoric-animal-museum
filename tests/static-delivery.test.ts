import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { prepareCloudflarePages } from '../scripts/cloudflare-pages.mjs'

const temporaryDirectories: string[] = []
const childProcesses: ChildProcessWithoutNullStreams[] = []

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

async function availablePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolve)
  })
  const address = probe.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => (error ? reject(error) : resolve()))
  })
  return port
}

async function waitForServer(
  child: ChildProcessWithoutNullStreams,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Static server did not start in time.')),
      5_000,
    )
    const onData = (chunk: Buffer) => {
      if (!chunk.toString().includes('Serving')) {
        return
      }
      clearTimeout(timeout)
      child.stdout.off('data', onData)
      resolve()
    }
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`Static server exited early with code ${code}.`))
    })
    child.stdout.on('data', onData)
  })
}

afterEach(async () => {
  for (const child of childProcesses.splice(0)) {
    if (!child.killed) {
      child.kill('SIGTERM')
    }
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  )
})

describe('static multilingual delivery', () => {
  it('prepares Cloudflare output with locale pages and SEO control files at host root', async () => {
    const fixtureRoot = await temporaryDirectory('museum-cloudflare-')
    const sourceDirectory = join(fixtureRoot, 'dist')
    const outputDirectory = join(fixtureRoot, 'cloudflare-dist')
    await mkdir(join(sourceDirectory, 'en'), { recursive: true })
    await mkdir(join(sourceDirectory, 'en/animals/stegosaurus'), {
      recursive: true,
    })
    await mkdir(join(sourceDirectory, 'zh-CN'), { recursive: true })
    await mkdir(join(sourceDirectory, 'assets'), { recursive: true })
    await Promise.all([
      writeFile(join(sourceDirectory, 'index.html'), 'ROOT'),
      writeFile(join(sourceDirectory, 'en/index.html'), 'ENGLISH'),
      writeFile(
        join(sourceDirectory, 'en/animals/stegosaurus/index.html'),
        'STEGOSAURUS DETAIL',
      ),
      writeFile(join(sourceDirectory, 'zh-CN/index.html'), 'CHINESE'),
      writeFile(join(sourceDirectory, 'assets/app.js'), 'APP'),
      writeFile(join(sourceDirectory, 'robots.txt'), 'ROBOTS'),
      writeFile(join(sourceDirectory, 'sitemap.xml'), 'SITEMAP'),
      writeFile(
        join(sourceDirectory, '404.html'),
        '<a data-museum-return href="/prehistoric-animal-museum/">NOT FOUND</a>',
      ),
    ])

    await prepareCloudflarePages({ sourceDirectory, outputDirectory })

    expect(await readFile(join(outputDirectory, 'museum/en/index.html'), 'utf8')).toBe(
      'ENGLISH',
    )
    expect(
      await readFile(join(outputDirectory, 'museum/zh-CN/index.html'), 'utf8'),
    ).toBe('CHINESE')
    expect(
      await readFile(
        join(
          outputDirectory,
          'museum/en/animals/stegosaurus/index.html',
        ),
        'utf8',
      ),
    ).toBe('STEGOSAURUS DETAIL')
    expect(await readFile(join(outputDirectory, 'robots.txt'), 'utf8')).toBe(
      'ROBOTS',
    )
    expect(await readFile(join(outputDirectory, 'sitemap.xml'), 'utf8')).toBe(
      'SITEMAP',
    )
    expect(await readFile(join(outputDirectory, '404.html'), 'utf8')).toContain(
      'href="/museum/"',
    )
    expect(
      await readFile(join(outputDirectory, 'museum/404.html'), 'utf8'),
    ).toContain('href="/museum/"')
    const redirects = await readFile(join(outputDirectory, '_redirects'), 'utf8')
    expect(redirects).toContain(
      '/museum/en/animals/stegosaurus /museum/en/animals/stegosaurus/ 301',
    )
    expect(redirects).toContain(
      '/museum/en/animals/stegosaurus/index.html /museum/en/animals/stegosaurus/ 301',
    )
  })

  it('serves locale directory indexes and returns the real 404 document', async () => {
    const fixtureRoot = await temporaryDirectory('museum-server-')
    await mkdir(join(fixtureRoot, 'en'), { recursive: true })
    await Promise.all([
      writeFile(join(fixtureRoot, 'index.html'), 'ROOT'),
      writeFile(join(fixtureRoot, 'en/index.html'), 'ENGLISH'),
      writeFile(join(fixtureRoot, '404.html'), 'NOT FOUND'),
      writeFile(join(fixtureRoot, 'robots.txt'), 'ROBOTS'),
      writeFile(join(fixtureRoot, 'sitemap.xml'), '<urlset />'),
    ])
    const port = await availablePort()
    const child = spawn(
      process.execPath,
      [
        'server.mjs',
        fixtureRoot,
        '--port',
        String(port),
        '--base',
        '/museum/',
      ],
      { cwd: process.cwd(), stdio: 'pipe' },
    )
    childProcesses.push(child)
    await waitForServer(child)

    const localized = await fetch(`http://127.0.0.1:${port}/museum/en/`)
    expect(localized.status).toBe(200)
    expect(localized.headers.get('cache-control')).toBe('no-store')
    expect(await localized.text()).toBe('ENGLISH')

    const withoutTrailingSlash = await fetch(
      `http://127.0.0.1:${port}/museum/en`,
      { redirect: 'manual' },
    )
    expect(withoutTrailingSlash.status).toBe(301)
    expect(withoutTrailingSlash.headers.get('location')).toBe('/museum/en/')

    const missing = await fetch(
      `http://127.0.0.1:${port}/museum/missing-test`,
    )
    expect(missing.status).toBe(404)
    expect(await missing.text()).toBe('NOT FOUND')

    const robots = await fetch(`http://127.0.0.1:${port}/museum/robots.txt`)
    expect(robots.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(robots.headers.get('cache-control')).toBe('no-store')
    const sitemap = await fetch(
      `http://127.0.0.1:${port}/museum/sitemap.xml`,
    )
    expect(sitemap.headers.get('content-type')).toBe(
      'application/xml; charset=utf-8',
    )
  })
})
