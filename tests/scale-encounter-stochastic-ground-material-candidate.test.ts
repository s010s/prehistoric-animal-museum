import {
  MeshStandardMaterial,
  Texture,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from 'three'
import { applyScaleEncounterStochasticGroundMaterialCandidate } from '../src/viewer/scale-encounter-stochastic-ground-material-candidate'

function compileCandidate(material: MeshStandardMaterial) {
  const shader = {
    fragmentShader: `
varying vec3 vViewPosition;
void main() {
  vec4 diffuseColor = vec4( diffuse, opacity );
  #include <map_fragment>
  #include <roughnessmap_fragment>
  #include <normal_fragment_maps>
  #include <tonemapping_fragment>
  #include <fog_fragment>
}`,
    uniforms: {},
    vertexShader: `
varying vec3 vViewPosition;
void main() {
  #include <begin_vertex>
}`,
  } as unknown as WebGLProgramParametersWithUniforms
  material.onBeforeCompile(shader, {} as WebGLRenderer)
  return shader
}

describe('scale encounter stochastic ground material candidate', () => {
  it('uses one stochastic frame for all three PBR maps and stays opaque', () => {
    const material = new MeshStandardMaterial({
      alphaMap: new Texture(),
      depthWrite: false,
      opacity: 0.4,
      transparent: true,
    })

    applyScaleEncounterStochasticGroundMaterialCandidate(material, {
      physicalWidthMeters: 2,
    })
    const shader = compileCandidate(material)

    expect(material.transparent).toBe(false)
    expect(material.depthWrite).toBe(true)
    expect(material.opacity).toBe(1)
    expect(material.alphaMap).toBeNull()
    expect(shader.vertexShader).toContain(
      'vScaleEncounterGroundLocalPosition = position.xy',
    )
    expect(shader.vertexShader).toContain(
      'vScaleEncounterGroundLocalHeight = position.z',
    )
    expect(shader.vertexShader).toContain(
      'vScaleEncounterGroundSlope = sqrt',
    )
    expect(shader.fragmentShader.match(/texture2D\(map,/g)).toHaveLength(3)
    expect(shader.fragmentShader.match(/texture2D\(roughnessMap,/g)).toHaveLength(
      3,
    )
    // Both supported normal-map branches contain the same three reads; the
    // WebGL preprocessor retains only the active object- or tangent-space path.
    expect(shader.fragmentShader.match(/texture2D\(normalMap,/g)).toHaveLength(6)
    for (const suffix of ['A', 'B', 'C']) {
      expect(shader.fragmentShader).toContain(
        `scaleEncounterGroundFrame.uv${suffix}`,
      )
    }
    expect(shader.fragmentShader).toContain(
      'ScaleEncounterStochasticFrame scaleEncounterGroundFrame',
    )
    expect(shader.fragmentShader).toContain(
      'scaleEncounterResolveBiomeWeights(',
    )
    expect(shader.fragmentShader).toContain('float lowland = 1.0 - smoothstep')
    expect(shader.fragmentShader).toContain('float mossIsland =')
    expect(shader.fragmentShader).toContain(
      'mix(1.0, 0.78, scaleEncounterGroundBiomeWeights.z)',
    )
    expect(shader.fragmentShader).toContain('weights *= weights * weights')
    expect(shader.fragmentShader).toContain('scaleEncounterClearingMottle')
    expect(shader.fragmentShader).toContain('scaleEncounterDrainage')
    expect(shader.fragmentShader).toContain(
      'float scaleEncounterFocusFogFactor = smoothstep(',
    )
    expect(shader.fragmentShader).toContain(
      'scaleEncounterCameraFogFactor * scaleEncounterFocusFogFactor',
    )
    expect(shader.fragmentShader).toContain(
      'length(vScaleEncounterGroundLocalPosition)',
    )
    expect(shader.fragmentShader).toContain(
      '1.0 / projectionMatrix[1][1]',
    )
    expect(shader.fragmentShader).toContain(
      'projectionMatrix[1][1] / projectionMatrix[0][0]',
    )
    expect(shader.fragmentShader).toContain(
      'scaleEncounterPortraitOverviewAmount',
    )
    expect(shader.fragmentShader).toContain(
      'scaleEncounterFarEarthHue = mix(',
    )
    expect(shader.fragmentShader).toContain(
      'scaleEncounterDistantViewAmount * 0.92',
    )
    expect(shader.fragmentShader).not.toContain('diffuseColor.a *=')
    expect(shader.fragmentShader).not.toContain('discard')
    expect(shader.fragmentShader).not.toContain('0.431')
    expect(shader.fragmentShader).not.toContain('0.137')
    expect(shader.uniforms.uScaleEncounterGroundMetrics?.value).toEqual([
      2,
      7.5,
      720,
    ])
    expect(shader.uniforms.uScaleEncounterGroundNormalFade?.value).toEqual([
      58,
      148,
    ])
    expect(shader.uniforms.uScaleEncounterGroundPanoramaBlend?.value).toEqual([
      42,
      86,
    ])
    expect(shader.fragmentShader).not.toContain(
      '#define SCALE_ENCOUNTER_USE_PANORAMA_MATCH',
    )
    expect(material.customProgramCacheKey()).toContain(
      'stochastic-pbr-ground-v17-portrait-overview-earth|macro-map:0|dry-litter:0|panorama:0',
    )
  })

  it('adds one mipmapped dry-litter albedo domain without tripling the PBR stack', () => {
    const dryLitterAlbedoTexture = new Texture()
    const material = new MeshStandardMaterial()
    applyScaleEncounterStochasticGroundMaterialCandidate(material, {
      dryLitterAlbedoTexture,
      macroVariationStrength: 0.42,
      physicalWidthMeters: 2,
    })

    const shader = compileCandidate(material)
    expect(shader.fragmentShader).toContain(
      '#define SCALE_ENCOUNTER_USE_DRY_LITTER_ALBEDO',
    )
    expect(
      shader.fragmentShader.match(
        /texture2D\(\s*uScaleEncounterGroundDryLitterMap,/g,
      ),
    ).toHaveLength(3)
    expect(shader.uniforms.uScaleEncounterGroundDryLitterMap?.value).toBe(
      dryLitterAlbedoTexture,
    )
    // Base + dry albedo are stochastic (six fetches), while normal and
    // roughness remain one shared three-fetch stack each: 12 active fetches.
    expect(shader.fragmentShader.match(/texture2D\(map,/g)).toHaveLength(3)
    expect(shader.fragmentShader.match(/texture2D\(roughnessMap,/g)).toHaveLength(
      3,
    )
    expect(shader.fragmentShader).not.toContain(
      'uScaleEncounterGroundDryLitterNormalMap',
    )
    expect(material.customProgramCacheKey()).toContain('dry-litter:1')
  })

  it('accepts a unique authored control map over the stable procedural fallback', () => {
    const macroControlMap = new Texture()
    const material = new MeshStandardMaterial()
    applyScaleEncounterStochasticGroundMaterialCandidate(material, {
      macroControlMap,
      macroVariationStrength: 4,
      macroWorldSizeMeters: 18,
      normalFadeEndMeters: 8,
      normalFadeStartMeters: 3,
      physicalWidthMeters: 0.1,
      stochasticCellSizeMeters: 0.1,
    })

    const shader = compileCandidate(material)

    expect(shader.fragmentShader).toContain(
      '#define SCALE_ENCOUNTER_USE_MACRO_CONTROL_MAP',
    )
    expect(shader.fragmentShader).toContain(
      'mix(proceduralControl.rgb, authoredControl.rgb, authoredControl.a)',
    )
    expect(
      shader.uniforms.uScaleEncounterGroundMacroControlMap?.value,
    ).toBe(macroControlMap)
    expect(shader.uniforms.uScaleEncounterGroundMacroStrength?.value).toBe(0.6)
    expect(shader.uniforms.uScaleEncounterGroundMetrics?.value).toEqual([
      0.25,
      0.375,
      32,
    ])
    expect(shader.uniforms.uScaleEncounterGroundNormalFade?.value).toEqual([
      12,
      13,
    ])
    expect(material.customProgramCacheKey()).toContain('macro-map:1')
  })

  it('projection-matches distant RGB to the cached panorama while keeping opaque depth', () => {
    const panoramaTexture = new Texture()
    const material = new MeshStandardMaterial({
      alphaMap: new Texture(),
      depthWrite: false,
      opacity: 0.3,
      transparent: true,
    })
    applyScaleEncounterStochasticGroundMaterialCandidate(material, {
      panoramaBlendEndMeters: 160,
      panoramaBlendStartMeters: 72,
      panoramaTexture,
      physicalWidthMeters: 2,
    })

    const shader = compileCandidate(material)
    expect(shader.fragmentShader).toContain(
      '#define SCALE_ENCOUNTER_USE_PANORAMA_MATCH',
    )
    expect(shader.fragmentShader).toContain(
      'scaleEncounterProjectionMatchedPanorama()',
    )
    expect(shader.fragmentShader).toContain(
      'gl_FragColor.rgb = mix(',
    )
    expect(shader.fragmentShader.indexOf('#include <tonemapping_fragment>')).toBeLessThan(
      shader.fragmentShader.indexOf('gl_FragColor.rgb = mix('),
    )
    expect(shader.fragmentShader).toContain('viewMatrix')
    expect(shader.fragmentShader).toContain(
      'vec3 domeDirection = normalize(',
    )
    expect(shader.fragmentShader).not.toContain('cameraAlongRay')
    expect(shader.fragmentShader).toContain(
      'scaleEncounterHorizonNoise(localPosition / 47.0',
    )
    expect(shader.fragmentShader).toContain(
      'radialAmount * cameraDepthAmount',
    )
    expect(shader.fragmentShader).toContain(
      'length(vViewPosition)',
    )
    expect(shader.fragmentShader).toContain('-worldViewRay.y')
    expect(shader.fragmentShader).toContain(
      'return radialAmount * cameraDepthAmount * lookingDownAmount',
    )
    expect(shader.fragmentShader).toMatch(
      /cameraDepthAmount = smoothstep\(\s*72\.0,\s*148\.0,/,
    )
    expect(shader.fragmentShader).not.toContain('grazingAmount')
    expect(shader.fragmentShader).not.toContain('diffuseColor.a *=')
    expect(shader.fragmentShader).not.toContain('discard')
    expect(shader.uniforms.uScaleEncounterGroundPanoramaMap?.value).toBe(
      panoramaTexture,
    )
    expect(shader.uniforms.uScaleEncounterGroundPanoramaBlend?.value).toEqual([
      72,
      160,
    ])
    expect(material.transparent).toBe(false)
    expect(material.depthWrite).toBe(true)
    expect(material.customProgramCacheKey()).toContain('panorama:1')
  })

  it('is idempotent so a rebuilt D environment does not stack shader patches', () => {
    const material = new MeshStandardMaterial()
    applyScaleEncounterStochasticGroundMaterialCandidate(material, {
      physicalWidthMeters: 2,
    })
    applyScaleEncounterStochasticGroundMaterialCandidate(material, {
      physicalWidthMeters: 4,
    })
    const shader = compileCandidate(material)

    expect(
      shader.fragmentShader.match(/struct ScaleEncounterStochasticFrame/g),
    ).toHaveLength(1)
  })
})
