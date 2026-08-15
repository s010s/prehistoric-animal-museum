import {
  BatchedMesh,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { ScaleEncounterEcologyDensity } from './scale-encounter-ecology-density'

/**
 * Low-frequency depth between the authored midground population and the v5
 * equirectangular plate.  It deliberately avoids a continuous annulus: six
 * tapered landform sectors and six offset tree colonies leave broad openings
 * through which the plate remains visible.  Both layers are opaque world-space
 * geometry, so the scene fog can dissolve them without transparent sorting or
 * a screen-horizontal alpha band.
 */

type TerrainHeightAtWorld = (worldX: number, worldZ: number) => number

export interface ScaleEncounterProductionFarTreeAnchor {
  readonly height: number
  readonly radius: number
  readonly widthScale: number
  readonly x: number
  readonly yaw: number
  readonly z: number
}

export interface ScaleEncounterProductionFarRidgeSector {
  readonly centreAngle: number
  readonly halfSpan: number
  readonly height: number
  readonly radius: number
  readonly radialDepth: number
  readonly seed: number
}

export interface ScaleEncounterProductionFarDepthPlan {
  readonly ridgeSectors: ReadonlyArray<ScaleEncounterProductionFarRidgeSector>
  readonly trees: ReadonlyArray<ScaleEncounterProductionFarTreeAnchor>
}

export interface ScaleEncounterProductionFarDepthMetadata {
  readonly angularCoverageRatio: number
  readonly density: ScaleEncounterEcologyDensity
  readonly drawCalls: number
  readonly estimatedTriangles: number
  readonly layout: 'broken-ridge-sectors-and-offset-tree-colonies'
  readonly maximumRadiusMeters: number
  readonly minimumRadiusMeters: number
  readonly profileCount: number
  readonly representation:
    | 'alpha-clipped-multi-profile-world-space-fog-proxies'
    | 'instanced-scanned-tree-lod-world-space-fog-proxies'
  readonly ridgeSectorCount: number
  readonly treeColonyCount: number
  readonly treeCount: number
}

const TAU = Math.PI * 2
const FAR_TREE_MINIMUM_RADIUS_METERS = 82
const FAR_TREE_MAXIMUM_RADIUS_METERS = 218
const FAR_TREE_PROFILE_COUNT = 8
// The nursery scans become implausibly thin when stretched to a 12–15 m far
// tree and were the pale vertical needles visible in the previous QA pass.
// The reviewed root-to-tip silhouettes provide eight distinct mature forms.
const USE_SCANNED_FAR_SAPLINGS = false
const LOCAL_ENVIRONMENT_ROUTE =
  '/__museum-review-assets/scale-encounter-environments'

function reviewCandidateUrl(bundledUrl: URL): string {
  if (
    import.meta.env.MODE === 'development' ||
    import.meta.env.MODE === 'review'
  ) {
    const fileName = bundledUrl.pathname.slice(
      bundledUrl.pathname.lastIndexOf('/') + 1,
    )
    return `${LOCAL_ENVIRONMENT_ROUTE}/${fileName}`
  }
  return bundledUrl.href
}

const farTreeAtlasUrl = reviewCandidateUrl(
  new URL(
    '../../assets/candidates/scale-encounter-environments/midground-mature-tree-atlas-v1-1024.webp',
    import.meta.url,
  ),
)

const RIDGE_SECTORS = [
  { centreAngle: -2.68, halfSpan: 0.37, height: 12.8, radius: 221, radialDepth: 34, seed: 11 },
  { centreAngle: -1.92, halfSpan: 0.24, height: 10.6, radius: 214, radialDepth: 30, seed: 23 },
  { centreAngle: -1.23, halfSpan: 0.28, height: 14.2, radius: 226, radialDepth: 35, seed: 31 },
  { centreAngle: -0.16, halfSpan: 0.33, height: 13.4, radius: 232, radialDepth: 38, seed: 37 },
  { centreAngle: 1.08, halfSpan: 0.46, height: 11.7, radius: 218, radialDepth: 32, seed: 53 },
  { centreAngle: 2.31, halfSpan: 0.3, height: 9.8, radius: 235, radialDepth: 28, seed: 71 },
] as const satisfies ReadonlyArray<ScaleEncounterProductionFarRidgeSector>

interface TreeColony {
  readonly angle: number
  readonly angularSpread: number
  readonly count: number
  readonly radius: number
  readonly radialSpread: number
  readonly seed: number
}

const TREE_COLONIES = [
  { angle: -2.95, angularSpread: 0.24, count: 3, radius: 152, radialSpread: 25, seed: 101 },
  { angle: -2.05, angularSpread: 0.21, count: 2, radius: 174, radialSpread: 22, seed: 149 },
  { angle: -0.92, angularSpread: 0.28, count: 3, radius: 146, radialSpread: 27, seed: 211 },
  { angle: 0.42, angularSpread: 0.23, count: 2, radius: 176, radialSpread: 22, seed: 277 },
  { angle: 1.61, angularSpread: 0.31, count: 3, radius: 142, radialSpread: 27, seed: 347 },
  { angle: 2.73, angularSpread: 0.24, count: 2, radius: 166, radialSpread: 24, seed: 419 },
  // The tall portrait overview looks towards -Z. A small, shallow colony in
  // that valley keeps the mobile frame from losing its mid/far vegetation
  // layer without closing the clearing into a uniform ring.
  { angle: -1.56, angularSpread: 0.5, count: 4, radius: 112, radialSpread: 23, seed: 503 },
] as const satisfies ReadonlyArray<TreeColony>

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function createFarTrees(multiplier = 1): ScaleEncounterProductionFarTreeAnchor[] {
  return TREE_COLONIES.flatMap((colony) => {
    const random = seededRandom(colony.seed)
    const count = Math.round(colony.count * multiplier)
    const clumpCount = Math.max(2, Math.round(Math.sqrt(count)))
    const clumps = Array.from({ length: clumpCount }, () => ({
      angle:
        colony.angle + (random() - 0.5) * colony.angularSpread * 1.55,
      radius: colony.radius + (random() - 0.5) * colony.radialSpread * 1.35,
    }))
    return Array.from({ length: count }, (_, index) => {
      // Trees gather in overlapping clumps with ragged edges. Independent
      // even scattering made the most distant silhouettes resemble equally
      // spaced icons when projected into only a few pixels.
      const clump = clumps[(index * 5 + colony.seed) % clumps.length]!
      const angle =
        clump.angle +
        (random() + random() - 1) * colony.angularSpread * 0.22
      const radius = Math.max(
        FAR_TREE_MINIMUM_RADIUS_METERS,
        Math.min(
          FAR_TREE_MAXIMUM_RADIUS_METERS,
          clump.radius +
            (random() + random() - 1) * colony.radialSpread * 0.24,
        ),
      )
      const distanceProgress =
        (radius - FAR_TREE_MINIMUM_RADIUS_METERS) /
        (FAR_TREE_MAXIMUM_RADIUS_METERS - FAR_TREE_MINIMUM_RADIUS_METERS)
      const heightScale = colony.seed === 503 ? 0.78 : 0.9
      const height =
        (8.4 + random() * (7.2 - distanceProgress * 1.8)) * heightScale
      return {
        height: round(height),
        radius: round(radius),
        widthScale: round(0.56 + random() * 0.32),
        x: round(Math.cos(angle) * radius),
        yaw: round(random() * TAU),
        z: round(Math.sin(angle) * radius),
      }
    })
  })
}

export function createScaleEncounterProductionFarDepthPlan(): ScaleEncounterProductionFarDepthPlan {
  return {
    ridgeSectors: RIDGE_SECTORS.map((sector) => ({ ...sector })),
    trees: createFarTrees(),
  }
}

function createRidgeGeometry(
  sectors: ReadonlyArray<ScaleEncounterProductionFarRidgeSector>,
  terrainHeightAtWorld: TerrainHeightAtWorld,
): BufferGeometry {
  const positions: number[] = []
  const colours: number[] = []
  const indices: number[] = []
  // A denser angular profile costs only a few hundred static triangles and
  // keeps the atmospheric skyline from reading as a low-poly cardboard saw.
  const segmentCount = 36
  const baseColour = new Color('#555950')
  const shoulderColour = new Color('#62665d')
  const colour = new Color()

  for (const sector of sectors) {
    const sectorStart = positions.length / 3
    for (let segment = 0; segment <= segmentCount; segment += 1) {
      const progress = segment / segmentCount
      const angle =
        sector.centreAngle + (progress * 2 - 1) * sector.halfSpan
      const endTaper = Math.sin(progress * Math.PI) ** 0.72
      // Mountain-sized undulation only. Per-segment white noise made every
      // edge vertex visible as a hard cardboard fold in the 30-degree audit.
      const irregularity =
        Math.sin(progress * Math.PI * 2.15 + sector.seed * 0.37) * 0.12 +
        Math.sin(progress * Math.PI * 4.4 - sector.seed * 0.19) * 0.045
      const peakHeight =
        sector.height * endTaper * Math.max(0.42, 0.78 + irregularity)
      const peakRadius =
        sector.radius +
        Math.sin(progress * Math.PI * 2.7 + sector.seed * 0.21) * 5.8 +
        Math.sin(progress * Math.PI * 3.1 + sector.seed) * 1.35
      const radii = [
        peakRadius - sector.radialDepth * 0.5,
        peakRadius,
        peakRadius + sector.radialDepth * 0.5,
      ] as const
      radii.forEach((radius, row) => {
        const x = Math.cos(angle) * radius
        const z = Math.sin(angle) * radius
        const terrainY = terrainHeightAtWorld(x, z)
        const rowHeight = row === 1 ? peakHeight : row === 0 ? 0.08 : 0.03
        positions.push(x, terrainY + rowHeight - 0.03, z)
        colour
          .copy(baseColour)
          .lerp(shoulderColour, row === 1 ? 0.3 + endTaper * 0.18 : 0.04)
          .toArray(colours, colours.length)
      })
    }

    for (let segment = 0; segment < segmentCount; segment += 1) {
      const current = sectorStart + segment * 3
      const next = current + 3
      // Near slope, then far slope. The shoulders terminate on sampled terrain
      // at both ends, preventing either a vertical cap or a ruler-straight top.
      indices.push(
        current,
        next,
        current + 1,
        next,
        next + 1,
        current + 1,
        current + 1,
        next + 1,
        current + 2,
        next + 1,
        next + 2,
        current + 2,
      )
    }
  }

  const geometry = new BufferGeometry()
  geometry.name = 'scale-encounter-production-far-ridge-geometry'
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(positions), 3),
  )
  geometry.setAttribute(
    'color',
    new BufferAttribute(new Float32Array(colours), 3),
  )
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function triangleCount(geometry: BufferGeometry): number {
  return (geometry.index?.count ?? geometry.getAttribute('position').count) / 3
}

function farTreeAtlasCellBounds(profile: number): {
  readonly u0: number
  readonly u1: number
  readonly v0: number
  readonly v1: number
} {
  const columns = 4
  const rows = 2
  const column = profile % columns
  const rowFromTop = Math.floor(profile / columns)
  const paddingU = 0.012
  const paddingV = 0.009
  return {
    u0: (column + paddingU) / columns,
    u1: (column + 1 - paddingU) / columns,
    v0: 1 - (rowFromTop + 1 - paddingV) / rows,
    v1: 1 - (rowFromTop + paddingV) / rows,
  }
}

function createFarTreePrototype(profile: number): BufferGeometry {
  const parts: BufferGeometry[] = []
  // Two fixed world-space profiles give the distant silhouette volume while
  // remaining alpha-clipped and depth-writing.  These are not camera-facing
  // billboards, so a 360-degree orbit never makes the colony swivel.
  for (let planeIndex = 0; planeIndex < 2; planeIndex += 1) {
    const bounds = farTreeAtlasCellBounds(profile)
    const profileHeight = planeIndex === 0 ? 1 : 0.96
    const profileWidth = planeIndex === 0 ? 1 : 0.88
    const plane = new PlaneGeometry(profileWidth, profileHeight, 1, 1)
    const uvs = plane.getAttribute('uv')
    for (let index = 0; index < uvs.count; index += 1) {
      const sourceU =
        (profile + planeIndex) % 3 === 1
          ? 1 - uvs.getX(index)
          : uvs.getX(index)
      uvs.setXY(
        index,
        bounds.u0 + (bounds.u1 - bounds.u0) * sourceU,
        bounds.v0 + (bounds.v1 - bounds.v0) * uvs.getY(index),
      )
    }
    uvs.needsUpdate = true
    plane.rotateY(
      planeIndex * Math.PI * 0.5 + (profile % 2 === 0 ? 0.04 : -0.035),
    )
    plane.translate(
      0,
      profileHeight * 0.5,
      0,
    )
    parts.push(plane)
  }
  const geometry = mergeGeometries(parts, false)
  parts.forEach((part) => part.dispose())
  if (!geometry) throw new Error('Unable to merge far tree cutout profile')
  geometry.name = `scale-encounter-production-far-tree-profile-${profile + 1}`
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

interface FarTreeBatchStats {
  readonly drawCalls: number
  readonly profileCount: number
  readonly representation: ScaleEncounterProductionFarDepthMetadata['representation']
  readonly triangles: number
}

function borrowFarTreeMaterialTextures(
  material: Material | Material[],
  borrowedTextures?: Set<Texture>,
): void {
  if (!borrowedTextures) return
  const materials = Array.isArray(material) ? material : [material]
  for (const entry of materials) {
    for (const value of Object.values(entry)) {
      if (value instanceof Texture) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        borrowedTextures.add(value)
      }
    }
  }
}

function cloneNormalizedFarTreePrototype(
  templateRoot: Group,
  sourceName: string,
  borrowedTextures?: Set<Texture>,
): {
  readonly geometry: BufferGeometry
  readonly material: Material | Material[]
} | null {
  const object = templateRoot.getObjectByName(sourceName)
  if (!(object instanceof Mesh)) return null
  const templateMesh = object as Mesh<BufferGeometry, Material | Material[]>
  templateRoot.updateMatrixWorld(true)
  templateMesh.updateMatrixWorld(true)
  const relativeMatrix = new Matrix4()
    .copy(templateRoot.matrixWorld)
    .invert()
    .multiply(templateMesh.matrixWorld)
  const geometry = templateMesh.geometry.clone()
  geometry.applyMatrix4(relativeMatrix)
  geometry.computeBoundingBox()
  const bounds = geometry.boundingBox?.clone()
  if (!bounds) {
    geometry.dispose()
    return null
  }
  const height = Math.max(0.001, bounds.max.y - bounds.min.y)
  geometry.translate(
    -(bounds.min.x + bounds.max.x) * 0.5,
    -bounds.min.y,
    -(bounds.min.z + bounds.max.z) * 0.5,
  )
  geometry.scale(1 / height, 1 / height, 1 / height)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  const material = Array.isArray(templateMesh.material)
    ? templateMesh.material.map((entry) => entry.clone())
    : templateMesh.material.clone()
  const materials = Array.isArray(material) ? material : [material]
  materials.forEach((entry) => {
    entry.side = DoubleSide
    entry.alphaToCoverage = true
    if (entry instanceof MeshStandardMaterial) {
      entry.metalness = 0
      entry.roughness = Math.max(0.82, entry.roughness)
      entry.envMapIntensity = Math.min(0.72, entry.envMapIntensity)
    }
  })
  borrowFarTreeMaterialTextures(material, borrowedTextures)
  return { geometry, material }
}

function addScannedFarTreeColonies(
  group: Group,
  trees: ReadonlyArray<ScaleEncounterProductionFarTreeAnchor>,
  terrainHeightAtWorld: TerrainHeightAtWorld,
  templateRoot: Group,
  borrowedTextures?: Set<Texture>,
): FarTreeBatchStats | null {
  const sourceNames = [
    'real_tree_fir_sapling_a_lod1',
    'real_tree_fir_sapling_b_lod1',
    'real_tree_fir_sapling_c_lod1',
    'real_tree_pine_sapling_small_a_lod1',
    'real_tree_pine_sapling_small_b_lod1',
    'real_tree_pine_sapling_small_c_lod1',
  ] as const
  if (
    !sourceNames.every(
      (sourceName) => templateRoot.getObjectByName(sourceName) instanceof Mesh,
    )
  ) {
    return null
  }

  let triangles = 0
  let drawCalls = 0
  sourceNames.forEach((sourceName, sourceIndex) => {
    const sourceTrees = trees.filter(
      (_tree, index) => index % sourceNames.length === sourceIndex,
    )
    if (sourceTrees.length === 0) return
    const prototype = cloneNormalizedFarTreePrototype(
      templateRoot,
      sourceName,
      borrowedTextures,
    )
    if (!prototype) return
    const mesh = new InstancedMesh(
      prototype.geometry,
      prototype.material,
      sourceTrees.length,
    )
    mesh.name = `scale-encounter-production-far-trees-${sourceName}`
    const transform = new Object3D()
    const grounded: Array<
      ScaleEncounterProductionFarTreeAnchor & {
        readonly terrainY: number
        readonly worldBottomY: number
      }
    > = []
    sourceTrees.forEach((anchor, index) => {
      const terrainY = terrainHeightAtWorld(anchor.x, anchor.z)
      transform.position.set(anchor.x, terrainY - 0.035, anchor.z)
      transform.rotation.set(
        (index % 3 - 1) * 0.006,
        anchor.yaw,
        ((index * 5) % 3 - 1) * 0.006,
      )
      transform.scale.set(
        anchor.height * anchor.widthScale,
        anchor.height,
        anchor.height * anchor.widthScale,
      )
      transform.updateMatrix()
      mesh.setMatrixAt(index, transform.matrix)
      mesh.setColorAt(
        index,
        new Color().setRGB(
          0.76 - (index % 4) * 0.018,
          0.82 - (index % 5) * 0.013,
          0.69 - (index % 3) * 0.016,
        ),
      )
      grounded.push({
        ...anchor,
        terrainY,
        worldBottomY: terrainY - 0.035,
      })
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingBox()
    mesh.computeBoundingSphere()
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.userData.scaleEncounterFarTreePlacements = grounded
    mesh.userData.scaleEncounterFarTreeSource = sourceName
    group.add(mesh)
    triangles += triangleCount(prototype.geometry) * sourceTrees.length
    drawCalls += 1
  })

  return drawCalls > 0
    ? {
        drawCalls,
        profileCount: sourceNames.length,
        representation: 'instanced-scanned-tree-lod-world-space-fog-proxies',
        triangles,
      }
    : null
}

function addFarTreeColonies(
  group: Group,
  trees: ReadonlyArray<ScaleEncounterProductionFarTreeAnchor>,
  terrainHeightAtWorld: TerrainHeightAtWorld,
  preparedMatureTreeAtlas: Texture | null = null,
): FarTreeBatchStats {
  if (trees.length === 0) {
    return {
      drawCalls: 0,
      profileCount: FAR_TREE_PROFILE_COUNT,
      representation: 'alpha-clipped-multi-profile-world-space-fog-proxies',
      triangles: 0,
    }
  }
  const atlas =
    preparedMatureTreeAtlas ?? new TextureLoader().load(farTreeAtlasUrl)
  atlas.name = 'scale-encounter-production-mature-tree-atlas-v1'
  atlas.colorSpace = SRGBColorSpace
  atlas.magFilter = LinearFilter
  atlas.minFilter = LinearMipmapLinearFilter
  atlas.generateMipmaps = true
  const material = new MeshBasicMaterial({
    alphaTest: 0.46,
    alphaToCoverage: true,
    color: '#c5ccba',
    fog: true,
    map: atlas,
    side: DoubleSide,
    transparent: false,
  })
  material.name = 'scale-encounter-production-far-tree-material'
  const prototypes = Array.from(
    { length: FAR_TREE_PROFILE_COUNT },
    (_, profile) => createFarTreePrototype(profile),
  )
  const maximumVertexCount = prototypes.reduce(
    (sum, geometry) => sum + geometry.getAttribute('position').count,
    0,
  )
  const maximumIndexCount = prototypes.reduce(
    (sum, geometry) => sum + (geometry.index?.count ?? 0),
    0,
  )
  const batched = new BatchedMesh(
    trees.length,
    maximumVertexCount,
    maximumIndexCount,
    material,
  )
  batched.name = 'scale-encounter-production-far-tree-colonies'
  batched.castShadow = false
  batched.receiveShadow = false
  batched.perObjectFrustumCulled = true
  batched.sortObjects = false
  const geometryIds = prototypes.map((geometry) => batched.addGeometry(geometry))
  const transform = new Object3D()
  const grounded: Array<
    ScaleEncounterProductionFarTreeAnchor & {
      readonly burialDepth: number
      readonly profile: number
      readonly terrainY: number
      readonly worldBottomY: number
    }
  > = []
  const projectionMetrics: Array<{
    readonly height: number
    readonly instanceId: number
    readonly worldCentre: Vector3
  }> = []
  let estimatedTriangles = 0
  trees.forEach((anchor, index) => {
    const profile =
      (Math.floor(anchor.yaw * 1_000) + index * 5) % FAR_TREE_PROFILE_COUNT
    const terrainY = terrainHeightAtWorld(anchor.x, anchor.z)
    transform.position.set(anchor.x, terrainY - 0.025, anchor.z)
    transform.rotation.set(
      (index % 3 - 1) * 0.009,
      anchor.yaw,
      ((index * 5) % 3 - 1) * 0.008,
    )
    transform.scale.set(
      anchor.height * anchor.widthScale,
      anchor.height,
      anchor.height * anchor.widthScale,
    )
    transform.updateMatrix()
    const instanceId = batched.addInstance(geometryIds[profile]!)
    batched.setMatrixAt(instanceId, transform.matrix)
    batched.setColorAt(
      instanceId,
      new Color().setRGB(
        0.4 - (index % 4) * 0.012,
        0.48 - (index % 5) * 0.01,
        0.35 - (index % 3) * 0.011,
      ),
    )
    grounded.push({
      ...anchor,
      burialDepth: 0.025,
      profile,
      terrainY,
      worldBottomY: terrainY - 0.025,
    })
    projectionMetrics.push({
      height: anchor.height,
      instanceId,
      worldCentre: new Vector3(anchor.x, terrainY + anchor.height * 0.5, anchor.z),
    })
    estimatedTriangles += triangleCount(prototypes[profile]!)
  })
  batched.computeBoundingBox()
  batched.computeBoundingSphere()
  batched.userData.scaleEncounterFarTreeCount = trees.length
  batched.userData.scaleEncounterFarTreeProfileCount = FAR_TREE_PROFILE_COUNT
  batched.userData.scaleEncounterFarTreePlacements = grounded
  batched.userData.scaleEncounterFarTreeProjectedPixelGate = 5
  const rendererSize = new Vector2()
  const cameraWorldPosition = new Vector3()
  const updateBatchedDrawList = batched.onBeforeRender.bind(batched)
  batched.onBeforeRender = (
    renderer,
    scene,
    camera,
    geometry,
    renderMaterial,
    group,
  ) => {
    if (camera instanceof PerspectiveCamera) {
      renderer.getSize(rendererSize)
      camera.getWorldPosition(cameraWorldPosition)
      const pixelsPerWorldUnitAtUnitDistance =
        rendererSize.y / (2 * Math.tan((camera.fov * Math.PI) / 360))
      let visibleCount = 0
      projectionMetrics.forEach((metric) => {
        const distance = Math.max(
          0.01,
          cameraWorldPosition.distanceTo(metric.worldCentre),
        )
        const projectedHeight =
          (metric.height * pixelsPerWorldUnitAtUnitDistance) / distance
        const visible = projectedHeight >= 5
        batched.setVisibleAt(metric.instanceId, visible)
        if (visible) visibleCount += 1
      })
      batched.userData.scaleEncounterFarTreeVisibleCount = visibleCount
    }
    updateBatchedDrawList(
      renderer,
      scene,
      camera,
      geometry,
      renderMaterial,
      group,
    )
  }
  group.add(batched)
  return {
    drawCalls: 1,
    profileCount: FAR_TREE_PROFILE_COUNT,
    representation: 'alpha-clipped-multi-profile-world-space-fog-proxies',
    triangles: estimatedTriangles,
  }
}

export function createScaleEncounterProductionFarDepth(
  terrainHeightAtWorld: TerrainHeightAtWorld,
  density: ScaleEncounterEcologyDensity = 'current',
  forestProps: Group | null = null,
  borrowedTextures?: Set<Texture>,
  preparedMatureTreeAtlas: Texture | null = null,
): Group {
  const plan = createScaleEncounterProductionFarDepthPlan()
  const ridge = new Mesh(
    createRidgeGeometry(plan.ridgeSectors, terrainHeightAtWorld),
    new MeshBasicMaterial({
      vertexColors: true,
    }),
  )
  ridge.name = 'scale-encounter-production-broken-far-ridges'
  ridge.castShadow = false
  ridge.receiveShadow = false
  // The current flat-shaded ridge proxy is retained only as deterministic
  // layout data while the authored distant landscape comes from the v5 plate.
  // Exposing it turns the horizon into a low-poly stage wall in oblique views.
  ridge.visible = false
  const group = new Group()
  group.name = 'scale-encounter-production-far-depth'
  group.add(ridge)
  const farTrees =
    density === 'current'
      ? createFarTrees(0.8)
      : density === '1.25x'
        ? createFarTrees(0.95)
        : createFarTrees(1.1)
  const farTreeStats =
    (USE_SCANNED_FAR_SAPLINGS && forestProps
      ? addScannedFarTreeColonies(
          group,
          farTrees,
          terrainHeightAtWorld,
          forestProps,
          borrowedTextures,
        )
      : null) ??
    addFarTreeColonies(
      group,
      farTrees,
      terrainHeightAtWorld,
      preparedMatureTreeAtlas,
    )
  const allRadii = [
    ...plan.ridgeSectors.flatMap(({ radius, radialDepth }) => [
      radius - radialDepth * 0.5,
      radius + radialDepth * 0.5,
    ]),
  ]
  const estimatedTriangles =
    triangleCount(ridge.geometry) + farTreeStats.triangles
  const metadata: ScaleEncounterProductionFarDepthMetadata = {
    angularCoverageRatio:
      plan.ridgeSectors.reduce((sum, { halfSpan }) => sum + halfSpan * 2, 0) /
      TAU,
    density,
    drawCalls: farTreeStats.drawCalls,
    estimatedTriangles,
    layout: 'broken-ridge-sectors-and-offset-tree-colonies',
    maximumRadiusMeters: Math.max(...allRadii),
    minimumRadiusMeters: Math.min(...allRadii),
    profileCount: farTreeStats.profileCount,
    representation: farTreeStats.representation,
    ridgeSectorCount: plan.ridgeSectors.length,
    treeColonyCount: farTrees.length > 0 ? TREE_COLONIES.length : 0,
    treeCount: farTrees.length,
  }
  group.userData.scaleEncounterProductionFarDepth = metadata
  return group
}
