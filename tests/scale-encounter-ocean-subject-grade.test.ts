import {
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three'
import {
  OCEAN_SUBJECT_GRADE_REVISION,
  applyOceanSubjectGrade,
} from '../src/scale-encounter/environments/ocean/ocean-subject-grade'

describe('ocean subject grade', () => {
  it('isolates submerged skin optics and restores its shared material once', () => {
    const root = new Group()
    const geometry = new SphereGeometry(1)
    const skin = new MeshPhysicalMaterial({ name: 'skin', ior: 1.5 })
    const eye = new MeshPhysicalMaterial({ name: 'eye', ior: 1.5 })
    root.add(
      new Mesh(geometry, skin),
      new Mesh(geometry, skin),
      new Mesh(geometry, eye),
    )
    const compile = Reflect.get(skin, 'onBeforeCompile')
    const eyeCompile = Reflect.get(eye, 'onBeforeCompile')
    const cacheKey = Reflect.get(skin, 'customProgramCacheKey')
    const lease = applyOceanSubjectGrade(root, {
      midtoneExponent: 1.2,
      saturation: 1.65,
      materialNames: ['skin'],
      incidentMediumIor: 1.333,
    })

    expect(lease.materialCount).toBe(1)
    expect(skin.ior).toBeCloseTo(1.5 / 1.333, 10)
    expect(eye.ior).toBe(1.5)
    expect(Reflect.get(eye, 'onBeforeCompile')).toBe(eyeCompile)
    expect(skin.customProgramCacheKey()).toContain('1.3330')
    lease.restore()
    lease.restore()
    expect(skin.ior).toBe(1.5)
    expect(Reflect.get(skin, 'onBeforeCompile')).toBe(compile)
    expect(Reflect.get(skin, 'customProgramCacheKey')).toBe(cacheKey)
    geometry.dispose()
    skin.dispose()
    eye.dispose()
  })

  it('adds and restores one reversible authored-albedo shader grade', () => {
    const root = new Group()
    const sharedMaterial = new MeshStandardMaterial({ color: '#ffffff' })
    root.add(
      new Mesh(new SphereGeometry(1), sharedMaterial),
      new Mesh(new SphereGeometry(1), sharedMaterial),
    )
    const originalCompile = Reflect.get(
      sharedMaterial,
      'onBeforeCompile',
    )
    const originalCacheKey = Reflect.get(
      sharedMaterial,
      'customProgramCacheKey',
    )

    const lease = applyOceanSubjectGrade(root, {
      midtoneExponent: 1.08,
      saturation: 1.18,
    })

    expect(lease.materialCount).toBe(1)
    const gradedCompile = Reflect.get(
      sharedMaterial,
      'onBeforeCompile',
    )
    const gradedCacheKey = Reflect.get(
      sharedMaterial,
      'customProgramCacheKey',
    )
    expect(gradedCompile).not.toBe(originalCompile)
    expect(gradedCacheKey.call(sharedMaterial)).toContain(
      OCEAN_SUBJECT_GRADE_REVISION,
    )

    lease.restore()
    expect(Reflect.get(sharedMaterial, 'onBeforeCompile')).toBe(originalCompile)
    expect(Reflect.get(sharedMaterial, 'customProgramCacheKey')).toBe(
      originalCacheKey,
    )
    lease.restore()

    sharedMaterial.dispose()
    root.children.forEach((child) => {
      if (child instanceof Mesh && child.geometry instanceof SphereGeometry) {
        child.geometry.dispose()
      }
    })
  })
})
