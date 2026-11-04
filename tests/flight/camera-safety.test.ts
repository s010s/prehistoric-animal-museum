import {expect,it} from 'vitest'
import {Vector3} from 'three'
import {cameraSafety} from '../../src/flight-experience/camera-safety'
const hero={x:0,y:20,z:0},pose={position:new Vector3(21,20,0),target:new Vector3(0,20,0)},from={x:20,y:20,z:0}
it('distinguishes a safe camera sweep from a wall hiding the animal',()=>{
 expect(cameraSafety(from,pose,hero,(x)=>x>8&&x<12?40:0,1)).toBe('occluded')
 expect(cameraSafety(from,pose,hero,(x)=>x>20?40:0,1)).toBe('camera-clearance')
 expect(cameraSafety(from,pose,hero,()=>NaN,1)).toBe('terrain-pending')
})
it('keeps the swept near-plane outside the full animal and nearby companions',()=>{
 expect(cameraSafety({x:-20,y:20,z:0},pose,hero,()=>0,1)).toBe('body-clearance')
 expect(cameraSafety(from,pose,hero,()=>0,1,[{position:{x:24,y:20,z:0},radius:5}])).toBe('companion-clearance')
 expect(cameraSafety(from,pose,hero,()=>0,1)).toBeNull()
})

it('sweeps the body in its moving frame without skipping terrain collision',()=>{
 const oldHero={x:0,y:190,z:0},newHero={x:0,y:190,z:-1.8}
 const oldCamera={x:0,y:190.9,z:-2.5}
 const nextPose={position:new Vector3(0,190.9,-4.3),target:new Vector3(0,190,-1.8)}
 // At28m/s a slow frame moves the small animal near the camera's OLD position.
 expect(cameraSafety(oldCamera,nextPose,newHero,()=>0,.75,[],1.1)).toBe('body-clearance')
 expect(cameraSafety(oldCamera,nextPose,newHero,()=>0,.75,[],1.1,oldHero)).toBeNull()
 expect(cameraSafety(oldCamera,nextPose,newHero,(_x,z)=>z < -3?200:0,.75,[],1.1,oldHero)).toBe('camera-clearance')
 const throughBody={position:new Vector3(0,190.9,.7),target:nextPose.target}
 expect(cameraSafety(oldCamera,throughBody,newHero,()=>0,.75,[],1.1,oldHero)).toBe('body-clearance')
})
