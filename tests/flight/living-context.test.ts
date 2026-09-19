import {expect,it,vi} from 'vitest'
import {LivingScope,DEFAULT_LIVING_INTENT,livingContext} from '../../src/flight-experience/living/living-context'
import {clockPolicy} from '../../src/flight-experience/environment/environment-clock'
import {WeatherController} from '../../src/flight-experience/environment/weather-controller'
it('derives one admitted clock and separates intent from permission',()=>{
 const input={generation:1,motionSeconds:12,camera:{x:1,y:120,z:3},player:{x:2,y:190,z:4},heading:0,quality:'low' as const,gentle:false,weather:new WeatherController().serialize(),intent:{...DEFAULT_LIVING_INTENT,wind:true}}
 for(const activity of ['paused','hidden','context-lost','error','closed','viewpoint-preparing'] as const){const frame=livingContext(input,clockPolicy(activity),60);expect(frame.delta).toBe(0);expect(frame.active).toBe(false);expect(frame.intent.wind).toBe(true);expect(frame.motionSeconds).toBe(12)}
 expect(livingContext(input,clockPolicy('viewpoint'),60).delta).toBe(4/60)
})
it('invalidates late ownership and releases each resource once',()=>{
 const scope=new LivingScope(),release=vi.fn(),token=scope.generation
 const remove=scope.own(release);scope.invalidate();expect(scope.accepts(token)).toBe(false)
 remove();scope.dispose();remove();expect(release).toHaveBeenCalledOnce()
 scope.own(release);expect(release).toHaveBeenCalledTimes(2);expect(scope.accepts(scope.generation)).toBe(false)
})
