import { Mesh, Texture, TextureLoader, ShaderLib, type MeshStandardMaterial, type WebGLRenderer } from 'three'
import { createMammothAcceptedSnowEnvironment } from '../src/scale-encounter/environments/glacier/mammoth-accepted-snow-environment'

it('keeps the active E snow normals and DEM valid until all corresponding images arrive', () => {
  const pending: { url: string; texture: Texture<HTMLImageElement>; loaded: ((texture: Texture<HTMLImageElement>) => void) | undefined }[] = []
  const loader = vi.spyOn(TextureLoader.prototype, 'load').mockImplementation((url, loaded) => {
    const texture = new Texture<HTMLImageElement>()
    pending.push({ url, texture, loaded })
    return texture
  })
  const environment = createMammothAcceptedSnowEnvironment()
  const compile = (material: MeshStandardMaterial) => {
    const shader = { uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader } as unknown as Parameters<MeshStandardMaterial['onBeforeCompile']>[0]
    material.onBeforeCompile(shader, {} as WebGLRenderer)
    return shader
  }
  try {
    const ground = environment.root.getObjectByName('scale-encounter-mammoth-continuous-snow-drifts') as Mesh
    const shader = compile(ground.material as MeshStandardMaterial)
    expect(shader.uniforms.uMammothSurfaceReady!.value).toBe(0)
    expect(shader.fragmentShader).toContain('uMammothSurfaceReady < .5 ? vec3(0., 0., 1.)')
    expect(shader.fragmentShader).toContain('mix(vec3(.73, .79, .81)')
    const surfaces = pending.filter(({ url }) => url.includes('surface-') || url.includes('snow-earth-patches'))
    expect(surfaces).toHaveLength(6)
    for (const image of surfaces.slice(0, 5)) image.loaded!(image.texture)
    expect(shader.uniforms.uMammothSurfaceReady!.value).toBe(0)
    surfaces[5]!.loaded!(surfaces[5]!.texture)
    expect(shader.uniforms.uMammothSurfaceReady!.value).toBe(1)
    let terrain!: MeshStandardMaterial
    environment.root.traverse((object) => {
      const mesh = object as Mesh
      if (object instanceof Mesh && !Array.isArray(mesh.material) && mesh.material.name === 'scale-encounter-real-dem-snow-mountain-material') terrain = object.material as MeshStandardMaterial
    })
    const dem = compile(terrain)
    expect(dem.uniforms.alpineHeightReady!.value).toBe(0)
    expect(dem.vertexShader).toContain('if (alpineHeightReady < .5) return 2537.59375')
  } finally { environment.dispose(); loader.mockRestore() }
})
