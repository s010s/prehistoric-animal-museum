import { describe, it, expect } from 'vitest'
import { sampleEnvironment, sampleSky } from '../../src/flight-experience/environment/environment-state'
describe('continuous E1 sunlight in a single frame',()=>{
 it('is deterministic, finite, normalized and continuous across all daylight values',()=>{
  let previous=sampleEnvironment(.08,12,'sunset-bay')
  for(let p=.08;p<=.94;p+=.001){
   const f=sampleEnvironment(p,12,'sunset-bay',2)
   expect(f).toEqual(sampleEnvironment(p,12,'sunset-bay',2));expect(Math.hypot(...f.sunDirectionWorld)).toBeCloseTo(1,12)
   expect(Math.hypot(...f.sunDirectionWorld.map((v,i)=>v-previous.sunDirectionWorld[i]!))).toBeLessThan(.02)
   for(const values of [f.sunColor,f.skyZenith,f.horizon]) for(const v of values){expect(Number.isFinite(v)).toBe(true);expect(v).toBeGreaterThanOrEqual(0)}
   expect(f.motionSeconds).toBe(12);expect(f.revision).toBe(2);previous=f
  }
 })
 it('uses a warm horizon and a cool zenith without discontinuous colour bands',()=>{
  const f=sampleEnvironment('evening',0,'sunset-bay'),h=sampleSky(f,[0,0,-1]),z=sampleSky(f,[0,1,0])
  expect(h[0]).toBeGreaterThan(h[2]);expect(z[2]).toBeGreaterThan(z[0])
  let previous=sampleSky(f,[0,0,-1])
  for(let y=.001;y<1;y+=.001){const c=sampleSky(f,[0,y,-Math.sqrt(1-y*y)]);expect(Math.hypot(...c.map((v,i)=>v-previous[i]!))).toBeLessThan(.018);previous=c}
 })
 it('bounds invalid solar and motion input without nighttime wrapping',()=>{
  for(const p of [-Infinity,Infinity,NaN,-20,20]){
   const f=sampleEnvironment(p,NaN,'sunset-bay');expect(f.dayProgress).toBeGreaterThanOrEqual(.08);expect(f.dayProgress).toBeLessThanOrEqual(.94);expect(f.motionSeconds).toBe(0)
   expect(Math.hypot(...f.sunDirectionWorld)).toBeCloseTo(1)
  }
 })
 it('preserves old preset direction when the fallback is explicitly selected',()=>{
  const f=sampleEnvironment('afternoon',0,'legacy'),length=Math.hypot(.63,.65,-.43)
  expect(f.sunDirectionWorld).toEqual([.63/length,.65/length,-.43/length])
 })
})

it('samples identical fixed and automatic states at the daylight joins in both layouts', async () => {
 const {EnvironmentClock,clockPolicy}=await import('../../src/flight-experience/environment/environment-clock')
 for(const layout of ['legacy','sunset-bay'] as const)for(const progress of [.08,.419999,.42,.420001,.679999,.68,.680001,.94]){
  const clock=new EnvironmentClock();clock.setSolarDayProgress(progress);clock.restoreCaptureMotion(17.25)
  const fixed=sampleEnvironment(clock.solarDayProgress,clock.motionSeconds,layout,10)
  clock.setSolarMode('auto');clock.tick(0,clockPolicy('viewpoint'))
  expect(sampleEnvironment(clock.solarDayProgress,clock.motionSeconds,layout,10)).toEqual(fixed)
 }
})
