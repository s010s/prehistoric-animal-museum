import {
  BufferGeometry,
  Material,
  Mesh,
  SkinnedMesh,
  Texture,
  type Object3D,
} from 'three'

export interface DisposalCounts {
  geometries: number
  materials: number
  skeletons: number
  textures: number
}

interface Disposable {
  dispose: () => void
}

interface ClosableImageSource {
  close: () => void
}

function isTexture(value: unknown): value is Texture {
  return value instanceof Texture
}

function collectTexture(value: unknown, textures: Set<Texture>) {
  if (isTexture(value)) {
    textures.add(value)
    return
  }

  if (Array.isArray(value)) {
    value.forEach((item) => {
      collectTexture(item, textures)
    })
    return
  }

  if (value && typeof value === 'object' && 'value' in value) {
    collectTexture(value.value, textures)
  }
}

function collectClosableImageSource(
  value: unknown,
  imageSources: Set<ClosableImageSource>,
): void {
  if (Array.isArray(value)) {
    value.forEach((item) => {
      collectClosableImageSource(item, imageSources)
    })
    return
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    'close' in value &&
    typeof value.close === 'function'
  ) {
    imageSources.add(value as ClosableImageSource)
  }
}

export function disposeObject3D(
  root: Object3D,
  renderer?: { readonly renderLists: { dispose(): void } },
): DisposalCounts {
  const geometries = new Set<Disposable>()
  const materials = new Set<Material>()
  const skeletons = new Set<Disposable>()
  const textures = new Set<Texture>()
  const imageSources = new Set<ClosableImageSource>()

  root.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return
    }

    if (object.geometry instanceof BufferGeometry) {
      geometries.add(object.geometry)
    }
    if (object instanceof SkinnedMesh) {
      skeletons.add(object.skeleton)
    }
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material]
    meshMaterials.filter((material): material is Material => material instanceof Material).forEach(
      (material) => {
        materials.add(material)
        Object.values(material).forEach((value) => {
          collectTexture(value, textures)
        })
        if ('uniforms' in material) {
          Object.values((material as Material & { uniforms: Record<string, unknown> }).uniforms).forEach(
            (uniform) => {
              collectTexture(uniform, textures)
            },
          )
        }
      },
    )
  })

  textures.forEach((texture) => {
    collectClosableImageSource(texture.source.data, imageSources)
    texture.dispose()
  })
  imageSources.forEach((source) => {
    source.close()
  })
  materials.forEach((material) => {
    material.dispose()
  })
  geometries.forEach((geometry) => {
    geometry.dispose()
  })
  skeletons.forEach((skeleton) => {
    skeleton.dispose()
  })
  root.removeFromParent()
  renderer?.renderLists.dispose()

  return {
    geometries: geometries.size,
    materials: materials.size,
    skeletons: skeletons.size,
    textures: textures.size,
  }
}
