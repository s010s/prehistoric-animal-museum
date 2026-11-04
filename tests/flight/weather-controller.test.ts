import {describe,it,expect} from 'vitest'
import {WeatherController} from '../../src/flight-experience/environment/weather-controller'
import {clockPolicy,EnvironmentClock} from '../../src/flight-experience/environment/environment-clock'
const active=clockPolicy('viewpoint'),paused=clockPolicy('hidden')
const run=(w:WeatherController,seconds:number,hz=60)=>{for(let i=0;i<Math.round(seconds*hz);i++)w.tick(1/hz,active)}
describe('weather admitted-time contract',()=>{
 it('retargets from current values and freezes pending changes and wetness while hidden',()=>{
  const w=new WeatherController();w.setTarget('light-rain');run(w,20);const prior=w.serialize();w.setTarget('fair');expect(w.snapshot().resolved).toEqual(prior.resolved)
  const pending=w.serialize();w.tick(60,paused);expect(w.serialize()).toEqual(pending)
 })
 it('allows weather to keep changing after sunlight ends',()=>{
  const w=new WeatherController(),c=new EnvironmentClock();c.setSolarDayProgress(.94);c.setSolarMode('auto');w.setTarget('light-rain')
  for(let i=0;i<600;i++){c.tick(1/60,active);w.tick(1/60,active)}
  expect(c.snapshot(active).status).toBe('ended');expect(w.snapshot().resolved.coverage).toBeGreaterThan(0)
 })
 it('has delayed rain and historical drying',()=>{
  const w=new WeatherController();w.setTarget('light-rain');run(w,15);expect(w.snapshot().resolved.coverage).toBeGreaterThan(.2);expect(w.snapshot().resolved.rain).toBe(0);run(w,65)
  w.setTarget('clear');run(w,11);expect(w.snapshot().resolved.rain).toBe(0);expect(w.snapshot().wetness).toBeGreaterThan(.8)
  run(w,220);expect(w.snapshot().wetness).toBe(0)
 })
})
