import {expect,it} from 'vitest'
import {cloudIntersection,cloudUV} from '../../src/flight-experience/environment/cloud-field'
import {rainPosition} from '../../src/flight-experience/environment/rain-field'
it('projects low sun over 37 km, never into a clamped local shadow cache',()=>{const angle=3.2*Math.PI/180;const q=cloudIntersection([0,120,0],[Math.cos(angle),Math.sin(angle),0],2200)!;expect(q[0]).toBeCloseTo(37204,-1);expect(cloudIntersection([0,120,0],[1,0,0])).toBeNull();expect(cloudIntersection([0,2500,0],[0,1,0])).toBeNull()})
it('retains the same field through negative origins and period crossings',()=>{expect(cloudUV([123,-340],[0,0],[65,34])).toEqual(cloudUV([123-4096,-340+8192],[4096,-8192],[65,34]));expect(cloudUV([123+65536,-340],[0,0],[65,34])).toEqual(cloudUV([123,-340],[0,0],[65,34]))})
it('bounds stable world rain and does not rotate it with the camera',()=>{for(let i=0;i<1536;i++){const p=rainPosition(i,10000,[30000,1400,-30000]);expect(Math.abs(p[0]-30000)).toBeLessThanOrEqual(50);expect(Math.abs(p[1]-1400)).toBeLessThanOrEqual(30);expect(Math.abs(p[2]+30000)).toBeLessThanOrEqual(50)}const p=rainPosition(8,1,[0,100,0]),q=rainPosition(8,1.01,[0,100,0]);expect(q[1]-p[1]).toBeCloseTo(-.19)})

it('maps one metre to the same 16 km density texture period used by the GPU',()=>{expect(cloudUV([4096,0],[0,0],[0,0])).toEqual([.25,0]);expect(cloudUV([16384,0],[0,0],[0,0])).toEqual([0,0])})
