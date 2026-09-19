import { describe, expect, it, vi } from 'vitest'
import { PerspectiveCamera, Scene, Vector3 } from 'three'
import { EnvironmentScene } from '../../src/flight-experience/environment/environment-scene'
import { sampleEnvironment, sampleSky } from '../../src/flight-experience/environment/environment-state'
import { envelopeOrigin, waveComponents, OCEAN_WAVES } from '../../src/flight-experience/environment/ocean-waves'
import { BathymetryField,decodeHeight,encodeHeight, DEPTH_SIZE } from '../../src/flight-experience/environment/bathymetry'
import { terrainAt, coastAt, shorelineAt } from '../../src/flight-experience/world'
describe('shared linear environment',()=>{
  it('has normalized world sun and deterministic linear skies in four looks',()=>{
    for(const preset of ['morning','noon','afternoon','evening'] as const){const f=sampleEnvironment(preset,10)
      expect(Math.hypot(...f.sunDirectionWorld)).toBeCloseTo(1,12)
      expect(sampleSky(f,[0,0,-1])).toEqual(f.horizon)
      sampleSky(f,[0,1,0]).forEach((v,i)=>expect(v).toBeCloseTo(f.skyZenith[i]!,12))
      expect(sampleEnvironment(preset,10)).toEqual(f)
      expect(f.sunDirectionWorld).toEqual(sampleEnvironment(preset,1000).sunDirectionWorld)
    }
  })
  it('keeps all six wind constrained waves phase continuous across large positive and negative origins',()=>{
    for(const origin of [{x:8192,z:-8192},{x:-16384,z:24576}]){
      const local={x:36,z:-54},a=waveComponents([.91,.41],origin,123),b=waveComponents([.91,.41],{x:0,z:0},123)
      a.forEach((w,i)=>{const other=b[i]!
        expect(Math.sin(local.x*w.x+local.z*w.z+w.phase)).toBeCloseTo(Math.sin((local.x+origin.x)*other.x+(local.z+origin.z)*other.z+other.phase),10)
        expect(w.phase).toBeGreaterThanOrEqual(0);expect(w.phase).toBeLessThan(Math.PI*2)
      })
    }
    expect(new Set(OCEAN_WAVES.map(w=>w.length)).size).toBe(6)
  })
  it('packs signed heights with at most 1.6cm quantization error without float texture support',()=>{
    for(let h=-128;h<=896;h+=.273)expect(Math.abs(decodeHeight(...encodeHeight(h))-h)).toBeLessThan(.016)
  })
  it('publishes complete padded fields with a 520 query/frame bound and does not poll unchanged world data',()=>{
    const field=new BathymetryField();let height=-3
    for(let i=0;i<33;i++)expect(field.update(0,0,()=>height,Infinity)).toBeLessThanOrEqual(520)
    expect(field.revision).toBe(1);expect(field.data.length).toBe(DEPTH_SIZE*DEPTH_SIZE*4)
    expect(decodeHeight(field.data[0]!,field.data[1]!)).toBeCloseTo(-3,1)
    height=2
    for(let i=0;i<63;i++)field.update(0,0,()=>height,Infinity)
    expect(field.revision).toBe(1);expect(decodeHeight(field.data[0]!,field.data[1]!)).toBeCloseTo(-3,1)
  })
  it('samples the actual shoreline, not the nominal coast function',()=>{
    const z=350;let low=coastAt(z)-200,high=coastAt(z)+400
    for(let i=0;i<50;i++){const mid=(low+high)/2;if(terrainAt(mid,z).height<-.7)low=mid;else high=mid}
    // The estuary can move the coastline; compare the independent sea-level solve.
    expect(high).toBeCloseTo(shorelineAt(z),4)
    expect(high-coastAt(z)).toBeGreaterThan(50)
    const x0=Math.floor(high/8)*8,h0=terrainAt(x0,z).height,h1=terrainAt(x0+8,z).height
    const interpolated=x0+(-.7-h0)/(h1-h0)*8
    expect(Math.abs(interpolated-high)).toBeLessThan(.5)
  })
  it('keeps sunlight and shadow direction independent of heading and floating origin and disposes its lease',()=>{
    const scene=new Scene(),camera=new PerspectiveCamera(50,1.6,1,4000),env=new EnvironmentScene(scene,()=>-80)
    camera.position.set(100,230,-50);env.update(camera,{x:0,z:0},10,'low','morning')
    const direction=env.sun.position.clone().sub(env.sun.target.position).normalize(),position=env.sun.position.clone()
    camera.rotateY(2.4);env.update(camera,{x:0,z:0},10,'low','morning')
    expect(env.sun.position.distanceTo(position)).toBeLessThan(1e-8)
    camera.position.x-=8192;camera.position.z+=8192
    env.update(camera,{x:8192,z:-8192},10,'low','morning')
    expect(env.sun.position.clone().add(new Vector3(8192,0,-8192)).distanceTo(position)).toBeLessThan(1e-8)
    expect(env.sun.position.clone().sub(env.sun.target.position).normalize().distanceTo(direction)).toBeLessThan(1e-8)
    expect(env.metrics.shadowMapSize).toBe(1024);env.dispose();expect(scene.children).toHaveLength(0)
  })

  it('yields bathymetry work by elapsed budget while retaining unpublished work',()=>{
    let now=0
    const spy=vi.spyOn(performance,'now').mockImplementation(()=>now)
    try {
      const field=new BathymetryField()
      const query=()=>{now+=.1;return -5}
      expect(field.update(0,0,query,1)).toBe(16)
      expect(field.revision).toBe(0)
      for(let i=0;i<1100&&field.revision===0;i++)expect(field.update(0,0,query,1)).toBeLessThanOrEqual(16)
      expect(field.revision).toBe(1)
      expect(decodeHeight(field.data[0]!,field.data[1]!)).toBeCloseTo(-5,1)
    } finally {spy.mockRestore()}
  })

  it('keeps envelope lattice coordinates invariant modulo its 8192m period across rebases',()=>{
    const mod=(n:number)=>((n%8192)+8192)%8192
    for(const origin of [{x:8192,z:-8192},{x:-16384,z:24576},{x:12345,z:-98765}]){
      const bounded=envelopeOrigin(origin),logical=[origin.x+36,origin.z-54]
      expect(mod(bounded[0]+36)).toBeCloseTo(mod(logical[0]!),10)
      expect(mod(bounded[1]-54)).toBeCloseTo(mod(logical[1]!),10)
      bounded.forEach(v=>{expect(v).toBeGreaterThanOrEqual(0);expect(v).toBeLessThan(8192)})
    }
  })

})
