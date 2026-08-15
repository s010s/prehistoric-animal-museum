import { InstancedMesh, type Material } from 'three'
import {
  SCALE_ENCOUNTER_PRODUCTION_GROUND_DETAIL_SEED,
  createScaleEncounterProductionGroundDetail,
  type ScaleEncounterProductionGroundDetailMetadata,
} from '../src/viewer/scale-encounter-production-ground-detail'

describe('scale encounter production ground detail', () => {
  it('replaces empty foreground with one low-cost opaque litter batch', () => {
    const terrainHeight = (x: number, z: number) => x * 0.002 - z * 0.001
    const root = createScaleEncounterProductionGroundDetail(terrainHeight)
    const mesh = root.getObjectByName(
      'scale-encounter-production-ground-detail-instances',
    )
    const metadata = root.userData
      .scaleEncounterProductionGroundDetail as ScaleEncounterProductionGroundDetailMetadata

    expect(root.name).toBe('scale-encounter-production-ground-detail')
    expect(mesh).toBeInstanceOf(InstancedMesh)
    expect(metadata).toMatchObject({
      drawCalls: 3,
      instanceCount: 520,
      representation: 'instanced-twigs-humus-roots-and-authored-soil-impressions',
      rootInstanceCount: 24,
      seed: SCALE_ENCOUNTER_PRODUCTION_GROUND_DETAIL_SEED,
      soilImpressionCount: 5,
    })
    expect(metadata.estimatedTriangles).toBeGreaterThan(27_000)
    expect(metadata.estimatedTriangles).toBeLessThan(40_000)
    expect(metadata.samples).toHaveLength(12)
    for (const sample of metadata.samples) {
      expect(sample.y).toBeCloseTo(
        terrainHeight(sample.x, sample.z) - 0.0015,
        8,
      )
    }
    expect(metadata.rootSamples).toHaveLength(12)
    for (const sample of metadata.rootSamples) {
      expect(sample.y).toBeCloseTo(
        terrainHeight(sample.x, sample.z) - 0.002,
        8,
      )
    }

    const litter = mesh as InstancedMesh
    expect(litter.count).toBe(520)
    expect(litter.castShadow).toBe(false)
    expect(litter.receiveShadow).toBe(true)
    expect(litter.instanceColor).not.toBeNull()
    litter.geometry.computeBoundingBox()
    expect(litter.geometry.boundingBox?.max.y).toBeGreaterThan(0.025)
    const patches = root.getObjectByName(
      'scale-encounter-production-compacted-humus-patches',
    ) as InstancedMesh
    expect(patches).toBeInstanceOf(InstancedMesh)
    expect(patches.count).toBe(69)
    const patchMaterial = patches.material as Material
    expect(patchMaterial.transparent).toBe(true)
    expect(patchMaterial.depthWrite).toBe(false)
    expect(metadata.litterPatchCount).toBe(0)
    expect(
      root.getObjectByName(
        'scale-encounter-production-decayed-leaf-litter-patches',
      ),
    ).toBeUndefined()
    const roots = root.getObjectByName(
      'scale-encounter-production-surface-roots',
    ) as InstancedMesh
    expect(roots).toBeInstanceOf(InstancedMesh)
    expect(roots.count).toBe(24)
    expect(roots.castShadow).toBe(false)
    expect(roots.receiveShadow).toBe(true)
  })

  it('is deterministic across environment rebuilds', () => {
    const first = createScaleEncounterProductionGroundDetail(() => 0)
      .getObjectByName(
        'scale-encounter-production-ground-detail-instances',
      ) as InstancedMesh
    const second = createScaleEncounterProductionGroundDetail(() => 0)
      .getObjectByName(
        'scale-encounter-production-ground-detail-instances',
      ) as InstancedMesh
    expect([...first.instanceMatrix.array]).toEqual([
      ...second.instanceMatrix.array,
    ])
    expect([...(first.instanceColor?.array ?? [])]).toEqual([
      ...(second.instanceColor?.array ?? []),
    ])
  })
})
