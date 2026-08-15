import {
  BatchedMesh,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  scaleEncounterEcologyDensityMultiplier,
  type ScaleEncounterEcologyDensity,
} from './scale-encounter-ecology-density'

type TerrainHeightAtWorld = (worldX: number, worldZ: number) => number
type UnderstoryKind = 'fern' | 'shrub'

interface UnderstoryPatch {
  readonly kind: UnderstoryKind
  readonly radiusX: number
  readonly radiusZ: number
  readonly weight: number
  readonly x: number
  readonly z: number
}

export interface ScaleEncounterProductionUnderstoryAnchor {
  readonly height: number
  readonly kind: UnderstoryKind
  readonly patchId: number
  readonly radius: number
  readonly variant: 0 | 1
  readonly widthScale: number
  readonly x: number
  readonly yaw: number
  readonly z: number
}

export interface ScaleEncounterProductionUnderstoryMetadata {
  readonly airborneInstanceCount: number
  readonly density: ScaleEncounterEcologyDensity
  readonly drawCalls: number
  readonly estimatedTriangles: number
  readonly fernCount: number
  readonly maximumAbsoluteGroundingError: number
  readonly representation: 'alpha-clipped-grounded-colonies-with-root-collars'
  readonly shrubCount: number
  readonly totalInstances: number
}

const LOCAL_ENVIRONMENT_ROUTE =
  '/__museum-review-assets/scale-encounter-environments'

function reviewCandidateUrl(bundledUrl: URL): string {
  if (
    import.meta.env.MODE === 'development' ||
    import.meta.env.MODE === 'review'
  ) {
    return `${LOCAL_ENVIRONMENT_ROUTE}/${bundledUrl.pathname.slice(
      bundledUrl.pathname.lastIndexOf('/') + 1,
    )}`
  }
  return bundledUrl.href
}

const vegetationAtlasUrl = reviewCandidateUrl(
  new URL(
    '../../assets/candidates/scale-encounter-environments/midground-vegetation-atlas-v2.webp',
    import.meta.url,
  ),
)

// These are deliberately asymmetric habitat pockets rather than an annulus.
// The central animal ellipse and the child's full observation rail are tested
// again after sampling, so density grows along the clearing edge without
// becoming a horizontal fern belt or hiding the scale comparison.
const UNDERSTORY_PATCHES = [
  { kind: 'fern', x: -4.5, z: -10.8, radiusX: 5.8, radiusZ: 2.7, weight: 1.5 },
  { kind: 'fern', x: 10.6, z: 8.7, radiusX: 4.4, radiusZ: 4.9, weight: 0.95 },
  { kind: 'fern', x: 13.4, z: -9.6, radiusX: 5.7, radiusZ: 3.4, weight: 1.18 },
  { kind: 'fern', x: -8.2, z: 12.4, radiusX: 6.5, radiusZ: 3.2, weight: 0.72 },
  { kind: 'fern', x: -19.8, z: -13.4, radiusX: 8.1, radiusZ: 5.6, weight: 1.34 },
  { kind: 'fern', x: 23.5, z: 16.8, radiusX: 9.2, radiusZ: 6.1, weight: 0.84 },
  { kind: 'shrub', x: -23.2, z: 10.8, radiusX: 8.8, radiusZ: 6.2, weight: 1.42 },
  { kind: 'shrub', x: 22.6, z: -15.8, radiusX: 9.6, radiusZ: 6.8, weight: 1.08 },
  { kind: 'shrub', x: -3.4, z: -25.6, radiusX: 12.4, radiusZ: 5.8, weight: 0.82 },
  { kind: 'shrub', x: 29.2, z: 5.4, radiusX: 7.8, radiusZ: 9.2, weight: 1.26 },
  { kind: 'shrub', x: -29.4, z: -18.6, radiusX: 9.4, radiusZ: 7.4, weight: 0.76 },
] as const satisfies ReadonlyArray<UnderstoryPatch>

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

function distanceToChildRail(x: number, z: number): number {
  const closestX = Math.max(-23, Math.min(-6, x))
  return Math.hypot(x - closestX, z)
}

export function isOutsideScaleEncounterProductionUnderstoryCorridor(
  x: number,
  z: number,
): boolean {
  const outsideAnimal = ((x - 2.2) / 10.4) ** 2 + (z / 5.4) ** 2 >= 1
  return outsideAnimal && distanceToChildRail(x, z) >= 2.65
}

function choosePatch(
  patches: ReadonlyArray<UnderstoryPatch>,
  random: () => number,
): { readonly index: number; readonly patch: UnderstoryPatch } {
  const total = patches.reduce((sum, patch) => sum + patch.weight, 0)
  let value = random() * total
  for (let index = 0; index < patches.length; index += 1) {
    const patch = patches[index]!
    value -= patch.weight
    if (value <= 0) return { index, patch }
  }
  return { index: patches.length - 1, patch: patches.at(-1)! }
}

export function createScaleEncounterProductionUnderstoryPlan(
  density: ScaleEncounterEcologyDensity,
): ScaleEncounterProductionUnderstoryAnchor[] {
  const multiplier = scaleEncounterEcologyDensityMultiplier(density)
  const random = seededRandom(0x7b31e84d)
  const anchors: ScaleEncounterProductionUnderstoryAnchor[] = []
  const targets: ReadonlyArray<{ readonly count: number; readonly kind: UnderstoryKind }> = [
    // Add a modest amount of knee-high foreground cover without increasing
    // the taller shrub population or narrowing the child/animal corridor.
    { count: Math.round(80 * multiplier), kind: 'fern' },
    { count: Math.round(34 * multiplier), kind: 'shrub' },
  ]

  for (const { count, kind } of targets) {
    const patches = UNDERSTORY_PATCHES.filter((patch) => patch.kind === kind)
    for (let index = 0; index < count; index += 1) {
      let accepted:
        | { readonly patchId: number; readonly x: number; readonly z: number }
        | undefined
      for (let attempt = 0; attempt < 320; attempt += 1) {
        const { index: patchId, patch } = choosePatch(patches, random)
        const angle = random() * Math.PI * 2
        const clusterRadius = random() ** 2.15
        const x = patch.x + Math.cos(angle) * patch.radiusX * clusterRadius
        const z = patch.z + Math.sin(angle) * patch.radiusZ * clusterRadius
        const radius = Math.hypot(x, z)
        const minimumRadius = kind === 'fern' ? 6 : 12
        // This layer owns the requested 6–30 m near/middle ecology. Keeping
        // every instance inside 30 m also makes the batch eligible for the
        // encounter's tightly bounded real-shadow budget; everything beyond
        // this range belongs to the shadowless mid/far systems.
        const maximumRadius = kind === 'fern' ? 24 : 30
        const minimumSeparation =
          (kind === 'fern' ? 0.72 : 1.45) / Math.sqrt(multiplier)
        if (
          radius < minimumRadius ||
          radius > maximumRadius ||
          !isOutsideScaleEncounterProductionUnderstoryCorridor(x, z) ||
          anchors.some(
            (anchor) =>
              anchor.kind === kind &&
              Math.hypot(anchor.x - x, anchor.z - z) < minimumSeparation,
          )
        ) {
          continue
        }
        accepted = { patchId, x, z }
        break
      }
      if (!accepted) {
        throw new Error(`Unable to place grounded ${kind} ${index + 1}/${count}`)
      }
      const radius = Math.hypot(accepted.x, accepted.z)
      anchors.push({
        height:
          kind === 'fern'
            ? 0.34 + random() * 0.38
            : 0.58 + random() * 0.5,
        kind,
        patchId: accepted.patchId,
        radius,
        variant: ((index + accepted.patchId) % 2) as 0 | 1,
        widthScale: 0.82 + random() * 0.42,
        x: accepted.x,
        yaw: random() * Math.PI * 2,
        z: accepted.z,
      })
    }
  }
  return anchors
}

function atlasCellBounds(cell: number): {
  readonly u0: number
  readonly u1: number
  readonly v0: number
  readonly v1: number
} {
  const columns = 8
  const padding = 0.006
  return {
    u0: (cell + padding) / columns,
    u1: (cell + 1 - padding) / columns,
    v0: 0.008,
    v1: 0.992,
  }
}

function mapUvsToCell(geometry: BufferGeometry, cell: number, mirror: boolean): void {
  const bounds = atlasCellBounds(cell)
  const uvs = geometry.getAttribute('uv')
  for (let index = 0; index < uvs.count; index += 1) {
    const u = mirror ? 1 - uvs.getX(index) : uvs.getX(index)
    uvs.setXY(
      index,
      bounds.u0 + (bounds.u1 - bounds.u0) * u,
      bounds.v0 + (bounds.v1 - bounds.v0) * uvs.getY(index),
    )
  }
  uvs.needsUpdate = true
}

function createFoliagePrototype(kind: UnderstoryKind, variant: 0 | 1): BufferGeometry {
  const parts: BufferGeometry[] = []
  const cell = kind === 'fern' ? 1 + variant * 3 : 2 + variant * 3
  const profileCount = kind === 'fern' ? 3 : 2
  for (let profile = 0; profile < profileCount; profile += 1) {
    const width =
      (kind === 'fern' ? 1.2 : 1.06) *
      (0.88 + ((profile * 5 + variant * 3) % 4) * 0.055)
    const height =
      (kind === 'fern' ? 0.72 : 0.92) *
      (0.94 + ((profile * 7 + variant) % 3) * 0.035)
    const plane = new PlaneGeometry(width, height, 1, 2)
    mapUvsToCell(plane, cell, (profile + variant) % 2 === 1)
    plane.rotateY((profile / profileCount) * Math.PI + variant * 0.07)
    plane.rotateZ((profile - 1) * 0.035)
    // Root-to-tip silhouettes are grounded by their true transformed bounds
    // below; this small overlap buries any residual transparent atlas gutter.
    plane.translate(0, height * 0.47, 0)
    parts.push(plane)
  }
  const geometry = mergeGeometries(parts, false)
  parts.forEach((part) => part.dispose())
  if (!geometry) throw new Error(`Unable to merge ${kind} understory prototype`)
  geometry.name = `scale-encounter-grounded-${kind}-${variant}-foliage`
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function createRootCollarPrototype(): BufferGeometry {
  const root = new CylinderGeometry(0.035, 0.075, 0.09, 7, 1, false)
  root.translate(0, 0.045, 0)
  root.computeBoundingBox()
  root.computeBoundingSphere()
  root.name = 'scale-encounter-understory-root-collar'
  return root
}

function terrainNormal(
  terrainHeightAtWorld: TerrainHeightAtWorld,
  x: number,
  z: number,
  target: Vector3,
): Vector3 {
  const step = 0.35
  const slopeX =
    (terrainHeightAtWorld(x + step, z) -
      terrainHeightAtWorld(x - step, z)) /
    (step * 2)
  const slopeZ =
    (terrainHeightAtWorld(x, z + step) -
      terrainHeightAtWorld(x, z - step)) /
    (step * 2)
  return target.set(-slopeX, 1, -slopeZ).normalize()
}

function installProjectedPixelGate(
  mesh: BatchedMesh,
  metrics: ReadonlyArray<{
    readonly instanceId: number
    readonly radius: number
    readonly size: number
    readonly worldCentre: Vector3
  }>,
): void {
  const rendererSize = new Vector2()
  const cameraPosition = new Vector3()
  const updateBatchedDrawList = mesh.onBeforeRender.bind(mesh)
  mesh.onBeforeRender = (
    renderer,
    scene,
    camera,
    geometry,
    material,
    group,
  ) => {
    if (camera instanceof PerspectiveCamera) {
      renderer.getSize(rendererSize)
      camera.getWorldPosition(cameraPosition)
      const pixelsPerUnit =
        rendererSize.y / (2 * Math.tan((camera.fov * Math.PI) / 360))
      let visibleCount = 0
      metrics.forEach((metric) => {
        const distance = Math.max(
          0.01,
          cameraPosition.distanceTo(metric.worldCentre),
        )
        const projectedPixels = (metric.size * pixelsPerUnit) / distance
        const visible = metric.radius < 18 || projectedPixels >= 2.25
        mesh.setVisibleAt(metric.instanceId, visible)
        if (visible) visibleCount += 1
      })
      mesh.userData.scaleEncounterUnderstoryVisibleInstanceCount = visibleCount
    }
    updateBatchedDrawList(
      renderer,
      scene,
      camera,
      geometry,
      material,
      group,
    )
  }
}

export function createScaleEncounterProductionUnderstory(
  terrainHeightAtWorld: TerrainHeightAtWorld,
  density: ScaleEncounterEcologyDensity = 'current',
): Group {
  const anchors = createScaleEncounterProductionUnderstoryPlan(density)
  const texture = new TextureLoader().load(vegetationAtlasUrl)
  texture.name = 'scale-encounter-understory-vegetation-atlas-v2'
  texture.colorSpace = SRGBColorSpace
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true

  const foliageMaterial = new MeshStandardMaterial({
    alphaTest: 0.4,
    alphaToCoverage: true,
    color: '#9eaa92',
    emissive: '#1f2a1b',
    emissiveIntensity: 0.06,
    map: texture,
    metalness: 0,
    roughness: 0.94,
    side: DoubleSide,
    transparent: false,
  })
  foliageMaterial.name = 'scale-encounter-grounded-understory-foliage-material'
  const rootMaterial = new MeshStandardMaterial({
    color: '#4f4435',
    emissive: '#130f0b',
    emissiveIntensity: 0.08,
    metalness: 0,
    roughness: 1,
  })
  rootMaterial.name = 'scale-encounter-grounded-understory-root-material'

  const prototypes = ([
    ['fern', 0],
    ['fern', 1],
    ['shrub', 0],
    ['shrub', 1],
  ] as const).map(([kind, variant]) => ({
    geometry: createFoliagePrototype(kind, variant),
    key: `${kind}-${variant}`,
    kind,
    variant,
  }))
  const foliageBatch = new BatchedMesh(
    anchors.length,
    prototypes.reduce(
      (sum, { geometry }) => sum + geometry.getAttribute('position').count,
      0,
    ),
    prototypes.reduce(
      (sum, { geometry }) => sum + (geometry.index?.count ?? 0),
      0,
    ),
    foliageMaterial,
  )
  foliageBatch.name = 'scale-encounter-production-grounded-understory-foliage'
  foliageBatch.castShadow = true
  foliageBatch.receiveShadow = true
  foliageBatch.perObjectFrustumCulled = true
  foliageBatch.sortObjects = false
  const geometryIds = new Map(
    prototypes.map(({ geometry, key }) => [key, foliageBatch.addGeometry(geometry)]),
  )

  const rootGeometry = createRootCollarPrototype()
  const rootBatch = new BatchedMesh(
    anchors.length,
    rootGeometry.getAttribute('position').count,
    rootGeometry.index?.count ?? 0,
    rootMaterial,
  )
  rootBatch.name = 'scale-encounter-production-grounded-understory-roots'
  rootBatch.castShadow = true
  rootBatch.receiveShadow = true
  rootBatch.perObjectFrustumCulled = true
  rootBatch.sortObjects = false
  const rootGeometryId = rootBatch.addGeometry(rootGeometry)

  const transform = new Object3D()
  const rootTransform = new Object3D()
  const normal = new Vector3()
  const slopeAlignment = new Quaternion()
  const yawRotation = new Quaternion()
  const worldUp = new Vector3(0, 1, 0)
  const metrics: Array<{
    readonly instanceId: number
    readonly radius: number
    readonly size: number
    readonly worldCentre: Vector3
  }> = []
  const rootMetrics: typeof metrics = []
  const groundingSamples: Array<{
    readonly groundingError: number
    readonly kind: UnderstoryKind
    readonly terrainY: number
    readonly worldBottomY: number
    readonly x: number
    readonly z: number
  }> = []
  let maximumAbsoluteGroundingError = 0
  let airborneInstanceCount = 0
  let estimatedTriangles = 0

  anchors.forEach((anchor, index) => {
    const prototype = prototypes.find(
      ({ kind, variant }) => kind === anchor.kind && variant === anchor.variant,
    )!
    const prototypeBounds = prototype.geometry.boundingBox!.clone()
    const prototypeHeight = Math.max(
      0.001,
      prototypeBounds.max.y - prototypeBounds.min.y,
    )
    const scale = anchor.height / prototypeHeight
    const terrainY = terrainHeightAtWorld(anchor.x, anchor.z)
    terrainNormal(terrainHeightAtWorld, anchor.x, anchor.z, normal)
    slopeAlignment.setFromUnitVectors(worldUp, normal)
    yawRotation.setFromAxisAngle(worldUp, anchor.yaw)
    transform.position.set(anchor.x, 0, anchor.z)
    transform.quaternion.copy(slopeAlignment).multiply(yawRotation)
    transform.scale.set(
      scale * anchor.widthScale,
      scale,
      scale * anchor.widthScale,
    )
    transform.updateMatrix()
    const zeroBounds = prototypeBounds.clone().applyMatrix4(transform.matrix)
    const burialDepth = Math.min(0.018, anchor.height * 0.018)
    transform.position.y = terrainY - burialDepth - zeroBounds.min.y
    transform.updateMatrix()
    const finalBounds = prototypeBounds.clone().applyMatrix4(transform.matrix)
    const instanceId = foliageBatch.addInstance(
      geometryIds.get(prototype.key)!,
    )
    foliageBatch.setMatrixAt(instanceId, transform.matrix)
    const variation = ((index * 7 + anchor.patchId * 3) % 9) * 0.012
    foliageBatch.setColorAt(
      instanceId,
      new Color().setRGB(
        0.72 + variation,
        0.8 + variation * 0.7,
        0.62 + variation * 0.45,
      ),
    )
    const groundingError = finalBounds.min.y - (terrainY - burialDepth)
    maximumAbsoluteGroundingError = Math.max(
      maximumAbsoluteGroundingError,
      Math.abs(groundingError),
    )
    if (groundingError > 0.003) airborneInstanceCount += 1
    if (groundingSamples.length < 24) {
      groundingSamples.push({
        groundingError,
        kind: anchor.kind,
        terrainY,
        worldBottomY: finalBounds.min.y,
        x: anchor.x,
        z: anchor.z,
      })
    }
    metrics.push({
      instanceId,
      radius: anchor.radius,
      size: anchor.height,
      worldCentre: finalBounds.getCenter(new Vector3()),
    })

    rootTransform.position.set(anchor.x, 0, anchor.z)
    rootTransform.quaternion.copy(slopeAlignment).multiply(yawRotation)
    const rootScale = anchor.kind === 'fern' ? anchor.height * 0.72 : anchor.height * 0.64
    rootTransform.scale.set(
      rootScale * anchor.widthScale,
      rootScale,
      rootScale * anchor.widthScale,
    )
    rootTransform.updateMatrix()
    const rootZeroBounds = rootGeometry.boundingBox!
      .clone()
      .applyMatrix4(rootTransform.matrix)
    rootTransform.position.y = terrainY - 0.012 - rootZeroBounds.min.y
    rootTransform.updateMatrix()
    const rootBounds = rootGeometry.boundingBox!
      .clone()
      .applyMatrix4(rootTransform.matrix)
    const rootInstanceId = rootBatch.addInstance(rootGeometryId)
    rootBatch.setMatrixAt(rootInstanceId, rootTransform.matrix)
    rootBatch.setColorAt(
      rootInstanceId,
      new Color().setRGB(
        0.72 + variation * 0.35,
        0.65 + variation * 0.2,
        0.52 + variation * 0.12,
      ),
    )
    rootMetrics.push({
      instanceId: rootInstanceId,
      radius: anchor.radius,
      size: Math.max(0.18, anchor.height * 0.22),
      worldCentre: rootBounds.getCenter(new Vector3()),
    })
    estimatedTriangles +=
      (prototype.geometry.index?.count ??
        prototype.geometry.getAttribute('position').count) /
        3 +
      (rootGeometry.index?.count ?? rootGeometry.getAttribute('position').count) /
        3
  })

  foliageBatch.computeBoundingBox()
  foliageBatch.computeBoundingSphere()
  rootBatch.computeBoundingBox()
  rootBatch.computeBoundingSphere()
  foliageBatch.userData.scaleEncounterUnderstoryGroundingSamples =
    groundingSamples
  foliageBatch.userData.scaleEncounterUnderstoryProjectedPixelGate = 2.25
  installProjectedPixelGate(foliageBatch, metrics)
  installProjectedPixelGate(rootBatch, rootMetrics)

  prototypes.forEach(({ geometry }) => geometry.dispose())
  rootGeometry.dispose()

  const group = new Group()
  group.name = 'scale-encounter-production-grounded-understory'
  group.add(foliageBatch, rootBatch)
  const fernCount = anchors.filter(({ kind }) => kind === 'fern').length
  const shrubCount = anchors.length - fernCount
  const metadata: ScaleEncounterProductionUnderstoryMetadata = {
    airborneInstanceCount,
    density,
    drawCalls: 2,
    estimatedTriangles,
    fernCount,
    maximumAbsoluteGroundingError,
    representation: 'alpha-clipped-grounded-colonies-with-root-collars',
    shrubCount,
    totalInstances: anchors.length,
  }
  group.userData.scaleEncounterProductionUnderstory = metadata
  // The runtime QA collector consumes this common summary contract. Report
  // the complete population rather than a hand-picked screenshot sample so a
  // single raised fern fails the evidence gate even when it is off camera.
  group.userData.scaleEncounterEcologyGrounding = {
    airborneInstanceCount,
    instanceCount: anchors.length,
    maximumAbsoluteGroundingError,
  }
  return group
}
