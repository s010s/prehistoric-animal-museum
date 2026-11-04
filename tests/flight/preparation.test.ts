import {expect,it} from 'vitest'
import {FlightPreparation} from '../../src/flight-experience/preparation'

it('excludes background time from the active preparation timeout',()=>{
 const p=new FlightPreparation(0)
 expect(p.tick(10000,true)).toBe(false)
 expect(p.tick(90000,false)).toBe(false)
 expect(p.tick(100000,true)).toBe(false)
 expect(p.tick(100001,true)).toBe(true)
})

it('settles focus and visibility boundaries even when timer callbacks are throttled',()=>{
 const p=new FlightPreparation(0)
 p.mark('world',0)
 p.setAvailable(5000,false)
 expect(p.tick(65000)).toBe(false)
 p.setAvailable(65000,true)
 expect(p.tick(79999)).toBe(false)
 expect(p.tick(80001)).toBe(true)
})

it('does not reset an active phase budget on repeated unavailable events',()=>{
 const p=new FlightPreparation(0)
 p.mark('world',0)
 p.setAvailable(5000,false)
 p.setAvailable(30000,false)
 p.setAvailable(60000,false)
 p.setAvailable(70000,true)
 expect(p.tick(84999)).toBe(false)
 expect(p.tick(85001)).toBe(true)
})

it('budgets each active preparation phase independently',()=>{
 const p=new FlightPreparation(0)
 p.tick(19000,true);p.mark('world',19000)
 expect(p.tick(38000,true)).toBe(false)
 expect(p.tick(39001,true)).toBe(true)
})
