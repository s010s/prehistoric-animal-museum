import { clockPolicy } from '../../src/flight-experience/environment/environment-clock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Texture, TextureLoader } from 'three'
import { FlightExperience } from '../../src/flight-experience/FlightExperience'
import type { FlightRuntime } from '../../src/flight-experience/FlightRuntime'
import { HorizonTerrain } from '../../src/flight-experience/horizon-terrain'
import { TerrainStream } from '../../src/flight-experience/terrain-stream'
import { I18nProvider } from '../../src/i18n/I18nProvider'
import type { ViewerController, ViewerModelDescriptor, StagedViewerModel } from '../../src/viewer/ViewerController'

class IdleWorker { postMessage() {} terminate() {} }
beforeEach(() => {
 vi.stubGlobal('Worker', IdleWorker)
 vi.spyOn(HorizonTerrain.prototype,'ready','get').mockReturnValue(true)
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
 await act(async()=>{})
 const runtime=instances[0]!
 act(()=>{runtime.update(0);runtime.completedFrame(document.createElement('canvas'))})
 return {runtime,instances,view}
}
describe('whole FlightExperience events with the actual Runtime (GPU/worker readiness stubbed)',()=>{
 it('recovers a genuinely unsafe displayed camera and still requires an explicit resume',async()=>{
  const {runtime,view}=await mount()
  vi.spyOn(runtime.terrain,'displayedHeight').mockReturnValue(0)
  vi.spyOn(runtime.terrain,'safeToEnter').mockReturnValue(true)
  act(()=>runtime.start())
  act(()=>runtime.update(0))
  const hero=runtime.simulation.renderState().position
  runtime.camera.position.set(hero.x,hero.y,hero.z)
  act(()=>runtime.update(1/60))
  expect(runtime.getSnapshot()).toMatchObject({phase:'paused',reason:'camera'})
  expect(runtime.canResume).toBe(false)
  act(()=>{runtime.resize(1280,720);runtime.update(0)})
  expect(runtime.getSnapshot()).toMatchObject({phase:'paused',reason:null})
  expect(screen.getByRole('button',{name:'Continue flying'})).toBeVisible()
  fireEvent.click(screen.getByRole('button',{name:'Continue flying'}))
  expect(runtime.getSnapshot().phase).toBe('flying')
  view.unmount()
 })
 it('changes language from a portalled choice without dismissing the panel on pointer down',async()=>{
  const {view}=await mount()
  fireEvent.click(screen.getByRole('button',{name:'Flight & scenery'}))
  fireEvent.click(screen.getByRole('button',{name:'Change language, current English'}))
  const choice=screen.getByRole('menuitemradio',{name:'简体中文'})
  fireEvent.pointerDown(choice,{pointerId:2,pointerType:'touch'})
  expect(screen.getByRole('tab',{name:'Scenery'})).toBeInTheDocument()
  fireEvent.click(choice)
  expect(document.documentElement.lang).toBe('zh-CN')
  expect(screen.getByRole('tab',{name:'风景'})).toBeVisible()
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
 fireEvent.click(screen.getByRole('tab',{name:'Views'}))
 fireEvent.click(screen.getByText('Choose a new starting point'))
 fireEvent.click(screen.getByRole('button',{name:'Start from Coast entrance'}))
 await act(async()=>{})
 const restarted=instances[1]!
 expect(restarted.environmentClock.solarDayProgress).toBe(.7)
 expect(restarted.environmentClock.solarMode).toBe('fixed')
 expect(restarted.weather.snapshot().mode).toBe('fixed');expect(restarted.weather.snapshot().target).toBeNull()
 expect(restarted.weather.snapshot().resolved).toEqual(weatherBefore.resolved);expect(restarted.weather.snapshot().wetness).toBe(weatherBefore.wetness)
 act(()=>{restarted.update(0);restarted.completedFrame(document.createElement('canvas'))})
 fireEvent.click(screen.getByRole('button',{name:'Flight & scenery'}))
 fireEvent.click(screen.getByText('Restore initial settings'))
 fireEvent.click(screen.getByRole('button',{name:'Restore defaults and restart'}))
 await act(async()=>{})
 expect(instances[2]!.environmentClock.solarDayProgress).toBe(original)
 expect(instances[2]!.environmentClock.solarMode).toBe('fixed')
 expect(instances[2]!.weather.snapshot().resolved.coverage).toBe(0);expect(instances[2]!.weather.snapshot().wetness).toBe(0)
 view.unmount()
})

it('dismisses postcards before flight when Escape comes from outside the gallery',async()=>{
 const {runtime,view}=await mount()
 act(()=>runtime.start())
 const pocket=screen.getByRole('button',{name:'View postcards, 0'})
 fireEvent.click(pocket)
 expect(screen.getByRole('button',{name:'Close postcards'})).toHaveFocus()
 const pause=screen.getByRole('button',{name:'Stop and look'})
 pause.focus()
 fireEvent.keyDown(pause,{key:'Escape',code:'Escape'})
 expect(screen.queryByRole('button',{name:'Close postcards'})).toBeNull()
 expect(pocket).toHaveFocus()
 expect(runtime.getSnapshot().phase).toBe('flying')
 view.unmount()
})

it.each(['ready','paused'] as const)('quiet viewing dismisses the %s card and retains one working flight action',async(phase)=>{
 const {runtime,view}=await mount()
 if(phase==='paused')act(()=>{runtime.start();runtime.setFocusState(false);runtime.setFocusState(true)})
 const position={...runtime.simulation.position}
 fireEvent.click(screen.getByRole('button',{name:'Just look at the scenery'}))
 expect(screen.queryByRole('button',{name:'Just look at the scenery'})).toBeNull()
 act(()=>runtime.update(1/60))
 expect(runtime.simulation.position).toEqual(position)
 fireEvent.click(screen.getByRole('button',{name:phase==='ready'?'Start flying':'Continue flying'}))
 expect(runtime.getSnapshot().phase).toBe('flying')
 view.unmount()
})

it('closes the museum language menu before the flight card, restoring focus in order',async()=>{
 const {view}=await mount()
 fireEvent.click(screen.getByRole('button',{name:'Flight & scenery'}))
 const language=screen.getByRole('button',{name:'Change language, current English'})
 fireEvent.click(language)
 fireEvent.keyDown(screen.getByRole('menuitemradio',{name:'English'}),{key:'Escape',code:'Escape'})
 await waitFor(()=>expect(language).toHaveFocus())
 expect(screen.queryByRole('menu')).toBeNull()
 expect(screen.getByRole('tab',{name:'Scenery'})).toBeVisible()
 fireEvent.keyDown(language,{key:'Escape',code:'Escape'})
 expect(screen.queryByRole('tab',{name:'Scenery'})).toBeNull()
 view.unmount()
})
