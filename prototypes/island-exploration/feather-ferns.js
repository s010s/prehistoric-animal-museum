import * as THREE from 'three'

// A small, fully geometric temperate fern. No billboard, texture, or alpha
// sorting: paired pinnae follow five curved rachises in actual 3D space.
export function createFeatherFernParts({ seed = 1, fronds = 5, pairs = 8, leafletWidth = 1, spread = 1 } = {}) {
  fronds = Math.max(4, Math.min(6, Math.round(fronds)))
  pairs = Math.max(7, Math.min(18, Math.round(pairs)))
  let state = (seed | 0) || 1
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) | 0
    return (state >>> 0) / 4294967296
  }
  const positions = [], colors = []
  const green = new THREE.Color('#526a3b')
  const pale = new THREE.Color('#81906a')
  const dark = new THREE.Color('#344b30')
  const stem = new THREE.Color('#526049')
  const color = new THREE.Color()
  const point = (x, y, z) => new THREE.Vector3(x, y, z)
  function vertex(p, c) {
    positions.push(p.x, p.y, p.z)
    colors.push(c.r, c.g, c.b)
  }
  function triangle(a, b, c, ca, cb, cc) {
    vertex(a, ca); vertex(b, cb); vertex(c, cc)
  }

  for (let f = 0; f < fronds; f++) {
    const angle = (2 * Math.PI * (f + (random() - .5) * .62)) / fronds
    const radial = point(Math.cos(angle), 0, Math.sin(angle))
    const lateral = point(-Math.sin(angle), 0, Math.cos(angle))
    const reach = (.44 + random() * .23) * spread
    const rise = .50 + random() * .22
    const droop = .18 + random() * .12
    const startY = .025 + random() * .025
    const hue = (random() - .5) * .17
    const frondColor = green.clone().lerp(pale, Math.max(0, hue + .18))
    function rachis(t) {
      const radius = reach * (.18 * t + .82 * Math.sin(t * Math.PI / 2))
      const y = startY + rise * Math.sin(t * Math.PI * .72) - droop * t * t * t
      const bend = .09 * Math.sin(Math.PI * t * 1.3 + angle * 2) * t
      return point(radial.x * radius + lateral.x * bend, y,
                   radial.z * radius + lateral.z * bend)
    }

    // Narrow olive rachis ribbon, bent in 3D rather than a straight spoke.
    for (let j = 0; j <= pairs; j++) {
      const t0 = j / (pairs + 1), t1 = (j + 1) / (pairs + 1)
      const p0 = rachis(t0), p1 = rachis(t1)
      const w0 = .005 * (1 - t0) + .001, w1 = .005 * (1 - t1) + .001
      const a = p0.clone().addScaledVector(lateral, -w0)
      const b = p0.clone().addScaledVector(lateral, w0)
      const c = p1.clone().addScaledVector(lateral, w1)
      const d = p1.clone().addScaledVector(lateral, -w1)
      triangle(a, b, c, stem, stem, stem)
      triangle(a, c, d, stem, stem, stem)
    }

    // Opposing pinnae broaden near the middle, shorten toward crown and base,
    // and curl down at their outer tips. Three ribbon spans = 6 tris per pinna.
    for (let j = 0; j < pairs; j++) {
      const t = .13 + j * (.78 / (pairs - 1))
      const base = rachis(t)
      const taper = Math.pow(Math.sin(Math.PI * (j + 1) / (pairs + 1)), .73)
      const length = (.15 + random() * .075) * taper * (1 - .18 * t)
      for (const side of [-1, 1]) {
        const stagger = (random() - .5) * .022
        const stations = [0, .23, .49, .76, 1].map((u, k) => {
          const along = side * length * u
          const center = base.clone()
            .addScaledVector(lateral, along)
            .addScaledVector(radial, length * (.16 * u + .08 * u * u))
          center.y += stagger + length * (.10 * Math.sin(u*Math.PI) - .20 * u*u)
          const breadth = leafletWidth * length * [ .025, .105, .094, .061, .002 ][k]
          return [center.clone().addScaledVector(radial, -breadth),
                  center.clone().addScaledVector(radial, breadth)]
        })
        for (let s = 0; s < 4; s++) {
          const [a, b] = stations[s], [d, c] = stations[s + 1]
          const shade = (f * 7 + j * 3 + s) % 5 / 5
          const inner = dark.clone().lerp(frondColor, .68 + shade * .15)
          const outer = frondColor.clone().lerp(pale, .05 + .14 * s / 3)
          triangle(a, b, c, inner, outer, outer)
          triangle(a, c, d, inner, outer, inner)
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.name = 'feather-fern'
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  const box = geometry.boundingBox
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: .97,
    metalness: 0,
    side: THREE.DoubleSide,
    envMapIntensity: .48,
  })
  return {
    parts: [{ geometry, material }],
    height: box.max.y - box.min.y,
    width: Math.max(box.max.x - box.min.x, box.max.z - box.min.z),
    triangles: positions.length / 9,
  }
}
