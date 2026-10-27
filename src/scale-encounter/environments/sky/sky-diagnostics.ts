import {
  Box3,
  Matrix4,
  Vector3,
  type BufferGeometry,
  type Object3D,
  type PerspectiveCamera,
} from 'three'
import {
  SKY_REFERENCE_Y_METERS,
  skyAltitudeMeters,
  type SkyLayerId,
} from './sky-contract'

export interface SerializedVector3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface SerializedBox3 {
  readonly maximum: SerializedVector3
  readonly minimum: SerializedVector3
}

export interface ProjectedRectangle {
  readonly areaFraction: number
  readonly heightPixels: number
  readonly maximumX: number
  readonly maximumY: number
  readonly minimumX: number
  readonly minimumY: number
  readonly visible: boolean
  readonly widthPixels: number
}

export interface SkyCloudDiagnosticInput {
  readonly id: string
  readonly layer: Extract<SkyLayerId, 'near-air' | 'mid-cloud' | 'far-cloud'>
  readonly object: Object3D
}

export interface SkyCloudDiagnostic {
  readonly altitudeMaximumMeters: number
  readonly altitudeMinimumMeters: number
  readonly bandId: SkyCloudDiagnosticInput['layer']
  readonly corridorOverlap: boolean
  readonly id: string
  readonly projectedAreaPixels: number
  readonly projectedHeightPixels: number
  readonly projectedWidthPixels: number
  readonly subjectOcclusionFraction: number
  readonly worldBounds: SerializedBox3
}

export interface TransparentOverdrawEstimate {
  /** Sum of every clipped projected rectangle, expressed in viewport pixels. */
  readonly coveredPixelContributions: number
  readonly maximumLayerCount: number
  readonly meanLayerCountWhereCovered: number
  readonly viewportCoverageFraction: number
}

export interface GeometryResourceEstimate {
  readonly geometryBytes: number
  readonly geometryCount: number
  readonly indexBytes: number
  readonly vertexAttributeBytes: number
}

const corners = Array.from({ length: 8 }, () => new Vector3())
const cameraSpace = new Vector3()
const projected = new Vector3()
const viewMatrix = new Matrix4()

function setBoxCorners(bounds: Readonly<Box3>): readonly Vector3[] {
  let index = 0
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        corners[index]?.set(x, y, z)
        index += 1
      }
    }
  }
  return corners
}

function round(value: number, places = 6): number {
  const scale = 10 ** places
  return Math.round(value * scale) / scale
}

export function serializeVector3(
  value: Readonly<Vector3>,
): SerializedVector3 {
  return {
    x: round(value.x),
    y: round(value.y),
    z: round(value.z),
  }
}

export function serializeBox3(bounds: Readonly<Box3>): SerializedBox3 {
  return {
    minimum: serializeVector3(bounds.min),
    maximum: serializeVector3(bounds.max),
  }
}

export function worldBoundsFor(object: Object3D): Box3 {
  object.updateMatrixWorld(true)
  return new Box3().setFromObject(object, true)
}

export function projectWorldBounds(
  bounds: Readonly<Box3>,
  camera: PerspectiveCamera,
  viewportWidth: number,
  viewportHeight: number,
): ProjectedRectangle {
  camera.updateMatrixWorld(true)
  viewMatrix.copy(camera.matrixWorldInverse)
  let minimumX = Number.POSITIVE_INFINITY
  let minimumY = Number.POSITIVE_INFINITY
  let maximumX = Number.NEGATIVE_INFINITY
  let maximumY = Number.NEGATIVE_INFINITY
  let pointsInFront = 0

  for (const corner of setBoxCorners(bounds)) {
    cameraSpace.copy(corner).applyMatrix4(viewMatrix)
    if (cameraSpace.z > -camera.near) continue
    pointsInFront += 1
    projected.copy(corner).project(camera)
    minimumX = Math.min(minimumX, projected.x)
    maximumX = Math.max(maximumX, projected.x)
    minimumY = Math.min(minimumY, projected.y)
    maximumY = Math.max(maximumY, projected.y)
  }

  if (pointsInFront === 0) {
    return {
      areaFraction: 0,
      heightPixels: 0,
      maximumX: 0,
      maximumY: 0,
      minimumX: 0,
      minimumY: 0,
      visible: false,
      widthPixels: 0,
    }
  }

  const clippedMinimumX = Math.max(-1, minimumX)
  const clippedMaximumX = Math.min(1, maximumX)
  const clippedMinimumY = Math.max(-1, minimumY)
  const clippedMaximumY = Math.min(1, maximumY)
  const ndcWidth = Math.max(0, clippedMaximumX - clippedMinimumX)
  const ndcHeight = Math.max(0, clippedMaximumY - clippedMinimumY)
  const widthPixels = (ndcWidth / 2) * viewportWidth
  const heightPixels = (ndcHeight / 2) * viewportHeight
  return {
    areaFraction: (ndcWidth * ndcHeight) / 4,
    heightPixels: round(heightPixels, 3),
    maximumX: round(clippedMaximumX),
    maximumY: round(clippedMaximumY),
    minimumX: round(clippedMinimumX),
    minimumY: round(clippedMinimumY),
    visible: ndcWidth > 0 && ndcHeight > 0,
    widthPixels: round(widthPixels, 3),
  }
}

export function projectedOverlapFraction(
  subject: ProjectedRectangle,
  occluder: ProjectedRectangle,
): number {
  if (!subject.visible || !occluder.visible || subject.areaFraction <= 0) {
    return 0
  }
  const width = Math.max(
    0,
    Math.min(subject.maximumX, occluder.maximumX) -
      Math.max(subject.minimumX, occluder.minimumX),
  )
  const height = Math.max(
    0,
    Math.min(subject.maximumY, occluder.maximumY) -
      Math.max(subject.minimumY, occluder.minimumY),
  )
  return round((width * height) / (subject.areaFraction * 4), 8)
}

export function estimateTransparentOverdraw(
  rectangles: readonly ProjectedRectangle[],
  viewportWidth: number,
  viewportHeight: number,
  gridSize = 40,
): TransparentOverdrawEstimate {
  const layers = new Uint16Array(gridSize * gridSize)
  let coveredPixelContributions = 0

  for (const rectangle of rectangles) {
    if (!rectangle.visible) continue
    coveredPixelContributions +=
      rectangle.areaFraction * viewportWidth * viewportHeight
    const minimumColumn = Math.max(
      0,
      Math.floor(((rectangle.minimumX + 1) / 2) * gridSize),
    )
    const maximumColumn = Math.min(
      gridSize - 1,
      Math.ceil(((rectangle.maximumX + 1) / 2) * gridSize) - 1,
    )
    const minimumRow = Math.max(
      0,
      Math.floor(((rectangle.minimumY + 1) / 2) * gridSize),
    )
    const maximumRow = Math.min(
      gridSize - 1,
      Math.ceil(((rectangle.maximumY + 1) / 2) * gridSize) - 1,
    )
    for (let row = minimumRow; row <= maximumRow; row += 1) {
      for (
        let column = minimumColumn;
        column <= maximumColumn;
        column += 1
      ) {
        const index = row * gridSize + column
        layers[index] = (layers[index] ?? 0) + 1
      }
    }
  }

  let coveredCells = 0
  let totalLayersInCoveredCells = 0
  let maximumLayerCount = 0
  for (const layerCount of layers) {
    if (layerCount === 0) continue
    coveredCells += 1
    totalLayersInCoveredCells += layerCount
    maximumLayerCount = Math.max(maximumLayerCount, layerCount)
  }

  return {
    coveredPixelContributions: Math.round(coveredPixelContributions),
    maximumLayerCount,
    meanLayerCountWhereCovered:
      coveredCells === 0
        ? 0
        : round(totalLayersInCoveredCells / coveredCells, 4),
    viewportCoverageFraction: round(
      coveredCells / Math.max(layers.length, 1),
      6,
    ),
  }
}

export function inspectSkyClouds(
  clouds: readonly SkyCloudDiagnosticInput[],
  corridorBounds: Readonly<Box3>,
  subjectBounds: Readonly<Box3>,
  camera: PerspectiveCamera,
  viewportWidth: number,
  viewportHeight: number,
  additionalSubjectBounds: readonly Readonly<Box3>[] = [],
): readonly SkyCloudDiagnostic[] {
  const subjectRectangles = [subjectBounds, ...additionalSubjectBounds].map(
    (bounds) =>
      projectWorldBounds(bounds, camera, viewportWidth, viewportHeight),
  )
  return clouds.map(({ id, layer, object }) => {
    const bounds = worldBoundsFor(object)
    const projectedRectangle = projectWorldBounds(
      bounds,
      camera,
      viewportWidth,
      viewportHeight,
    )
    return {
      altitudeMaximumMeters: round(skyAltitudeMeters(bounds.max.y), 3),
      altitudeMinimumMeters: round(skyAltitudeMeters(bounds.min.y), 3),
      bandId: layer,
      corridorOverlap: bounds.intersectsBox(corridorBounds),
      id,
      projectedAreaPixels: Math.round(
        projectedRectangle.areaFraction * viewportWidth * viewportHeight,
      ),
      projectedHeightPixels: projectedRectangle.heightPixels,
      projectedWidthPixels: projectedRectangle.widthPixels,
      subjectOcclusionFraction: Math.max(
        0,
        ...subjectRectangles.map((subjectRectangle) =>
          projectedOverlapFraction(subjectRectangle, projectedRectangle),
        ),
      ),
      worldBounds: serializeBox3(bounds),
    }
  })
}

function attributeBytes(attribute: {
  readonly array: { readonly byteLength: number }
}): number {
  return attribute.array.byteLength
}

export function estimateGeometryResources(
  geometries: readonly BufferGeometry[],
): GeometryResourceEstimate {
  const unique = new Set(geometries)
  let indexBytes = 0
  let vertexAttributeBytes = 0
  for (const geometry of unique) {
    if (geometry.index) indexBytes += geometry.index.array.byteLength
    for (const attribute of Object.values(geometry.attributes)) {
      vertexAttributeBytes += attributeBytes(attribute)
    }
    for (const morphAttributes of Object.values(geometry.morphAttributes)) {
      for (const attribute of morphAttributes ?? []) {
        vertexAttributeBytes += attributeBytes(attribute)
      }
    }
  }
  return {
    geometryBytes: indexBytes + vertexAttributeBytes,
    geometryCount: unique.size,
    indexBytes,
    vertexAttributeBytes,
  }
}

export function boundsAltitudeRange(
  bounds: Readonly<Box3>,
): { readonly maximum: number; readonly minimum: number } {
  return {
    maximum: round(bounds.max.y - SKY_REFERENCE_Y_METERS, 3),
    minimum: round(bounds.min.y - SKY_REFERENCE_Y_METERS, 3),
  }
}

const SOFTWARE_RENDERER_PATTERN =
  /swiftshader|llvmpipe|software rasterizer|microsoft basic render/i
const HARDWARE_RENDERER_PATTERN =
  /apple|metal|nvidia|geforce|quadro|amd|radeon|intel|iris/i

export function isSoftwareSkyRenderer(renderer: string): boolean {
  return SOFTWARE_RENDERER_PATTERN.test(renderer)
}

export function isVerifiedHardwareSkyRenderer(renderer: string): boolean {
  return (
    !isSoftwareSkyRenderer(renderer) &&
    HARDWARE_RENDERER_PATTERN.test(renderer)
  )
}
