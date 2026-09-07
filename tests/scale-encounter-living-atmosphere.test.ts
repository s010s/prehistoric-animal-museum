import { Group, Mesh, PerspectiveCamera, Points, Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { createLivingAtmosphere } from '../src/viewer/scale-encounter-living-atmosphere'

describe('living habitat atmosphere', () => {
  it('has distinct bounded populations, leaves open air clear, and disposes GPU resources', () => {
    for (const [habitat, snow, count] of [['land', true, 1800], ['land', false, 480], ['water', false, 160], ['air', false, 0]] as const) {
      const atmosphere = createLivingAtmosphere(habitat, snow)
      const owner = new Group(); owner.add(atmosphere.root)
      const disposers = atmosphere.root.children.flatMap((child) => child instanceof Points || child instanceof Mesh
        ? [vi.spyOn(child.geometry, 'dispose'), vi.spyOn(child.material, 'dispose')] : [])
      expect(atmosphere.particleCount).toBe(count)
      if (habitat === 'air' || habitat === 'land') expect(atmosphere.root.getObjectByName('scale-encounter-canopy-sunbeam')).toBeUndefined()
      atmosphere.dispose()
      expect(owner.children).toHaveLength(0)
      expect(disposers.every((spy) => spy.mock.calls.length === 1)).toBe(true)
    }
  })

  it('reduces density under sustained slow frames and recovers cautiously with fixed buffers', () => {
    const atmosphere = createLivingAtmosphere('land', true)
    const particles = atmosphere.root.getObjectByName('scale-encounter-snow-drift') as Points
    const positions = particles.geometry.getAttribute('position')
    let t = 0
    atmosphere.update(t, false)
    for (let i = 0; i < 450; i++) atmosphere.update(t += 1 / 30, false)
    expect(atmosphere.particleCount).toBeLessThan(800)
    expect(atmosphere.particleCount).toBeGreaterThanOrEqual(700)
    for (let i = 0; i < 2400; i++) atmosphere.update(t += 1 / 60, false)
    expect(atmosphere.particleCount).toBeGreaterThan(2600)
    expect(atmosphere.particleCount).toBeLessThanOrEqual(2800)
    expect(particles.geometry.getAttribute('position')).toBe(positions)
    expect(particles.geometry.drawRange.count).toBeLessThanOrEqual(2800)
    const beforePause = atmosphere.particleCount
    atmosphere.update(t + 900, false)
    expect(atmosphere.particleCount).toBe(beforePause)
    atmosphere.dispose()
  })

  it('pauses without time jumps, caps tab-resume deltas, and keeps weather out of the close lens', () => {
    const atmosphere = createLivingAtmosphere('land', true, () => 2)
    const camera = new PerspectiveCamera()
    camera.position.set(4, 3.1, 8)
    atmosphere.update(100, false, camera)
    atmosphere.update(100.1, false, camera)
    expect(atmosphere.timeSeconds).toBeCloseTo(.1)
    atmosphere.update(500, true, camera)
    const particles = atmosphere.root.getObjectByName('scale-encounter-snow-drift') as Points
    expect(particles.visible).toBe(false)
    atmosphere.update(501, false, camera)
    expect(atmosphere.timeSeconds).toBeCloseTo(.2)
    atmosphere.settleFoot(new Vector3(1, 0, 2))
    atmosphere.update(501.1, false, camera)
    const puff = atmosphere.root.getObjectByName('scale-encounter-soft-foot-settle') as Mesh
    expect(puff.position.y).toBeCloseTo(2.12)
    expect(puff.visible).toBe(true)
    for (let i = 2; i < 25; i++) atmosphere.update(501 + i * .1, false, camera)
    expect(puff.visible).toBe(false)
    atmosphere.dispose()
  })
})
