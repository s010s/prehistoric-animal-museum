import {afterEach,expect,it,vi} from 'vitest'
import {CameraInput} from '../../src/flight-experience/camera-input'
afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks()})
it('preserves browser pinch zoom while handling scene wheel events',()=>{
 const element=document.createElement('div');document.body.append(element)
 const input=new CameraInput(element,vi.fn(),vi.fn(),vi.fn())
 const wheel=(deltaY:number,extra:WheelEventInit={})=>{const e=new WheelEvent('wheel',{deltaY,bubbles:true,cancelable:true,...extra});element.dispatchEvent(e);return e}
 expect(wheel(100).defaultPrevented).toBe(true)
 expect(wheel(100,{ctrlKey:true}).defaultPrevented).toBe(false)
 input.dispose()
})
