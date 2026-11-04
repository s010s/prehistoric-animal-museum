import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {expect,it} from 'vitest'
import {FLIGHT_SPECIES,availableFlightSpecies} from '../../src/flight-experience/species/profiles'
import {orbitPose} from '../../src/flight-experience/camera-rig'
it('binds every flight species to its calibrated source asset',()=>{
 for(const profile of FLIGHT_SPECIES){
  const bytes=readFileSync(`src/content/animals/${profile.id}/model/model.glb`)
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(profile.sourceAssetHash)
 }
})

it('keeps future candidates out of the approved public set',()=>{
 const profiles=[...FLIGHT_SPECIES,{...FLIGHT_SPECIES[0]!,id:'future-candidate',publicState:'candidate' as const}]
 expect(availableFlightSpecies('candidate',profiles).map(p=>p.id)).toContain('future-candidate')
 expect(availableFlightSpecies('public',profiles).map(p=>p.id)).toEqual(FLIGHT_SPECIES.map(p=>p.id))
})

it('keeps the orbit camera outside every species safety radius',()=>{
 for(const profile of FLIGHT_SPECIES)for(const aspect of [320/844,844/390,16/9])for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2]){
  const pose=orbitPose({x:0,y:190,z:0},0,{yaw,pitch:0},aspect,'near',profile.camera)
  expect(pose.position.distanceTo({x:0,y:190,z:0})).toBeGreaterThan(profile.camera.radius)
 }
})
