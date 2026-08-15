import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Texture,
  Vector3,
  type BufferGeometry,
  type InstancedMesh,
  type Material,
  type MeshStandardMaterial,
} from 'three'
import {
  SCALE_ENCOUNTER_ENVIRONMENT_VARIANTS,
  createScaleEncounterEnvironment,
  disposeScaleEncounterEnvironment,
  syncScaleEncounterGroundContacts,
  updateScaleEncounterEnvironment,
  type ScaleEncounterEnvironmentVariant,
} from '../src/viewer/scale-encounter-environment'
import type { ScaleEncounterHabitat } from '../src/viewer/scale-encounter'

const habitats = ['land', 'air', 'water'] as const satisfies readonly ScaleEncounterHabitat[]
const generatedVariants = [
  'baseline',
  'ground-slice',
  'hybrid-slice',
  'production-slice',
] as const satisfies readonly ScaleEncounterEnvironmentVariant[]

interface EnvironmentBudget {
  readonly geometries: Set<BufferGeometry>
  readonly materials: Set<Material>
  readonly meshes: number
  readonly objects: number
  readonly vertices: number
}

function inspectEnvironment(root: Group): EnvironmentBudget {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  let meshes = 0
  let objects = 0
  let vertices = 0

  root.traverse((object) => {
    objects += 1
    if (!(object instanceof Mesh)) return
    const mesh = object as Mesh<BufferGeometry, Material | Material[]>
    meshes += 1
    geometries.add(mesh.geometry)
    vertices += mesh.geometry.getAttribute('position')?.count ?? 0
    const meshMaterials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material]
    meshMaterials.forEach((material) => materials.add(material))
  })

  return { geometries, materials, meshes, objects, vertices }
}

describe('scale encounter environment', () => {
  it('keeps the four forest review variants explicit', () => {
    expect(SCALE_ENCOUNTER_ENVIRONMENT_VARIANTS).toEqual([
      'baseline',
      'ground-slice',
      'hybrid-slice',
      'production-slice',
    ])
    expect(() => updateScaleEncounterEnvironment(null, 10, false)).not.toThrow()
    expect(() => disposeScaleEncounterEnvironment(null)).not.toThrow()
  })

  it.each(
    habitats.flatMap((habitat) =>
      generatedVariants.map((variant) => [habitat, variant] as const),
    ),
  )(
    'creates and fully releases the %s %s environment within the prototype object budget',
    (habitat, variant) => {
      const environment = createScaleEncounterEnvironment(habitat, variant)
      expect(environment).not.toBeNull()
      if (!environment) return

      const parent = new Group()
      parent.add(environment.root)
      const budget = inspectEnvironment(environment.root)

      expect(environment.variant).toBe(variant)
      expect(environment.root.name).toBe(
        `scale-encounter-environment-${habitat}-${variant}`,
      )
      expect(budget.meshes).toBeGreaterThan(0)
      expect(budget.meshes).toBeLessThanOrEqual(32)
      expect(budget.objects).toBeLessThanOrEqual(46)
      expect(budget.vertices).toBeLessThanOrEqual(12_000)

      const geometryDisposals = [...budget.geometries].map((geometry) =>
        vi.spyOn(geometry, 'dispose'),
      )
      const materialDisposals = [...budget.materials].map((material) =>
        vi.spyOn(material, 'dispose'),
      )

      disposeScaleEncounterEnvironment(environment)

      expect(environment.root.parent).toBeNull()
      geometryDisposals.forEach((dispose) => expect(dispose).toHaveBeenCalledOnce())
      materialDisposals.forEach((dispose) => expect(dispose).toHaveBeenCalledOnce())
    },
  )

  it.each([
    ['land', 'scale-encounter-land-ground'],
    ['air', 'scale-encounter-air-far-below'],
    ['water', 'scale-encounter-water-surface'],
  ] as const)(
    'keeps the %s dome centred on the camera without moving its world-space proxy',
    (habitat, proxyName) => {
      const environment = createScaleEncounterEnvironment(habitat, 'baseline')
      expect(environment).not.toBeNull()
      if (!environment) return
      const proxy = environment.root.getObjectByName(proxyName)
      expect(proxy).toBeDefined()
      if (!proxy) return

      environment.root.updateMatrixWorld(true)
      const proxyBefore = proxy.getWorldPosition(new Vector3())
      const cameraPosition = new Vector3(146, 37, -129)

      updateScaleEncounterEnvironment(
        environment,
        12,
        false,
        cameraPosition,
      )
      environment.root.updateMatrixWorld(true)

      expect(
        environment.skyDome.getWorldPosition(new Vector3()),
      ).toEqual(cameraPosition)
      expect(proxy.getWorldPosition(new Vector3())).toEqual(proxyBefore)

      disposeScaleEncounterEnvironment(environment)
    },
  )

  it('keeps land depth proxies behind the reviewed child and animal silhouettes', () => {
    const environment = createScaleEncounterEnvironment('land', 'hybrid-slice')
    expect(environment).not.toBeNull()
    if (!environment) return

    const trees = environment.root.children.filter((child) =>
      child.name.startsWith('scale-encounter-tree-'),
    )
    expect(trees.length).toBeGreaterThan(0)
    for (const tree of trees) {
      tree.traverse((object) => {
        if (!(object instanceof Mesh)) return
        const mesh = object as Mesh<BufferGeometry, Material | Material[]>
        const materials = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material]
        expect(mesh.renderOrder).toBeLessThan(0)
        materials.forEach((material) => expect(material.depthWrite).toBe(false))
      })
    }

    disposeScaleEncounterEnvironment(environment)
  })

  it('marks the tyrannosaurus hybrid slice as waiting for reviewed middle-distance art', () => {
    const environment = createScaleEncounterEnvironment(
      'land',
      'hybrid-slice',
      null,
      { animalId: 'tyrannosaurus-rex' },
    )
    expect(
      environment?.root.userData
        .scaleEncounterNeedsReviewedMiddleDistanceAssets,
    ).toBe(true)
    disposeScaleEncounterEnvironment(environment)
  })

  it('adds real production midground depth around the tyrannosaurus clearing', () => {
    const environment = createScaleEncounterEnvironment(
      'land',
      'production-slice',
      null,
      { animalId: 'tyrannosaurus-rex' },
    )
    const midground = environment?.root.getObjectByName(
      'scale-encounter-production-midground-depth',
    )
    expect(midground).toBeDefined()
    const metadata = midground?.userData
      .scaleEncounterProductionMidground as
      | { readonly totalInstances: number }
      | undefined
    expect(metadata?.totalInstances).toBe(180)
    const groundDetail = environment?.root.getObjectByName(
      'scale-encounter-production-ground-detail',
    )
    expect(groundDetail).toBeDefined()
    const groundDetailMetadata = groundDetail?.userData
      .scaleEncounterProductionGroundDetail as
      | { readonly drawCalls: number; readonly instanceCount: number }
      | undefined
    expect(groundDetailMetadata).toMatchObject({
      drawCalls: 3,
      instanceCount: 520,
    })
    const farDepth = environment?.root.getObjectByName(
      'scale-encounter-production-far-depth',
    )
    expect(farDepth).toBeDefined()
    expect(
      farDepth?.userData.scaleEncounterProductionFarDepth,
    ).toMatchObject({
      drawCalls: 1,
      profileCount: 8,
      ridgeSectorCount: 6,
      treeCount: 15,
    })
    disposeScaleEncounterEnvironment(environment)
  })

  it.each([
    ['current', 180, 520, 24, 15, 114, 917],
    ['1.25x', 226, 650, 34, 19, 143, 1_152],
    ['1.5x', 270, 780, 46, 19, 171, 1_382],
  ] as const)(
    'builds the %s ecology population as a shareable environment version',
    (
      ecologyDensity,
      midgroundCount,
      groundDetailCount,
      rootCount,
      farTreeCount,
      understoryCount,
      totalCount,
    ) => {
      const environment = createScaleEncounterEnvironment(
        'land',
        'production-slice',
        null,
        { animalId: 'tyrannosaurus-rex', ecologyDensity },
      )
      expect(environment?.root.userData.scaleEncounterEcologyDensity).toBe(
        ecologyDensity,
      )
      const midground = environment?.root.getObjectByName(
        'scale-encounter-production-midground-depth',
      )
      const midgroundMetadata = midground?.userData
        .scaleEncounterProductionMidground as unknown as
        | { readonly totalInstances: number }
        | undefined
      expect(
        midgroundMetadata?.totalInstances,
      ).toBe(midgroundCount)
      const groundDetail = environment?.root.getObjectByName(
        'scale-encounter-production-ground-detail',
      )
      expect(
        groundDetail?.userData.scaleEncounterProductionGroundDetail,
      ).toMatchObject({
        instanceCount: groundDetailCount,
        rootInstanceCount: rootCount,
      })
      const farDepth = environment?.root.getObjectByName(
        'scale-encounter-production-far-depth',
      )
      const farDepthMetadata = farDepth?.userData
        .scaleEncounterProductionFarDepth as unknown as
        | { readonly treeCount: number }
        | undefined
      expect(
        farDepthMetadata?.treeCount,
      ).toBe(farTreeCount)
      const understory = environment?.root.getObjectByName(
        'scale-encounter-production-grounded-understory',
      )
      const understoryMetadata = understory?.userData
        .scaleEncounterProductionUnderstory as unknown as
        | {
            readonly airborneInstanceCount: number
            readonly maximumAbsoluteGroundingError: number
            readonly totalInstances: number
          }
        | undefined
      expect(
        understoryMetadata,
      ).toMatchObject({
        airborneInstanceCount: 0,
        totalInstances: understoryCount,
      })
      expect(
        understoryMetadata?.maximumAbsoluteGroundingError,
      ).toBeLessThan(1e-9)
      expect(
        environment?.root.userData.scaleEncounterEcologyPopulation,
      ).toMatchObject({ totalInstances: totalCount })
      disposeScaleEncounterEnvironment(environment)
    },
  )

  it.each([
    ['land', 'scale-encounter-land-ground'],
    ['air', 'scale-encounter-air-far-below'],
    ['water', 'scale-encounter-seabed'],
  ] as const)(
    'combines the borrowed %s equirectangular far field with a world-space near field',
    (habitat, nearFieldName) => {
      const texture = new Texture()
      const albedo = new Texture()
      const normal = new Texture()
      const roughness = new Texture()
      const textureDispose = vi.spyOn(texture, 'dispose')
      const surfaceDisposals = [albedo, normal, roughness].map((surface) =>
        vi.spyOn(surface, 'dispose'),
      )
      const environment = createScaleEncounterEnvironment(
        habitat,
        'hybrid-slice',
        texture,
        {
          animalId:
            habitat === 'water' ? 'mosasaurus' : 'tyrannosaurus-rex',
          maxAnisotropy: 16,
          surfaceTextures:
            habitat === 'air'
              ? null
              : {
                  albedo,
                  normal,
                  physicalWidthMeters: habitat === 'water' ? 15 : 2,
                  roughness,
                },
        },
      )
      expect(environment).not.toBeNull()
      if (!environment) return

      expect(environment.panoramaTexture).toBe(texture)
      expect(environment.root.children).toContain(environment.skyDome)
      expect(environment.root.getObjectByName(nearFieldName)).toBeDefined()
      expect(environment.skyDome.name).toBe('scale-encounter-panorama-dome')
      expect(environment.skyDome.frustumCulled).toBe(false)
      expect(environment.skyDome.material).toBeInstanceOf(MeshBasicMaterial)
      const material = environment.skyDome.material as MeshBasicMaterial
      expect(material.map).toBe(texture)
      expect(material.depthWrite).toBe(false)
      expect(material.depthTest).toBe(false)

      const cameraPosition = new Vector3(168, -42, 203)
      updateScaleEncounterEnvironment(
        environment,
        5,
        false,
        cameraPosition,
      )
      expect(environment.skyDome.position).toEqual(cameraPosition)

      disposeScaleEncounterEnvironment(environment)
      expect(material.map).toBeNull()
      expect(textureDispose).not.toHaveBeenCalled()
      surfaceDisposals.forEach((dispose) => expect(dispose).not.toHaveBeenCalled())
    },
  )

  it('uses a 360 m PBR ground and anchors both subjects with feathered contact cues', () => {
    const textures = {
      albedo: new Texture(),
      normal: new Texture(),
      physicalWidthMeters: 2,
      roughness: new Texture(),
    }
    const environment = createScaleEncounterEnvironment(
      'land',
      'hybrid-slice',
      new Texture(),
      {
        animalId: 'tyrannosaurus-rex',
        maxAnisotropy: 16,
        surfaceTextures: textures,
      },
    )
    expect(environment).not.toBeNull()
    if (!environment) return

    const ground = environment.root.getObjectByName(
      'scale-encounter-land-ground',
    ) as Mesh
    const groundMaterial = ground.material as MeshStandardMaterial
    expect(groundMaterial.map).toBe(textures.albedo)
    expect(groundMaterial.normalMap).toBe(textures.normal)
    expect(groundMaterial.roughnessMap).toBe(textures.roughness)
    expect(textures.albedo.repeat.x).toBe(360)
    expect(textures.albedo.anisotropy).toBe(8)
    const positions = ground.geometry.getAttribute('position')
    let maximumExtent = 0
    for (let index = 0; index < positions.count; index += 1) {
      maximumExtent = Math.max(
        maximumExtent,
        Math.abs(positions.getX(index)),
        Math.abs(positions.getY(index)),
      )
    }
    expect(maximumExtent).toBeCloseTo(360, 3)
    expect(
      Array.from({ length: positions.count }, (_, index) =>
        Math.abs(positions.getZ(index)),
      ).some((height) => height > 0.2),
    ).toBe(true)
    expect(
      environment.root.children.some((child) =>
        /anchor|trunk-anchor|forest-anchor/.test(child.name),
      ),
    ).toBe(false)

    const animal = new Mesh(new BoxGeometry(12, 5, 4))
    animal.position.set(8, 2.5, -3)
    const child = new Mesh(new BoxGeometry(0.5, 1.1, 0.35))
    child.position.set(-4, 0.55, 2)
    syncScaleEncounterGroundContacts(environment, animal, child)
    expect(environment.animalContactCue?.visible).toBe(true)
    expect(environment.animalContactCue?.position.x).toBeCloseTo(8)
    expect(environment.animalContactCue?.position.z).toBeCloseTo(-3)
    expect(environment.childContactCue?.visible).toBe(true)
    expect(environment.childContactCue?.position.x).toBeCloseTo(-4)
    expect(environment.childContactCue?.position.z).toBeCloseTo(2)

    animal.geometry.dispose()
    child.geometry.dispose()
    disposeScaleEncounterEnvironment(environment)
  })

  it('keeps production contact cues tight, visible and attached to the world support plane', () => {
    const environment = createScaleEncounterEnvironment(
      'land',
      'production-slice',
      new Texture(),
      { animalId: 'tyrannosaurus-rex' },
    )
    expect(environment).not.toBeNull()
    if (!environment) return

    const animal = new Mesh(new BoxGeometry(12, 5, 4))
    animal.position.set(2.2, 2.5, 0)
    const child = new Mesh(new BoxGeometry(0.5, 1.1, 0.35))
    child.position.set(-12, 0.55, 0)
    syncScaleEncounterGroundContacts(environment, animal, child)

    const animalMaterial = environment.animalContactCue
      ?.material as MeshBasicMaterial
    const childMaterial = environment.childContactCue
      ?.material as MeshBasicMaterial
    expect(animalMaterial.opacity).toBeGreaterThanOrEqual(0.09)
    expect(childMaterial.opacity).toBeGreaterThanOrEqual(0.24)
    expect(environment.animalContactCue?.position.y).toBeCloseTo(0.006, 3)
    expect(environment.childContactCue?.position.y).toBeCloseTo(0.006, 3)
    expect(environment.childContactCue?.scale.x).toBeLessThan(0.4)

    animal.geometry.dispose()
    child.geometry.dispose()
    disposeScaleEncounterEnvironment(environment)
  })

  it('keeps the hybrid forest terrain level and continuous beneath the full subject rail', () => {
    const environment = createScaleEncounterEnvironment(
      'land',
      'hybrid-slice',
      new Texture(),
      { animalId: 'tyrannosaurus-rex' },
    )
    expect(environment).not.toBeNull()
    if (!environment) return

    const ground = environment.root.getObjectByName(
      'scale-encounter-land-ground',
    ) as Mesh
    const positions = ground.geometry.getAttribute('position')
    let protectedMaximumHeight = 0
    let firstTransitionRingMaximumHeight = 0
    for (let index = 0; index < positions.count; index += 1) {
      const radius = Math.hypot(
        positions.getX(index),
        positions.getY(index),
      )
      const height = Math.abs(positions.getZ(index))
      if (radius <= 22.001) {
        protectedMaximumHeight = Math.max(protectedMaximumHeight, height)
      }
      if (radius > 22 && radius <= 25.001) {
        firstTransitionRingMaximumHeight = Math.max(
          firstTransitionRingMaximumHeight,
          height,
        )
      }
    }

    expect(protectedMaximumHeight).toBeLessThan(0.000_001)
    expect(firstTransitionRingMaximumHeight).toBeLessThan(0.08)
    disposeScaleEncounterEnvironment(environment)
  })

  it('keeps the hybrid mobile ground opaque while preserving the feathered baseline', () => {
    const panorama = new Texture()
    const baseline = createScaleEncounterEnvironment(
      'land',
      'baseline',
      panorama,
      { animalId: 'tyrannosaurus-rex' },
    )
    const hybrid = createScaleEncounterEnvironment(
      'land',
      'hybrid-slice',
      panorama,
      { animalId: 'tyrannosaurus-rex' },
    )
    expect(baseline).not.toBeNull()
    expect(hybrid).not.toBeNull()
    if (!baseline || !hybrid) return

    const baselineGround = baseline.root.getObjectByName(
      'scale-encounter-land-ground',
    ) as Mesh
    const hybridGround = hybrid.root.getObjectByName(
      'scale-encounter-land-ground',
    ) as Mesh
    const baselineMaterial = baselineGround.material as MeshStandardMaterial
    const hybridMaterial = hybridGround.material as MeshStandardMaterial

    expect(baselineMaterial.transparent).toBe(true)
    expect(baselineMaterial.alphaMap).not.toBeNull()
    expect(baselineGround.renderOrder).toBe(-20)
    expect(hybridMaterial.transparent).toBe(true)
    expect(hybridMaterial.alphaMap).toBeNull()
    expect(hybridMaterial.depthWrite).toBe(true)
    expect(hybridGround.renderOrder).toBe(0)

    disposeScaleEncounterEnvironment(baseline)
    disposeScaleEncounterEnvironment(hybrid)
  })

  it('uses continuous opaque terrain with non-shadowing far silhouettes in the production slice', () => {
    const surfaceTextures = {
      albedo: new Texture(),
      normal: new Texture(),
      physicalWidthMeters: 2,
      roughness: new Texture(),
    }
    const environment = createScaleEncounterEnvironment(
      'land',
      'production-slice',
      new Texture(),
      { animalId: 'tyrannosaurus-rex', surfaceTextures },
    )
    expect(environment).not.toBeNull()
    if (!environment) return

    const ground = environment.root.getObjectByName(
      'scale-encounter-land-ground',
    ) as Mesh
    const material = ground.material as MeshStandardMaterial
    expect(material.transparent).toBe(false)
    expect(material.alphaMap).toBeNull()
    expect(material.depthWrite).toBe(true)
    expect(material.color.getHexString()).toBe('f2ead8')
    const farDepth = environment.root.getObjectByName(
      'scale-encounter-production-far-depth',
    )
    expect(farDepth).toBeDefined()
    expect(
      farDepth?.getObjectByName(
        'scale-encounter-production-broken-far-ridges',
      ),
    ).toBeDefined()
    const farTree = farDepth?.getObjectByName(
      'scale-encounter-production-far-tree-colonies',
    ) as Mesh | undefined
    expect(farTree).toBeDefined()
    expect(farTree?.castShadow).toBe(false)
    expect(farTree?.receiveShadow).toBe(false)
    const farTreeMaterial = farTree?.material as MeshBasicMaterial
    expect(farTreeMaterial.transparent).toBe(false)
    expect(farTreeMaterial.depthWrite).toBe(true)

    disposeScaleEncounterEnvironment(environment)
  })

  it('instantiates a dense real forest outside the subject clearing', () => {
    const propTemplate = new Group()
    for (const name of ['fern_02', 'rock_07', 'dead_tree_trunk']) {
      const mesh = new Mesh(new BoxGeometry(1, 1, 1))
      mesh.name = name
      propTemplate.add(mesh)
    }
    const environment = createScaleEncounterEnvironment(
      'land',
      'hybrid-slice',
      new Texture(),
      {
        animalId: 'tyrannosaurus-rex',
        forestProps: propTemplate,
      },
    )
    expect(environment).not.toBeNull()
    if (!environment) return

    const ferns = environment.root.getObjectByName(
      'scale-encounter-real-ferns',
    ) as InstancedMesh
    const rocks = environment.root.getObjectByName(
      'scale-encounter-real-rocks',
    ) as InstancedMesh
    const logs = environment.root.getObjectByName(
      'scale-encounter-real-logs',
    ) as InstancedMesh
    expect(ferns.count).toBe(78)
    expect(rocks.count).toBe(24)
    expect(logs.count).toBe(6)
    expect(
      environment.root.getObjectByName('scale-encounter-real-forest-props'),
    ).toBeDefined()

    disposeScaleEncounterEnvironment(environment)
    propTemplate.traverse((object) => {
      if (object instanceof Mesh) {
        const propMesh = object as Mesh<BufferGeometry, Material | Material[]>
        propMesh.geometry.dispose()
      }
    })
  })

  it('tiles the 15 m water scan 48 times across the 720 m seabed diameter', () => {
    const textures = {
      albedo: new Texture(),
      normal: new Texture(),
      physicalWidthMeters: 15,
      roughness: new Texture(),
    }
    const environment = createScaleEncounterEnvironment(
      'water',
      'baseline',
      new Texture(),
      {
        animalId: 'mosasaurus',
        maxAnisotropy: 16,
        surfaceTextures: textures,
      },
    )
    expect(environment).not.toBeNull()
    expect(textures.albedo.repeat.x).toBe(48)
    expect(textures.albedo.repeat.y).toBe(48)
    disposeScaleEncounterEnvironment(environment)
  })

  it.each([
    ['air', 'scale-encounter-cloud-1', 'position'] as const,
    ['water', 'scale-encounter-light-shaft-1', 'rotation'] as const,
  ])('derives the %s idle environment pose from time instead of frame count', (
    habitat,
    objectName,
    property,
  ) => {
    const environment = createScaleEncounterEnvironment(habitat, 'hybrid-slice')
    expect(environment).not.toBeNull()
    if (!environment) return
    const object = environment.root.getObjectByName(objectName)
    expect(object).toBeDefined()
    if (!object) return

    updateScaleEncounterEnvironment(environment, 12, false)
    const first = property === 'position' ? object.position.x : object.rotation.z
    updateScaleEncounterEnvironment(environment, 12, false)
    const repeated =
      property === 'position' ? object.position.x : object.rotation.z
    updateScaleEncounterEnvironment(environment, 24, false)
    const later = property === 'position' ? object.position.x : object.rotation.z

    expect(repeated).toBeCloseTo(first, 12)
    expect(later).not.toBeCloseTo(first, 6)
    disposeScaleEncounterEnvironment(environment)
  })
})
