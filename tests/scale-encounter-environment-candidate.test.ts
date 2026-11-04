import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'

interface Delivery {
  readonly file: string
}

interface EnvironmentManifest {
  readonly productionApproved: boolean
  readonly variants: readonly {
    readonly high: Delivery
    readonly low: Delivery
    readonly medium: Delivery
  }[]
}

const environmentDirectory = resolve(
  process.cwd(),
  'src/scale-encounter/assets/environments',
)
const environmentManifestPath = resolve(
  environmentDirectory,
  'manifest.json',
)
async function decodedLongitudeSeamDelta(bytes: Buffer): Promise<{
  readonly maximum: number
  readonly mean: number
}> {
  const image = sharp(bytes)
  const metadata = await image.metadata()
  if (!metadata.width || !metadata.height) {
    throw new Error('Expected a decodable panorama with dimensions.')
  }
  const [left, right] = await Promise.all([
    image
      .clone()
      .extract({ height: metadata.height, left: 0, top: 0, width: 1 })
      .raw()
      .toBuffer(),
    image
      .clone()
      .extract({
        height: metadata.height,
        left: metadata.width - 1,
        top: 0,
        width: 1,
      })
      .raw()
      .toBuffer(),
  ])
  let maximum = 0
  let total = 0
  for (let index = 0; index < left.length; index += 1) {
    const delta = Math.abs(left[index]! - right[index]!)
    maximum = Math.max(maximum, delta)
    total += delta
  }
  return { maximum, mean: total / Math.max(left.length, 1) }
}

describe('scale encounter panorama delivery', () => {
  it('keeps delivered panoramas within transfer budgets and continuous at the longitude seam', async () => {
    const manifest = JSON.parse(
      readFileSync(environmentManifestPath, 'utf8'),
    ) as EnvironmentManifest

    expect(manifest.productionApproved).toBe(true)
    for (const variant of manifest.variants) {
      for (const [kind, delivery] of [
        ['high', variant.high],
        ['medium', variant.medium],
        ['low', variant.low],
      ] as const) {
        const bytes = readFileSync(resolve(environmentDirectory, delivery.file))
        expect(bytes.byteLength).toBeLessThanOrEqual(
          kind === 'high' ? 14_000_000 : kind === 'medium' ? 4_000_000 : 1_000_000,
        )
        const decodedSeam = await decodedLongitudeSeamDelta(bytes)
        // WebP is lossy, so equality before encoding is not enough. Bound the
        // actual decoded longitude columns that WebGL will bilinearly sample.
        expect(decodedSeam.mean).toBeLessThanOrEqual(5)
        expect(decodedSeam.maximum).toBeLessThanOrEqual(32)
      }
    }
  })
})
