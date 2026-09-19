import { BufferAttribute, type BufferGeometry } from 'three'
import { classifySurface, surfaceContext } from './surface-context'
import type { WorldSampler } from '../world'

/** Rendered semantic field, sampled in logical world coordinates at mesh vertices. */
export function attachSurfaceAttributes(geometry:BufferGeometry,world:WorldSampler,offsetX:number,offsetZ:number){
 const position=geometry.getAttribute('position'),first=new Float32Array(position.count*3),second=new Float32Array(position.count*3)
 for(let i=0;i<position.count;i++){
  const {weights}=classifySurface(surfaceContext(world,offsetX+position.getX(i),offsetZ+position.getZ(i)))
  first.set(weights.slice(0,3),i*3);second.set(weights.slice(3),i*3)
 }
 geometry.setAttribute('surfaceWeightsA',new BufferAttribute(first,3));geometry.setAttribute('surfaceWeightsB',new BufferAttribute(second,3))
}
