import { type Mesh, type MeshBasicMaterial, PerspectiveCamera, type ShaderMaterial, type Vector4 } from 'three'
import { createRiverWater } from '../src/viewer/scale-encounter-river-water'
import { createRiverWaterInteraction, type RiverVisitor } from '../src/viewer/scale-encounter-water-interaction'
import { disposeObject3D } from '../src/viewer/dispose'

const visitor = (changes: Partial<RiverVisitor> = {}): RiverVisitor => ({
  x: 0, z: 0, feetY: -0.5, heightMeters: 1.2, verticalVelocity: 0, airborne: false,
  ...changes,
})
const count = (ripples: Vector4[]) => ripples.filter((ripple) => ripple.w > 0).length

describe('shallow-water visitor interactions', () => {
  it('pushes water continuously before the next footfall and follows a turn or a backward step', () => {
    const effect = createRiverWaterInteraction(() => 0.5, 0)
    effect.update(0, visitor())
    effect.update(0.1, visitor({ x: 0.14 }))
    expect(count(effect.ripples)).toBe(0)
    expect(effect.push.x).toBe(0.14)
    expect(effect.push.z).toBeGreaterThan(0.7)
    expect(effect.flow.x).toBeCloseTo(1)
    effect.update(0.2, visitor({ x: 0.14, z: 0.14 }))
    expect(effect.push.y).toBe(0.14)
    expect(effect.flow.x).toBeCloseTo(0)
    expect(effect.flow.y).toBeCloseTo(1)
    effect.update(0.3, visitor({ x: 0, z: 0.14 }))
    expect(effect.flow.x).toBeCloseTo(-1)
    for (let frame = 4; frame <= 12; frame++) {
      effect.update(frame * 0.1, visitor({ x: -(frame - 3) * 0.14, z: 0.14 }))
    }
    // The latest step starts ahead in the actual direction of travel.
    const latest = effect.ripples.filter((ripple) => ripple.w > 0).sort((a, b) => b.z - a.z)[0]!
    const impactBodyX = -(Math.round(latest.z * 10) - 3) * 0.14
    expect(latest.x).toBeLessThan(impactBodyX)
    disposeObject3D(effect.root)
  })

  it('scales the pressure front with immersion and releases it when stopping or leaving the water', () => {
    const shallow = createRiverWaterInteraction(() => 0.5, 0)
    const deep = createRiverWaterInteraction(() => 0.5, 0)
    shallow.update(0, visitor({ feetY: -0.025 }))
    deep.update(0, visitor())
    for (let frame = 1; frame <= 8; frame++) {
      shallow.update(frame * 0.1, visitor({ x: frame * 0.14, feetY: -0.025 }))
      deep.update(frame * 0.1, visitor({ x: frame * 0.14 }))
    }
    expect(deep.push.z).toBeGreaterThan(shallow.push.z * 5)
    const stoppedX = deep.push.x
    for (let frame = 9; frame <= 15; frame++) deep.update(frame * 0.1, visitor({ x: stoppedX }))
    expect(deep.push.z).toBeLessThan(0.002)
    expect(count(deep.ripples)).toBeGreaterThan(0)
    deep.update(1.6, visitor({ x: stoppedX + 0.14 }))
    expect(deep.push.z).toBeGreaterThan(0.5)
    deep.update(1.7, visitor({ x: stoppedX + 0.28, feetY: 0.1, airborne: true }))
    expect(deep.push.z).toBe(0)
    deep.update(1.8, null)
    expect(deep.push.z).toBe(0)
    expect(deep.flow.z).toBe(0)
    disposeObject3D(shallow.root)
    disposeObject3D(deep.root)
  })

  it('emits once on entry, leaves the impact in world space, then fades to still water', () => {
    const effect = createRiverWaterInteraction((x) => x > 0 ? 0.5 : 0, 0)
    effect.update(0, visitor({ x: -0.05, feetY: 0.02 }))
    effect.update(0.1, visitor({ x: 0.05 }))
    expect(count(effect.ripples)).toBe(1)
    const firstImpact = effect.ripples[0]!.clone()
    for (let i = 2; i < 10; i++) effect.update(i * 0.1, visitor({ x: 0.05 }))
    expect(count(effect.ripples)).toBe(1)
    expect(effect.ripples[0]).toEqual(firstImpact)
    expect(effect.root.children.some((mesh) => mesh.visible)).toBe(false)
    for (let i = 10; i <= 32; i++) effect.update(i * 0.1, visitor({ x: 0.05 }))
    expect(count(effect.ripples)).toBe(0)
    disposeObject3D(effect.root)
  })

  it('uses travelled stride distance, so 30 Hz and 120 Hz give the same alternating footsteps', () => {
    function walk(hz: number) {
      const effect = createRiverWaterInteraction(() => 0.5, 0)
      for (let frame = 0; frame <= hz * 2; frame++) {
        const time = frame / hz
        effect.update(time, visitor({ x: time }))
      }
      return effect
    }
    const slow = walk(30)
    const fast = walk(120)
    expect(count(slow.ripples)).toBe(2)
    expect(count(fast.ripples)).toBe(2)
    for (let i = 0; i < 2; i++) {
      expect(Math.abs(slow.ripples[i]!.x - fast.ripples[i]!.x)).toBeLessThan(0.04)
      expect(slow.ripples[i]!.y * slow.ripples[(i + 1) % 2]!.y).toBeLessThan(0)
    }
    disposeObject3D(slow.root)
    disposeObject3D(fast.root)
  })

  it('makes one stronger landing impact at water contact, with no duplicate on the riverbed', () => {
    const effect = createRiverWaterInteraction(() => 0.5, 0)
    effect.update(0, visitor())
    effect.update(0.1, visitor({ feetY: -0.2, airborne: true, verticalVelocity: 2 }))
    effect.update(0.2, visitor({ feetY: 0.05, airborne: true, verticalVelocity: 1 }))
    effect.update(0.3, visitor({ feetY: 0.02, airborne: true, verticalVelocity: -1 }))
    effect.update(0.4, visitor({ feetY: -0.1, airborne: true, verticalVelocity: -2 }))
    expect(count(effect.ripples)).toBe(1)
    expect(effect.ripples[0]!.w).toBeGreaterThan(1)
    effect.update(0.5, visitor())
    effect.update(0.6, visitor())
    expect(count(effect.ripples)).toBe(1)
    expect(effect.ripples[0]!.z).toBe(0.4)
    disposeObject3D(effect.root)
  })

  it('also responds to a short jump whose feet stay below the surface', () => {
    const effect = createRiverWaterInteraction(() => 0.5, 0)
    effect.update(0, visitor())
    effect.update(0.1, visitor({ feetY: -0.25, airborne: true, verticalVelocity: 1 }))
    effect.update(0.2, visitor({ feetY: -0.3, airborne: true, verticalVelocity: -1.2 }))
    effect.update(0.3, visitor())
    effect.update(0.4, visitor())
    expect(count(effect.ripples)).toBe(1)
    expect(effect.ripples[0]!.z).toBe(0.3)
    disposeObject3D(effect.root)
  })

  it('does not splash on dry land, initialization, reset, camera transitions or a resumed tab', () => {
    const effect = createRiverWaterInteraction((x) => x > 0 ? 0.5 : 0, 0)
    effect.update(0, visitor({ x: -2 }))
    effect.update(0.1, visitor({ x: -1.8 }))
    effect.update(0.2, visitor({ x: -1.6, airborne: true }))
    effect.update(0.3, visitor({ x: -1.6 }))
    expect(count(effect.ripples)).toBe(0)
    effect.update(0.4, visitor({ x: 4 })) // teleport into the reach
    effect.update(0.5, visitor({ x: 4 }))
    expect(count(effect.ripples)).toBe(0)
    effect.update(0.6, null)
    effect.update(0.7, visitor({ x: 5 }))
    effect.update(10, visitor({ x: 5.5 }))
    expect(count(effect.ripples)).toBe(0)
    disposeObject3D(effect.root)
  })

  it('keeps its pool bounded during a long run and suppresses spray outside the visible reach', () => {
    const water = createRiverWater(() => -0.5, () => 0, 0, 12)
    const material = water.material as ShaderMaterial
    const camera = new PerspectiveCamera()
    const ripples = material.uniforms.uVisitorRipples!.value as Vector4[]
    for (let frame = 0; frame <= 1200; frame++) {
      const time = frame / 60
      water.updateWater(time, false, camera, visitor({ x: Math.sin(time) * 6 }))
    }
    expect(count(ripples)).toBeGreaterThan(0)
    expect(ripples).toHaveLength(8)
    expect(water.children[0]!.children).toHaveLength(8)
    water.updateWater(21, false, camera, visitor({ x: 20 }))
    water.updateWater(21.1, false, camera, visitor({ x: 20.2 }))
    expect(count(ripples)).toBe(0)
    water.updateWater(22, false, camera, visitor({ z: 20 }))
    water.updateWater(22.1, false, camera, visitor({ z: 20.1 }))
    expect(count(ripples)).toBe(0)
    disposeObject3D(water)
  })

  it('retains a fixed waterline, honors reduced motion, and releases all effect resources', () => {
    const water = createRiverWater(() => -0.5, () => 0, 0, 12)
    const material = water.material as ShaderMaterial
    const camera = new PerspectiveCamera()
    water.updateWater(0, false, camera, visitor())
    for (let frame = 1; frame <= 9; frame++) {
      water.updateWater(frame * 0.1, false, camera, visitor({ x: frame * 0.1 }))
    }
    const sprays = water.children[0]!.children as Mesh[]
    expect(sprays.some((spray) => spray.visible)).toBe(true)
    const sprayMaterial = sprays[0]!.material as MeshBasicMaterial
    const disposeTexture = vi.spyOn(sprayMaterial.map!, 'dispose')
    const disposeGeometry = vi.spyOn(sprays[0]!.geometry, 'dispose')
    const disposeReflection = vi.spyOn(water.getRenderTarget(), 'dispose')
    water.updateWater(1, true, camera, visitor({ x: 1 }))
    expect(count(material.uniforms.uVisitorRipples!.value as Vector4[])).toBe(0)
    expect(sprays.every((spray) => !spray.visible)).toBe(true)
    expect(water.position.y).toBe(0)
    water.updateWater(1.1, false, camera, visitor({ x: 1.1 }))
    expect(count(material.uniforms.uVisitorRipples!.value as Vector4[])).toBe(0)
    disposeObject3D(water)
    expect(disposeTexture).toHaveBeenCalledOnce()
    expect(disposeGeometry).toHaveBeenCalledOnce()
    expect(disposeReflection).toHaveBeenCalledOnce()
  })
})
