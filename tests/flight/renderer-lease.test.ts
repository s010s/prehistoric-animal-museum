import { expect, it, vi } from 'vitest'
import type { Color, Vector4, WebGLRenderer } from 'three'
import { rendererStateLease } from '../../src/viewer/external-experience'
it('restores every shadow global and exposure after the external scene releases', () => {
  const renderer = {
    getPixelRatio:()=>2,getViewport:(v:Vector4)=>v.set(0,0,1280,720),getScissor:(v:Vector4)=>v.set(0,0,1280,720),getScissorTest:()=>false,
    getRenderTarget:()=>null,getClearColor:(c:Color)=>c.set('#123456'),getClearAlpha:()=>1,
    toneMapping:4,toneMappingExposure:.9,outputColorSpace:'srgb',autoClear:true,
    shadowMap:{enabled:false,type:1,autoUpdate:false,needsUpdate:true},
    setPixelRatio:vi.fn(),setRenderTarget:vi.fn(),setViewport:vi.fn(),setScissor:vi.fn(),setScissorTest:vi.fn(),setClearColor:vi.fn(),
  }
  const release=rendererStateLease(renderer as unknown as WebGLRenderer)
  Object.assign(renderer.shadowMap,{enabled:true,type:2,autoUpdate:true,needsUpdate:false});renderer.toneMappingExposure=1.1
  release();release()
  expect(renderer.shadowMap).toEqual({enabled:false,type:1,autoUpdate:false,needsUpdate:true})
  expect(renderer.toneMappingExposure).toBe(.9);expect(renderer.setPixelRatio).toHaveBeenCalledTimes(1)
})
