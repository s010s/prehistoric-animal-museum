import { type Mesh, type ShaderMaterial, Texture, type Vector4 } from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import { createScaleEncounterEnvironment, disposeScaleEncounterEnvironment, updateScaleEncounterEnvironment } from '../src/viewer/scale-encounter-environment'
import { forestStreamCentreZ, forestWaterForAnimal } from '../src/viewer/scale-encounter-forest-water'

describe('Meganeura forest stream', () => {
  it.each([
    ['meganeura', -2, 0],
    ['lystrosaurus', -4, 0],
    ['archaeopteryx', 0.5, 0.9],
    ['baryonyx', -14, 0],
    ['carnotaurus', -13, 0],
    ['tyrannosaurus-rex', -16, 0],
    ['spinosaurus', -13, 8.4],
  ] as const)('gives %s a broad reach while retaining dry subject and initial visitor banks', (animalId, childX, childZ) => {
    const stream = forestWaterForAnimal(animalId)!
    const environment = createScaleEncounterEnvironment('land', 'production-slice', new Texture(), { animalId })!
    const water = environment.root.getObjectByName(`scale-encounter-${animalId}-forest-stream-water`) as Reflector
    expect(water).toBeInstanceOf(Reflector)
    expect(environment.groundHeightAtWorld!(childX, childZ)).toBeGreaterThan(water.position.y)
    for (const x of [-1, 0, 1, 2, 3, 4, 5]) {
      expect(environment.groundHeightAtWorld!(x, 0)).toBeGreaterThan(water.position.y)
    }
    const positions = water.geometry.getAttribute('position')
    const middle = (positions.count / 13 - 1) / 2 * 13
    const width = Math.abs(positions.getY(middle + 12) - positions.getY(middle))
    // Even the smallest visitor scene has a visible sheet, not a thin ditch.
    expect(width).toBeGreaterThan(7)
    expect(water.position.y - stream.heightAtWorld(0, stream.centreZ(0))).toBeCloseTo(0.5)
    disposeScaleEncounterEnvironment(environment)
  })

  it('keeps an originally dry forest clearing free of added water', () => {
    expect(forestWaterForAnimal('apatosaurus')).toBeNull()
    expect(forestWaterForAnimal('sauropelta')).toBeNull()
  })

  it('preserves the forest, cuts a shallow visible reach and grounds the mesh and visitor on the same banks', () => {
    const panorama = new Texture()
    const environment = createScaleEncounterEnvironment('land', 'production-slice', panorama, { animalId: 'meganeura' })!
    const water = environment.root.getObjectByName('scale-encounter-meganeura-forest-stream-water') as Reflector
    const ground = environment.root.getObjectByName('scale-encounter-land-ground') as Mesh
    expect(water).toBeInstanceOf(Reflector)
    expect(environment.root.getObjectByName('scale-encounter-accepted-forested-mountain-basin')).toBeTruthy()
    const heightAt = environment.groundHeightAtWorld!
    expect(heightAt(0.8, 0)).toBeCloseTo(0, 2)
    expect(heightAt(-2, 0)).toBeCloseTo(0, 2)
    // This bend is visible beside the child in a wide overview; it remains
    // shallow enough to enter after walking away from the dry start at -2 m.
    expect(heightAt(-6.5, 0)).toBeLessThan(water.position.y)
    expect(water.position.y - heightAt(-6.5, 0)).toBeLessThanOrEqual(0.5)
    expect(water.position.y - heightAt(0, forestStreamCentreZ(0))).toBeCloseTo(0.5)
    const positions = ground.geometry.getAttribute('position')
    let wetVerticesNearAnimal = 0
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i)
      const z = -positions.getY(i)
      const y = positions.getZ(i) + ground.position.y
      expect(y).toBeCloseTo(heightAt(x, z), 4)
      if (Math.hypot(x, z) < 12 && y < water.position.y) wetVerticesNearAnimal++
    }
    expect(wetVerticesNearAnimal).toBeGreaterThan(100)
    // Refining the stream must not let jittered rings cross and invert faces.
    const faces = ground.geometry.getIndex()!
    for (let i = 0; i < faces.count; i += 3) {
      const a = faces.getX(i)
      const b = faces.getX(i + 1)
      const c = faces.getX(i + 2)
      const signedArea = (positions.getX(b) - positions.getX(a)) * (positions.getY(c) - positions.getY(a))
        - (positions.getY(b) - positions.getY(a)) * (positions.getX(c) - positions.getX(a))
      expect(signedArea).toBeGreaterThan(0)
    }
    const waterPositions = water.geometry.getAttribute('position')
    const depths = water.geometry.getAttribute('waterDepth')
    for (let i = 0; i < waterPositions.count; i++) {
      const x = waterPositions.getX(i)
      const z = -waterPositions.getY(i)
      expect(depths.getX(i)).toBeCloseTo(Math.max(0, water.position.y - heightAt(x, z)), 4)
      expect(depths.getX(i)).toBeLessThanOrEqual(0.50001)
    }
    const level = water.position.y
    updateScaleEncounterEnvironment(environment, 8, false)
    expect(water.position.y).toBe(level)
    expect((water.material as ShaderMaterial).uniforms.uTime!.value).toBe(8)
    for (let frame = 0; frame < 10; frame++) {
      const x = frame * 0.1
      const z = forestStreamCentreZ(x)
      updateScaleEncounterEnvironment(environment, 8 + frame * 0.05, false, undefined, {
        x, z, feetY: heightAt(x, z), heightMeters: 1.2, verticalVelocity: 0, airborne: false,
      })
    }
    const ripples = (water.material as ShaderMaterial).uniforms.uVisitorRipples!.value as Vector4[]
    expect(ripples.some((ripple) => ripple.w > 0)).toBe(true)
    updateScaleEncounterEnvironment(environment, 9, true)
    expect(ripples.every((ripple) => ripple.w === 0)).toBe(true)
    expect((water.material as ShaderMaterial).uniforms.uTime!.value).toBe(0)
    const disposeReflection = vi.spyOn(water.getRenderTarget(), 'dispose')
    disposeScaleEncounterEnvironment(environment)
    expect(disposeReflection).toHaveBeenCalledOnce()
    panorama.dispose()
  })
})
