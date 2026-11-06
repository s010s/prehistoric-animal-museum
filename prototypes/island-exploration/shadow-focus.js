import { Vector3 } from 'three'

// Keep the existing 280 m coverage, light direction, bias and map budget.
// Only the projection's translation changes. Based on the production world's
// sun-tangent-plane snapping (environment-scene.ts).
export function makeShadowFocus(direction) {
  const vertical = new Vector3(0, Math.abs(direction.y) > .999 ? 0 : 1, Math.abs(direction.y) > .999 ? 1 : 0)
  const right = new Vector3().crossVectors(direction, vertical).normalize()
  const up = new Vector3().crossVectors(right, direction).normalize()
  const basisDirection = direction.clone()
  const focus = new Vector3()
  return {
    apply(light, camera, heightAt, stable) {
      if (!basisDirection.equals(direction) || !light.shadow.camera.up.equals(vertical)) {
        vertical.set(0, Math.abs(direction.y) > .999 ? 0 : 1, Math.abs(direction.y) > .999 ? 1 : 0)
        right.crossVectors(direction, vertical).normalize()
        up.crossVectors(right, direction).normalize()
        basisDirection.copy(direction)
        light.shadow.camera.up.copy(vertical)
      }
      if (stable) {
        focus.set(camera.position.x, Math.max(0, heightAt(camera.position.x, camera.position.z)), camera.position.z)
        const c = light.shadow.camera
        const tx = (c.right - c.left) / light.shadow.mapSize.x
        const ty = (c.top - c.bottom) / light.shadow.mapSize.y
        focus.addScaledVector(right, Math.round(focus.dot(right) / tx) * tx - focus.dot(right))
        focus.addScaledVector(up, Math.round(focus.dot(up) / ty) * ty - focus.dot(up))
      } else {
        const x = Math.round(camera.position.x / 8) * 8, z = Math.round(camera.position.z / 8) * 8
        focus.set(x, Math.max(0, heightAt(x, z)), z)
      }
      light.target.position.copy(focus)
      light.position.copy(focus).addScaledVector(direction, 650)
    },
    snapshot(light) {
      const c = light.shadow.camera
      const texel = [(c.right - c.left) / light.shadow.mapSize.x, (c.top - c.bottom) / light.shadow.mapSize.y]
      const grid = [focus.dot(right) / texel[0], focus.dot(up) / texel[1]]
      return { focus: focus.toArray(), texel, gridError: grid.map(v => Math.abs(v - Math.round(v))), mapSize: light.shadow.mapSize.toArray(), extent: [c.right - c.left, c.top - c.bottom] }
    },
  }
}
