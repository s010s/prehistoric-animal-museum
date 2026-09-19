import type { Material, Color, Vector3 } from 'three'

const decorated = new WeakSet<Material>()

/** Art-directed sunset edge light on the staged flight animal only.
 * Uses the skinned, normal-mapped view normal and the actual world solar direction.
 * Retains the original material, textures, animation and existing compile hooks.
 */
export function decorateAnimalRim(material: Material, uniforms: {
  animalRim: { value: number }; sunDirection: { value: Vector3 }; sunColor: { value: Color }
}) {
  if (decorated.has(material)) return
  decorated.add(material)
  const compile = material.onBeforeCompile.bind(material)
  const cacheKey = material.customProgramCacheKey.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    compile(shader, renderer)
    // Environment fog supplies these same uniforms and declarations.
    Object.assign(shader.uniforms, uniforms)
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float animalRim;').replace('#include <opaque_fragment>', `
      vec3 rimView=normalize(vViewPosition);
      vec3 rimSun=normalize(mat3(viewMatrix)*sunDirection);
      float rimEdge=pow(1.-abs(dot(normal,rimView)),3.5);
      float rimFacing=smoothstep(-.08,.55,dot(normal,rimSun));
      float rimSunset=1.-smoothstep(.10,.36,sunDirection.y);
      outgoingLight+=vec3(1.,.48,.12)*rimEdge*rimFacing*rimSunset*.65*animalRim*cloudTransmission(flightWorldPoint(flightFogView),sunDirection);
      #include <opaque_fragment>
    `)
  }
  material.customProgramCacheKey = () => `${cacheKey()}:flight-animal-rim-v1`
  material.needsUpdate = true
}
