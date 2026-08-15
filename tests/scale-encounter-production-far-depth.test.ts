import type {
  BatchedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
} from 'three'
import { disposeObject3D } from '../src/viewer/dispose'
import {
  createScaleEncounterProductionFarDepth,
  createScaleEncounterProductionFarDepthPlan,
  type ScaleEncounterProductionFarDepthMetadata,
} from '../src/viewer/scale-encounter-production-far-depth'

describe('scale encounter production far depth', () => {
  it('uses deterministic broken sectors and offset colonies instead of a ring', () => {
    const first = createScaleEncounterProductionFarDepthPlan()
    const second = createScaleEncounterProductionFarDepthPlan()
    expect(second).toEqual(first)
    expect(first.ridgeSectors).toHaveLength(6)
    expect(first.trees).toHaveLength(19)

    const coverage = first.ridgeSectors.reduce(
      (sum, { halfSpan }) => sum + halfSpan * 2,
      0,
    ) / (Math.PI * 2)
    expect(coverage).toBeGreaterThan(0.5)
    expect(coverage).toBeLessThan(0.7)

    const angularBins = new Set(
      first.trees.map(({ x, z }) =>
        Math.floor(
          (((Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2)) /
            (Math.PI * 2)) *
            12,
        ),
      ),
    )
    expect(angularBins.size).toBeGreaterThanOrEqual(7)
    expect(
      new Set(first.trees.map(({ radius }) => Math.floor(radius / 12))).size,
    ).toBeGreaterThanOrEqual(5)
  })

  it('grounds an opaque fog-compatible broken-ridge batch within the far-field budget', () => {
    const sampled = new Map<string, number>()
    const terrainHeight = (x: number, z: number) => {
      const height = Math.sin(x * 0.013) + Math.cos(z * 0.017)
      sampled.set(`${x},${z}`, height)
      return height
    }
    const group = createScaleEncounterProductionFarDepth(terrainHeight)
    const metadata = group.userData
      .scaleEncounterProductionFarDepth as ScaleEncounterProductionFarDepthMetadata
    expect(metadata).toMatchObject({
      density: 'current',
      drawCalls: 1,
      layout: 'broken-ridge-sectors-and-offset-tree-colonies',
      profileCount: 8,
      representation: 'alpha-clipped-multi-profile-world-space-fog-proxies',
      ridgeSectorCount: 6,
      treeColonyCount: 7,
      treeCount: 15,
    })
    expect(metadata.estimatedTriangles).toBeLessThan(20_000)
    expect(metadata.minimumRadiusMeters).toBeGreaterThan(74)
    expect(metadata.maximumRadiusMeters).toBeLessThan(260)
    expect(group.children).toHaveLength(2)

    const ridge = group.getObjectByName(
      'scale-encounter-production-broken-far-ridges',
    ) as Mesh
    const ridgeMaterial = ridge.material as MeshBasicMaterial
    expect(ridge.visible).toBe(false)
    expect(ridgeMaterial.transparent).toBe(false)
    expect(ridgeMaterial.depthWrite).toBe(true)
    expect(ridgeMaterial.fog).toBe(true)
    expect(ridgeMaterial.vertexColors).toBe(true)

    const treeBatch = group.getObjectByName(
      'scale-encounter-production-far-tree-colonies',
    ) as BatchedMesh
    const treeMaterial = treeBatch.material as MeshStandardMaterial
    expect(treeBatch.castShadow).toBe(false)
    expect(treeBatch.receiveShadow).toBe(false)
    expect(treeMaterial.transparent).toBe(false)
    expect(treeMaterial.depthWrite).toBe(true)
    expect(treeMaterial.alphaTest).toBeGreaterThanOrEqual(0.45)
    expect(treeMaterial.alphaToCoverage).toBe(true)
    expect(treeMaterial.map?.name).toBe(
      'scale-encounter-production-mature-tree-atlas-v1',
    )
    const placements = treeBatch.userData
      .scaleEncounterFarTreePlacements as Array<{
      readonly terrainY: number
      readonly worldBottomY: number
      readonly x: number
      readonly z: number
    }>
    expect(placements).toHaveLength(metadata.treeCount)
    placements.forEach(({ terrainY, worldBottomY, x, z }) => {
      expect(terrainY).toBeCloseTo(terrainHeight(x, z), 8)
      expect(worldBottomY).toBeCloseTo(terrainY - 0.025, 8)
    })

    const disposal = disposeObject3D(group)
    expect(disposal.geometries).toBe(2)
    expect(disposal.materials).toBe(2)
    expect(disposal.textures).toBe(1)
  })

  it('uses one varied alpha-clipped profile batch for dense far colonies', () => {
    const group = createScaleEncounterProductionFarDepth(() => 0, '1.25x')
    const metadata = group.userData
      .scaleEncounterProductionFarDepth as ScaleEncounterProductionFarDepthMetadata
    expect(metadata).toMatchObject({
      density: '1.25x',
      drawCalls: 1,
      profileCount: 8,
      treeColonyCount: 7,
      treeCount: 19,
    })
    expect(group.children).toHaveLength(2)
    const mesh = group.children[1] as BatchedMesh
    const material = mesh.material as MeshStandardMaterial
    expect(material.transparent).toBe(false)
    expect(material.depthWrite).toBe(true)
    expect(mesh.castShadow).toBe(false)
    expect(mesh.receiveShadow).toBe(false)
    disposeObject3D(group)
  })
})
