import {
  BatchedMesh,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Texture,
  type BufferGeometry,
} from 'three'
import {
  createScaleEncounterEnvironment,
  disposeScaleEncounterEnvironment,
} from '../src/viewer/scale-encounter-environment'
import {
  SCALE_ENCOUNTER_PRODUCTION_ECOLOGY_TEMPLATE_NAMES,
  createScaleEncounterProductionForestScatter,
  type ScaleEncounterProductionEcologyKind,
  type ScaleEncounterProductionEcologyPlacement,
} from '../src/viewer/scale-encounter-production-forest-scatter'

function placementsForKind(
  kind: ScaleEncounterProductionEcologyKind,
): ScaleEncounterProductionEcologyPlacement[] {
  return createScaleEncounterProductionForestScatter().batches
    .filter((batch) => batch.kind === kind)
    .flatMap((batch) => batch.placements)
}

function radius({ x, z }: { readonly x: number; readonly z: number }): number {
  return Math.hypot(x, z)
}

function createEcologyTemplate(): Group {
  const root = new Group()
  root.name = 'scale-encounter-real-forest-ecology-v2-template'
  const propsMaterial = new MeshStandardMaterial()
  const litterMaterial = new MeshStandardMaterial()
  for (const name of SCALE_ENCOUNTER_PRODUCTION_ECOLOGY_TEMPLATE_NAMES) {
    const geometry = new BoxGeometry(0.8, 0.7, 0.6)
    geometry.translate(0, 0.35, 0)
    const mesh = new Mesh(
      geometry,
      name.startsWith('forest_litter_') ? litterMaterial : propsMaterial,
    )
    mesh.name = name
    root.add(mesh)
  }
  return root
}

function disposeEcologyTemplate(root: Group): void {
  const materials = new Set<MeshStandardMaterial>()
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    ;(object.geometry as BufferGeometry).dispose()
    const meshMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material]
    meshMaterials.forEach((material) => {
      if (material instanceof MeshStandardMaterial) materials.add(material)
    })
  })
  materials.forEach((material) => material.dispose())
}

describe('scale encounter production forest ecology', () => {
  it('uses every reviewed silhouette with tier-specific LODs', () => {
    const scatter = createScaleEncounterProductionForestScatter()
    expect(scatter.counts).toEqual({
      branch: 22,
      fern: 96,
      litter: 155,
      log: 11,
      moss: 132,
      rock: 52,
      shrub: 36,
    })
    expect(scatter.batches).toHaveLength(42)
    expect(scatter.batches.map(({ templateName }) => templateName)).toEqual(
      expect.arrayContaining([
        ...SCALE_ENCOUNTER_PRODUCTION_ECOLOGY_TEMPLATE_NAMES,
      ]),
    )

    for (const batch of scatter.batches) {
      if (batch.kind === 'litter') continue
      expect(batch.placements.every(({ tier }) =>
        batch.templateName.endsWith(tier === 'near' ? '_lod0' : '_lod1'),
      )).toBe(true)
    }
  })

  it.each([
    ['current', 85],
    ['1.25x', 86],
    ['1.5x', 91],
  ] as const)(
    'moves the %s foreground budget into low-cost ground layers',
    (density, expectedRenderedProps) => {
      const scatter = createScaleEncounterProductionForestScatter(density)
      const renderedProps = scatter.batches
        .filter(({ kind }) => ['branch', 'log', 'rock'].includes(kind))
        .reduce((sum, { placements }) => sum + placements.length, 0)
      expect(renderedProps).toBe(expectedRenderedProps)
    },
  )

  it('forms colonies and leaves irregular gaps instead of a uniform icon field', () => {
    const ferns = placementsForKind('fern')
    const nearestDistances = ferns.map((placement, index) =>
      Math.min(
        ...ferns
          .filter((_, otherIndex) => otherIndex !== index)
          .map((other) =>
            Math.hypot(placement.x - other.x, placement.z - other.z),
          ),
      ),
    )
    expect(
      nearestDistances.filter((distance) => distance < 2.2).length /
        nearestDistances.length,
    ).toBeGreaterThan(0.5)
    expect(Math.max(...nearestDistances)).toBeGreaterThan(4)

    const nearPatchSizes = new Map<number, number>()
    for (const placement of ferns.filter(({ tier }) => tier === 'near')) {
      nearPatchSizes.set(
        placement.patchId,
        (nearPatchSizes.get(placement.patchId) ?? 0) + 1,
      )
    }
    const sizes = [...nearPatchSizes.values()]
    expect(Math.max(...sizes) / Math.min(...sizes)).toBeGreaterThan(2.2)
  })

  it('fills the inner clearing only with low cover while protecting both subjects', () => {
    const scatter = createScaleEncounterProductionForestScatter()
    const lowCover = scatter.batches
      .filter(({ kind }) => ['fern', 'litter', 'moss'].includes(kind))
      .flatMap(({ placements }) => placements)
    const largeProps = scatter.batches
      .filter(({ kind }) => ['log', 'rock'].includes(kind))
      .flatMap(({ placements }) => placements)

    expect(Math.min(...lowCover.map(radius))).toBeLessThan(8)
    expect(Math.min(...largeProps.map(radius))).toBeGreaterThanOrEqual(22)
    for (const placement of lowCover) {
      const outsideAnimal =
        ((placement.x - 2.2) / 8.6) ** 2 + (placement.z / 3.7) ** 2 >= 1
      expect(outsideAnimal).toBe(true)
      const closestRailX = Math.max(-22, Math.min(-7, placement.x))
      expect(Math.hypot(placement.x - closestRailX, placement.z)).toBeGreaterThanOrEqual(1.55)
    }
  })

  it('is deterministic and remains inside the reviewed 122 m ecology field', () => {
    const first = createScaleEncounterProductionForestScatter()
    expect(createScaleEncounterProductionForestScatter()).toEqual(first)
    const placements = first.batches.flatMap(({ placements }) => placements)
    expect(Math.max(...placements.map(radius))).toBeLessThanOrEqual(122)
    expect(new Set(placements.map(({ x, z }) => `${x}:${z}`)).size).toBe(
      placements.length,
    )
  })

  it('groups material-compatible terrain props outside the real-shadow budget', () => {
    const propTemplate = createEcologyTemplate()
    const environment = createScaleEncounterEnvironment(
      'land',
      'production-slice',
      new Texture(),
      {
        animalId: 'tyrannosaurus-rex',
        forestProps: propTemplate,
      },
    )
    expect(environment).not.toBeNull()
    if (!environment) return

    const propRoot = environment.root.getObjectByName(
      'scale-encounter-real-forest-props',
    ) as Group
    const batches = propRoot.children.filter(
      (child): child is BatchedMesh => child instanceof BatchedMesh,
    )
    expect(batches).toHaveLength(3)
    expect(propRoot.userData.scaleEncounterEcologyDrawCalls).toBe(3)
    expect(batches.filter(({ castShadow }) => castShadow)).toHaveLength(0)
    expect(batches.filter(({ castShadow }) => !castShadow)).toHaveLength(3)
    expect(
      propRoot.userData.scaleEncounterDeferredOpaqueGroundPatches,
    ).toBe(true)
    expect(
      environment.root.getObjectByName(
        'scale-encounter-production-ecology-litter-batch',
      ),
    ).toBeUndefined()
    expect(
      batches.reduce(
        (sum, batch) =>
          sum +
          (batch.userData.scaleEncounterEcologyInstanceCount as number),
        0,
      ),
    ).toBe(85)
    expect(
      batches.reduce(
        (sum, batch) =>
          sum +
          (batch.userData.scaleEncounterEcologyUniqueGeometryCount as number),
        0,
      ),
    ).toBe(16)
    expect(
      batches.reduce(
        (sum, batch) =>
          sum +
          (batch.userData.scaleEncounterEstimatedTriangles as number),
        0,
      ),
    ).toBeLessThan(500_000)
    for (const batch of batches) {
      expect(batch.userData.scaleEncounterEcologyGrounding).toMatchObject({
        airborneInstanceCount: 0,
        instanceCount:
          batch.userData.scaleEncounterEcologyInstanceCount as number,
      })
      expect(
        (batch.userData.scaleEncounterEcologyGrounding as {
          readonly maximumAbsoluteGroundingError: number
        }).maximumAbsoluteGroundingError,
      ).toBeLessThan(0.000_001)
    }

    disposeScaleEncounterEnvironment(environment)
    disposeEcologyTemplate(propTemplate)
  })
})
