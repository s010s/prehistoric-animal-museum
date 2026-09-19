import { describe, expect, it, vi } from 'vitest'
import { AnimationClip, Group, Mesh, MeshBasicMaterial, BoxGeometry, NumberKeyframeTrack, PerspectiveCamera, Vector3 } from 'three'
import { loadFarCompanionTemplate, ownFarCompanionTemplate } from '../../src/flight-experience/living/companion-assets'
import type * as CompanionAssetModule from '../../src/flight-experience/living/companion-assets'
import { CompanionDirector, companionGeometryLod, planCompanionRoute, routePoint, segmentDistance } from '../../src/flight-experience/living/companion-director'
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
  it('detects an actor crossed between endpoints, including origin crossing',()=>{
    expect(segmentDistance({x:-30,y:0,z:0},{x:30,y:0,z:0},{x:0,y:0,z:0})).toBe(0)
    expect(segmentDistance({x:-30,y:30,z:0},{x:30,y:30,z:0},{x:0,y:0,z:0})).toBe(30)
  })
  it('freezes lifecycle during pause, rebases without world movement, and clears on generation/disable/disposal',()=>{
    const scene=new Group(),hero=new Group();hero.add(new Mesh(new BoxGeometry(),new MeshBasicMaterial()))
    const director=new CompanionDirector(scene,createWorldSampler(),hero,new AnimationClip('Idle',2,[]),()=>0)
    for(let i=0;i<40;i++)director.update(context({motionSeconds:i*.1}),{x:0,z:0})
    expect(director.metrics.near).toBe(1)
    const before=director.root.children[0]!.position.clone()
    for(let i=0;i<100;i++)director.update(context({active:false,delta:0,motionSeconds:4}),{x:512,z:-512})
    const after=director.root.children[0]!.position
    expect(after.x+512).toBeCloseTo(before.x);expect(after.z-512).toBeCloseTo(before.z);expect(after.y).toBe(before.y)
    director.update(context({generation:2}),{x:0,z:0});expect(director.metrics.near).toBe(0)
    for(let i=0;i<40;i++)director.update(context({generation:2}),{x:0,z:0})
    expect(director.metrics.near).toBe(1)
    director.update(context({generation:2,intent:{wind:false,companions:false}}),{x:0,z:0});expect(director.metrics.near).toBe(1)
    for(let i=0;i<65;i++)director.update(context({generation:2,intent:{wind:false,companions:false}}),{x:0,z:0})
    expect(director.metrics.near).toBe(0)
    director.dispose();director.dispose();expect(scene.children).toHaveLength(0)
  })
  it('suppresses a group when a new observation camera lands in its safety envelope and blocks rainy spawns',()=>{
    const scene=new Group(),hero=new Group();hero.add(new Mesh(new BoxGeometry(),new MeshBasicMaterial()))
    const director=new CompanionDirector(scene,createWorldSampler(),hero,new AnimationClip('Idle',2,[]),()=>0)
    for(let i=0;i<40;i++)director.update(context({weather:{...context().weather,resolved:{...context().weather.resolved,rain:.8}}}),{x:0,z:0})
    expect(director.metrics.near).toBe(0)
    director.update(context(),{x:0,z:0});expect(director.metrics.near).toBe(1)
    const position=director.root.children[0]!.position
    director.update(context({camera:{x:position.x,y:position.y,z:position.z}}),{x:0,z:0})
    expect(director.metrics.near).toBe(0);director.dispose()
  })
  it('continuously escapes a 36m/s player chase without entering its 25m envelope',()=>{
    const scene=new Group(),hero=new Group();hero.add(new Mesh(new BoxGeometry(),new MeshBasicMaterial()))
    const director=new CompanionDirector(scene,createWorldSampler(),hero,new AnimationClip('Idle',2,[]),()=>0)
    for(let i=0;i<40;i++)director.update(context(),{x:0,z:0})
    let player={x:0,y:190,z:0},minimum=Infinity
    for(let i=0;i<300&&director.metrics.near;i++){
      const p=director.root.children[0]!.position,dx=p.x-player.x,dy=p.y-player.y,dz=p.z-player.z,length=Math.hypot(dx,dy,dz)
      player={x:player.x+dx/length*3.6,y:player.y+dy/length*3.6,z:player.z+dz/length*3.6}
      director.update(context({player,camera:{x:player.x,y:player.y,z:player.z+10}}),{x:0,z:0})
      if(director.metrics.near){const q=director.root.children[0]!.position;minimum=Math.min(minimum,Math.hypot(q.x-player.x,q.y-player.y,q.z-player.z))}
    }
    expect(minimum).toBeGreaterThanOrEqual(25);expect(director.metrics.near).toBe(0);director.dispose()
  })

  it('turning companions off while paused removes the static actors immediately',()=>{
    const scene=new Group(),hero=new Group();hero.add(new Mesh(new BoxGeometry(),new MeshBasicMaterial()))
    const director=new CompanionDirector(scene,createWorldSampler(),hero,new AnimationClip('Idle',2,[]),()=>0)
    for(let i=0;i<40;i++)director.update(context(),{x:0,z:0})
    expect(director.metrics.near).toBe(1)
    director.update(context({active:false,delta:0,intent:{wind:false,companions:false}}),{x:0,z:0})
    expect(director.metrics.near).toBe(0);expect(director.metrics.status).toBe('off');director.dispose()
  })

  it('a failed far asset load stays degraded without frame-by-frame retries until explicit re-enable',async()=>{
    const loader=vi.mocked(loadFarCompanionTemplate),calls=loader.mock.calls.length
    loader.mockRejectedValueOnce(new Error('missing asset'))
    const scene=new Group(),hero=new Group();hero.add(new Mesh(new BoxGeometry(),new MeshBasicMaterial()))
    const director=new CompanionDirector(scene,createWorldSampler(),hero,new AnimationClip('Idle',2,[]),()=>0)
    director.update(context(),{x:0,z:0});await Promise.resolve()
    for(let i=0;i<100;i++)director.update(context(),{x:0,z:0})
    expect(director.metrics.status).toBe('degraded');expect(loader.mock.calls.length-calls).toBe(1)
    director.update(context({active:false,intent:{wind:false,companions:false}}),{x:0,z:0})
    director.update(context(),{x:0,z:0});expect(loader.mock.calls.length-calls).toBe(2);director.dispose()
  })
  it('reports and completes the six-effective-second quality departure budget transition',()=>{
    const scene=new Group(),hero=new Group();hero.add(new Mesh(new BoxGeometry(),new MeshBasicMaterial()))
    const director=new CompanionDirector(scene,createWorldSampler(),hero,new AnimationClip('Idle',2,[]),()=>0)
    for(let i=0;i<40;i++)director.update(context({quality:'balanced'}),{x:0,z:0})
    expect(director.metrics.near).toBe(2)
    director.update(context(),{x:0,z:0});expect(director.metrics.budgetTransition).toBe(true)
    expect(director.metrics.budgetTransitionMaxEffectiveSeconds).toBe(6)
    for(let i=0;i<65;i++)director.update(context(),{x:0,z:0})
    expect(director.metrics.near).toBe(1);expect(director.metrics.budgetTransition).toBe(false);director.dispose()
  })

  it('selects bounded projected-size LOD with hysteresis and no far-cohort promotion',()=>{
    expect(companionGeometryLod(true,160,'source',true)).toBe('far')
    expect(companionGeometryLod(true,80,'far',true)).toBe('source')
    expect(companionGeometryLod(true,120,'source',true)).toBe('source')
    expect(companionGeometryLod(true,120,'far',true)).toBe('far')
    expect(companionGeometryLod(false,50,'far',true)).toBe('far')
    expect(companionGeometryLod(true,160,'source',false)).toBe('source')
  })
  it('switches a near cohort between shared far and source geometry without changing its normalization or leaking a template reference',async()=>{
    const scene=new Group(),hero=new Group(),correction=new Group(),sourceGeometry=new BoxGeometry(),material=new MeshBasicMaterial()
    hero.position.set(.2,-.07,.1);hero.add(new Mesh(sourceGeometry,material));correction.scale.setScalar(6.8);correction.add(hero);scene.add(correction)
    const farRoot=new Group(),farGeometry=new BoxGeometry();farRoot.add(new Mesh(farGeometry,new MeshBasicMaterial()))
    hero.children[0]!.name='wing';farRoot.children[0]!.name='wing'
    const clip=new AnimationClip('Idle',2,[new NumberKeyframeTrack('wing.position[y]',[0,1,2],[0,1,0])]),library=ownFarCompanionTemplate(farRoot,clip,material)
    vi.mocked(loadFarCompanionTemplate).mockResolvedValueOnce(library)
    const director=new CompanionDirector(scene,createWorldSampler(),hero,clip,()=>0)
    director.update(context(),{x:0,z:0});await Promise.resolve()
    for(let i=0;i<40;i++)director.update(context({motionSeconds:i*.1}),{x:0,z:0})
    const wrapper=director.root.children[0]!,oldVisual=wrapper.children[0]!
    expect((oldVisual.children[0] as Mesh).geometry).toBe(farGeometry);expect(library.references).toBe(4)
    expect(wrapper.scale.x).toBeCloseTo(6.8);expect(oldVisual.position.toArray()).toEqual(hero.position.toArray())
    let camera={x:0,y:190,z:10}
    for(let i=0;i<30;i++){
      const target={x:wrapper.position.x+80,y:wrapper.position.y,z:wrapper.position.z}
      camera={x:camera.x+(target.x-camera.x)*.3,y:camera.y+(target.y-camera.y)*.3,z:camera.z+(target.z-camera.z)*.3}
      director.update(context({camera,motionSeconds:4+i*.1}),{x:0,z:0})
    }
    const visual=wrapper.children[0]!
    expect((visual.children[0] as Mesh).geometry).toBe(sourceGeometry)
    expect(visual.position.toArray()).toEqual(hero.position.toArray());expect(wrapper.scale.x).toBeCloseTo(6.8)
    const phase=(6.9*.7+(createWorldSampler().config.seed%101)*.73)%2
    expect(visual.children[0]!.position.y).toBeCloseTo(phase<1?phase:2-phase)
    expect(oldVisual.parent).toBeNull();expect(library.references).toBeLessThanOrEqual(3)
    director.dispose();expect(library.references).toBe(0)
  })

  it('holds a recognizable near companion inside the default 28m/s camera during parallel flight',()=>{
    const heading=.22,c=context({heading}),route=planCompanionRoute(89,true,c,()=>0,28)!
    const camera=new PerspectiveCamera(55,1.8224666142969363,.5,24000)
    camera.quaternion.set(-.15514407565764407,-.1084327744878713,-.017135015365026984,.9817734160454936)
    for(const age of [21,24,28,32]){
      const player={x:Math.sin(heading)*28*age,y:190,z:-Math.cos(heading)*28*age}
      camera.position.set(player.x-Math.sin(heading)*11,195,player.z+Math.cos(heading)*11);camera.updateMatrixWorld(true)
      const point=routePoint(route,age),projected=new Vector3(point.x,point.y,point.z).project(camera)
      expect(Math.abs(projected.x)).toBeLessThan(.9);expect(Math.abs(projected.y)).toBeLessThan(.8)
      expect(Math.hypot(point.x-player.x,point.y-player.y,point.z-player.z)).toBeGreaterThan(25)
    }
  })

})
