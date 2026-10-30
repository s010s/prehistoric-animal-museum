import {
  AnimationClip,
  AnimationMixer,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  NumberKeyframeTrack,
  Object3D,
  QuaternionKeyframeTrack,
  Texture,
  Vector3,
  VectorKeyframeTrack,
  type KeyframeTrack,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from 'three'
import {
  REVIEW_CANDIDATE_AVATAR_PACKAGES,
  REVIEW_CANDIDATE_AVATAR_EQUIPMENT_SOCKET_NAMES,
  createReviewCandidateAvatarLoader,
  scaleEncounterAirflowFabricMaskAt,
  scaleEncounterAvatarVariantFor,
  type ReviewCandidateAvatarClipName,
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
    readonly centimetreBoneTranslations?: boolean
    readonly imageSource?: { close(): void }
    readonly omittedClip?: ReviewCandidateAvatarClipName
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
  const centimetreBone = new Object3D()
  centimetreBone.name = 'CentimetreBone'
  if (options.centimetreBoneTranslations) {
    centimetreBone.position.set(0, 59, 3)
  }
  scene.add(centimetreBone)
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

  const headfront = new Object3D()
  headfront.name = 'headfront'
  headfront.position.set(0, 0, 0.1)
  sockets.get('Head')?.position.set(0, 0.96, 0)
  sockets.get('Head')?.add(headfront)

  const leftToe = new Object3D()
  leftToe.name = 'LeftToeBase'
  leftToe.position.set(0, 0, 0.12)
  sockets.get('LeftFoot')?.add(leftToe)
  const rightToe = new Object3D()
  rightToe.name = 'RightToeBase'
  rightToe.position.set(0, 0, 0.12)
  sockets.get('RightFoot')?.add(rightToe)

  const texture = options.texture ?? new Texture()
  if (options.imageSource) texture.source.data = options.imageSource
  const material = new MeshStandardMaterial({ map: texture })
  const mesh = new Mesh(new BoxGeometry(0.2, 0.6, 0.15), material)
  mesh.name = 'AvatarMesh'
  scene.add(mesh)

  const animations = avatarPackage.clipNames
    .filter((clipName) => clipName !== options.omittedClip)
    .map((clipName) => {
      const moving = clipName.startsWith('Walk_') || clipName.startsWith('Run_')
      const jumping = clipName.startsWith('Jump_Land_')
      const jumpDuration = clipName.endsWith('_Stand')
        ? 54 / 60
        : clipName.endsWith('_Walk')
          ? 46 / 60
          : 42 / 60
      const amplitude = clipName.startsWith('Run_') ? 0.12 : 0.08
      const tracks: KeyframeTrack[] = [
        new NumberKeyframeTrack(
          'AnimatedBone.position[x]',
          moving
            ? [0, 0.25, 0.5, 0.75, 1]
            : jumping
              ? [0, jumpDuration]
              : [0, 1],
          moving ? [0, amplitude, 0, -amplitude, 0] : [0, 0],
        ),
      ]
      if (jumping) {
        const flex = 0.5
        const kneeValues = [
          0, 0, 0, 1,
          Math.sin(flex / 2), 0, 0, Math.cos(flex / 2),
          Math.sin(flex / 2), 0, 0, Math.cos(flex / 2),
          0, 0, 0, 1,
        ]
        tracks.push(
          new QuaternionKeyframeTrack(
            'LeftLeg.quaternion',
            [0, jumpDuration * 0.2, jumpDuration * 0.55, jumpDuration],
            kneeValues,
          ),
          new QuaternionKeyframeTrack(
            'RightLeg.quaternion',
            [0, jumpDuration * 0.2, jumpDuration * 0.55, jumpDuration],
            kneeValues,
          ),
          new VectorKeyframeTrack(
            'Hips.position',
            [0, jumpDuration * 0.2, jumpDuration * 0.55, jumpDuration],
            [
              0, 0.48, 0,
              0, 0.41, 0,
              0, 0.45, 0,
              0, 0.48, 0,
            ],
          ),
        )
      }
      if (options.centimetreBoneTranslations) {
        tracks.push(
          new VectorKeyframeTrack(
            'CentimetreBone.position',
            [0, 1],
            [0, 59, 3, 0, 59, 3],
          ),
        )
      }
      if (moving) {
        tracks.push(
          new QuaternionKeyframeTrack(
            'LeftArm.quaternion',
            [0, 0.5, 1],
            [0, 0, 0, 1, 0, 0, Math.sin(0.2), Math.cos(0.2), 0, 0, 0, 1],
          ),
        )
      }
      return new AnimationClip(clipName, jumping ? jumpDuration : 1, tracks)
    })
  return { animations, scene }
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

describe('scale encounter complete Meshy V4 scene avatars', () => {
  it('maps every encounter to its own gender-and-scene package and approved clips', () => {
    for (const gender of ['boy', 'girl'] as const) {
      expect(
        scaleEncounterAvatarVariantFor(
          gender,
          'land',
          'tyrannosaurus-rex',
        ),
      ).toMatchObject({
        animation: 'Idle_Forest',
        id: `${gender}-land-explorer`,
        presentation: {
          bodyOrientation: 'upright',
          equipment: 'trail-daypack',
          pose: 'grounded-observer',
        },
        sourceId: `${gender}-land-explorer`,
      })
      expect(
        scaleEncounterAvatarVariantFor(gender, 'land', 'mammoth'),
      ).toMatchObject({
        animation: 'Idle_Snow',
        id: `${gender}-snow-expedition`,
        presentation: {
          equipment: 'insulated-cold-weather-kit',
          pose: 'cold-weather-observer',
        },
        sourceId: `${gender}-snow-expedition`,
      })
      expect(
        scaleEncounterAvatarVariantFor(gender, 'air', 'pteranodon'),
      ).toMatchObject({
        animation: 'Glide_Static',
        id: `${gender}-air-wingsuit`,
        presentation: {
          bodyOrientation: 'prone',
          equipment: 'helmeted-wingsuit-and-parachute',
          pose: 'prone-wingsuit-glide',
        },
        sourceId: `${gender}-air-wingsuit`,
      })
      expect(
        scaleEncounterAvatarVariantFor(gender, 'water', 'mosasaurus'),
      ).toMatchObject({
        animation: 'Scuba_Trim_Static',
        id: `${gender}-water-diver`,
        presentation: {
          bodyOrientation: 'prone',
          equipment: 'scuba-kit',
          pose: 'horizontal-scuba-trim',
        },
        sourceId: `${gender}-water-diver`,
      })
    }

    const packages = Object.values(REVIEW_CANDIDATE_AVATAR_PACKAGES)
    expect(packages).toHaveLength(8)
    expect(new Set(packages.map((entry) => entry.filename)).size).toBe(8)
    expect(new Set(packages.map((entry) => entry.sourceUrl)).size).toBe(8)
    expect(
      packages.every((entry) =>
        entry.sourceUrl.includes('/scale-encounter/assets/avatars/'),
      ),
    ).toBe(true)
    expect(
      packages.every((entry) => entry.sceneRootName === 'ChildAvatarV4Root'),
    ).toBe(true)
    expect(
      packages.every((entry) => entry.eyeAnchorName === 'EyeAnchor'),
    ).toBe(true)
    expect(
      packages.every(
        (entry) => entry.rigPolicy === 'meshy-v4-per-package-24-joint',
      ),
    ).toBe(true)
    expect(
      packages.every(
        (entry) =>
          entry.filename ===
          `child-avatar-v4-${entry.gender}-${entry.profile}-v01.glb`,
      ),
    ).toBe(true)
    expect(packages.every((entry) => entry.authoredHeightMeters === 1.15)).toBe(
      true,
    )
    expect(packageFor('boy', 'land-explorer').clipNames).toEqual([
      'Idle_Forest',
      'Walk_Forest',
      'Run_Forest',
      'Jump_Land_Stand',
      'Jump_Land_Walk',
      'Jump_Land_Run',
    ])
    expect(packageFor('girl', 'snow-expedition').clipNames).toEqual([
      'Idle_Snow',
      'Walk_Snow',
      'Jump_Land_Stand',
      'Jump_Land_Walk',
      'Jump_Land_Run',
    ])
    expect(packageFor('boy', 'air-wingsuit').clipNames).toEqual([
      'Glide_Static',
    ])
    expect(packageFor('girl', 'water-diver').clipNames).toEqual([
      'Scuba_Trim_Static',
    ])
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
      packageFor('girl', 'air-wingsuit').sourceUrl,
    )
    expect(firstLease.variantId).toBe('girl-air-wingsuit')
    expect(concurrentLease.variantId).toBe('girl-air-wingsuit')
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
      packageFor('boy', 'air-wingsuit').sourceUrl,
    )
    reopened.release()
    switched.release()
  })

  it('switches only among the approved clips inside the selected scene package', async () => {
    const { loader } = loaderFixture(8)
    const cases = [
      {
        animalId: 'tyrannosaurus-rex',
        expected: ['Idle_Forest', 'Walk_Forest', 'Run_Forest'],
        gender: 'boy',
        habitat: 'land',
        motions: ['idle', 'walk', 'run'],
      },
      {
        animalId: 'mammoth',
        expected: ['Idle_Snow', 'Walk_Snow', 'Walk_Snow'],
        gender: 'girl',
        habitat: 'land',
        motions: ['idle', 'walk', 'run'],
      },
      {
        animalId: 'pteranodon',
        expected: ['Glide_Static', 'Glide_Static', 'Glide_Static'],
        gender: 'boy',
        habitat: 'air',
        motions: ['idle', 'walk', 'glide'],
      },
      {
        animalId: 'mosasaurus',
        expected: [
          'Scuba_Trim_Static',
          'Scuba_Trim_Static',
          'Scuba_Trim_Static',
        ],
        gender: 'girl',
        habitat: 'water',
        motions: ['idle', 'run', 'swim'],
      },
    ] as const

    for (const sceneCase of cases) {
      const lease = await loader.acquire(
        { gender: sceneCase.gender, heightCm: 110 },
        sceneCase.animalId,
      )
      const avatar = lease.factory(
        { gender: sceneCase.gender, heightCm: 110 },
        sceneCase.habitat,
        sceneCase.animalId,
      )
      for (let index = 0; index < sceneCase.motions.length; index += 1) {
        avatar.setMotionState?.({
          kind: sceneCase.motions[index]!,
          speedMetersPerSecond: index === 0 ? 0 : 2.8,
        })
        expect(avatar.root.userData.scaleEncounterAvatarActiveClip).toBe(
          sceneCase.expected[index],
        )
      }
      avatar.dispose?.()
      lease.release()
    }
  })

  it('selects the package-local jump for each entry gait and returns to current locomotion', async () => {
    const { loader } = loaderFixture(8)
    const lease = await loader.acquire(
      { gender: 'boy', heightCm: 110 },
      'tyrannosaurus-rex',
    )
    const avatar = lease.factory(
      { gender: 'boy', heightCm: 110 },
      'land',
      'tyrannosaurus-rex',
    )

    avatar.setMotionState?.({ kind: 'walk', speedMetersPerSecond: 1.2 })
    avatar.setActionState?.('jump', true, 'walk')
    expect(avatar.root.userData.scaleEncounterAvatarActiveClip).toBe(
      'Jump_Land_Walk',
    )
    avatar.setMotionState?.({ kind: 'run', speedMetersPerSecond: 2.8 })
    expect(avatar.root.userData.scaleEncounterAvatarActiveClip).toBe(
      'Jump_Land_Walk',
    )
    avatar.setActionState?.('jump', false, 'walk')
    expect(avatar.root.userData.scaleEncounterAvatarActiveClip).toBe(
      'Run_Forest',
    )
    avatar.setActionState?.('jump', true, 'run')
    expect(avatar.root.userData.scaleEncounterAvatarActiveClip).toBe(
      'Jump_Land_Run',
    )
    avatar.setActionState?.('jump', false, 'run')
    avatar.setMotionState?.({ kind: 'idle', speedMetersPerSecond: 0 })
    avatar.setActionState?.('jump', true, 'idle')
    expect(avatar.root.userData.scaleEncounterAvatarActiveClip).toBe(
      'Jump_Land_Stand',
    )
    avatar.setActionState?.('jump', false, 'idle')

    avatar.dispose?.()
    lease.release()
  })

  it('lets the jump clip own both knees while a stationary child anticipates', async () => {
    const { loader } = loaderFixture(8)
    const lease = await loader.acquire(
      { gender: 'girl', heightCm: 110 },
      'tyrannosaurus-rex',
    )
    const avatar = lease.factory(
      { gender: 'girl', heightCm: 110 },
      'land',
      'tyrannosaurus-rex',
    )
    const leftKnee = avatar.visual.getObjectByName('LeftLeg')!
    const rightKnee = avatar.visual.getObjectByName('RightLeg')!
    const leftStart = leftKnee.quaternion.clone()
    const rightStart = rightKnee.quaternion.clone()

    avatar.updateIdle?.(0, false)
    avatar.setActionState?.('jump', true, 'idle')
    for (let frame = 1; frame <= 6; frame += 1) {
      avatar.updateIdle?.(frame / 30, false)
    }

    expect(leftKnee.quaternion.angleTo(leftStart)).toBeGreaterThan(0.2)
    expect(rightKnee.quaternion.angleTo(rightStart)).toBeGreaterThan(0.2)
    expect(avatar.root.userData.scaleEncounterAvatarActiveClip).toBe(
      'Jump_Land_Stand',
    )

    avatar.setActionState?.('jump', false, 'idle')
    avatar.dispose?.()
    lease.release()
  })

  it('rejects a package missing any approved clip', async () => {
    const avatarPackage = packageFor('boy', 'land-explorer')
    const loader = createReviewCandidateAvatarLoader({
      load: vi.fn(() =>
        Promise.resolve(
          candidateFor(avatarPackage, { omittedClip: 'Run_Forest' }),
        ),
      ),
    })

    await expect(
      loader.acquire(
        { gender: 'boy', heightCm: 110 },
        'tyrannosaurus-rex',
      ),
    ).rejects.toThrow('candidate-avatar-unexpected-clip-set')
  })

  it('reuses a selected scene package but keeps scenes and genders independent', async () => {
    const { load, loader } = loaderFixture(4)
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

    expect(loader.cachedVariantIds()).toEqual([
      'boy-air-wingsuit',
      'girl-air-wingsuit',
      'girl-water-diver',
    ])
    expect(load).toHaveBeenCalledTimes(3)

    const boyAirAgain = await loader.acquire(
      { gender: 'boy', heightCm: 110 },
      'pteranodon',
    )
    expect(load).toHaveBeenCalledTimes(3)
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

    expect(loader.cachedVariantIds()).toEqual(['girl-air-wingsuit'])
    activeAvatar.dispose?.()
  })

  it('scales from authored metres, uses the cloned EyeAnchor, and rejects a lease target mismatch', async () => {
    const { loader } = loaderFixture()
    const avatarPackage = packageFor('boy', 'land-explorer')
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

  it('normalizes centimetre-authored rig nodes and tracks before the first pose', async () => {
    const avatarPackage = packageFor('boy', 'snow-expedition')
    const candidate = candidateFor(avatarPackage, {
      centimetreBoneTranslations: true,
    })
    const loader = createReviewCandidateAvatarLoader({
      load: vi.fn().mockResolvedValue(candidate),
    })
    const lease = await loader.acquire(
      { gender: 'boy', heightCm: 110 },
      'mammoth',
    )
    const avatar = lease.factory(
      { gender: 'boy', heightCm: 110 },
      'land',
      'mammoth',
    )

    expect(
      candidate.scene.userData.scaleEncounterAvatarAnimationTranslationScale,
    ).toBe(0.01)
    expect(
      candidate.scene.userData.scaleEncounterAvatarRigTranslationScale,
    ).toBe(0.01)
    expect(
      avatar.root.userData.scaleEncounterAvatarAnimationTranslationScale,
    ).toBe(0.01)
    expect(avatar.root.userData.scaleEncounterAvatarRigTranslationScale).toBe(
      0.01,
    )
    expect(candidate.scene.getObjectByName('CentimetreBone')?.position.y).toBeCloseTo(
      0.59,
      6,
    )
    expect(avatar.visual.getObjectByName('CentimetreBone')?.position.y).toBeCloseTo(
      0.59,
      6,
    )

    avatar.dispose?.()
    lease.release()
  })

  it('uses complete scene meshes without adding V3 procedural equipment and keeps the reviewed poses', async () => {
    const { loader } = loaderFixture()
    const landLease = await loader.acquire(
      { gender: 'boy', heightCm: 110 },
      'tyrannosaurus-rex',
    )
    const airLease = await loader.acquire(
      { gender: 'boy', heightCm: 110 },
      'pteranodon',
    )
    const waterLease = await loader.acquire(
      { gender: 'boy', heightCm: 110 },
      'mosasaurus',
    )
    const land = landLease.factory(
      { gender: 'boy', heightCm: 110 },
      'land',
      'tyrannosaurus-rex',
    )
    const air = airLease.factory(
      { gender: 'boy', heightCm: 110 },
      'air',
      'pteranodon',
    )
    const water = waterLease.factory(
      { gender: 'boy', heightCm: 110 },
      'water',
      'mosasaurus',
    )

    const direction = (avatar: typeof land, start: string, end: string) =>
      avatar.visual
        .getObjectByName(end)!
        .getWorldPosition(new Vector3())
        .sub(
          avatar.visual
            .getObjectByName(start)!
            .getWorldPosition(new Vector3()),
        )
        .normalize()
    const proceduralEquipmentNames = (avatar: typeof land) => {
      const names: string[] = []
      avatar.visual.traverse((object) => {
        if (object.name.startsWith('avatar-equipment-')) names.push(object.name)
      })
      return names
    }

    expect(land.bodyOrientation).toBe('upright')
    expect(
      direction(land, 'LeftArm', 'LeftForeArm').y,
    ).toBeLessThan(-0.98)
    expect(proceduralEquipmentNames(land)).toEqual([])

    expect(air.bodyOrientation).toBe('prone')
    expect(
      new Vector3(0, 1, 0)
        .applyQuaternion(air.visual.getWorldQuaternion(air.visual.quaternion.clone()))
        .x,
    ).toBeGreaterThan(0.99)
    expect(Math.abs(direction(air, 'LeftArm', 'LeftForeArm').z)).toBeGreaterThan(
      0.98,
    )
    expect(Math.abs(direction(air, 'RightArm', 'RightForeArm').z)).toBeGreaterThan(
      0.98,
    )
    expect(direction(air, 'Head', 'headfront').x).toBeGreaterThan(0.98)
    expect(direction(air, 'LeftFoot', 'LeftToeBase').x).toBeLessThan(-0.98)
    expect(proceduralEquipmentNames(air)).toEqual([])

    expect(water.bodyOrientation).toBe('prone')
    expect(direction(water, 'Head', 'headfront').x).toBeGreaterThan(0.96)
    expect(proceduralEquipmentNames(water)).toEqual([])
    expect(land.root.userData.scaleEncounterAvatarSource).toBe(
      packageFor('boy', 'land-explorer').filename,
    )
    expect(air.root.userData.scaleEncounterAvatarSource).toBe(
      packageFor('boy', 'air-wingsuit').filename,
    )
    expect(air.root.userData.scaleEncounterAvatarFabricMotion).toBe(
      'scale-encounter-airflow-fabric-v4',
    )
    expect(water.root.userData.scaleEncounterAvatarSource).toBe(
      packageFor('boy', 'water-diver').filename,
    )

    const waterFoot = water.visual.getObjectByName('LeftFoot')
    water.updateIdle?.(0, true)
    const reducedPose = waterFoot?.quaternion.clone()
    water.setMotionState?.({ kind: 'swim', speedMetersPerSecond: 1.2 })
    water.updateIdle?.(0, false)
    for (let frame = 1; frame <= 8; frame += 1) {
      water.updateIdle?.(frame / 30, false)
    }
    expect(waterFoot?.quaternion.angleTo(reducedPose!)).toBeGreaterThan(0.01)

    water.updateIdle?.(1, true)
    expect(waterFoot?.quaternion.angleTo(reducedPose!)).toBeLessThan(1e-6)

    land.dispose?.()
    air.dispose?.()
    water.dispose?.()
    landLease.release()
    airLease.release()
    waterLease.release()
  })

  it('adds a readable reduced-motion-aware airflow ripple only to wingsuit cloth', async () => {
    const { loader } = loaderFixture()
    const airLease = await loader.acquire(
      { gender: 'girl', heightCm: 110 },
      'pteranodon',
    )
    const landLease = await loader.acquire(
      { gender: 'girl', heightCm: 110 },
      'tyrannosaurus-rex',
    )
    const air = airLease.factory(
      { gender: 'girl', heightCm: 110 },
      'air',
      'pteranodon',
    )
    const land = landLease.factory(
      { gender: 'girl', heightCm: 110 },
      'land',
      'tyrannosaurus-rex',
    )
    const airMaterial = (
      air.visual.getObjectByName('AvatarMesh') as Mesh
    ).material as MeshStandardMaterial
    const landMaterial = (
      land.visual.getObjectByName('AvatarMesh') as Mesh
    ).material as MeshStandardMaterial
    const shader = {
      fragmentShader: `void main() {
  #include <color_fragment>
}`,
      uniforms: {},
      vertexShader: `void main() {
  #include <begin_vertex>
  #include <skinning_vertex>
}`,
    } as unknown as WebGLProgramParametersWithUniforms

    airMaterial.onBeforeCompile(shader, {} as WebGLRenderer)
    expect(airMaterial.customProgramCacheKey()).toContain(
      'scale-encounter-airflow-fabric-v4',
    )
    expect(shader.vertexShader).toContain('scaleEncounterWingMask')
    expect(shader.vertexShader).toContain('position.z')
    expect(shader.vertexShader).toContain('abs(position.y)')
    expect(shader.vertexShader).toContain('normalize(objectNormal)')
    expect(shader.vertexShader).toContain('3.80')
    expect(shader.vertexShader).toContain('transformed.z +=')
    expect(shader.vertexShader).toContain('3.40')
    expect(shader.vertexShader).toContain('scaleEncounterAirflowGust')
    expect(shader.fragmentShader).toContain(
      'vScaleEncounterAirflowRipple',
    )
    expect(shader.fragmentShader).toContain('scaleEncounterFabricLight')
    expect(shader.fragmentShader).toContain('diffuseColor.rgb')
    expect(shader.uniforms.uScaleEncounterAirflowStrength?.value).toBe(1)
    expect(landMaterial.customProgramCacheKey()).not.toContain(
      'scale-encounter-airflow-fabric-v4',
    )
    expect(land.root.userData.scaleEncounterAvatarFabricMotion).toBeUndefined()

    air.updateIdle?.(2.5, false)
    expect(shader.uniforms.uScaleEncounterAirflowTime?.value).toBe(2.5)
    expect(shader.uniforms.uScaleEncounterAirflowStrength?.value).toBe(1)
    air.updateIdle?.(3, true)
    expect(shader.uniforms.uScaleEncounterAirflowTime?.value).toBe(3)
    expect(shader.uniforms.uScaleEncounterAirflowStrength?.value).toBe(0)

    air.dispose?.()
    land.dispose?.()
    airLease.release()
    landLease.release()
  })

  it('keeps the airflow mask on the membrane below the arms', () => {
    expect(
      scaleEncounterAirflowFabricMaskAt({ x: 22, y: 0, z: 67 }),
    ).toBe(1)
    expect(
      scaleEncounterAirflowFabricMaskAt({ x: -24, y: 2, z: 64 }),
    ).toBe(1)

    // Horizontal sleeves and hands sit above or outside the membrane band.
    expect(
      scaleEncounterAirflowFabricMaskAt({ x: 24, y: 0, z: 86 }),
    ).toBe(0)
    expect(
      scaleEncounterAirflowFabricMaskAt({ x: 44, y: 0, z: 82 }),
    ).toBe(0)
    // Torso, backpack depth and the lower leg-wing remain rigid as well.
    expect(
      scaleEncounterAirflowFabricMaskAt({ x: 7, y: 0, z: 67 }),
    ).toBe(0)
    expect(
      scaleEncounterAirflowFabricMaskAt({ x: 22, y: 10, z: 67 }),
    ).toBe(0)
    expect(
      scaleEncounterAirflowFabricMaskAt({ x: 18, y: 0, z: 45 }),
    ).toBe(0)
  })

  it('keeps boy and girl functionally identical across every scene presentation', async () => {
    const { loader } = loaderFixture()
    for (const [animalId, habitat] of [
      ['tyrannosaurus-rex', 'land'],
      ['mammoth', 'land'],
      ['pteranodon', 'air'],
      ['mosasaurus', 'water'],
    ] as const) {
      const boyLease = await loader.acquire(
        { gender: 'boy', heightCm: 110 },
        animalId,
      )
      const girlLease = await loader.acquire(
        { gender: 'girl', heightCm: 110 },
        animalId,
      )
      const boy = boyLease.factory(
        { gender: 'boy', heightCm: 110 },
        habitat,
        animalId,
      )
      const girl = girlLease.factory(
        { gender: 'girl', heightCm: 110 },
        habitat,
        animalId,
      )
      expect(girl.bodyOrientation).toBe(boy.bodyOrientation)
      expect(girl.root.userData.scaleEncounterAvatarEquipment).toBe(
        boy.root.userData.scaleEncounterAvatarEquipment,
      )
      expect(girl.root.userData.scaleEncounterAvatarPose).toBe(
        boy.root.userData.scaleEncounterAvatarPose,
      )
      expect(girl.root.userData.scaleEncounterAvatarSource).not.toBe(
        boy.root.userData.scaleEncounterAvatarSource,
      )
      expect(girl.root.userData.scaleEncounterAvatarSource).toContain(
        'child-avatar-v4-girl-',
      )
      expect(boy.root.userData.scaleEncounterAvatarSource).toContain(
        'child-avatar-v4-boy-',
      )

      boy.dispose?.()
      girl.dispose?.()
      boyLease.release()
      girlLease.release()
    }
  })

  it('advances each instance by delta at 120Hz and drops excess time after 200/500ms stalls', async () => {
    const update = vi.spyOn(AnimationMixer.prototype, 'update')
    const { loader } = loaderFixture()
    const lease = await loader.acquire(
      { gender: 'boy', heightCm: 110 },
      'tyrannosaurus-rex',
    )
    const avatar = lease.factory(
      { gender: 'boy', heightCm: 110 },
      'land',
      'tyrannosaurus-rex',
    )
    const animated = avatar.visual.getObjectByName('AnimatedBone')
    expect(animated).not.toBeNull()
    avatar.setMotionState?.({ kind: 'walk', speedMetersPerSecond: 1.4 })

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

  it('keeps air animation at one real second per second at 20 and 60 fps', async () => {
    const update = vi.spyOn(AnimationMixer.prototype, 'update')
    const { loader } = loaderFixture()
    const lease = await loader.acquire({ gender: 'boy', heightCm: 110 }, 'pteranodon')
    const totals: number[] = []
    for (const fps of [20, 60]) {
      const avatar = lease.factory({ gender: 'boy', heightCm: 110 }, 'air', 'pteranodon')
      avatar.setMotionState?.({ kind: 'glide', speedMetersPerSecond: fps === 20 ? 0 : 4 })
      update.mockClear()
      avatar.updateIdle?.(100, false)
      for (let frame = 1; frame <= fps; frame++) avatar.updateIdle?.(100 + frame / fps, false)
      totals.push(update.mock.calls.reduce((total, [delta]) => total + delta, 0))
      avatar.dispose?.()
    }
    expect(totals[0]).toBeCloseTo(1, 10)
    expect(totals[1]).toBeCloseTo(1, 10)
    lease.release()
    update.mockRestore()
  })

  it('preserves imported land gait bones while moving and restores the static review pose for reduced motion', async () => {
    const { loader } = loaderFixture()
    const lease = await loader.acquire(
      { gender: 'boy', heightCm: 110 },
      'tyrannosaurus-rex',
    )
    const avatar = lease.factory(
      { gender: 'boy', heightCm: 110 },
      'land',
      'tyrannosaurus-rex',
    )
    const leftArm = avatar.visual.getObjectByName('LeftArm')
    expect(leftArm).not.toBeNull()

    avatar.updateIdle?.(0, true)
    const staticReviewPose = leftArm!.quaternion.clone()
    avatar.setMotionState?.({ kind: 'walk', speedMetersPerSecond: 1.4 })
    avatar.updateIdle?.(1, false)
    for (let frame = 1; frame <= 15; frame += 1) {
      avatar.updateIdle?.(1 + frame / 30, false)
    }
    expect(leftArm!.quaternion.angleTo(staticReviewPose)).toBeGreaterThan(0.05)
    expect(avatar.root.userData.scaleEncounterAvatarActiveClip).toBe(
      'Walk_Forest',
    )

    avatar.updateIdle?.(2, true)
    expect(leftArm!.quaternion.angleTo(staticReviewPose)).toBeLessThan(1e-6)
    expect(avatar.root.userData.scaleEncounterAvatarActiveClip).toBe(
      'Idle_Forest',
    )

    avatar.dispose?.()
    lease.release()
  })

  it('holds a deterministic bind frame for reduced motion without catching up on resume', async () => {
    const update = vi.spyOn(AnimationMixer.prototype, 'update')
    const { loader } = loaderFixture()
    const lease = await loader.acquire(
      { gender: 'girl', heightCm: 110 },
      'tyrannosaurus-rex',
    )
    const avatar = lease.factory(
      { gender: 'girl', heightCm: 110 },
      'land',
      'tyrannosaurus-rex',
    )
    const animated = avatar.visual.getObjectByName('AnimatedBone')
    avatar.setMotionState?.({ kind: 'walk', speedMetersPerSecond: 1.4 })

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
      'tyrannosaurus-rex',
    )
    const first = lease.factory(
      { gender: 'girl', heightCm: 110 },
      'land',
      'tyrannosaurus-rex',
    )
    const second = lease.factory(
      { gender: 'girl', heightCm: 130 },
      'land',
      'tyrannosaurus-rex',
    )
    first.setMotionState?.({ kind: 'walk', speedMetersPerSecond: 1.4 })
    second.setMotionState?.({ kind: 'walk', speedMetersPerSecond: 1.4 })

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
      if (avatarPackage.variantId === 'girl-air-wingsuit') {
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
    const avatarPackage = packageFor('boy', 'land-explorer')
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
    const avatarPackage = packageFor('boy', 'air-wingsuit')
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
    const avatarPackage = packageFor('girl', 'land-explorer')
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
