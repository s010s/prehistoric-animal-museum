import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LightViewpointPanel } from '../../src/flight-experience/LightViewpointPanel'
import type { FlightRuntime, FlightSnapshot } from '../../src/flight-experience/FlightRuntime'
import { DEFAULT_FLIGHT_SETTINGS } from '../../src/flight-experience/settings'
const snapshot:FlightSnapshot={phase:'flying',reason:null,simplified:false,region:'coast',gentle:false,assisted:false,quality:'low',settings:DEFAULT_FLIGHT_SETTINGS,observation:'inactive',solarDayProgress:.68}
function setup(mode:'sunlight'|'viewpoints',locale:'en'|'zh-CN'='en',state=snapshot){
 const runtime={setSolarMode:vi.fn(),restartDaylightFromMorning:vi.fn(),enterViewpoint:vi.fn(),setSolarDayProgress:vi.fn(),toggleScenery:vi.fn(),returnFromViewpoint:vi.fn(),pause:vi.fn()}
 render(<LightViewpointPanel runtime={runtime as unknown as FlightRuntime} snapshot={state} locale={locale} mode={mode}/>);return runtime
}
describe('unified scenery sections',()=>{
 it('applies sunlight while flying without invoking pause or a viewpoint',()=>{
  const runtime=setup('sunlight')
  fireEvent.click(screen.getByRole('button',{name:'Sunset'}));expect(runtime.setSolarDayProgress).toHaveBeenCalledWith(.94)
  fireEvent.change(screen.getByRole('slider',{name:'Daylight progress'}),{target:{value:'.3'}});expect(runtime.setSolarDayProgress).toHaveBeenLastCalledWith(.3)
  expect(runtime.pause).not.toHaveBeenCalled();expect(runtime.enterViewpoint).not.toHaveBeenCalled()
  expect(screen.queryByRole('button',{name:'Cliffs · 210 m'})).not.toBeInTheDocument()
 })
 it('labels viewpoint interruption and retains scenery and return controls',()=>{
  const runtime=setup('viewpoints','en',{...snapshot,phase:'paused',observation:'active',viewpoint:'seaward',sceneryPaused:false})
  expect(screen.getByText(/Choosing a viewpoint pauses flight/)).toBeVisible()
  fireEvent.click(screen.getByRole('button',{name:'Cliffs · 210 m'}));expect(runtime.enterViewpoint).toHaveBeenCalledWith('cliff')
  fireEvent.click(screen.getByRole('button',{name:'Pause scenery'}));expect(runtime.toggleScenery).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button',{name:'Return to flight position'}));expect(runtime.returnFromViewpoint).toHaveBeenCalledOnce()
 })
 it('keeps return available while a Chinese viewpoint is preparing',()=>{
  const runtime=setup('viewpoints','zh-CN',{...snapshot,phase:'paused',observation:'preparing'})
  expect(screen.getByRole('status')).toHaveTextContent('正在准备观景点')
  fireEvent.click(screen.getByRole('button',{name:'返回原飞行位置'}));expect(runtime.returnFromViewpoint).toHaveBeenCalledOnce()
 })
})

it('offers automatic daylight and an explicit replay only at sunset', () => {
 const runtime=setup('sunlight','en',{...snapshot,solarDayProgress:.94,daylight:{mode:'auto',status:'ended',progress:.94,remainingActiveSeconds:0}})
 expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext','Daylight progress 100%')
 expect(screen.getByRole('status')).toHaveTextContent('Holding at sunset')
 fireEvent.click(screen.getByRole('button',{name:'Replay daylight from morning'}))
 expect(runtime.restartDaylightFromMorning).toHaveBeenCalledOnce()
 fireEvent.click(screen.getByRole('button',{name:'Fixed time'}))
 expect(runtime.setSolarMode).toHaveBeenCalledWith('fixed')
 expect(runtime.pause).not.toHaveBeenCalled()
})
