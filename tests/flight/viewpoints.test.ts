import { describe, it, expect } from 'vitest'
import { ObservationSession } from '../../src/flight-experience/viewpoints/observation-session'
import { VIEWPOINTS } from '../../src/flight-experience/viewpoints/viewpoint-catalog'
const sea=VIEWPOINTS[0]!,cliff=VIEWPOINTS[1]!
describe('bounded observation transactions',()=>{
 it('keeps the original bookmark through A/B/A and rejects late completion',()=>{
  const session=new ObservationSession<{position:number;actionTime:number}>(), bookmark={position:100,actionTime:1.7}
  const a=session.request(sea,bookmark,0),b=session.request(cliff,{position:900,actionTime:0},1),latest=session.request(sea,{position:400,actionTime:0},2)
  expect(session.complete(a)).toBe(false);expect(session.complete(b)).toBe(false)
  expect(session.complete(latest)).toBe(true);expect(session.target).toBe(sea);expect(session.bookmark).toBe(bookmark)
 })
 it('times out without discarding return state and cancels pending entry on return',()=>{
  const session=new ObservationSession<number>(),a=session.request(sea,42,0)
  expect(session.checkTimeout(19999)).toBe(false);expect(session.checkTimeout(20000)).toBe(true)
  expect(session.phase).toBe('failed');expect(session.bookmark).toBe(42)
  const token=session.returnToTravel(21000);expect(session.complete(a)).toBe(false)
  expect(session.complete(token)).toBe(true);expect(session.phase).toBe('inactive');expect(session.bookmark).toBeNull()
 })
 it('does not automatically resume scenery after suspension, switching or recovery',()=>{
  const session=new ObservationSession<number>();session.complete(session.request(sea,42,0));session.suspend()
  session.complete(session.request(cliff,99,10));expect(session.sceneryPaused).toBe(true)
 })
 it('releases bookmarks and targets on twenty roundtrips and close rejects late results',()=>{
  const session=new ObservationSession<number>()
  for(let i=0;i<20;i++){
   const token=session.request(sea,i,0);expect(session.complete(token)).toBe(true)
   expect(session.complete(session.returnToTravel(2))).toBe(true)
   expect(session.bookmark).toBeNull();expect(session.target).toBeNull()
  }
  const last=session.request(cliff,33,0);session.close();expect(session.complete(last)).toBe(false)
  expect(session.bookmark).toBeNull();expect(session.target).toBeNull()
 })
})

describe('active preparation budget', () => {
 it.each(['entry', 'return'] as const)('excludes hidden time during %s and keeps the remaining fifteen seconds', direction => {
  const session = new ObservationSession<number>()
  session.request(sea, 42, 0)
  if (direction === 'return') session.returnToTravel(0)
  session.setPreparationAvailable(false, 5000)
  session.setPreparationAvailable(false, 35000)
  expect(session.checkTimeout(65000)).toBe(false)
  session.setPreparationAvailable(true, 65000)
  session.setPreparationAvailable(true, 65000)
  expect(session.checkTimeout(79999)).toBe(false)
  expect(session.checkTimeout(80000)).toBe(true)
  expect(session.bookmark).toBe(42)
 })
 it('resets the budget for a new generation and invalidates failures without losing the bookmark', () => {
  const session = new ObservationSession<number>()
  const old = session.request(sea, 42, 0)
  session.setPreparationAvailable(false, 5000)
  const latest = session.request(cliff, 99, 60000)
  session.setPreparationAvailable(true, 65000)
  expect(session.checkTimeout(84999)).toBe(false)
  expect(session.complete(old)).toBe(false)
  session.fail()
  expect(session.complete(latest)).toBe(false)
  expect(session.bookmark).toBe(42)
 })
})
