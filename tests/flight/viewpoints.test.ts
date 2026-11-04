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
})
