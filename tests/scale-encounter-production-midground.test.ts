import path from 'node:path'
import sharp from 'sharp'
import {
  BatchedMesh,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type MeshBasicMaterial,
} from 'three'
import { disposeObject3D } from '../src/viewer/dispose'
import {
  SCALE_ENCOUNTER_PRODUCTION_MIDGROUND_MAXIMUM_RADIUS_METERS,
  SCALE_ENCOUNTER_PRODUCTION_MIDGROUND_MINIMUM_RADIUS_METERS,
  createScaleEncounterProductionMidground,
  createScaleEncounterProductionMidgroundPlan,
  isOutsideScaleEncounterProductionMidgroundCorridor,
  type ScaleEncounterProductionMidgroundMetadata,
} from '../src/viewer/scale-encounter-production-midground'

describe('scale encounter production midground depth', () => {
  it('keeps the chroma-key crown edge narrower than the runtime alpha cutoff', async () => {
    const atlasPath = path.resolve(
      process.cwd(),
      'assets/candidates/scale-encounter-environments/midground-frond-components-v4-final.webp',
    )
    const { data, info } = await sharp(atlasPath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    let visiblePixels = 0
    let partiallyVisiblePixels = 0
    for (let index = 0; index < info.width * info.height; index += 1) {
      const alpha = data[index * info.channels + 3]!
      // The component material uses alphaTest 0.37, which maps to 95 on the
      // encoded eight-bit mask. Pixels below this value are discarded before
      // alpha-to-coverage; the remainder must not form a broad pale fringe.
      if (alpha < 95) continue
      visiblePixels += 1
      if (alpha < 255) partiallyVisiblePixels += 1
    }
    expect(visiblePixels).toBeGreaterThan(500_000)
    expect(partiallyVisiblePixels / visiblePixels).toBeLessThan(0.065)
  })

  it('uses a genuine alpha atlas plus explicit grounded support geometry', async () => {
    const atlasPath = path.resolve(
      process.cwd(),
      'assets/candidates/scale-encounter-environments/midground-vegetation-atlas-v2.webp',
    )
    const { data, info } = await sharp(atlasPath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const alphaValues = Array.from(
      { length: info.width * info.height },
      (_, index) => data[index * info.channels + 3]!,
    )
    const sampledAlpha = alphaValues.slice(0, 250_000)
    expect(sampledAlpha.reduce((minimum, alpha) => Math.min(minimum, alpha), 255)).toBeLessThan(8)
    expect(sampledAlpha.reduce((maximum, alpha) => Math.max(maximum, alpha), 0)).toBeGreaterThan(245)

    const group = createScaleEncounterProductionMidground(() => 0)
    for (const kind of ['araucarian-conifer', 'tree-fern', 'cycad'] as const) {
      const mesh = group.children.find((child) =>
        child.name.includes(`production-${kind}s-near-variant-`),
      ) as InstancedMesh | undefined
      expect(mesh).toBeDefined()
      mesh?.geometry.computeBoundingBox()
      expect(mesh?.geometry.boundingBox?.min.y).toBeLessThanOrEqual(0.01)
      expect(mesh?.geometry.getAttribute('uv').count).toBe(
        mesh?.geometry.getAttribute('position').count,
      )
      const material = mesh?.material as MeshStandardMaterial
      expect(material.map?.name).toBe(
        'scale-encounter-production-vegetation-atlas-v2',
      )
    }
    const treeFernSupport = group.children.find((child) =>
      child.name.includes('tree-ferns-near-grounded-supports'),
    ) as InstancedMesh | undefined
    expect(treeFernSupport).toBeDefined()
    treeFernSupport?.geometry.computeBoundingBox()
    expect(treeFernSupport?.geometry.boundingBox?.min.y).toBeLessThanOrEqual(
      0.01,
    )
    const treeFernCrown = group.children.find((child) =>
      child.name.includes('tree-ferns-near-grounded-crowns'),
    ) as InstancedMesh | undefined
    expect(treeFernCrown).toBeDefined()
    expect(
      (treeFernCrown?.material as MeshStandardMaterial).map?.name,
    ).toBe('scale-encounter-production-frond-components-v4')

    const matureTrees = group.getObjectByName(
      'scale-encounter-production-mature-tree-colonies',
    ) as BatchedMesh | undefined
    expect(matureTrees).toBeInstanceOf(BatchedMesh)
    expect((matureTrees?.material as MeshBasicMaterial).map?.name).toBe(
      'scale-encounter-production-mature-tree-atlas-v1',
    )
    disposeObject3D(group)
  })

  it('creates a deterministic, genuinely two-dimensional woodland population', () => {
    const first = createScaleEncounterProductionMidgroundPlan()
    const second = createScaleEncounterProductionMidgroundPlan()
    expect(second).toEqual(first)
    expect(first).toHaveLength(180)

    expect(
      first.filter(({ kind }) => kind === 'araucarian-conifer'),
    ).toHaveLength(46)
    expect(first.filter(({ kind }) => kind === 'tree-fern')).toHaveLength(58)
    expect(first.filter(({ kind }) => kind === 'cycad')).toHaveLength(76)

    const treeFerns = first.filter(({ kind }) => kind === 'tree-fern')
    const conifers = first.filter(({ kind }) => kind === 'araucarian-conifer')
    const cycads = first.filter(({ kind }) => kind === 'cycad')
    expect(Math.min(...conifers.map(({ height }) => height))).toBeGreaterThanOrEqual(
      3.6,
    )
    expect(Math.max(...conifers.map(({ height }) => height))).toBeLessThanOrEqual(
      11.2,
    )
    expect(Math.min(...treeFerns.map(({ height }) => height))).toBeGreaterThanOrEqual(
      0.45,
    )
    expect(Math.max(...treeFerns.map(({ height }) => height))).toBeLessThanOrEqual(
      5.2,
    )
    expect(treeFerns.some(({ height }) => height < 1.35)).toBe(true)
    expect(treeFerns.some(({ height }) => height >= 1.85)).toBe(true)
    expect(Math.min(...cycads.map(({ height }) => height))).toBeGreaterThanOrEqual(
        0.58,
    )
    expect(Math.max(...cycads.map(({ height }) => height))).toBeLessThanOrEqual(
        2.25,
    )

    const angularBins = new Set<number>()
    const radialBins = new Set<number>()
    let xMean = 0
    let zMean = 0
    first.forEach((anchor) => {
      expect(anchor.radius).toBeGreaterThanOrEqual(
        SCALE_ENCOUNTER_PRODUCTION_MIDGROUND_MINIMUM_RADIUS_METERS,
      )
      expect(anchor.radius).toBeLessThanOrEqual(
        SCALE_ENCOUNTER_PRODUCTION_MIDGROUND_MAXIMUM_RADIUS_METERS,
      )
      expect(
        isOutsideScaleEncounterProductionMidgroundCorridor(
          anchor.x,
          anchor.z,
        ),
      ).toBe(true)
      const angle = Math.atan2(anchor.z, anchor.x) + Math.PI
      angularBins.add(Math.floor((angle / (Math.PI * 2)) * 12))
      radialBins.add(Math.floor((anchor.radius - 45) / 20))
      xMean += anchor.x / first.length
      zMean += anchor.z / first.length
    })
    // Low layers can reach all headings, but canopy trees must leave multiple
    // openings rather than closing those headings into a wall.
    expect(angularBins.size).toBe(12)
    const canopyCounts = Array.from({ length: 12 }, () => 0)
    first
      .filter(({ kind }) => kind === 'araucarian-conifer')
      .forEach(({ x, z }) => {
        const angle = (Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2)
        canopyCounts[Math.floor((angle / (Math.PI * 2)) * 12)]! += 1
      })
    const canopyBins = new Set(
      canopyCounts.flatMap((count, index) => (count > 0 ? [index] : [])),
    )
    expect(canopyBins.size).toBeGreaterThanOrEqual(6)
    // Trees may exist in every broad heading, but no heading is allowed to
    // accumulate enough trunks to read as an equal-spaced wall.
    expect(Math.max(...canopyCounts)).toBeLessThanOrEqual(9)
    expect(radialBins.size).toBeGreaterThanOrEqual(5)

    let varianceX = 0
    let varianceZ = 0
    let covariance = 0
    first.forEach(({ x, z }) => {
      varianceX += (x - xMean) ** 2 / first.length
      varianceZ += (z - zMean) ** 2 / first.length
      covariance += ((x - xMean) * (z - zMean)) / first.length
    })
    // A camera-parallel ribbon approaches a singular covariance matrix. The
    // broad positive determinant rejects that failure mode without prescribing
    // one camera heading.
    expect(varianceX * varianceZ - covariance ** 2).toBeGreaterThan(
      1_500_000,
    )
    expect(
      Math.abs(covariance) / Math.sqrt(varianceX * varianceZ),
    ).toBeLessThan(0.82)
  })

  it('limits close conifers and keeps every base on the sampled terrain', () => {
    const sampled = new Map<string, number>()
    const terrainHeight = (x: number, z: number) => {
      const height = Math.sin(x * 0.037) * 1.7 + Math.cos(z * 0.029) * 1.1
      sampled.set(`${x},${z}`, height)
      return height
    }
    const group = createScaleEncounterProductionMidground(terrainHeight)
    const metadata = group.userData
      .scaleEncounterProductionMidground as ScaleEncounterProductionMidgroundMetadata

    expect(metadata.drawCalls).toBe(group.children.length)
    expect(metadata.drawCalls).toBeLessThanOrEqual(20)
    expect(metadata.totalInstances).toBe(180)
    expect(metadata.counts).toEqual({
      'araucarian-conifer': 46,
      cycad: 76,
      'tree-fern': 58,
    })
    expect(metadata.layout).toBe('irregular-habitat-patches')
    expect(metadata.lodCounts.near + metadata.lodCounts.far).toBe(180)
    expect(metadata.lodCounts.near).toBeGreaterThan(0)
    expect(metadata.lodCounts.far).toBeGreaterThan(0)
    expect(metadata.representation).toBe(
      'hybrid-scanned-saplings-supported-tree-ferns-and-atlas-tree-proxies',
    )
    expect(metadata.treeAssetMode).toBe('authored-atlas-profiles')
    expect(metadata.estimatedTriangles).toBeGreaterThan(2_000)
    expect(metadata.estimatedTriangles).toBeLessThan(600_000)
    // Exact grounding samples the centre plus a local finite-difference slope.
    expect(sampled.size).toBeGreaterThan(metadata.totalInstances)

    const matrix = new Matrix4()
    const position = new Vector3()
    const quaternion = new Quaternion()
    const scale = new Vector3()
    for (const child of group.children) {
      expect(
        child instanceof InstancedMesh || child instanceof BatchedMesh,
      ).toBe(true)
      const mesh = child as InstancedMesh | BatchedMesh
      const material = mesh.material as MeshBasicMaterial | MeshStandardMaterial
      expect(mesh.castShadow).toBe(false)
      expect(mesh.receiveShadow).toBe(false)
      expect(material.transparent).toBe(false)
      if (material instanceof MeshStandardMaterial) {
        expect(material.roughness).toBeGreaterThanOrEqual(0.78)
        expect(material.metalness).toBe(0)
      }
      if (material.map) {
        expect(material.alphaTest).toBeGreaterThanOrEqual(0.3)
        expect(material.alphaToCoverage).toBe(true)
        expect(material.map.name).toMatch(
          /scale-encounter-production-(?:vegetation-atlas-v2|frond-components-v4|mature-tree-atlas-v1)/,
        )
      }

      if (
        mesh.name.includes('tree-ferns') ||
        mesh.name.includes('cycads')
      ) {
        mesh.geometry.computeBoundingBox()
        const bounds = mesh.geometry.boundingBox
        expect(bounds).not.toBeNull()
        // Opaque support geometry and radial root flares cross the authored
        // support plane; the exact per-instance translation then buries that
        // bottom by a small, measured amount.
        expect(bounds!.min.y).toBeLessThanOrEqual(0.025)
        expect(bounds!.min.y).toBeGreaterThanOrEqual(-0.15)
      }

      const placements = mesh.userData
        .scaleEncounterProductionMidgroundPlacements as Array<{
        readonly burialDepth?: number
        readonly crownSupportGap?: number
        readonly groundingError?: number
        readonly height: number
        readonly radius: number
        readonly terrainY: number
        readonly worldBottomY?: number
        readonly x: number
        readonly z: number
      }>
      expect(placements.length).toBeGreaterThan(0)
      placements.forEach((placement, index) => {
        if (
          mesh instanceof InstancedMesh &&
          mesh.userData.scaleEncounterProductionMidgroundRole !==
            'supported-crown'
        ) {
          mesh.getMatrixAt(index, matrix)
          matrix.decompose(position, quaternion, scale)
          expect(position.x).toBeCloseTo(placement.x, 4)
          expect(position.z).toBeCloseTo(placement.z, 4)
        }
        expect(placement.terrainY).toBeCloseTo(
          terrainHeight(placement.x, placement.z),
          8,
        )
        if (
          mesh.userData.scaleEncounterProductionMidgroundRole ===
          'supported-crown'
        ) {
          expect(placement.crownSupportGap).toBeCloseTo(0, 6)
        } else {
          expect(placement.groundingError).toBeCloseTo(0, 6)
          expect(placement.worldBottomY).toBeCloseTo(
            placement.terrainY - placement.burialDepth!,
            3,
          )
        }
      })
    }

    const conifers = createScaleEncounterProductionMidgroundPlan().filter(
      ({ kind }) => kind === 'araucarian-conifer',
    )
    conifers
      .filter(({ radius }) => radius < 70)
      .forEach(({ height }) => expect(height).toBeLessThanOrEqual(20))

    const disposal = disposeObject3D(group)
    expect(disposal.geometries).toBe(metadata.drawCalls)
    expect(disposal.materials).toBe(metadata.drawCalls)
    expect(disposal.textures).toBeGreaterThanOrEqual(3)
  })

  it('keeps most added trees on the far LOD while reserving a bounded visible layer', () => {
    const current = createScaleEncounterProductionMidground(() => 0)
    const dense = createScaleEncounterProductionMidground(() => 0, '1.25x')
    const currentMetadata = current.userData
      .scaleEncounterProductionMidground as ScaleEncounterProductionMidgroundMetadata
    const denseMetadata = dense.userData
      .scaleEncounterProductionMidground as ScaleEncounterProductionMidgroundMetadata

    expect(denseMetadata.totalInstances).toBe(226)
    const addedNear =
      denseMetadata.lodCounts.near - currentMetadata.lodCounts.near
    const addedFar = denseMetadata.lodCounts.far - currentMetadata.lodCounts.far
    expect(addedNear).toBeGreaterThan(0)
    expect(addedNear + addedFar).toBe(46)
    expect(addedFar).toBeGreaterThan(addedNear)
    expect(
      denseMetadata.estimatedTriangles / denseMetadata.totalInstances,
    ).toBeLessThan(
      currentMetadata.estimatedTriangles / currentMetadata.totalInstances,
    )

    disposeObject3D(current)
    disposeObject3D(dense)
  })
})
