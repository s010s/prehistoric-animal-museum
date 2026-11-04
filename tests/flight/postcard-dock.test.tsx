import {afterEach,describe,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {PostcardDock} from '../../src/flight-experience/living/PostcardDock'
import type {FlightRuntime,FlightSnapshot} from '../../src/flight-experience/FlightRuntime'
import type {PhotoState} from '../../src/flight-experience/living/photo-service'
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()})
function setup(){
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}}))
 const release=vi.fn(),request=vi.fn(()=>true),remove=vi.fn()
 const runtime={photos:{releaseCapture:release,getSnapshot:()=>({status:'idle',photos:[]}),remove},requestPhoto:request,input:{clear:vi.fn()}} as unknown as FlightRuntime
 const snapshot=(photos:PhotoState)=>({phase:'flying',photos} as FlightSnapshot)
 const view=render(<PostcardDock runtime={runtime} snapshot={snapshot({status:'idle',photos:[]})} locale="zh-CN"/> )
 return {view,runtime,snapshot}
}
describe('postcard moment and pocket',()=>{
 it('restores focus after removing a postcard and closing the gallery on Escape',()=>{
  const {view,runtime,snapshot}=setup()
  view.rerender(<PostcardDock runtime={runtime} snapshot={snapshot({status:'idle',photos:[{url:'blob:1',frame:1,width:1280,height:720,sun:.4,weather:'clear'}]})} locale="zh-CN"/> )
  fireEvent.click(screen.getByRole('button',{name:'查看明信片，1张'}))
  const remove=screen.getByRole('button',{name:'移除'});remove.focus();fireEvent.click(remove)
  expect(document.activeElement).toBe(screen.getByRole('button',{name:'查看明信片，1张'}))
  fireEvent.keyDown(screen.getByRole('button',{name:'关闭明信片'}),{key:'Escape'})
  expect(screen.queryByRole('link',{name:'保存到设备'})).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('button',{name:'查看明信片，1张'}))
 })
})
