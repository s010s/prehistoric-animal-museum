import { AnimationMixer, Box3, Mesh, SkinnedMesh, Sphere, Vector3, type AnimationClip, type BufferGeometry, type Group, type Material, type Object3D, type Skeleton } from 'three'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import farUrl from '../assets/companions/pteranodon-far.glb?url'

/** Sampled whole original Idle cycle, padded offline. Source GLB units. */
export const COMPANION_SOURCE_BOUNDS = new Box3(new Vector3(-.579, -.337, -.318), new Vector3(.566, .449, .242))
export const COMPANION_TRIANGLES = { near: 13494, far: 4048 } as const
export interface CompanionInstance {
  readonly root: Object3D
  readonly mixer: AnimationMixer
  /** Absolute environment motion time; caller freezes that time during pause. */
  setMotionSeconds(seconds: number): void
  setOpacity(opacity: number): void
  dispose(): void
}
export interface CompanionOptions { readonly phase?: number; readonly onDispose?: () => void; readonly independentMaterials?: boolean }

/** Borrow geometry/material/texture resources. Only the cloned bones and mixer are owned. */
export function createCompanion(template: Object3D, clip: AnimationClip, options: CompanionOptions = {}): CompanionInstance {
  if (clip.name !== 'Idle') throw new Error('Companions require the original Idle animation')
  const root = cloneSkeleton(template), mixer = new AnimationMixer(root)
  const action = mixer.clipAction(clip)
  action.play()
  const phase = Number.isFinite(options.phase) ? options.phase! : 0
  let disposed = false
  const ownMaterials = new Map<Material, Material>()
  root.traverse(object => {
    if (object instanceof Mesh) {
      object.castShadow = false; object.receiveShadow = true
      if (options.independentMaterials) {
        const mesh = object as Mesh<BufferGeometry, Material | Material[]>
        const copy = (source: Material) => {
          let material = ownMaterials.get(source)
          if (!material) {
            material = source.clone(); material.onBeforeCompile = (shader, renderer) => source.onBeforeCompile.call(material!, shader, renderer)
            material.customProgramCacheKey = () => source.customProgramCacheKey()
            material.transparent = true; material.depthWrite = false; material.forceSinglePass = true
            ownMaterials.set(source, material)
          }
          return material
        }
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(copy) : copy(mesh.material)
      }
    }
    // A whole-cycle bound avoids per-frame high-poly bound evaluation. These
    // skinned vertices are in the same source coordinates as the asset audit.
    if (object instanceof SkinnedMesh) {
      object.boundingBox = COMPANION_SOURCE_BOUNDS.clone()
      object.boundingSphere = COMPANION_SOURCE_BOUNDS.getBoundingSphere(object.boundingSphere ?? new Sphere())
      // Parent wrappers may normalize the rig. Until a bound is transformed
      // for that wrapper, skip automatic mesh culling; Director owns distance.
      object.frustumCulled = false
    }
  })
  const instance: CompanionInstance = {
    root, mixer,
    setMotionSeconds(seconds) {
      if (disposed || !Number.isFinite(seconds)) return
      mixer.setTime(((seconds + phase) % clip.duration + clip.duration) % clip.duration)
      // The host renderer updates scene matrices once after all mixers advance.
    },
    setOpacity(opacity) { if (!disposed) ownMaterials.forEach(material => { material.opacity = Math.max(0, Math.min(1, opacity)) }) },
    dispose() {
      if (disposed) return
      disposed = true
      mixer.stopAllAction(); mixer.uncacheRoot(root)
      const skeletons = new Set<Skeleton>()
      root.traverse(object => { if (object instanceof SkinnedMesh) skeletons.add(object.skeleton) })
      skeletons.forEach(skeleton => skeleton.dispose())
      ownMaterials.forEach(material => material.dispose()); ownMaterials.clear()
      root.removeFromParent()
      options.onDispose?.()
    },
  }
  instance.setMotionSeconds(0)
  return instance
}

export interface FarCompanionTemplate {
  readonly root: Group
  readonly clip: AnimationClip
  readonly references: number
  create(options?: Omit<CompanionOptions, 'onDispose'>): CompanionInstance
  /** Marks library closed; existing instances retain geometry until released. */
  dispose(): void
}
/** One session-owned far geometry, borrowing the hero's already loaded material. */
export function ownFarCompanionTemplate(root: Group, clip: AnimationClip, material: Material | Material[]): FarCompanionTemplate {
  const geometries = new Set<BufferGeometry>(), originalMaterials = new Set<Material>(), skeletons = new Set<Skeleton>()
  root.traverse(object => {
    if (object instanceof Mesh) {
      const mesh = object as Mesh<BufferGeometry, Material | Material[]>
      geometries.add(mesh.geometry)
      for (const value of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) originalMaterials.add(value)
      mesh.material = material
    }
    if (object instanceof SkinnedMesh) skeletons.add(object.skeleton)
  })
  // Far GLB has no textures. Its temporary loader materials are owned here.
  const borrowed = new Set(Array.isArray(material) ? material : [material])
  originalMaterials.forEach(value => { if (!borrowed.has(value)) value.dispose() })
  let references = 0, closed = false, released = false
  const release = () => {
    if (!closed || references !== 0 || released) return
    released = true
    geometries.forEach(geometry => geometry.dispose())
    skeletons.forEach(skeleton => skeleton.dispose())
    root.removeFromParent()
  }
  return {
    root, clip,
    get references() { return references },
    create(options = {}) {
      if (closed) throw new Error('Companion template has been released')
      references++
      try { return createCompanion(root, clip, { ...options, onDispose: () => { references--; release() } }) }
      catch (error) { references--; release(); throw error }
    },
    dispose() { closed = true; release() },
  }
}
export async function loadFarCompanionTemplate(material: Material | Material[]): Promise<FarCompanionTemplate> {
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(farUrl)
  const clip = gltf.animations.find(value => value.name === 'Idle')
  if (!clip) {
    gltf.scene.traverse(object => { if (object instanceof Mesh) { const mesh = object as Mesh<BufferGeometry, Material | Material[]>; mesh.geometry.dispose(); for (const value of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) value.dispose() } })
    throw new Error('Far companion is missing the original Idle animation')
  }
  return ownFarCompanionTemplate(gltf.scene, clip, material)
}
