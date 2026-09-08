import { PerspectiveCamera, type Vector3 } from 'three'
import { createSkyCloudPlan, createSkyCloudVolume, SKY_CLOUD_COUNT, SKY_CLOUD_DENSITY_BYTES } from '../src/scale-encounter/environments/sky/sky-cloud-volumes'

describe('random spatial cloud volumes', () => {
  it('varies layout and dimensions between scenes while replaying a supplied seed', () => {
    expect(createSkyCloudPlan(9)).toEqual(createSkyCloudPlan(9))
    expect(createSkyCloudPlan(9)).not.toEqual(createSkyCloudPlan(10))
    for (let seed = 1; seed <= 16; seed++) {
      const plan = createSkyCloudPlan(seed)
      expect(plan).toHaveLength(SKY_CLOUD_COUNT)
      expect(plan.filter((cloud) => cloud.distant)).toHaveLength(20)
      const widths = plan.map((cloud) => cloud.size[0])
      expect(Math.max(...widths) / Math.min(...widths)).toBeGreaterThan(2.4)
      expect(new Set(plan.map((cloud) => cloud.position[1])).size).toBe(SKY_CLOUD_COUNT)
      expect(new Set(plan.map((cloud) => cloud.seed)).size).toBe(SKY_CLOUD_COUNT)
      for (const cloud of plan) {
        if (cloud.distant) {
          expect(Math.hypot(cloud.position[0], cloud.position[2])).toBeGreaterThanOrEqual(260)
          expect(Math.hypot(cloud.position[0], cloud.position[2])).toBeLessThanOrEqual(620)
        }
        expect(Math.hypot(cloud.position[0], cloud.position[2])).toBeGreaterThanOrEqual(65)
        expect(cloud.position[1] + cloud.size[1] / 2).toBeLessThan(-12)
        expect(cloud.position[1] - cloud.size[1] / 2).toBeGreaterThan(-60)
      }
    }
  })

  it('bakes distinct bounded density fields and keeps world shape fixed as the camera moves', () => {
    const plan = createSkyCloudPlan(87)
    const first = createSkyCloudVolume(plan[0]!, 0)
    const second = createSkyCloudVolume(plan[1]!, 1)
    expect(first.density.image.data).not.toEqual(second.density.image.data)
    expect(first.density.image.data!.byteLength).toBe(SKY_CLOUD_DENSITY_BYTES)
    expect(first.density.image.data!.some((value) => value > 180)).toBe(true)
    const camera = new PerspectiveCamera()
    first.update(0, camera)
    const before = first.object.matrixWorld.clone()
    const rotation = first.object.quaternion.clone()
    camera.position.set(8, 4, -12)
    camera.lookAt(0, -20, 0)
    first.update(0, camera)
    expect(first.object.matrixWorld.equals(before)).toBe(true)
    expect(first.object.quaternion.equals(rotation)).toBe(true)
    const eye = first.material.uniforms.uEye!.value as Vector3
    expect(eye.distanceTo(first.object.worldToLocal(camera.position.clone()))).toBeLessThan(1e-6)
    first.update(60, camera)
    expect(first.object.position.x - plan[0]!.position[0]).toBeCloseTo(plan[0]!.speed * 60)
    expect(first.object.position.y).toBe(plan[0]!.position[1])
    for (const cloud of [first, second]) {
      cloud.density.dispose(); cloud.material.dispose(); cloud.object.geometry.dispose()
    }
  })
})
