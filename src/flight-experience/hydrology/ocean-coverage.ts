import {BufferAttribute,BufferGeometry} from 'three'
import {SEA_LEVEL,type Address} from '../world'
export interface WaterRect {minX:number;minZ:number;maxX:number;maxZ:number}
/** Cut the ocean in geometry, sharing the finite water's flat border. This avoids
 * different interpolated world coordinates making a one-pixel discard seam. */
export function oceanCoverage(center:Address,origin:Address,hole?:WaterRect){
 const a=center.x-5000,b=center.z-5000,c=center.x+5000,d=center.z+5000,rects:number[][]=[]
 if(hole&&hole.maxX>a&&hole.minX<c&&hole.maxZ>b&&hole.minZ<d){
  const x0=Math.max(a,hole.minX),x1=Math.min(c,hole.maxX),z0=Math.max(b,hole.minZ),z1=Math.min(d,hole.maxZ)
  rects.push([a,b,x0,d],[x1,b,c,d],[x0,b,x1,z0],[x0,z1,x1,d])
 }else rects.push([a,b,c,d])
 const positions:number[]=[]
 for(const [x0,z0,x1,z1] of rects as [number,number,number,number][]){if(x1<=x0||z1<=z0)continue;for(const [x,z] of [[x0,z0],[x0,z1],[x1,z0],[x1,z0],[x0,z1],[x1,z1]])positions.push(x!-origin.x,SEA_LEVEL,z!-origin.z)}
 const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(new Float32Array(positions),3));geometry.setAttribute('waterFlow',new BufferAttribute(new Float32Array(positions.length),3));return geometry
}
