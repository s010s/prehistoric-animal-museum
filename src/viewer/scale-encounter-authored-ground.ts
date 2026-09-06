import { Color, ShaderChunk, type MeshStandardMaterial, type Texture } from 'three'

/** One authored colour plate for the clearing; scans supply only close grain.
 * UVs are continuous in world space, so there are no randomized tile borders
 * or camera-relative projections to shimmer when the camera moves.
 */
export function applyAuthoredGroundMaterial(
  material: MeshStandardMaterial,
  options: {
    readonly colourMap: Texture
    readonly widthMeters: number
    readonly detailMeters: number
    readonly farColour: string
    readonly grainStrength?: number
    readonly colourMipLevel?: number
  },
): void {
  const previous = material.onBeforeCompile.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer)
    shader.uniforms.uGroundColourPlate = { value: options.colourMap }
    shader.uniforms.uGroundPlateWidth = { value: options.widthMeters }
    shader.uniforms.uGroundDetailWidth = { value: options.detailMeters }
    shader.uniforms.uGroundFarColour = { value: new Color(options.farColour) }
    shader.uniforms.uGroundGrain = { value: options.grainStrength ?? 0.85 }
    shader.uniforms.uGroundColourMip = { value: options.colourMipLevel ?? 6 }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAuthoredGroundWorld;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vAuthoredGroundWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vAuthoredGroundWorld;
uniform sampler2D uGroundColourPlate;
uniform float uGroundPlateWidth;
uniform float uGroundDetailWidth;
uniform vec3 uGroundFarColour;
uniform float uGroundGrain;
uniform float uGroundColourMip;

vec2 groundOffset(vec2 cell) {
  return fract(sin(vec2(dot(cell, vec2(127.1, 311.7)), dot(cell, vec2(269.5, 183.3)))) * 43758.5453);
}
// Three offset samples share a triangular blend. Texture derivatives are
// taken before the offsets, keeping mip selection stable at cell boundaries.
vec4 sampleGroundScan(sampler2D source, vec2 uv) {
  vec2 grid = mat2(1.0, 0.0, -.57735027, 1.15470054) * uv * 3.46410162;
  vec2 cell = floor(grid);
  vec2 f = fract(grid);
  vec2 a = cell;
  vec2 b = cell + vec2(1.0, 0.0);
  vec2 c = cell + vec2(0.0, 1.0);
  vec3 weights = vec3(1.0 - f.x - f.y, f.x, f.y);
  if (f.x + f.y > 1.0) {
    a = cell + 1.0;
    weights = vec3(f.x + f.y - 1.0, 1.0 - f.y, 1.0 - f.x);
  }
  vec2 dx = dFdx(uv);
  vec2 dy = dFdy(uv);
  return textureGrad(source, uv + groundOffset(a), dx, dy) * weights.x
       + textureGrad(source, uv + groundOffset(b), dx, dy) * weights.y
       + textureGrad(source, uv + groundOffset(c), dx, dy) * weights.z;
}`)
      .replace('#include <map_fragment>', `
vec2 groundDetailUv = vec2(vAuthoredGroundWorld.x, -vAuthoredGroundWorld.z) / uGroundDetailWidth;
vec2 groundPlateUv = vec2(vAuthoredGroundWorld.x, -vAuthoredGroundWorld.z) / uGroundPlateWidth + 0.5;
float groundDistance = distance(cameraPosition, vAuthoredGroundWorld);
float groundDetailFade = 1.0 - smoothstep(18.0, 58.0, groundDistance);
float groundGrainFade = 1.0 - smoothstep(60.0, 200.0, groundDistance);
float groundPlateFade = 1.0 - smoothstep(0.34, 0.50, length(vAuthoredGroundWorld.xz) / uGroundPlateWidth);
vec3 groundColour = mix(uGroundFarColour, textureLod(uGroundColourPlate, groundPlateUv, uGroundColourMip).rgb, groundPlateFade * .45);
#ifdef USE_MAP
float groundGrain = dot(sampleGroundScan(map, groundDetailUv).rgb, vec3(0.2126, 0.7152, 0.0722));
groundColour *= mix(1.0, clamp(groundGrain / .24, .35, 2.0), uGroundGrain * groundGrainFade);
#endif
diffuseColor.rgb *= groundColour;`)
      .replace('#include <roughnessmap_fragment>', `
float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
roughnessFactor *= 0.88 + 0.12 * sampleGroundScan(roughnessMap, groundDetailUv).g;
#endif`)
      .replace('#include <normal_fragment_maps>', ShaderChunk.normal_fragment_maps
        .replaceAll('texture2D( normalMap, vNormalMapUv )', 'sampleGroundScan( normalMap, groundDetailUv )')
        .replace('mapN.xy *= normalScale;', `
mapN = normalize(mapN);
mapN.xy *= normalScale * groundDetailFade;`))
      // Three r185 rotates its five PCF taps using screen-pixel noise. A fixed
      // kernel on the ground avoids crawling shadow grain during walking.
      .replace('#include <shadowmap_pars_fragment>', ShaderChunk.shadowmap_pars_fragment
        .replace('interleavedGradientNoise( gl_FragCoord.xy ) * PI2', '0.0'))
  }
  material.customProgramCacheKey = () => 'authored-ground-plate-v3'
  material.userData.authoredGround = { widthMeters: options.widthMeters, repeats: false }
}
