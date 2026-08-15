import {
  AnimationClip,
  AnimationMixer,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  NumberKeyframeTrack,
  Object3D,
  Texture,
  Vector3,
} from 'three'
import {
  REVIEW_CANDIDATE_AVATAR_PACKAGES,
  REVIEW_CANDIDATE_AVATAR_EQUIPMENT_SOCKET_NAMES,
  createReviewCandidateAvatarLoader,
  scaleEncounterAvatarVariantFor,
  type ReviewCandidateAvatarGltf,
  type ReviewCandidateAvatarPackage,
} from '../src/scale-encounter/avatar-review-candidate'
import { disposeScaleEncounterAvatar } from '../src/viewer/scale-encounter'

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

function packageFor(
  gender: 'boy' | 'girl',
  profile: ReviewCandidateAvatarPackage['profile'],
): ReviewCandidateAvatarPackage {
  return REVIEW_CANDIDATE_AVATAR_PACKAGES[`${gender}-${profile}`]
}

function candidateFor(
  avatarPackage: ReviewCandidateAvatarPackage,
  options: {
    readonly imageSource?: { close(): void }
    readonly texture?: Texture
  } = {},
): ReviewCandidateAvatarGltf {
  const scene = new Group()
  scene.name = avatarPackage.sceneRootName

  const eyeAnchor = new Object3D()
  eyeAnchor.name = avatarPackage.eyeAnchorName
  eyeAnchor.position.set(0, avatarPackage.authoredHeightMeters * 0.91, 0.04)
  scene.add(eyeAnchor)

  const animated = new Object3D()
  animated.name = 'AnimatedBone'
  scene.add(animated)
  const sockets = new Map<string, Object3D>()
  for (const socketName of REVIEW_CANDIDATE_AVATAR_EQUIPMENT_SOCKET_NAMES) {
    const socket = new Object3D()
    socket.name = socketName
    sockets.set(socketName, socket)
    scene.add(socket)
  }

  const leftArm = new Object3D()
  leftArm.name = 'LeftArm'
  leftArm.position.set(0.04, 0, 0)
  const leftForeArm = new Object3D()
  leftForeArm.name = 'LeftForeArm'
  leftForeArm.position.set(0.22, 0, 0)
  sockets.get('LeftShoulder')?.position.set(0.12, 0.82, 0)
  sockets.get('LeftShoulder')?.add(leftArm)
  leftArm.add(leftForeArm)
  leftForeArm.add(sockets.get('LeftHand') as Object3D)
  sockets.get('LeftHand')?.position.set(0.18, 0, 0)

  const rightArm = new Object3D()
  rightArm.name = 'RightArm'
  rightArm.position.set(-0.04, 0, 0)
  const rightForeArm = new Object3D()
  rightForeArm.name = 'RightForeArm'
  rightForeArm.position.set(-0.22, 0, 0)
  sockets.get('RightShoulder')?.position.set(-0.12, 0.82, 0)
  sockets.get('RightShoulder')?.add(rightArm)
  rightArm.add(rightForeArm)
  rightForeArm.add(sockets.get('RightHand') as Object3D)
  sockets.get('RightHand')?.position.set(-0.18, 0, 0)

  const leftUpLeg = new Object3D()
  leftUpLeg.name = 'LeftUpLeg'
  leftUpLeg.position.set(0.05, 0, 0)
  const leftLeg = new Object3D()
  leftLeg.name = 'LeftLeg'
  leftLeg.position.set(0, -0.24, 0)
  sockets.get('Hips')?.position.set(0, 0.48, 0)
  sockets.get('Hips')?.add(leftUpLeg)
  leftUpLeg.add(leftLeg)
  leftLeg.add(sockets.get('LeftFoot') as Object3D)
  sockets.get('LeftFoot')?.position.set(0, -0.22, 0)

  const rightUpLeg = new Object3D()
  rightUpLeg.name = 'RightUpLeg'
  rightUpLeg.position.set(-0.05, 0, 0)
  const rightLeg = new Object3D()
  rightLeg.name = 'RightLeg'
  rightLeg.position.set(0, -0.24, 0)
  sockets.get('Hips')?.add(rightUpLeg)
  rightUpLeg.add(rightLeg)
  rightLeg.add(sockets.get('RightFoot') as Object3D)
  sockets.get('RightFoot')?.position.set(0, -0.22, 0)

  const texture = options.texture ?? new Texture()
  if (options.imageSource) texture.source.data = options.imageSource
  const material = new MeshStandardMaterial({ map: texture })
  const mesh = new Mesh(new BoxGeometry(0.2, 0.6, 0.15), material)
  mesh.name = 'AvatarMesh'
  scene.add(mesh)

  const animation = new AnimationClip(avatarPackage.clipName, 1, [
    new NumberKeyframeTrack(
      'AnimatedBone.position[x]',
      [0, 0.25, 0.5, 0.75, 1],
      [0, 0.08, 0, -0.08, 0],
    ),
  ])
  return { animations: [animation], scene }
}

function loaderFixture(cacheLimit = 3) {
  const candidates = new Map<string, ReviewCandidateAvatarGltf>()
  const load = vi.fn((sourceUrl: string) => {
    const avatarPackage = Object.values(
      REVIEW_CANDIDATE_AVATAR_PACKAGES,
    ).find((entry) => entry.sourceUrl === sourceUrl)
    if (!avatarPackage) {
      return Promise.reject(new Error(`unknown-package:${sourceUrl}`))
    }
    const candidate = candidateFor(avatarPackage)
    candidates.set(avatarPackage.variantId, candidate)
    return Promise.resolve(candidate)
  })
  return {
    candidates,
    load,
    loader: createReviewCandidateAvatarLoader({ cacheLimit, load }),
  }
}

describe('scale encounter canonical child avatar v3 bases', () => {
  it('maps every encounter to one canonical base package per gender', () => {
    for (const gender of ['boy', 'girl'] as const) {
      expect(
        scaleEncounterAvatarVariantFor(
          gender,
          'land',
          'tyrannosaurus-rex',
        ),
      ).toEqual({ animation: 'Idle_Land', id: `${gender}-base` })
      expect(
        scaleEncounterAvatarVariantFor(gender, 'land', 'mammoth'),
      ).toEqual({ animation: 'Idle_Land', id: `${gender}-base` })
      expect(
        scaleEncounterAvatarVariantFor(gender, 'air', 'pteranodon'),
      ).toEqual({ animation: 'Idle_Land', id: `${gender}-base` })
      expect(
        scaleEncounterAvatarVariantFor(gender, 'water', 'mosasaurus'),
      ).toEqual({ animation: 'Idle_Land', id: `${gender}-base` })
    }

    const packages = Object.values(REVIEW_CANDIDATE_AVATAR_PACKAGES)
    expect(packages).toHaveLength(2)
    expect(new Set(packages.map((entry) => entry.filename)).size).toBe(2)
    expect(new Set(packages.map((entry) => entry.sourceUrl)).size).toBe(2)
    expect(
      packages.every((entry) =>
        entry.sourceUrl.startsWith(
          '/__museum-review-assets/scale-encounter-child-avatar/',
        ),
      ),
    ).toBe(true)
    expect(packages.every((entry) => entry.sceneRootName === 'ChildAvatarV3Root')).toBe(true)
    expect(packages.every((entry) => entry.eyeAnchorName === 'EyeAnchor')).toBe(true)
    expect(packages.every((entry) => entry.equipmentRigId === 'child-base-v3-meshy-24')).toBe(true)
    expect(packageFor('boy', 'base').acceptedSha256).toBe(
      '76eabc9cfa7c9d79b473f8998e449bbc874e292147b003969377ff719ec080d6',
    )
    expect(packageFor('girl', 'base').acceptedSha256).toBe(
      '0ed1bdfa7b0108addd8d134d7b90657c136222e068511606160b53c213601716',
    )
    expect(packages.every((entry) => entry.filename === `child-avatar-v3-${entry.gender}-land-normal.glb`)).toBe(true)
    expect(packageFor('boy', 'base').authoredHeightMeters).toBe(1.15)
    expect(packageFor('girl', 'base').authoredHeightMeters).toBe(1.15)
  })

  it('requests only the selected target, coalesces it, and does not refetch for height or reopen', async () => {
    const { load, loader } = loaderFixture()

    expect(load).not.toHaveBeenCalled()
    const first = loader.acquire(
      { gender: 'girl', heightCm: 90 },
      'pteranodon',
    )
    const concurrent = loader.acquire(
      { gender: 'girl', heightCm: 130 },
      'pteranodon',
    )
    const [firstLease, concurrentLease] = await Promise.all([
      first,
      concurrent,
    ])

    expect(load).toHaveBeenCalledOnce()
    expect(load).toHaveBeenCalledWith(
      packageFor('girl', 'base').sourceUrl,
    )
    expect(firstLease.variantId).toBe('girl-base')
    expect(concurrentLease.variantId).toBe('girl-base')
    firstLease.release()
    concurrentLease.release()

    const reopened = await loader.acquire(
      { gender: 'girl', heightCm: 110 },
      'pteranodon',
    )
    expect(load).toHaveBeenCalledOnce()

    const switched = await loader.acquire(
      { gender: 'boy', heightCm: 110 },
      'pteranodon',
    )
    expect(load).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenLastCalledWith(
      packageFor('boy', 'base').sourceUrl,
    )
    reopened.release()
    switched.release()
  })

  it('reuses one cached source across scenes and keeps boy and girl independent', async () => {
    const { load, loader } = loaderFixture(2)
    const girlAir = await loader.acquire(
      { gender: 'girl', heightCm: 110 },
      'pteranodon',
    )
    girlAir.release()
    const boyAir = await loader.acquire(
      { gender: 'boy', heightCm: 110 },
      'pteranodon',
    )
    boyAir.release()

    const girlAirAgain = await loader.acquire(
      { gender: 'girl', heightCm: 120 },
      'pteranodon',
    )
    girlAirAgain.release()
    const girlWater = await loader.acquire(
      { gender: 'girl', heightCm: 110 },
      'mosasaurus',
    )
    girlWater.release()

    expect(loader.cachedVariantIds()).toEqual(['boy-base', 'girl-base'])
    expect(load).toHaveBeenCalledTimes(2)

    const boyAirAgain = await loader.acquire(
      { gender: 'boy', heightCm: 110 },
      'pteranodon',
    )
    expect(load).toHaveBeenCalledTimes(2)
    boyAirAgain.release()
  })

  it('retains an active avatar source while evicting an inactive newer package to honor the bound', async () => {
    const { loader } = loaderFixture(1)
    const firstLease = await loader.acquire(
      { gender: 'girl', heightCm: 110 },
      'pteranodon',
    )
    const activeAvatar = firstLease.factory(
      { gender: 'girl', heightCm: 110 },
      'air',
      'pteranodon',
    )
    firstLease.release()

    const secondLease = await loader.acquire(
      { gender: 'boy', heightCm: 110 },
      'pteranodon',
    )
    secondLease.release()

    expect(loader.cachedVariantIds()).toEqual(['girl-base'])
    activeAvatar.dispose?.()
  })

  it('scales from authored metres, uses the cloned EyeAnchor, and rejects a lease target mismatch', async () => {
    const { loader } = loaderFixture()
    const avatarPackage = packageFor('boy', 'base')
    const lease = await loader.acquire(
      { gender: 'boy', heightCm: 125 },
      'tyrannosaurus-rex',
    )
    const avatar = lease.factory(
      { gender: 'boy', heightCm: 125 },
      'land',
      'tyrannosaurus-rex',
    )

    expect(avatar.root.scale.x).toBeCloseTo(
      1.25 / avatarPackage.authoredHeightMeters,
      10,
    )
    expect(avatar.eyeAnchor.name).toBe('EyeAnchor')
    expect(avatar.eyeAnchor).toBe(
      avatar.visual.getObjectByName('EyeAnchor'),
    )
    expect(avatar.eyeAnchor.getWorldPosition(new Vector3()).y).toBeCloseTo(
      1.25 * 0.91,
      10,
    )
    expect(() =>
      lease.factory(
        { gender: 'girl', heightCm: 125 },
        'land',
        'tyrannosaurus-rex',
      ),
    ).toThrow('candidate-avatar-lease-target-mismatch')

    avatar.dispose?.()
    lease.release()
  })

  it('holds both arms down and adds leg and foot motion only in water', async () => {
    const { loader } = loaderFixture()
    const lease = await loader.acquire(
      { gender: 'boy', heightCm: 110 },
      'mosasaurus',
    )
    const land = lease.factory(
      { gender: 'boy', heightCm: 110 },
      'land',
      'tyrannosaurus-rex',
    )
    const water = lease.factory(
      { gender: 'boy', heightCm: 110 },
      'water',
      'mosasaurus',
    )

    const leftArm = water.visual.getObjectByName('LeftArm')
    const leftForeArm = water.visual.getObjectByName('LeftForeArm')
    const rightArm = water.visual.getObjectByName('RightArm')
    const rightForeArm = water.visual.getObjectByName('RightForeArm')
    const leftArmPosition = leftArm?.getWorldPosition(new Vector3())
    const leftForeArmPosition = leftForeArm?.getWorldPosition(new Vector3())
    const rightArmPosition = rightArm?.getWorldPosition(new Vector3())
    const rightForeArmPosition = rightForeArm?.getWorldPosition(new Vector3())
    expect(
      leftForeArmPosition!
        .clone()
        .sub(leftArmPosition!)
        .normalize().y,
    ).toBeLessThan(-0.99)
    expect(
      rightForeArmPosition!
        .clone()
        .sub(rightArmPosition!)
        .normalize().y,
    ).toBeLessThan(-0.99)

    const landFoot = land.visual.getObjectByName('LeftFoot')
    const waterFoot = water.visual.getObjectByName('LeftFoot')
    const landStart = landFoot?.quaternion.clone()
    const waterStart = waterFoot?.quaternion.clone()
    land.updateIdle?.(0, false)
    water.updateIdle?.(0, false)
    for (let frame = 1; frame <= 8; frame += 1) {
      land.updateIdle?.(frame / 30, false)
      water.updateIdle?.(frame / 30, false)
    }
    expect(landFoot?.quaternion.angleTo(landStart!)).toBeCloseTo(0, 10)
    expect(waterFoot?.quaternion.angleTo(waterStart!)).toBeGreaterThan(0.01)

    water.updateIdle?.(1, true)
    expect(waterFoot?.quaternion.angleTo(landFoot!.quaternion)).toBeCloseTo(
      0,
      10,
    )

    land.dispose?.()
    water.dispose?.()
    lease.release()
  })

  it('advances each instance by delta at 120Hz and drops excess time after 200/500ms stalls', async () => {
    const update = vi.spyOn(AnimationMixer.prototype, 'update')
    const { loader } = loaderFixture()
    const lease = await loader.acquire(
      { gender: 'boy', heightCm: 110 },
      'mosasaurus',
    )
    const avatar = lease.factory(
      { gender: 'boy', heightCm: 110 },
      'water',
      'mosasaurus',
    )
    const animated = avatar.visual.getObjectByName('AnimatedBone')
    expect(animated).not.toBeNull()

    avatar.updateIdle?.(10_000, false)
    const stablePositions: number[] = [animated?.position.x ?? 0]
    for (let frame = 1; frame <= 120; frame += 1) {
      avatar.updateIdle?.(10_000 + frame / 120, false)
      stablePositions.push(animated?.position.x ?? 0)
    }
    const stableTransformDelta = Math.max(
      ...stablePositions.slice(1).map((position, index) =>
        Math.abs(position - stablePositions[index]!),
      ),
    )
    const beforeStalls = update.mock.calls.length
    const before200ms = animated?.position.x ?? 0
    avatar.updateIdle?.(10_001.2, false)
    const after200msPosition = animated?.position.x ?? 0
    const after200ms = update.mock.calls.length
    avatar.updateIdle?.(10_001.7, false)
    const after500msPosition = animated?.position.x ?? 0
    const after500ms = update.mock.calls.length

    const positiveSteps = update.mock.calls
      .map(([delta]) => delta)
      .filter((delta) => delta > 0)
    expect(Math.max(...positiveSteps)).toBeLessThanOrEqual(1 / 30 + 1e-10)
    expect(after200ms - beforeStalls).toBe(1)
    expect(after500ms - after200ms).toBe(1)
    expect(Math.abs(after200msPosition - before200ms)).toBeLessThanOrEqual(
      stableTransformDelta * 1.25 + 1e-10,
    )
    expect(
      Math.abs(after500msPosition - after200msPosition),
    ).toBeLessThanOrEqual(stableTransformDelta * 1.25 + 1e-10)
    expect(animated?.position.x).not.toBe(0)

    avatar.dispose?.()
    lease.release()
    update.mockRestore()
  })

  it('holds a deterministic bind frame for reduced motion without catching up on resume', async () => {
    const update = vi.spyOn(AnimationMixer.prototype, 'update')
    const { loader } = loaderFixture()
    const lease = await loader.acquire(
      { gender: 'girl', heightCm: 110 },
      'pteranodon',
    )
    const avatar = lease.factory(
      { gender: 'girl', heightCm: 110 },
      'air',
      'pteranodon',
    )
    const animated = avatar.visual.getObjectByName('AnimatedBone')

    avatar.updateIdle?.(4, false)
    avatar.updateIdle?.(4.2, false)
    expect(animated?.position.x).not.toBe(0)
    avatar.updateIdle?.(4.25, true)
    const frozen = animated?.position.x
    expect(frozen).toBeCloseTo(0, 10)
    avatar.updateIdle?.(500, true)
    expect(animated?.position.x).toBe(frozen)

    update.mockClear()
    avatar.updateIdle?.(500.5, false)
    expect(update).not.toHaveBeenCalled()
    avatar.updateIdle?.(500.5 + 1 / 120, false)
    expect(update).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledWith(expect.closeTo(1 / 120, 10))

    avatar.dispose?.()
    lease.release()
    update.mockRestore()
  })

  it('keeps independent time baselines for two instances of the same package', async () => {
    const update = vi.spyOn(AnimationMixer.prototype, 'update')
    const { loader } = loaderFixture()
    const lease = await loader.acquire(
      { gender: 'girl', heightCm: 110 },
      'pteranodon',
    )
    const first = lease.factory(
      { gender: 'girl', heightCm: 110 },
      'air',
      'pteranodon',
    )
    const second = lease.factory(
      { gender: 'girl', heightCm: 130 },
      'air',
      'pteranodon',
    )

    update.mockClear()
    first.updateIdle?.(10, false)
    first.updateIdle?.(10 + 1 / 120, false)
    expect(update).toHaveBeenCalledOnce()
    second.updateIdle?.(5_000, false)
    expect(update).toHaveBeenCalledOnce()
    second.updateIdle?.(5_000 + 1 / 120, false)
    expect(update).toHaveBeenCalledTimes(2)

    first.dispose?.()
    second.dispose?.()
    lease.release()
    update.mockRestore()
  })

  it('lets one failed target retry without disabling another package', async () => {
    let girlAttempts = 0
    const load = vi.fn((sourceUrl: string) => {
      const avatarPackage = Object.values(
        REVIEW_CANDIDATE_AVATAR_PACKAGES,
      ).find((entry) => entry.sourceUrl === sourceUrl)
      if (!avatarPackage) {
        return Promise.reject(new Error('unknown-package'))
      }
      if (avatarPackage.variantId === 'girl-base') {
        girlAttempts += 1
        if (girlAttempts === 1) {
          return Promise.reject(new Error('temporary-girl-failure'))
        }
      }
      return Promise.resolve(candidateFor(avatarPackage))
    })
    const loader = createReviewCandidateAvatarLoader({ load })

    await expect(
      loader.acquire(
        { gender: 'girl', heightCm: 110 },
        'pteranodon',
      ),
    ).rejects.toThrow('temporary-girl-failure')
    const boy = await loader.acquire(
      { gender: 'boy', heightCm: 110 },
      'pteranodon',
    )
    const girlRetry = await loader.acquire(
      { gender: 'girl', heightCm: 110 },
      'pteranodon',
    )

    expect(load).toHaveBeenCalledTimes(3)
    boy.release()
    girlRetry.release()
  })

  it('rejects a base that cannot support the shared equipment socket contract', async () => {
    const avatarPackage = packageFor('boy', 'base')
    const candidate = candidateFor(avatarPackage)
    candidate.scene.getObjectByName('RightHand')?.removeFromParent()
    const loader = createReviewCandidateAvatarLoader({
      load: vi.fn(() => Promise.resolve(candidate)),
    })

    await expect(
      loader.acquire(
        { gender: 'boy', heightCm: 110 },
        'tyrannosaurus-rex',
      ),
    ).rejects.toThrow(
      'candidate-avatar-missing-equipment-socket:RightHand',
    )
  })

  it('disposes a GLTF that resolves after its pending acquisition was aborted and evicted', async () => {
    const avatarPackage = packageFor('boy', 'base')
    const sourceClose = vi.fn()
    const sourceTexture = new Texture()
    sourceTexture.source.data = { close: sourceClose }
    const source = candidateFor(avatarPackage, {
      imageSource: sourceTexture.source.data as { close(): void },
      texture: sourceTexture,
    })
    const pending = deferred<ReviewCandidateAvatarGltf>()
    const loader = createReviewCandidateAvatarLoader({
      load: vi.fn(() => pending.promise),
    })
    const abort = new AbortController()

    const acquisition = loader.acquire(
      { gender: 'boy', heightCm: 110 },
      'pteranodon',
      abort.signal,
    )
    abort.abort()
    await expect(acquisition).rejects.toMatchObject({ name: 'AbortError' })
    expect(loader.cachedVariantIds()).toEqual([])

    pending.resolve(source)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(sourceClose).toHaveBeenCalledOnce()
    expect(loader.cachedVariantIds()).toEqual([])
  })

  it('disposes instance GPU objects without closing the cached ImageBitmap source, then reopens cleanly', async () => {
    const sourceClose = vi.fn()
    const sourceTexture = new Texture()
    sourceTexture.source.data = { close: sourceClose }
    const avatarPackage = packageFor('girl', 'base')
    const source = candidateFor(avatarPackage, {
      imageSource: sourceTexture.source.data as { close(): void },
      texture: sourceTexture,
    })
    const load = vi.fn(() => Promise.resolve(source))
    const loader = createReviewCandidateAvatarLoader({ load })

    const firstLease = await loader.acquire(
      { gender: 'girl', heightCm: 110 },
      'tyrannosaurus-rex',
    )
    const first = firstLease.factory(
      { gender: 'girl', heightCm: 110 },
      'land',
      'tyrannosaurus-rex',
    )
    const firstMap = (
      (first.visual.getObjectByName('AvatarMesh') as Mesh)
        .material as MeshStandardMaterial
    ).map
    expect(firstMap).not.toBe(sourceTexture)
    expect(firstMap?.source).toBe(sourceTexture.source)
    first.dispose?.()
    first.dispose?.()
    firstLease.release()

    expect(sourceClose).not.toHaveBeenCalled()
    expect((source.scene.getObjectByName('AvatarMesh') as Mesh).visible).toBe(true)

    const reopenedLease = await loader.acquire(
      { gender: 'girl', heightCm: 130 },
      'tyrannosaurus-rex',
    )
    const reopened = reopenedLease.factory(
      { gender: 'girl', heightCm: 130 },
      'land',
      'tyrannosaurus-rex',
    )
    const reopenedMap = (
      (reopened.visual.getObjectByName('AvatarMesh') as Mesh)
        .material as MeshStandardMaterial
    ).map
    expect(load).toHaveBeenCalledOnce()
    expect(reopenedMap).not.toBe(sourceTexture)
    expect(reopenedMap?.source.data).toBe(sourceTexture.source.data)
    expect(sourceClose).not.toHaveBeenCalled()

    reopened.dispose?.()
    reopenedLease.release()
    loader.disposeUnused()
    expect(sourceClose).toHaveBeenCalledOnce()
  })

  it('routes candidate cleanup through its cache-aware disposer', () => {
    const parent = new Group()
    const root = new Group()
    const dispose = vi.fn()
    const renderLists = { dispose: vi.fn() }
    parent.add(root)

    disposeScaleEncounterAvatar(
      {
        dispose,
        eyeAnchor: new Object3D(),
        root,
        visual: new Group(),
      },
      { renderLists },
    )

    expect(root.parent).toBeNull()
    expect(dispose).toHaveBeenCalledOnce()
    expect(renderLists.dispose).toHaveBeenCalledOnce()
  })

  it('keeps ordinary Object3D disposal for lightweight test avatars without a custom owner', () => {
    const root = new Group()
    const geometry = new BoxGeometry(0.2, 0.6, 0.15)
    const material = new MeshStandardMaterial()
    const geometryDisposed = vi.fn()
    const materialDisposed = vi.fn()
    geometry.addEventListener('dispose', geometryDisposed)
    material.addEventListener('dispose', materialDisposed)
    root.add(new Mesh(geometry, material))

    disposeScaleEncounterAvatar({
      eyeAnchor: new Object3D(),
      root,
      visual: new Group(),
    })

    expect(geometryDisposed).toHaveBeenCalledOnce()
    expect(materialDisposed).toHaveBeenCalledOnce()
  })
})
