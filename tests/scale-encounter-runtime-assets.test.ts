import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'

interface RuntimeAssetApproval {
  readonly assetGroups: {
    readonly avatars: { readonly binaryCount: number; readonly status: string }
    readonly environments: {
      readonly binaryCount: number
      readonly status: string
    }
    readonly narration: { readonly binaryCount: number; readonly status: string }
  }
  readonly approvedBy: string
  readonly approvedOn: string
  readonly productionApproved: boolean
  readonly publicDistributionDecision: string
  readonly status: string
}

const assetRoot = resolve(process.cwd(), 'src/scale-encounter/assets')
const binaryExtensions = new Set(['.glb', '.png', '.webp'])

function collectBinaryAssets(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(directory, entry.name)
    if (entry.isDirectory()) return collectBinaryAssets(absolutePath)
    return entry.isFile() && binaryExtensions.has(extname(entry.name))
      ? [relative(assetRoot, absolutePath)]
      : []
  })
}

describe('scale encounter runtime asset identities', () => {
  it('retains the dated baseline approval and records new scene assets separately', () => {
    const approval = JSON.parse(
      readFileSync(join(assetRoot, 'approval.json'), 'utf8'),
    ) as RuntimeAssetApproval
    expect(approval).toMatchObject({
      approvedBy: 'Leon',
      approvedOn: '2026-09-01',
      productionApproved: true,
      publicDistributionDecision: 'approved',
      status: 'production-approved',
    })
    expect(approval.assetGroups).toMatchObject({
      avatars: { binaryCount: 10, status: 'production-approved' },
      environments: { binaryCount: 55, status: 'production-approved' },
      narration: { binaryCount: 148, status: 'production-approved' },
    })

    const recorded = new Map(
      readFileSync(join(assetRoot, 'SHA256SUMS'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => {
          const match = line.match(/^([a-f0-9]{64}) {2}(.+)$/)
          if (!match) throw new Error(`invalid-runtime-checksum-line:${line}`)
          return [match[2]!, match[1]!] as const
        }),
    )
    const binaries = [
      ...collectBinaryAssets(join(assetRoot, 'avatars')),
      ...collectBinaryAssets(join(assetRoot, 'environments')),
    ].sort()

    // The September 1 approval covers the original 65 files only. New local
    // scene revisions have checksums; this test does not grant publication approval.
    const newSceneAssets = [
      'braided-sand-unique-v2.webp',
      'clouds-unique-v2.webp',
      'forest-floor-unique-v2.webp',
      'footstep-water-splash-v1.webp',
      'island-landforms-v2.glb',
      'red-silt-unique-v2.webp',
      'snow-drifts-unique-v2.webp',
      'snow-earth-patches-v3.webp',
      'panorama-irendabas-open-plain-v3.webp',
    ].map((name) => `environments/${name}`)
    expect(recorded.size - newSceneAssets.length).toBe(65)
    newSceneAssets.forEach((name) => expect(recorded.has(name)).toBe(true))
    expect([...recorded.keys()].sort()).toEqual(binaries)
    for (const [fileName, expectedHash] of recorded) {
      const bytes = readFileSync(join(assetRoot, fileName))
      expect(createHash('sha256').update(bytes).digest('hex'), fileName).toBe(
        expectedHash,
      )
    }
  })
})
