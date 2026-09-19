import { clockPolicy } from '../../src/flight-experience/environment/environment-clock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Texture, TextureLoader } from 'three'
import { FlightExperience } from '../../src/flight-experience/FlightExperience'
import type { FlightRuntime } from '../../src/flight-experience/FlightRuntime'
import { TerrainStream } from '../../src/flight-experience/terrain-stream'
import { I18nProvider } from '../../src/i18n/I18nProvider'
import type { ViewerController, ViewerModelDescriptor, StagedViewerModel } from '../../src/viewer/ViewerController'

class IdleWorker { postMessage() {} terminate() {} }
beforeEach(() => {
 vi.stubGlobal('Worker', IdleWorker)
 vi.spyOn(TextureLoader.prototype, 'loadAsync').mockResolvedValue(new Texture())
 vi.spyOn(TerrainStream.prototype, 'previewReady', 'get').mockReturnValue(true)
 vi.spyOn(TerrainStream.prototype, 'ready', 'get').mockReturnValue(true)
 vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({drawImage() {},getImageData: (_x:number,_y:number,w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4)})})) as unknown as typeof HTMLCanvasElement.prototype.getContext)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function mount() {
 const instances: FlightRuntime[] = []
 const root = new Group(), group = new Group(); group.add(root); root.add(new Mesh(new BoxGeometry(7,1,2),new MeshBasicMaterial()))
 const controller = {
  acquireExternalExperience: (runtime:FlightRuntime) => { instances.push(runtime); return {invalidate:vi.fn(),release:()=>runtime.dispose()} },
  stageModel: () => Promise.resolve({group,modelRoot:root,mixer:null,action:null,disposed:false} as unknown as StagedViewerModel),
  disposeStagedModel:vi.fn(),
 } as unknown as ViewerController
 const descriptor={} as ViewerModelDescriptor, onClose=vi.fn()
 const element=<I18nProvider initialState={{locale:'en',preference:'en'}}><FlightExperience controller={controller} descriptor={descriptor} onClose={onClose}/></I18nProvider>
 const view=render(element)
 await waitFor(()=>expect(instances).toHaveLength(1))
 const runtime=instances[0]!
 // Allow the actual asynchronous model/material attach to finish.
 await waitFor(()=>expect(runtime.pose.children).toHaveLength(1))
 act(()=>runtime.update(0))
 return {runtime,instances,view,element,onClose}
}
describe('whole FlightExperience events with the actual Runtime (GPU/worker readiness stubbed)',()=>{
 it('keeps mode and movement on panel/rerender/language changes and isolates range keyboard shortcuts',async()=>{
  const {runtime,instances,view,element}=await mount()
  act(()=>runtime.start())
  fireEvent.click(screen.getByRole('button',{name:'Flight & scenery'}))
  fireEvent.click(screen.getByRole('button',{name:'Automatic daylight'}))
  expect(runtime.environmentClock.solarMode).toBe('auto')
  expect(runtime.getSnapshot().phase).toBe('flying')
  const key=vi.spyOn(runtime.input,'key')
  fireEvent.keyDown(screen.getByRole('slider'),{code:'ArrowRight',key:'ArrowRight'})
  expect(key).not.toHaveBeenCalled()
  view.rerender(element);expect(instances).toHaveLength(1)
  fireEvent.click(screen.getByRole('button',{name:'Flying'}))
  fireEvent.change(screen.getByRole('combobox',{name:/Language/}),{target:{value:'zh-CN'}})
  expect(instances).toHaveLength(1);expect(runtime.environmentClock.solarMode).toBe('auto')
  expect(runtime.getSnapshot().phase).toBe('flying')
  fireEvent.keyDown(window,{code:'Escape',key:'Escape'})
  expect(screen.getByRole('button',{name:'飞行与风景'})).toHaveFocus()
  expect(runtime.getSnapshot().phase).toBe('flying')
  view.unmount();expect(runtime.running).toBe(false)
 })
 it.each(['terrain','quality'])('retains ordinary %s preparation across hidden, focus and context overlap',async(kind)=>{
  const {runtime,view}=await mount()
  act(()=>runtime.start())
  vi.spyOn(TerrainStream.prototype,'ready','get').mockReturnValue(false)
  vi.spyOn(TerrainStream.prototype,'previewReady','get').mockReturnValue(false)
  act(()=>{if(kind==='quality')runtime.setQuality('balanced');else runtime.pause('terrain')})
  expect(runtime.getSnapshot().phase).toBe('buffering')
  const terrainUpdate=vi.spyOn(runtime.terrain,'update')
  const position={...runtime.simulation.position},motion=runtime.environmentClock.motionSeconds
  vi.spyOn(document,'hidden','get').mockReturnValue(true)
  fireEvent(document,new Event('visibilitychange'));fireEvent(window,new Event('blur'))
  act(()=>{runtime.contextLost();runtime.contextRestored();runtime.update(60)})
  expect(runtime.running).toBe(false)
  vi.spyOn(document,'hidden','get').mockReturnValue(false)
  fireEvent(document,new Event('visibilitychange'));expect(runtime.running).toBe(false)
  fireEvent(window,new Event('focus'))
  terrainUpdate.mockClear()
  act(()=>runtime.update(1/60))
  expect(terrainUpdate).toHaveBeenCalled()
  expect(runtime.getSnapshot().phase).toBe('paused')
  expect(runtime.canResume).toBe(false)
  vi.spyOn(TerrainStream.prototype,'previewReady','get').mockReturnValue(true)
  // Preview coverage alone must not discard unfinished safety preparation.
  act(()=>runtime.update(1/60))
  expect(runtime.running).toBe(true)
  vi.spyOn(TerrainStream.prototype,'ready','get').mockReturnValue(true)
  act(()=>runtime.update(1/60))
  expect(runtime.canResume).toBe(true)
  expect(runtime.getSnapshot().phase).toBe('paused')
  terrainUpdate.mockClear();act(()=>runtime.update(1/60))
  expect(terrainUpdate).not.toHaveBeenCalled()
  expect(runtime.simulation.position).toEqual(position)
  expect(runtime.environmentClock.motionSeconds).toBe(motion)
  view.unmount();act(()=>runtime.update(60));expect(runtime.running).toBe(false)
 })
 it.each(['entry','return'])('restores only necessary %s preparation after DOM hidden/focus events and preserves error UI',async(direction)=>{
  const {runtime,view,onClose}=await mount()
  act(()=>{runtime.enterViewpoint('seaward');if(direction==='return')runtime.returnFromViewpoint();runtime.setSolarMode('auto')})
  vi.spyOn(document,'hidden','get').mockReturnValue(true)
  fireEvent(document,new Event('visibilitychange'));fireEvent(window,new Event('blur'))
  act(()=>{runtime.contextLost();runtime.contextRestored()})
  expect(runtime.running).toBe(false)
  vi.spyOn(document,'hidden','get').mockReturnValue(false)
  fireEvent(document,new Event('visibilitychange'));expect(runtime.running).toBe(false)
  fireEvent(window,new Event('focus'));expect(runtime.running).toBe(true)
  expect(runtime.observation.sceneryPaused).toBe(true)
  expect(runtime.getSnapshot().daylight?.status).toBe('suspended')
  vi.spyOn(console,'error').mockImplementation(()=>{})
  act(()=>runtime.fail(new Error('injected update fault')))
  expect(screen.getByRole('alert')).toBeVisible();expect(runtime.running).toBe(false)
  fireEvent(window,new Event('focus'));expect(runtime.running).toBe(false)
  expect(screen.getByRole('button',{name:'Return to flight position'})).toBeVisible()
  fireEvent.keyDown(window,{code:'Escape',key:'Escape'});expect(onClose).toHaveBeenCalledOnce()
  view.unmount()
 })
})

it('preserves the selected progress but resets auto on Restart, and Defaults restores the original time',async()=>{
 const {runtime,instances,view}=await mount()
 const original=runtime.environmentClock.solarDayProgress
 runtime.weather.capture('light-rain');for(let i=0;i<2700;i++)runtime.weather.tick(1/60,clockPolicy('viewpoint'))
 const weatherBefore=runtime.weather.serialize()
 act(()=>{runtime.setSolarDayProgress(.7);runtime.setSolarMode('auto')})
 fireEvent.click(screen.getByRole('button',{name:'Flight & scenery'}))
 fireEvent.click(screen.getByRole('button',{name:'Flying'}))
 fireEvent.click(screen.getByText('Choose a new start'))
 fireEvent.click(screen.getByRole('button',{name:'Restart from here'}))
 await waitFor(()=>expect(instances).toHaveLength(2))
 const restarted=instances[1]!
 expect(restarted.environmentClock.solarDayProgress).toBe(.7)
 expect(restarted.environmentClock.solarMode).toBe('fixed')
 expect(restarted.weather.snapshot().mode).toBe('fixed');expect(restarted.weather.snapshot().target).toBeNull()
 expect(restarted.weather.snapshot().resolved).toEqual(weatherBefore.resolved);expect(restarted.weather.snapshot().wetness).toBe(weatherBefore.wetness);expect(restarted.weather.snapshot().phase).toEqual(weatherBefore.phase)
 expect(runtime.running).toBe(false)
 await waitFor(()=>expect(restarted.pose.children).toHaveLength(1))
 act(()=>restarted.update(0))
 fireEvent.click(screen.getByRole('button',{name:'Flight & scenery'}))
 fireEvent.click(screen.getByText('Choose a new start'))
 fireEvent.click(screen.getByRole('button',{name:'Restore defaults and restart'}))
 await waitFor(()=>expect(instances).toHaveLength(3))
 expect(instances[2]!.environmentClock.solarDayProgress).toBe(original)
 expect(instances[2]!.environmentClock.solarMode).toBe('fixed')
 expect(instances[2]!.weather.snapshot().resolved.coverage).toBe(0);expect(instances[2]!.weather.snapshot().wetness).toBe(0)
 view.unmount()
})

it('preserves automatic mode through a quality preparation but waits for explicit resume',async()=>{
 const {runtime,view}=await mount()
 act(()=>{runtime.start();runtime.setSolarMode('auto')})
 fireEvent.click(screen.getByRole('button',{name:'Flight & scenery'}))
 fireEvent.click(screen.getByRole('button',{name:'Flying'}))
 const progress=runtime.environmentClock.solarDayProgress
 fireEvent.change(screen.getByRole('combobox',{name:/Scenery/}),{target:{value:'balanced'}})
 expect(runtime.getSnapshot().phase).toBe('buffering')
 expect(runtime.getSnapshot().daylight?.status).toBe('suspended')
 expect(runtime.environmentClock.solarMode).toBe('auto')
 act(()=>runtime.update(0))
 expect(runtime.getSnapshot().phase).toBe('paused')
 expect(runtime.environmentClock.solarDayProgress).toBe(progress)
 act(()=>runtime.start());expect(runtime.getSnapshot().daylight?.status).toBe('running')
 view.unmount()
})

it('changes weather live, isolates the two automatic modes and preserves pending weather while paused',async()=>{
 const {runtime,instances,view}=await mount()
 act(()=>runtime.start())
 fireEvent.click(screen.getByRole('button',{name:'Flight & scenery'}))
 fireEvent.click(screen.getByRole('button',{name:'Automatic daylight'}))
 fireEvent.click(screen.getByRole('button',{name:'Weather'}))
 fireEvent.click(screen.getByRole('button',{name:'Automatic weather (includes rain)'}))
 expect(runtime.weather.snapshot().mode).toBe('auto')
 fireEvent.click(screen.getByRole('button',{name:'Light rain'}))
 expect(runtime.weather.snapshot().mode).toBe('fixed');expect(runtime.weather.snapshot().target).toBe('light-rain')
 expect(runtime.environmentClock.solarMode).toBe('auto');expect(runtime.getSnapshot().phase).toBe('flying');expect(instances).toHaveLength(1)
 act(()=>runtime.pause('user'))
 const resolved=runtime.weather.snapshot().resolved
 fireEvent.click(screen.getByRole('button',{name:'Overcast'}))
 act(()=>runtime.update(60))
 expect(runtime.weather.snapshot().resolved).toEqual(resolved)
 expect(screen.getByText('Target: Overcast; transition incomplete. Paused; transitions resume with the scenery')).toBeVisible()
 const key=vi.spyOn(runtime.input,'key');fireEvent.keyDown(screen.getByRole('button',{name:'Overcast'}),{code:'ArrowRight',key:'ArrowRight'});expect(key).not.toHaveBeenCalled()
 view.unmount()
})

it('keeps Nature opt-in, cards paused, photos nonmodal and Restart visually consistent',async()=>{
 const {runtime,view,instances}=await mount()
 act(()=>runtime.start())
 fireEvent.click(screen.getByRole('button',{name:'Flight & scenery'}))
 fireEvent.click(screen.getByRole('button',{name:'Nature'}))
 expect(screen.getByRole('checkbox',{name:'Vegetation breeze'})).not.toBeChecked()
 expect(runtime.soundscape.getSnapshot().enabled).toBe(false)
 fireEvent.click(screen.getByRole('checkbox',{name:'Vegetation breeze'}))
 expect(runtime.getSnapshot().phase).toBe('flying')
 fireEvent.click(screen.getByRole('button',{name:'Make a postcard'}))
 expect(runtime.getSnapshot().phase).toBe('flying')
 expect(runtime.photos.getSnapshot().status).toBe('waiting')
 const mute=vi.spyOn(runtime.soundscape,'setMuted')
 fireEvent.click(screen.getByRole('button',{name:'Why does water sparkle?'}))
 expect(runtime.getSnapshot().phase).toBe('paused');expect(mute).toHaveBeenCalledWith(true)
 act(()=>{runtime.start();runtime.update(1/60)})
 expect(runtime.getSnapshot().phase).toBe('paused')
 fireEvent.click(screen.getByRole('button',{name:'Close and stay paused'}))
 expect(runtime.getSnapshot().phase).toBe('paused')
 expect(screen.getByRole('button',{name:'Why does water sparkle?'})).toHaveFocus()
 fireEvent.click(screen.getByRole('button',{name:'Flying'}))
 fireEvent.click(screen.getByText('Choose a new start'))
 fireEvent.click(screen.getByRole('button',{name:'Restart from here'}))
 await waitFor(()=>expect(instances).toHaveLength(2))
 expect(instances[1]!.livingIntent.wind).toBe(true)
 expect(instances[1]!.soundscape.getSnapshot().enabled).toBe(false)
 expect(runtime.photos.getSnapshot().photos).toHaveLength(0)
 view.unmount()
})

it('cancels a waiting photo when viewpoint preparation replaces its intended frame',async()=>{
 const {runtime,view}=await mount()
 expect(runtime.requestPhoto()).toBe(true)
 act(()=>runtime.enterViewpoint('seaward'))
 const complete=vi.spyOn(runtime.photos,'completedFrame')
 act(()=>runtime.completedFrame(document.createElement('canvas')))
 expect(complete).not.toHaveBeenCalled()
 expect(runtime.photos.getSnapshot().status).toBe('idle')
 view.unmount()
})
