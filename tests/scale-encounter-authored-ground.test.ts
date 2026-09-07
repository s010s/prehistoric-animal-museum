import {
  MeshStandardMaterial,
  ShaderLib,
  Texture,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from 'three'
import { applyAuthoredGroundMaterial } from '../src/viewer/scale-encounter-authored-ground'

it('patches both Three normal-map branches and retains the standard roughness declaration', () => {
  const material = new MeshStandardMaterial({ normalMap: new Texture() })
  applyAuthoredGroundMaterial(material, {
    colourMap: new Texture(), widthMeters: 96, detailMeters: 1.6, farColour: '#50432f',
  })
  const shader = {
    ...ShaderLib.standard,
    uniforms: {},
  } as WebGLProgramParametersWithUniforms
  material.onBeforeCompile(shader, {} as WebGLRenderer)

  // Three has object-space and tangent-space samples in the same chunk.
  // Replacing only the first left the active tangent-space floor stretched.
  expect(shader.fragmentShader).not.toContain('texture2D( normalMap, vNormalMapUv )')
  expect(shader.fragmentShader.match(/sampleGroundScan\( normalMap, groundDetailUv \)/g)).toHaveLength(2)
  expect(shader.fragmentShader).toContain('float roughnessFactor = roughness;')
  expect(shader.fragmentShader).toContain('float phi = 0.0;')
  expect(shader.fragmentShader).toContain('textureGrad(source, uv + groundOffset(a), dx, dy)')
})
