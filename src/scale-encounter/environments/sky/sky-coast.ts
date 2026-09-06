import { Color, Group, Mesh, ShaderChunk, type BufferGeometry, type MeshStandardMaterial, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { SKY_REFERENCE_Y_METERS } from './sky-contract'

let templatePromise: Promise<Group> | null = null

export function loadSkyCoastTemplate(): Promise<Group> {
  templatePromise ??= new GLTFLoader().loadAsync(new URL(
    '../../assets/environments/island-landforms-v2.glb', import.meta.url,
  ).href).then((gltf) => gltf.scene).catch((error: unknown) => {
    templatePromise = null
    throw error
  })
  return templatePromise
}

/** Fixed world-space islands. The colour plates include individual woodland,
 * limestone and beaches; the authored meshes rise continuously from the shore.
 * The sea geometry stays at its reference level, below every land vertex.
 */
export function createSkyCoast(template?: Object3D | null): Group {
  const root = new Group()
  root.name = 'distant-vegetated-coast'
  const islands = [
    ['woodland-island', -26, 4.4, 0.13, 0.35],
    ['cove-island', -8.5, -17.4, 0.15, -0.62],
    ['cove-island', -145, -265, 1.65, 1.48],
  ] as const
  for (const [name, x, z, scale, yaw] of islands) {
    const source = template?.getObjectByName(name)
    if (!source) continue
    const island = source.clone(true)
    island.name = `sky-${name}`
    island.traverse((object) => {
      if (!(object instanceof Mesh)) return
      const mesh = object as Mesh<BufferGeometry, MeshStandardMaterial | MeshStandardMaterial[]>
      mesh.geometry = mesh.geometry.clone()
      const cloneMaterial = (material: MeshStandardMaterial) => {
        const copy = material.clone()
        copy.alphaToCoverage = true
        copy.envMapIntensity = 0.6
        copy.onBeforeCompile = (shader) => {
          shader.uniforms.uCoastHaze = { value: new Color('#80afbc') }
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vCoastWorld;')
            .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvCoastWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;')
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vCoastWorld;\nuniform vec3 uCoastHaze;')
            .replace('#include <map_fragment>', ShaderChunk.map_fragment
              .replace('texture2D( map, vMapUv )', 'texture2D( map, vMapUv, 1.8 )'))
            .replace('#include <tonemapping_fragment>', `
float coastDistance = distance(cameraPosition, vCoastWorld);
float aerialPerspective = .24 + smoothstep(60.0, 450.0, coastDistance) * .34;
gl_FragColor.rgb = mix(gl_FragColor.rgb, uCoastHaze, aerialPerspective);
#include <tonemapping_fragment>`)
        }
        copy.customProgramCacheKey = () => 'coast-aerial-perspective-v3'
        return copy
      }
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(cloneMaterial)
        : cloneMaterial(mesh.material)
    })
    island.position.set(x, SKY_REFERENCE_Y_METERS + 0.12, z)
    island.rotation.y = yaw
    island.scale.set(scale, scale * 1.3, scale)
    root.add(island)
  }
  root.userData.assetRepresentation = 'unique-generated-colour-plates-on-authored-continuous-landforms'
  root.userData.localReview = '2026-09-05'
  return root
}
