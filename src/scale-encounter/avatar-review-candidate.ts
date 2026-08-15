import {
  AnimationMixer,
  Group,
  LoopRepeat,
  Mesh,
  Quaternion,
  SkinnedMesh,
  Texture,
  Vector3,
  type AnimationClip,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Skeleton,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { disposeObject3D } from '../viewer/dispose'
import {
  SCALE_ENCOUNTER_DEFINITIONS,
  normalizeScaleEncounterProfile,
  type ScaleEncounterAnimalId,
  type ScaleEncounterAvatar,
  type ScaleEncounterAvatarFactory,
  type ScaleEncounterGender,
  type ScaleEncounterHabitat,
  type ScaleEncounterProfile,
} from '../viewer/scale-encounter'

export type ReviewCandidateAvatarProfile = 'base'

export type ReviewCandidateAvatarVariantId =
  `${ScaleEncounterGender}-${ReviewCandidateAvatarProfile}`

type ReviewCandidateAvatarClipName = 'Idle_Land'

export interface ReviewCandidateAvatarPackage {
  readonly acceptedSha256: string
  /** Canonical rig family used later for compatible equipment attachments. */
  readonly equipmentRigId: 'child-base-v3-meshy-24'
  readonly authoredHeightMeters: number
  readonly clipName: ReviewCandidateAvatarClipName
  readonly eyeAnchorName: 'EyeAnchor'
  readonly filename: string
  readonly gender: ScaleEncounterGender
  readonly habitat: ScaleEncounterHabitat
  readonly profile: ReviewCandidateAvatarProfile
  readonly sceneRootName: 'ChildAvatarV3Root'
  readonly sourceUrl: string
  readonly variantId: ReviewCandidateAvatarVariantId
}

export const REVIEW_CANDIDATE_AVATAR_EQUIPMENT_SOCKET_NAMES = [
  'Hips',
  'Spine',
  'Spine01',
  'Spine02',
  'neck',
  'Head',
  'LeftShoulder',
  'LeftHand',
  'RightShoulder',
  'RightHand',
  'LeftFoot',
  'RightFoot',
] as const

const REVIEW_CANDIDATE_AVATAR_POSE_BONE_NAMES = [
  'LeftArm',
  'LeftForeArm',
  'RightArm',
  'RightForeArm',
  'LeftUpLeg',
  'LeftLeg',
  'RightUpLeg',
  'RightLeg',
] as const

const LEFT_ARM_DOWN = new Vector3(0.06, -1, 0).normalize()
const RIGHT_ARM_DOWN = new Vector3(-0.06, -1, 0).normalize()
const WATER_KICK_AXIS = new Vector3(1, 0, 0)

interface ReviewCandidatePoseController {
  apply(animationTimeSeconds: number, reducedMotion: boolean): void
}

/**
 * Keeps the canonical child bases in the quiet, arms-down museum stance chosen
 * for every habitat. Water adds only a restrained alternating leg/foot kick;
 * the base body, face and rig remain the same cached avatar package.
 */
function createReviewCandidatePoseController(
  visual: Group,
  habitat: ScaleEncounterHabitat,
): ReviewCandidatePoseController {
  const leftArm = visual.getObjectByName('LeftArm')
  const leftForeArm = visual.getObjectByName('LeftForeArm')
  const leftHand = visual.getObjectByName('LeftHand')
  const rightArm = visual.getObjectByName('RightArm')
  const rightForeArm = visual.getObjectByName('RightForeArm')
  const rightHand = visual.getObjectByName('RightHand')
  const leftUpLeg = visual.getObjectByName('LeftUpLeg')
  const leftLeg = visual.getObjectByName('LeftLeg')
  const leftFoot = visual.getObjectByName('LeftFoot')
  const rightUpLeg = visual.getObjectByName('RightUpLeg')
  const rightLeg = visual.getObjectByName('RightLeg')
  const rightFoot = visual.getObjectByName('RightFoot')
  const baseLeftUpLeg = leftUpLeg?.quaternion.clone()
  const baseLeftLeg = leftLeg?.quaternion.clone()
  const baseLeftFoot = leftFoot?.quaternion.clone()
  const baseRightUpLeg = rightUpLeg?.quaternion.clone()
  const baseRightLeg = rightLeg?.quaternion.clone()
  const baseRightFoot = rightFoot?.quaternion.clone()

  const bonePosition = new Vector3()
  const childPosition = new Vector3()
  const currentDirection = new Vector3()
  const targetWorldDirection = new Vector3()
  const axisWorld = new Vector3()
  const visualWorldQuaternion = new Quaternion()
  const boneWorldQuaternion = new Quaternion()
  const parentWorldQuaternion = new Quaternion()
  const deltaQuaternion = new Quaternion()
  const targetWorldQuaternion = new Quaternion()

  const setWorldDirection = (
    bone: Object3D | undefined,
    child: Object3D | undefined,
    targetVisualDirection: Vector3,
  ) => {
    if (!bone || !child || !bone.parent) return
    visual.updateMatrixWorld(true)
    bone.getWorldPosition(bonePosition)
    child.getWorldPosition(childPosition)
    currentDirection.subVectors(childPosition, bonePosition)
    if (currentDirection.lengthSq() <= 1e-12) return
    currentDirection.normalize()
    visual.getWorldQuaternion(visualWorldQuaternion)
    targetWorldDirection
      .copy(targetVisualDirection)
      .applyQuaternion(visualWorldQuaternion)
      .normalize()
    deltaQuaternion.setFromUnitVectors(
      currentDirection,
      targetWorldDirection,
    )
    bone.getWorldQuaternion(boneWorldQuaternion)
    targetWorldQuaternion
      .copy(deltaQuaternion)
      .multiply(boneWorldQuaternion)
    bone.parent.getWorldQuaternion(parentWorldQuaternion).invert()
    bone.quaternion
      .copy(parentWorldQuaternion)
      .multiply(targetWorldQuaternion)
      .normalize()
    visual.updateMatrixWorld(true)
  }

  const rotateAroundVisualAxis = (
    bone: Object3D | undefined,
    axis: Vector3,
    radians: number,
  ) => {
    if (!bone || !bone.parent || Math.abs(radians) <= 1e-12) return
    visual.updateMatrixWorld(true)
    visual.getWorldQuaternion(visualWorldQuaternion)
    axisWorld
      .copy(axis)
      .applyQuaternion(visualWorldQuaternion)
      .normalize()
    deltaQuaternion.setFromAxisAngle(axisWorld, radians)
    bone.getWorldQuaternion(boneWorldQuaternion)
    targetWorldQuaternion
      .copy(deltaQuaternion)
      .multiply(boneWorldQuaternion)
    bone.parent.getWorldQuaternion(parentWorldQuaternion).invert()
    bone.quaternion
      .copy(parentWorldQuaternion)
      .multiply(targetWorldQuaternion)
      .normalize()
    visual.updateMatrixWorld(true)
  }

  return {
    apply: (animationTimeSeconds, reducedMotion) => {
      if (leftUpLeg && baseLeftUpLeg) leftUpLeg.quaternion.copy(baseLeftUpLeg)
      if (leftLeg && baseLeftLeg) leftLeg.quaternion.copy(baseLeftLeg)
      if (leftFoot && baseLeftFoot) leftFoot.quaternion.copy(baseLeftFoot)
      if (rightUpLeg && baseRightUpLeg) {
        rightUpLeg.quaternion.copy(baseRightUpLeg)
      }
      if (rightLeg && baseRightLeg) rightLeg.quaternion.copy(baseRightLeg)
      if (rightFoot && baseRightFoot) rightFoot.quaternion.copy(baseRightFoot)
      visual.updateMatrixWorld(true)

      // Align upper and lower arms independently so the hands rest beneath the
      // shoulders instead of retaining Meshy's A-pose or animated shrug.
      setWorldDirection(leftArm, leftForeArm, LEFT_ARM_DOWN)
      setWorldDirection(leftForeArm, leftHand, LEFT_ARM_DOWN)
      setWorldDirection(rightArm, rightForeArm, RIGHT_ARM_DOWN)
      setWorldDirection(rightForeArm, rightHand, RIGHT_ARM_DOWN)

      if (habitat !== 'water' || reducedMotion) return
      const phase = animationTimeSeconds * Math.PI
      const thighSwing = Math.sin(phase) * (Math.PI / 20)
      const kneeSwing = Math.sin(phase + Math.PI / 2) * (Math.PI / 30)
      const footSwing = Math.sin(phase + Math.PI / 2) * (Math.PI / 12)
      rotateAroundVisualAxis(leftUpLeg, WATER_KICK_AXIS, thighSwing)
      rotateAroundVisualAxis(rightUpLeg, WATER_KICK_AXIS, -thighSwing)
      rotateAroundVisualAxis(leftLeg, WATER_KICK_AXIS, -kneeSwing)
      rotateAroundVisualAxis(rightLeg, WATER_KICK_AXIS, kneeSwing)
      rotateAroundVisualAxis(leftFoot, WATER_KICK_AXIS, footSwing)
      rotateAroundVisualAxis(rightFoot, WATER_KICK_AXIS, -footSwing)
    },
  }
}

export interface ReviewCandidateAvatarGltf {
  readonly animations: readonly AnimationClip[]
  readonly scene: Group
}

const localAvatarRoute =
  '/__museum-review-assets/scale-encounter-child-avatar'

function reviewCandidateAvatarUrl(
  filename: string,
  bundledUrl: URL,
): string {
  if (import.meta.env.MODE !== 'e2e') {
    return `${localAvatarRoute}/${filename}`
  }
  return bundledUrl.href
}

const BASE_AUTHORED_HEIGHT_METERS = 1.15

function avatarPackage(
  variantId: ReviewCandidateAvatarVariantId,
  gender: ScaleEncounterGender,
  profile: ReviewCandidateAvatarProfile,
  habitat: ScaleEncounterHabitat,
  clipName: ReviewCandidateAvatarClipName,
  authoredHeightMeters: number,
  acceptedSha256: string,
  bundledUrl: URL,
): ReviewCandidateAvatarPackage {
  const filename = `child-avatar-v3-${gender}-land-normal.glb`
  return {
    acceptedSha256,
    authoredHeightMeters,
    clipName,
    equipmentRigId: 'child-base-v3-meshy-24',
    eyeAnchorName: 'EyeAnchor',
    filename,
    gender,
    habitat,
    profile,
    sceneRootName: 'ChildAvatarV3Root',
    sourceUrl: reviewCandidateAvatarUrl(filename, bundledUrl),
    variantId,
  }
}

// This browser-side catalog mirrors the reviewed v3 manifest's scale and
// naming contract. It intentionally contains URLs for individual packages,
// not a manifest fetch or a monolithic avatar, so selecting one child/scene
// can issue exactly one GLB request. DirectScaleEncounter and this module are
// absent from the production entry graph until the review gates are closed.
export const REVIEW_CANDIDATE_AVATAR_PACKAGES = {
  'boy-base': avatarPackage(
    'boy-base',
    'boy',
    'base',
    'land',
    'Idle_Land',
    BASE_AUTHORED_HEIGHT_METERS,
    '76eabc9cfa7c9d79b473f8998e449bbc874e292147b003969377ff719ec080d6',
    new URL(
      '../../assets/candidates/scale-encounter-child-avatar/child-avatar-v3-boy-land-normal.glb',
      import.meta.url,
    ),
  ),
  'girl-base': avatarPackage(
    'girl-base',
    'girl',
    'base',
    'land',
    'Idle_Land',
    BASE_AUTHORED_HEIGHT_METERS,
    '0ed1bdfa7b0108addd8d134d7b90657c136222e068511606160b53c213601716',
    new URL(
      '../../assets/candidates/scale-encounter-child-avatar/child-avatar-v3-girl-land-normal.glb',
      import.meta.url,
    ),
  ),
} as const satisfies Readonly<
  Record<ReviewCandidateAvatarVariantId, ReviewCandidateAvatarPackage>
>

export function scaleEncounterAvatarVariantFor(
  gender: ScaleEncounterGender,
  habitat: ScaleEncounterHabitat,
  animalId: ScaleEncounterAnimalId,
): {
  readonly animation: ReviewCandidateAvatarClipName
  readonly id: ReviewCandidateAvatarVariantId
} {
  void habitat
  void animalId
  return { animation: 'Idle_Land', id: `${gender}-base` }
}

function packageForTarget(
  profile: ScaleEncounterProfile,
  animalId: ScaleEncounterAnimalId,
): ReviewCandidateAvatarPackage {
  const normalized = normalizeScaleEncounterProfile(profile)
  const habitat = SCALE_ENCOUNTER_DEFINITIONS[animalId].habitat
  const variant = scaleEncounterAvatarVariantFor(
    normalized.gender,
    habitat,
    animalId,
  )
  return REVIEW_CANDIDATE_AVATAR_PACKAGES[variant.id]
}

interface OwnedAvatarResources {
  readonly geometries: Set<BufferGeometry>
  readonly materials: Set<Material>
  readonly skeletons: Set<Skeleton>
  readonly textures: Set<Texture>
}

function createOwnedAvatarResources(): OwnedAvatarResources {
  return {
    geometries: new Set(),
    materials: new Set(),
    skeletons: new Set(),
    textures: new Set(),
  }
}

function cloneTextureReference(
  texture: Texture,
  clones: Map<Texture, Texture>,
  resources: OwnedAvatarResources,
): Texture {
  const cached = clones.get(texture)
  if (cached) return cached
  const clone = texture.clone()
  // Texture.clone deliberately shares Source/ImageBitmap. The visible
  // instance owns only this GPU texture object; its custom disposer below
  // never closes Source.data, which remains owned by the cached source GLTF.
  clones.set(texture, clone)
  resources.textures.add(clone)
  return clone
}

function isTexture(value: unknown): value is Texture {
  return value instanceof Texture
}

function cloneTextureValue(
  value: unknown,
  clones: Map<Texture, Texture>,
  resources: OwnedAvatarResources,
): unknown {
  if (isTexture(value)) {
    return cloneTextureReference(value, clones, resources)
  }
  if (Array.isArray(value) && value.some(isTexture)) {
    const entries: readonly unknown[] = value
    return entries.map((entry) =>
      isTexture(entry)
        ? cloneTextureReference(entry, clones, resources)
        : entry,
    )
  }
  return value
}

function cloneMaterial(
  source: Material,
  textureClones: Map<Texture, Texture>,
  resources: OwnedAvatarResources,
): Material {
  const clone = source.clone()
  const sourceValues = source as unknown as Record<string, unknown>
  const cloneValues = clone as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(sourceValues)) {
    const replacement = cloneTextureValue(value, textureClones, resources)
    if (replacement !== value) cloneValues[key] = replacement
  }

  if ('uniforms' in sourceValues && 'uniforms' in cloneValues) {
    const sourceUniforms = sourceValues.uniforms as Record<string, unknown>
    const cloneUniforms = cloneValues.uniforms as Record<string, unknown>
    for (const [name, sourceUniform] of Object.entries(sourceUniforms)) {
      if (
        sourceUniform &&
        typeof sourceUniform === 'object' &&
        'value' in sourceUniform
      ) {
        const clonedUniform = cloneUniforms[name]
        if (
          clonedUniform &&
          typeof clonedUniform === 'object' &&
          'value' in clonedUniform
        ) {
          clonedUniform.value = cloneTextureValue(
            sourceUniform.value,
            textureClones,
            resources,
          )
        }
      }
    }
  }
  resources.materials.add(clone)
  return clone
}

type CandidateMesh = Mesh<BufferGeometry, Material | Material[]>

function isCandidateMesh(object: Object3D): object is CandidateMesh {
  return object instanceof Mesh
}

function cloneCandidateScene(source: Group): {
  readonly resources: OwnedAvatarResources
  readonly visual: Group
} {
  const visual = cloneSkeleton(source) as Group
  const resources = createOwnedAvatarResources()
  const textureClones = new Map<Texture, Texture>()
  visual.traverse((object) => {
    if (!isCandidateMesh(object)) return
    object.geometry = object.geometry.clone()
    resources.geometries.add(object.geometry)
    object.material = Array.isArray(object.material)
      ? object.material.map((material) =>
          cloneMaterial(material, textureClones, resources),
        )
      : cloneMaterial(object.material, textureClones, resources)
    if (object instanceof SkinnedMesh) {
      resources.skeletons.add(object.skeleton)
    }
  })
  return { resources, visual }
}

function disposeOwnedAvatarResources(
  resources: OwnedAvatarResources,
): void {
  for (const texture of resources.textures) texture.dispose()
  for (const material of resources.materials) material.dispose()
  for (const geometry of resources.geometries) geometry.dispose()
  for (const skeleton of resources.skeletons) skeleton.dispose()
}

function validateCandidate(
  candidate: ReviewCandidateAvatarGltf,
  avatarPackage: ReviewCandidateAvatarPackage,
): ReviewCandidateAvatarGltf {
  if (
    candidate.scene.name !== avatarPackage.sceneRootName &&
    !candidate.scene.getObjectByName(avatarPackage.sceneRootName)
  ) {
    throw new Error(
      `candidate-avatar-missing-${avatarPackage.sceneRootName}`,
    )
  }
  let eyeAnchorCount = 0
  candidate.scene.traverse((object) => {
    if (object.name === avatarPackage.eyeAnchorName) eyeAnchorCount += 1
  })
  if (eyeAnchorCount !== 1) {
    throw new Error(
      `candidate-avatar-invalid-${avatarPackage.eyeAnchorName}-count:${eyeAnchorCount}`,
    )
  }
  if (
    !candidate.animations.some(
      (animation) => animation.name === avatarPackage.clipName,
    )
  ) {
    throw new Error(`candidate-avatar-missing-${avatarPackage.clipName}`)
  }
  for (const socketName of REVIEW_CANDIDATE_AVATAR_EQUIPMENT_SOCKET_NAMES) {
    if (!candidate.scene.getObjectByName(socketName)) {
      throw new Error(`candidate-avatar-missing-equipment-socket:${socketName}`)
    }
  }
  for (const boneName of REVIEW_CANDIDATE_AVATAR_POSE_BONE_NAMES) {
    if (!candidate.scene.getObjectByName(boneName)) {
      throw new Error(`candidate-avatar-missing-pose-bone:${boneName}`)
    }
  }
  return candidate
}

interface AvatarCacheEntry {
  candidate: ReviewCandidateAvatarGltf | null
  disposed: boolean
  evicted: boolean
  instanceCount: number
  leaseCount: number
  readonly avatarPackage: ReviewCandidateAvatarPackage
  readonly promise: Promise<ReviewCandidateAvatarGltf>
}

export interface ReviewCandidateAvatarLease {
  readonly factory: ScaleEncounterAvatarFactory
  readonly variantId: ReviewCandidateAvatarVariantId
  release(): void
}

export interface ReviewCandidateAvatarLoader {
  acquire(
    profile: ScaleEncounterProfile,
    animalId: ScaleEncounterAnimalId,
    signal?: AbortSignal,
  ): Promise<ReviewCandidateAvatarLease>
  cachedVariantIds(): readonly ReviewCandidateAvatarVariantId[]
  disposeUnused(): void
}

export interface ReviewCandidateAvatarLoaderOptions {
  readonly cacheLimit?: number
  readonly load?: (sourceUrl: string) => Promise<ReviewCandidateAvatarGltf>
  readonly maxStepSeconds?: number
  readonly stallBaselineMultiplier?: number
}

function disposeCachedCandidate(entry: AvatarCacheEntry): void {
  if (entry.disposed || !entry.candidate) return
  entry.disposed = true
  disposeObject3D(entry.candidate.scene)
  entry.candidate.scene.clear()
}

function disposeUncachedCandidate(candidate: ReviewCandidateAvatarGltf): void {
  disposeObject3D(candidate.scene)
  candidate.scene.clear()
}

export function createReviewCandidateAvatarLoader(
  options: ReviewCandidateAvatarLoaderOptions = {},
): ReviewCandidateAvatarLoader {
  const cacheLimit = options.cacheLimit ?? 3
  if (!Number.isInteger(cacheLimit) || cacheLimit < 1) {
    throw new RangeError('candidate-avatar-cache-limit-invalid')
  }
  const maxStepSeconds = options.maxStepSeconds ?? 1 / 30
  const stallBaselineMultiplier = options.stallBaselineMultiplier ?? 1.25
  if (
    !Number.isFinite(maxStepSeconds) ||
    maxStepSeconds <= 0 ||
    !Number.isFinite(stallBaselineMultiplier) ||
    stallBaselineMultiplier < 1
  ) {
    throw new RangeError('candidate-avatar-clock-policy-invalid')
  }
  const load: (
    sourceUrl: string,
  ) => Promise<ReviewCandidateAvatarGltf> =
    options.load ??
    ((sourceUrl: string) =>
      new GLTFLoader().loadAsync(sourceUrl))
  const cache = new Map<ReviewCandidateAvatarVariantId, AvatarCacheEntry>()

  function touch(entry: AvatarCacheEntry): void {
    const id = entry.avatarPackage.variantId
    if (cache.get(id) !== entry) return
    cache.delete(id)
    cache.set(id, entry)
  }

  function evict(entry: AvatarCacheEntry): void {
    const id = entry.avatarPackage.variantId
    if (cache.get(id) !== entry) return
    cache.delete(id)
    entry.evicted = true
    disposeCachedCandidate(entry)
  }

  function trimCache(): void {
    while (cache.size > cacheLimit) {
      const unused = [...cache.values()].find(
        (entry) => entry.leaseCount === 0 && entry.instanceCount === 0,
      )
      if (!unused) return
      evict(unused)
    }
  }

  function releaseInstance(entry: AvatarCacheEntry): void {
    entry.instanceCount = Math.max(0, entry.instanceCount - 1)
    trimCache()
  }

  function createFactory(
    entry: AvatarCacheEntry,
  ): ScaleEncounterAvatarFactory {
    return (profile, habitat, animalId): ScaleEncounterAvatar => {
      const normalized = normalizeScaleEncounterProfile(profile)
      const variant = scaleEncounterAvatarVariantFor(
        normalized.gender,
        habitat,
        animalId,
      )
      if (variant.id !== entry.avatarPackage.variantId) {
        throw new Error('candidate-avatar-lease-target-mismatch')
      }
      const candidate = entry.candidate
      if (!candidate || entry.disposed) {
        throw new Error('candidate-avatar-source-unavailable')
      }

      entry.instanceCount += 1
      let cloned: ReturnType<typeof cloneCandidateScene> | null = null
      try {
        cloned = cloneCandidateScene(candidate.scene)
        const { resources, visual } = cloned
        visual.name = 'scale-encounter-child-visual'
        // Both canonical v3 bases use glTF +Y up and +Z forward. Equipment and
        // scene-specific locomotion will be layered on these same rigs later.
        visual.rotation.y = Math.PI / 2

        const root = new Group()
        root.name =
          `scale-encounter-child-${entry.avatarPackage.variantId}-review-candidate`
        root.add(visual)
        root.scale.setScalar(
          normalized.heightMeters /
            entry.avatarPackage.authoredHeightMeters,
        )
        root.updateMatrixWorld(true)

        const eyeAnchor = visual.getObjectByName(
          entry.avatarPackage.eyeAnchorName,
        )
        if (!eyeAnchor) {
          throw new Error('candidate-avatar-missing-EyeAnchor')
        }
        const clip = candidate.animations.find(
          (animation) => animation.name === entry.avatarPackage.clipName,
        )
        if (!clip) {
          throw new Error(
            `candidate-avatar-missing-${entry.avatarPackage.clipName}`,
          )
        }
        const mixer = new AnimationMixer(visual)
        const action = mixer.clipAction(clip)
        action.setLoop(LoopRepeat, Number.POSITIVE_INFINITY)
        action.reset().play()
        // Apply the authored frame-zero pose before ViewerController measures
        // EyeAnchor or renders the first overview.
        mixer.update(0)
        const poseController = createReviewCandidatePoseController(
          visual,
          habitat,
        )
        poseController.apply(mixer.time, false)

        let disposed = false
        let previousElapsedSeconds: number | null = null
        let reducedMotionActive = false
        let stableFrameDeltaSeconds: number | null = null
        const dispose = () => {
          if (disposed) return
          disposed = true
          mixer.stopAllAction()
          mixer.uncacheRoot(visual)
          root.removeFromParent()
          disposeOwnedAvatarResources(resources)
          visual.clear()
          root.clear()
          releaseInstance(entry)
        }

        return {
          dispose,
          eyeAnchor,
          root,
          visual,
          updateIdle: (elapsedSeconds, reducedMotion) => {
            if (disposed || !Number.isFinite(elapsedSeconds)) return

            if (reducedMotion) {
              previousElapsedSeconds = elapsedSeconds
              if (!reducedMotionActive) {
                reducedMotionActive = true
                action.reset().play()
                action.paused = true
                mixer.update(0)
                poseController.apply(mixer.time, true)
              }
              return
            }

            if (reducedMotionActive) {
              reducedMotionActive = false
              action.paused = false
              previousElapsedSeconds = elapsedSeconds
              poseController.apply(mixer.time, false)
              return
            }

            if (previousElapsedSeconds === null) {
              previousElapsedSeconds = elapsedSeconds
              return
            }
            const rawDelta = elapsedSeconds - previousElapsedSeconds
            previousElapsedSeconds = elapsedSeconds
            if (rawDelta <= 0) return

            const frameBudget = Math.min(
              maxStepSeconds,
              stableFrameDeltaSeconds === null
                ? maxStepSeconds
                : stableFrameDeltaSeconds * stallBaselineMultiplier,
            )
            const delta = Math.min(rawDelta, frameBudget)
            mixer.update(delta)
            poseController.apply(mixer.time, false)

            // Learn legitimate 120/60/30Hz cadence changes while excluding
            // long stalls. A 200/500ms wall-clock gap is deliberately dropped
            // after one bounded update instead of being replayed as a burst of
            // substeps in the same rendered frame.
            if (rawDelta <= maxStepSeconds + 1e-9) {
              stableFrameDeltaSeconds =
                stableFrameDeltaSeconds === null
                  ? rawDelta
                  : stableFrameDeltaSeconds * 0.8 + rawDelta * 0.2
            }
          },
        }
      } catch (error) {
        if (cloned) {
          disposeOwnedAvatarResources(cloned.resources)
          cloned.visual.clear()
        }
        releaseInstance(entry)
        throw error
      }
    }
  }

  async function acquire(
    profile: ScaleEncounterProfile,
    animalId: ScaleEncounterAnimalId,
    signal?: AbortSignal,
  ): Promise<ReviewCandidateAvatarLease> {
    const avatarPackage = packageForTarget(profile, animalId)
    let entry = cache.get(avatarPackage.variantId)
    if (!entry) {
      const entryState: { current: AvatarCacheEntry | null } = {
        current: null,
      }
      const promise = load(avatarPackage.sourceUrl)
        .then((candidate) => {
          try {
            validateCandidate(candidate, avatarPackage)
          } catch (error) {
            disposeUncachedCandidate(candidate)
            throw error
          }
          if (!entryState.current || entryState.current.evicted) {
            // Defensive future-proofing for cancellation/teardown paths: a
            // source that finishes after its cache entry was evicted must not
            // become an orphaned ImageBitmap/GLTF.
            disposeUncachedCandidate(candidate)
            throw new Error('candidate-avatar-load-evicted')
          }
          entryState.current.candidate = candidate
          return candidate
        })
        .catch((error: unknown) => {
          if (cache.get(avatarPackage.variantId) === entryState.current) {
            cache.delete(avatarPackage.variantId)
          }
          throw error
        })
      const createdEntry: AvatarCacheEntry = {
        avatarPackage,
        candidate: null,
        disposed: false,
        evicted: false,
        instanceCount: 0,
        leaseCount: 0,
        promise,
      }
      entryState.current = createdEntry
      entry = createdEntry
      cache.set(avatarPackage.variantId, entry)
    }
    touch(entry)
    entry.leaseCount += 1
    trimCache()

    try {
      if (signal?.aborted) {
        throw new DOMException('Avatar package load aborted.', 'AbortError')
      }
      if (signal) {
        await new Promise<ReviewCandidateAvatarGltf>((resolve, reject) => {
          const abort = () => {
            settle()
            reject(
              new DOMException('Avatar package load aborted.', 'AbortError'),
            )
          }
          const settle = () => signal.removeEventListener('abort', abort)
          signal.addEventListener('abort', abort, { once: true })
          void entry.promise.then(
            (candidate) => {
              settle()
              resolve(candidate)
            },
            (error: unknown) => {
              settle()
              reject(error instanceof Error ? error : new Error(String(error)))
            },
          )
        })
      } else {
        await entry.promise
      }
    } catch (error) {
      entry.leaseCount = Math.max(0, entry.leaseCount - 1)
      if (
        signal?.aborted &&
        entry.leaseCount === 0 &&
        entry.instanceCount === 0
      ) {
        evict(entry)
      } else {
        trimCache()
      }
      throw error
    }

    let released = false
    const factory = createFactory(entry)
    return {
      factory: (nextProfile, habitat, nextAnimalId) => {
        if (released) {
          throw new Error('candidate-avatar-lease-released')
        }
        return factory(nextProfile, habitat, nextAnimalId)
      },
      release: () => {
        if (released) return
        released = true
        entry.leaseCount = Math.max(0, entry.leaseCount - 1)
        trimCache()
      },
      variantId: avatarPackage.variantId,
    }
  }

  return {
    acquire,
    cachedVariantIds: () => [...cache.keys()],
    disposeUnused: () => {
      for (const entry of [...cache.values()]) {
        if (entry.leaseCount === 0 && entry.instanceCount === 0) {
          evict(entry)
        }
      }
    },
  }
}

const defaultAvatarLoader = createReviewCandidateAvatarLoader()

export function acquireReviewCandidateAvatarFactory(
  profile: ScaleEncounterProfile,
  animalId: ScaleEncounterAnimalId,
  signal?: AbortSignal,
): Promise<ReviewCandidateAvatarLease> {
  return defaultAvatarLoader.acquire(profile, animalId, signal)
}
