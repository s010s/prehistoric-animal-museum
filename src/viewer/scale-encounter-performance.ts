import { InstancedMesh, Mesh } from 'three'
import type {
  BufferGeometry,
  Material,
  Object3D,
  Texture,
} from 'three'

export interface ScaleEncounterSceneResources {
  readonly estimatedGeometryBytes: number
  readonly estimatedTextureBytes: number
  readonly geometryCount: number
  readonly instanceCount: number
  readonly instancedMeshCount: number
  readonly shadowCasterCount: number
  readonly textureCount: number
  readonly transparentMaterialCount: number
}

function arrayByteLength(value: unknown): number {
  return value && typeof value === 'object' && 'byteLength' in value
    ? Number((value as { readonly byteLength?: number }).byteLength ?? 0)
    : 0
}

function geometryBytes(geometry: BufferGeometry): number {
  const arrays = new Set<unknown>()
  if (geometry.index) arrays.add(geometry.index.array)
  for (const attribute of Object.values(geometry.attributes)) {
    arrays.add('data' in attribute ? attribute.data.array : attribute.array)
  }
  for (const attributes of Object.values(geometry.morphAttributes)) {
    if (!attributes) continue
    for (const attribute of attributes) {
      arrays.add('data' in attribute ? attribute.data.array : attribute.array)
    }
  }
  return [...arrays].reduce<number>(
    (sum, array) => sum + arrayByteLength(array),
    0,
  )
}

function textureImageBytes(image: unknown): number {
  if (!image || typeof image !== 'object') return 0
  const record = image as Record<string, unknown>
  const data =
    record.data && typeof record.data === 'object'
      ? (record.data as Record<string, unknown>)
      : null
  const directBytes =
    typeof record.byteLength === 'number'
      ? record.byteLength
      : typeof data?.byteLength === 'number'
        ? data.byteLength
        : 0
  if (typeof directBytes === 'number' && directBytes > 0) return directBytes
  const width = typeof record.width === 'number' ? record.width : 0
  const height = typeof record.height === 'number' ? record.height : 0
  return width > 0 && height > 0 ? width * height * 4 : 0
}

function textureBytes(texture: Texture): number {
  if (texture.mipmaps.length > 0) {
    let explicitBytes = 0
    for (const mipmap of texture.mipmaps as unknown[]) {
      explicitBytes += textureImageBytes(mipmap)
    }
    if (explicitBytes > 0) return explicitBytes
  }
  const source = (
    texture.source as unknown as { readonly data?: unknown }
  ).data
  const baseBytes = Array.isArray(source)
    ? (source as unknown[]).reduce<number>(
        (sum, image) => sum + textureImageBytes(image),
        0,
      )
    : textureImageBytes(source)
  return Math.ceil(
    baseBytes * (texture.generateMipmaps && baseBytes > 0 ? 4 / 3 : 1),
  )
}

function materialTextures(material: Material): Texture[] {
  const textures: Texture[] = []
  for (const value of Object.values(material)) {
    if (
      value &&
      typeof value === 'object' &&
      'isTexture' in value &&
      (value as { readonly isTexture?: boolean }).isTexture
    ) {
      textures.push(value as Texture)
    }
  }
  return textures
}

export function inspectScaleEncounterSceneResources(
  root: Object3D,
): ScaleEncounterSceneResources {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  let instanceBufferBytes = 0
  let instanceCount = 0
  let instancedMeshCount = 0
  let shadowCasterCount = 0

  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const mesh = object as Mesh<BufferGeometry, Material | Material[]>
    geometries.add(mesh.geometry)
    const objectMaterials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material]
    objectMaterials.forEach((material) => materials.add(material))
    if (mesh.castShadow) shadowCasterCount += 1
    if (mesh instanceof InstancedMesh) {
      const instanced = mesh as InstancedMesh<
        BufferGeometry,
        Material | Material[]
      >
      instancedMeshCount += 1
      instanceCount += instanced.count
      instanceBufferBytes += instanced.instanceMatrix.array.byteLength
      if (instanced.instanceColor) {
        instanceBufferBytes += instanced.instanceColor.array.byteLength
      }
    }
  })

  for (const material of materials) {
    materialTextures(material).forEach((texture) => textures.add(texture))
  }

  return {
    estimatedGeometryBytes:
      [...geometries].reduce(
        (sum, geometry) => sum + geometryBytes(geometry),
        0,
      ) + instanceBufferBytes,
    estimatedTextureBytes: [...textures].reduce(
      (sum, texture) => sum + textureBytes(texture),
      0,
    ),
    geometryCount: geometries.size,
    instanceCount,
    instancedMeshCount,
    shadowCasterCount,
    textureCount: textures.size,
    transparentMaterialCount: [...materials].filter(
      (material) => material.transparent,
    ).length,
  }
}
