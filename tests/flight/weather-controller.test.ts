import {describe,it,expect} from 'vitest'
import {WeatherController} from '../../src/flight-experience/environment/weather-controller'
import {clockPolicy,EnvironmentClock} from '../../src/flight-experience/environment/environment-clock'
import {composeWeather,sampleEnvironment} from '../../src/flight-experience/environment/environment-state'
const active=clockPolicy('viewpoint'),paused=clockPolicy('hidden')
const run=(w:WeatherController,seconds:number,hz=60)=>{for(let i=0;i<Math.round(seconds*hz);i++)w.tick(1/hz,active)}
describe('weather admitted-time contract',()=>{
 it('starts clear/fixed and leaves the accepted solar frame identical',()=>{const w=new WeatherController(),f=sampleEnvironment();expect(w.snapshot().mode).toBe('fixed');expect(composeWeather(f,w.serialize())).toBe(f)})
 it.each([15,30,60,120])('plays 480 active seconds at %s Hz without resetting cloud or rain history',hz=>{
  const w=new WeatherController();w.setMode('auto');run(w,280,hz);expect(w.snapshot().resolved.rain).toBeCloseTo(.32);expect(w.snapshot().wetness).toBeGreaterThan(.6)
  run(w,60,hz);expect(w.snapshot().resolved.rain).toBe(0);expect(w.snapshot().wetness).toBeGreaterThan(.4)
  run(w,141,hz);expect(w.snapshot().resolved.coverage).toBeCloseTo(0);expect(w.snapshot().sequence).toBeCloseTo(1);expect(w.snapshot().phase[0]).toBeCloseTo(481*12,4)
 })
 it('retargets from current values and freezes pending changes and wetness while hidden',()=>{
  const w=new WeatherController();w.setTarget('light-rain');run(w,20);const prior=w.serialize();w.setTarget('fair');expect(w.snapshot().resolved).toEqual(prior.resolved)
  const pending=w.serialize();w.tick(60,paused);expect(w.serialize()).toEqual(pending);run(w,35);expect(w.snapshot().resolved.coverage).toBe(.30)
 })
 it('keeps fixed clouds moving and allows weather after sunlight ends',()=>{
  const w=new WeatherController(),c=new EnvironmentClock();c.setSolarDayProgress(.94);c.setSolarMode('auto');w.setTarget('light-rain')
  for(let i=0;i<600;i++){c.tick(1/60,active);w.tick(1/60,active)}
  expect(c.snapshot(active).status).toBe('ended');expect(w.snapshot().phase[0]).toBeCloseTo(120);expect(w.snapshot().resolved.coverage).toBeGreaterThan(0)
 })
 it('has delayed rain, historical drying and continuous wind changes',()=>{
  const w=new WeatherController();w.setTarget('light-rain');run(w,15);expect(w.snapshot().resolved.coverage).toBeGreaterThan(.2);expect(w.snapshot().resolved.rain).toBe(0);run(w,65)
  w.setTarget('clear');run(w,11);expect(w.snapshot().resolved.rain).toBe(0);expect(w.snapshot().wetness).toBeGreaterThan(.8)
  const before=w.snapshot().phase;w.tick(.05,active,{clouds:false,weather:false},[-2,5]);expect(w.snapshot().phase[0]).toBeCloseTo(before[0]-.1)
  run(w,220);expect(w.snapshot().wetness).toBe(0)
 })
 it('serializes independently and Restart cancels pending while preserving resolved history',()=>{
  const w=new WeatherController();w.setMode('auto');run(w,270);const v=w.serialize(),other=new WeatherController();expect(other.restore(v)).toBe(true);other.restart();expect(other.snapshot().target).toBeNull();expect(other.snapshot().resolved).toEqual(v.resolved);expect(other.snapshot().wetness).toBe(v.wetness);expect(other.snapshot().phase).toEqual(v.phase)
 })
 it('rejects bad captures and deltas without poisoning uniforms',()=>{
  const w=new WeatherController();for(const dt of [NaN,Infinity,-3])w.tick(dt,active);expect(w.snapshot().phase).toEqual([0,0]);expect(w.restore({...w.serialize(),wetness:NaN})).toBe(false);w.tick(3600,active);expect(w.snapshot().phase[0]).toBeCloseTo(.8)
 })
})

it('balances overcast direct and ambient illumination without changing fair sunlight',()=>{
 const clear=sampleEnvironment('evening',0,'sunset-bay'),weather=new WeatherController()
 weather.capture('fair');expect(composeWeather(clear,weather.serialize()).sunIntensity).toBe(clear.sunIntensity)
 weather.capture('overcast');const cloudy=composeWeather(clear,weather.serialize())
 expect(cloudy.sunIntensity).toBeLessThan(clear.sunIntensity*.75)
 expect(cloudy.fillIntensity).toBeGreaterThan(clear.fillIntensity)
 expect(cloudy.groundFill[2]/cloudy.groundFill[0]).toBeGreaterThan(clear.groundFill[2]/clear.groundFill[0])
 expect(cloudy.horizon[0]).toBeGreaterThan(cloudy.horizon[2]*3)
})
