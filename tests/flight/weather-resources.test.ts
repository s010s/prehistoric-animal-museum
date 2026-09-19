import {afterEach,expect,it,vi} from 'vitest'
import {PerspectiveCamera,Scene,Texture,TextureLoader} from 'three'
import {EnvironmentScene} from '../../src/flight-experience/environment/environment-scene'
import {WeatherController} from '../../src/flight-experience/environment/weather-controller'
import {sampleEnvironment} from '../../src/flight-experience/environment/environment-state'
afterEach(()=>vi.restoreAllMocks())
it('treats an unavailable cloud texture as optional and does not block preparation',async()=>{
 vi.spyOn(TextureLoader.prototype,'loadAsync').mockRejectedValue(new Error('optional texture unavailable'))
 const wake=vi.fn(),env=new EnvironmentScene(new Scene(),()=>-30,wake)
 await Promise.resolve();await Promise.resolve()
 expect(env.weatherDegraded).toBe(true);expect(wake).toHaveBeenCalledOnce()
 const camera=new PerspectiveCamera();camera.position.y=120;env.update(camera,{x:0,z:0},0,'low')
 expect(env.frame.rainRate).toBe(0);expect(env.frame.cloudCoverage).toBe(0);env.dispose()
})
it('disposes optional assets arriving after their environment has closed',async()=>{
 let finish!:(texture:Texture<HTMLImageElement>)=>void
 vi.spyOn(TextureLoader.prototype,'loadAsync').mockImplementation(()=>new Promise<Texture<HTMLImageElement>>(resolve=>{finish=resolve}))
 const wake=vi.fn(),env=new EnvironmentScene(new Scene(),()=>-30,wake),texture=new Texture<HTMLImageElement>(),dispose=vi.spyOn(texture,'dispose')
 env.dispose();finish(texture);await Promise.resolve()
 expect(dispose).toHaveBeenCalledOnce();expect(wake).not.toHaveBeenCalled()
})
it('keeps weather resources bounded across quality/origin changes and falls back to the exact clear frame',async()=>{
 vi.spyOn(TextureLoader.prototype,'loadAsync').mockResolvedValue(new Texture())
 const env=new EnvironmentScene(new Scene(),()=>-30),camera=new PerspectiveCamera(),w=new WeatherController()
 camera.position.y=120;w.capture('light-rain');env.weatherState=w.serialize();await Promise.resolve()
 const geometry=env.rain.geometry,material=env.rain.material
 env.update(camera,{x:0,z:0},0,'low');expect(geometry.instanceCount).toBe(512);expect(env.metrics.weatherDrawCalls).toBe(2)
 env.update(camera,{x:8192,z:-8192},0,'balanced');expect(geometry.instanceCount).toBe(1536);expect(env.rain.geometry).toBe(geometry);expect(env.rain.material).toBe(material)
 env.weatherEnabled=false;env.update(camera,{x:0,z:0},0,'low');expect(env.frame).toEqual(sampleEnvironment('afternoon',0,'legacy',3));expect(env.rain.uniforms.rainAmount.value).toBe(0);expect(env.curtains.uniforms.curtainAmount.value).toBe(0)
 env.restoreWaterMotion(20);env.review.freezeWater=true;env.update(camera,{x:0,z:0},30,'low');expect(env.waterMotionSeconds).toBe(20);env.review.freezeWater=false;env.update(camera,{x:0,z:0},31,'low');expect(env.waterMotionSeconds).toBe(21)
 env.dispose()
})
it('fades a late overcast asset on effective motion time, freezing on pause and weather disable',async()=>{
 let finish!:(texture:Texture<HTMLImageElement>)=>void
 vi.spyOn(TextureLoader.prototype,'loadAsync').mockImplementation(()=>new Promise<Texture<HTMLImageElement>>(resolve=>{finish=resolve}))
 const env=new EnvironmentScene(new Scene(),()=>-30),camera=new PerspectiveCamera(),weather=new WeatherController()
 camera.position.y=120;weather.capture('overcast');env.weatherState=weather.serialize()
 env.update(camera,{x:0,z:0},100,'low')
 expect(env.cloudAppearance.dataReady).toBe(false)
 finish(new Texture<HTMLImageElement>());await Promise.resolve()
 expect(env.cloudAppearance.dataReady).toBe(true);expect(env.cloudAppearance.appearanceWeight).toBe(0)
 env.update(camera,{x:0,z:0},100,'low');expect(env.cloudAppearance.appearanceWeight).toBe(0)
 env.update(camera,{x:0,z:0},101,'low');expect(env.cloudAppearance.appearanceWeight).toBe(.5)
 env.update(camera,{x:0,z:0},101,'low');expect(env.cloudAppearance.appearanceWeight).toBe(.5)
 env.weatherEnabled=false;env.update(camera,{x:0,z:0},161,'low');expect(env.cloudAppearance.appearanceWeight).toBe(.5)
 env.weatherEnabled=true;env.update(camera,{x:0,z:0},162,'low');expect(env.cloudAppearance.appearanceWeight).toBe(1)
 expect(env.sky.material.uniforms.cloudDataReady!.value).toBe(1)
 expect(env.sky.material.uniforms.cloudAppearanceWeight!.value).toBe(1)
 env.dispose()
})
it('cancels the development slow-load probe when its environment closes',()=>{
 vi.useFakeTimers()
 const original=globalThis.location.href
 globalThis.history.replaceState(null,'','?flightCloudDelayMs=5000')
 const load=vi.spyOn(TextureLoader.prototype,'loadAsync').mockResolvedValue(new Texture())
 const env=new EnvironmentScene(new Scene(),()=>-30)
 expect(load).not.toHaveBeenCalled();env.dispose();vi.advanceTimersByTime(6000)
 expect(load).not.toHaveBeenCalled()
 globalThis.history.replaceState(null,'',original);vi.useRealTimers()
})
