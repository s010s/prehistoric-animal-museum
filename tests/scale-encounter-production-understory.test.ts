import { BatchedMesh, type MeshStandardMaterial } from 'three'
import { disposeObject3D } from '../src/viewer/dispose'
import {
  createScaleEncounterProductionUnderstory,
  createScaleEncounterProductionUnderstoryPlan,
  isOutsideScaleEncounterProductionUnderstoryCorridor,
  type ScaleEncounterProductionUnderstoryMetadata,
} from '../src/viewer/scale-encounter-production-understory'

describe('scale encounter production understory', () => {
  it.each([
    ['current', 80, 34, 114],
    ['1.25x', 100, 43, 143],
    ['1.5x', 120, 51, 171],
  ] as const)(
    'builds deterministic, corridor-safe %s habitat colonies',
    (density, fernCount, shrubCount, totalCount) => {
      const first = createScaleEncounterProductionUnderstoryPlan(density)
      const second = createScaleEncounterProductionUnderstoryPlan(density)
      expect(second).toEqual(first)
      expect(first).toHaveLength(totalCount)
      expect(first.filter(({ kind }) => kind === 'fern')).toHaveLength(
        fernCount,
      )
      expect(first.filter(({ kind }) => kind === 'shrub')).toHaveLength(
        shrubCount,
      )

      const angularBins = new Set<number>()
      const radialBins = new Set<number>()
      first.forEach((anchor) => {
        expect(
          isOutsideScaleEncounterProductionUnderstoryCorridor(
            anchor.x,
            anchor.z,
          ),
        ).toBe(true)
        expect(anchor.radius).toBeGreaterThanOrEqual(
          anchor.kind === 'fern' ? 6 : 12,
        )
        expect(anchor.radius).toBeLessThanOrEqual(
          anchor.kind === 'fern' ? 24 : 30,
        )
        expect(anchor.height).toBeGreaterThanOrEqual(
          anchor.kind === 'fern' ? 0.34 : 0.58,
        )
        expect(anchor.height).toBeLessThanOrEqual(
          anchor.kind === 'fern' ? 0.72 : 1.08,
        )
        const angle = (Math.atan2(anchor.z, anchor.x) + Math.PI * 2) %
          (Math.PI * 2)
        angularBins.add(Math.floor((angle / (Math.PI * 2)) * 12))
        radialBins.add(Math.floor((anchor.radius - 6) / 4))
      })
      expect(angularBins.size).toBeGreaterThanOrEqual(8)
      expect(radialBins.size).toBeGreaterThanOrEqual(5)
    },
  )

  it('grounds every transformed bottom to the sampled world-space terrain', () => {
    let terrainSampleCount = 0
    const terrainHeight = (x: number, z: number) => {
      terrainSampleCount += 1
      return Math.sin(x * 0.07) * 0.42 + Math.cos(z * 0.052) * 0.31
    }
    const group = createScaleEncounterProductionUnderstory(
      terrainHeight,
      '1.25x',
    )
    const metadata = group.userData
      .scaleEncounterProductionUnderstory as ScaleEncounterProductionUnderstoryMetadata
    expect(metadata).toMatchObject({
      airborneInstanceCount: 0,
      density: '1.25x',
      drawCalls: 2,
      fernCount: 100,
      representation: 'alpha-clipped-grounded-colonies-with-root-collars',
      shrubCount: 43,
      totalInstances: 143,
    })
    expect(metadata.maximumAbsoluteGroundingError).toBeLessThan(1e-9)
    // Centre height plus four finite-difference samples are evaluated for
    // every plant; a one-value global Y offset cannot satisfy this gate.
    expect(terrainSampleCount).toBeGreaterThanOrEqual(
      metadata.totalInstances * 5,
    )
    expect(group.children).toHaveLength(2)

    const foliage = group.getObjectByName(
      'scale-encounter-production-grounded-understory-foliage',
    ) as BatchedMesh
    const roots = group.getObjectByName(
      'scale-encounter-production-grounded-understory-roots',
    ) as BatchedMesh
    expect(foliage).toBeInstanceOf(BatchedMesh)
    expect(roots).toBeInstanceOf(BatchedMesh)
    expect(foliage.castShadow).toBe(true)
    expect(roots.castShadow).toBe(true)
    expect(foliage.receiveShadow).toBe(true)
    expect(roots.receiveShadow).toBe(true)

    const foliageMaterial = foliage.material as MeshStandardMaterial
    expect(foliageMaterial.transparent).toBe(false)
    expect(foliageMaterial.alphaTest).toBeGreaterThanOrEqual(0.4)
    expect(foliageMaterial.alphaToCoverage).toBe(true)
    expect(foliageMaterial.map?.name).toBe(
      'scale-encounter-understory-vegetation-atlas-v2',
    )
    expect(
      foliage.userData.scaleEncounterUnderstoryProjectedPixelGate,
    ).toBe(2.25)

    const groundingSamples = foliage.userData
      .scaleEncounterUnderstoryGroundingSamples as ReadonlyArray<{
      readonly groundingError: number
      readonly terrainY: number
      readonly worldBottomY: number
    }>
    expect(groundingSamples).toHaveLength(24)
    groundingSamples.forEach((sample) => {
      expect(Math.abs(sample.groundingError)).toBeLessThan(1e-6)
      expect(sample.worldBottomY).toBeLessThan(sample.terrainY)
      expect(sample.terrainY - sample.worldBottomY).toBeLessThanOrEqual(0.0181)
    })

    const disposal = disposeObject3D(group)
    expect(disposal.geometries).toBe(2)
    expect(disposal.materials).toBe(2)
    expect(disposal.textures).toBe(1)
  })
})
