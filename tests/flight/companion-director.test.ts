import { describe, expect, it, vi } from 'vitest'
import { AnimationClip, Group, Mesh, MeshBasicMaterial, BoxGeometry, PerspectiveCamera, Vector3 } from 'three'
import type * as CompanionAssetModule from '../../src/flight-experience/living/companion-assets'
import { CompanionDirector, planCompanionRoute, routePoint } from '../../src/flight-experience/living/companion-director'
import { createWorldSampler } from '../../src/flight-experience/world'
import { WeatherController } from '../../src/flight-experience/environment/weather-controller'
import type { LivingContext } from '../../src/flight-experience/living/living-context'
vi.mock('../../src/flight-experience/living/companion-assets',async importOriginal=>{
  const original = await importOriginal<typeof CompanionAssetModule>()
  return {...original,loadFarCompanionTemplate:vi.fn(()=>new Promise(()=>{}))}
})
function context(patch: Partial<LivingContext>={}): LivingContext {
  return {generation:1,active:true,delta:.1,motionSeconds:0,camera:{x:0,y:190,z:10},player:{x:0,y:190,z:0},heading:0,quality:'low',gentle:false,
    weather:new WeatherController().serialize(),intent:{wind:false,companions:true},...patch}
}
describe('bounded companion routes',()=>{
  it('respects a sampled terrain canopy floor, rejects unknown ground, and starts beyond both actors',()=>{
    const c=context(),route=planCompanionRoute(2,true,c,()=>250)!
    expect(route.start.y).toBeGreaterThanOrEqual(268)
    for(let i=0;i<100;i++)expect(routePoint(route,i).y).toBeGreaterThanOrEqual(268)
    expect(Math.hypot(route.start.x,route.start.z)).toBeGreaterThan(80)
    expect(planCompanionRoute(2,true,c,()=>NaN)).toBeNull()
  })
  it('freezes companions during pause and rebases without world movement',()=>{
    const scene=new Group(),hero=new Group();hero.add(new Mesh(new BoxGeometry(),new MeshBasicMaterial()))
    const director=new CompanionDirector(scene,createWorldSampler(),hero,new AnimationClip('Idle',2,[]),()=>0)
    for(let i=0;i<40;i++)director.update(context({motionSeconds:i*.1}),{x:0,z:0})
    const before=director.root.children[0]!.position.clone()
    for(let i=0;i<100;i++)director.update(context({active:false,delta:0,motionSeconds:4}),{x:512,z:-512})
    const after=director.root.children[0]!.position
    expect(after.x+512).toBeCloseTo(before.x);expect(after.z-512).toBeCloseTo(before.z);expect(after.y).toBe(before.y)
    director.dispose()
  })

  it('holds a recognizable near companion inside the default 28m/s camera during parallel flight',()=>{
    const heading=.22,c=context({heading}),route=planCompanionRoute(89,true,c,()=>0,28)!
    const camera=new PerspectiveCamera(55,1.8224666142969363,.5,24000)
    camera.quaternion.set(-.15514407565764407,-.1084327744878713,-.017135015365026984,.9817734160454936)
    for(const age of [32,36,40,48]){
      const player={x:Math.sin(heading)*28*age,y:190,z:-Math.cos(heading)*28*age}
      camera.position.set(player.x-Math.sin(heading)*11,195,player.z+Math.cos(heading)*11);camera.updateMatrixWorld(true)
      const point=routePoint(route,age),projected=new Vector3(point.x,point.y,point.z).project(camera)
      expect(Math.abs(projected.x)).toBeLessThan(.9);expect(Math.abs(projected.y)).toBeLessThan(.8)
      expect(Math.hypot(point.x-player.x,point.y-player.y,point.z-player.z)).toBeGreaterThan(25)
    }
  })

})
