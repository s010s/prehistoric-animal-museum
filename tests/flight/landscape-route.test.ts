import { expect, it } from 'vitest'
import { WORLD,createWorldSampler } from '../../src/flight-experience/world'
import { coastValleyLandmarks,createLandscapeSurface,scenicRouteAnchors,LANDMARK_BUDGET } from '../../src/flight-experience/world-presets/coast-valley'
import { CLIFF_SAMPLE } from '../../src/flight-experience/props/prop-obstacles'
it('keeps landmarks and their actual asset envelopes stable across return trips and seeds',()=>{
 for(const seed of [193706,193707,193708]){
  const world=createWorldSampler({...WORLD,seed}),landmarks=coastValleyLandmarks(world),surface=createLandscapeSurface(world,landmarks)
  expect(landmarks).toHaveLength(LANDMARK_BUDGET.count)
  for(const landmark of landmarks){
   expect(surface(landmark.x,landmark.z)).toBeGreaterThanOrEqual(landmark.y+CLIFF_SAMPLE.height*landmark.scale+2)
   const before=surface(landmark.x,landmark.z);surface(8500,-9000);expect(surface(landmark.x,landmark.z)).toBe(before)
  }
  expect(coastValleyLandmarks(world)).toEqual(landmarks)
  expect(scenicRouteAnchors(world).map(a=>a.z)).toEqual([-450,-1100,-2200])
 }
})
