import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { FlightCameraRig, orbitPose, HERO_RADIUS } from '../../src/flight-experience/camera-rig'
const p={x:4096,y:190,z:-8192}
describe('flight camera intent and geometry',()=>{
  it('keeps the target in front across every direction and aspect outside the rear composition blend',()=>{
    for(const aspect of [.4,.5625,1,16/9,2.2])for(const yaw of [-Math.PI,-Math.PI/2,Math.PI/2,150*Math.PI/180,165*Math.PI/180,Math.PI])for(const view of ['near','standard','wide'] as const){
      const pose=orbitPose(p,0,{yaw,pitch:0},aspect,view)
      expect(pose.target.clone().sub(pose.position).dot(new Vector3(p.x,p.y,p.z).sub(pose.position))).toBeGreaterThan(0)
      expect(pose.position.distanceTo(new Vector3(p.x,p.y,p.z))).toBeGreaterThan(HERO_RADIUS+2)
    }
    const front=orbitPose(p,0,{yaw:Math.PI,pitch:0},16/9,'standard')
    expect(new Vector3(p.x,p.y-5,p.z-20).sub(front.position).dot(new Vector3(p.x,p.y,p.z).sub(front.position))).toBeLessThan(0)
  })
})

it('permits a safe underside orbit',()=>{
 const rig=new FlightCameraRig();rig.nudge(0,-2);rig.step(.016,true,()=>null)
 const low=orbitPose(p,0,rig.resolved,16/9,'standard')
 expect(low.position.y).toBeLessThan(p.y-5)
 expect(low.position.distanceTo(low.target)).toBeGreaterThan(HERO_RADIUS+2)
})
