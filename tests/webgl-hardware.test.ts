import {
  isHardwareWebGlRenderer,
  isSoftwareWebGlRenderer,
} from '../e2e/support/webgl-hardware'

describe('WebGL hardware gate', () => {
  it.each([
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)))',
    'llvmpipe (LLVM 17.0.6, 256 bits)',
    'Microsoft Basic Render Driver',
    'Software Rasterizer',
  ])('rejects software renderer %s', (renderer) => {
    expect(isSoftwareWebGlRenderer(renderer)).toBe(true)
    expect(isHardwareWebGlRenderer(renderer)).toBe(false)
  })

  it.each([
    'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)',
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11)',
    'ANGLE (Intel Inc., Intel Iris OpenGL Engine)',
    'AMD Radeon Pro 5500M OpenGL Engine',
  ])('accepts hardware renderer %s', (renderer) => {
    expect(isSoftwareWebGlRenderer(renderer)).toBe(false)
    expect(isHardwareWebGlRenderer(renderer)).toBe(true)
  })

  it.each(['', 'unavailable', 'ANGLE (Unknown Renderer)'])(
    'does not accept an unverified renderer %s',
    (renderer) => {
      expect(isHardwareWebGlRenderer(renderer)).toBe(false)
    },
  )
})
