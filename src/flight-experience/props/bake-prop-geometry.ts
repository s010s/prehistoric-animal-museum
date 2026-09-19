import {BufferAttribute,type BufferGeometry,type Matrix4} from 'three'
/** glTF quantized attributes must be decoded before baking a metre-space matrix.
 * Writing transformed metres back into normalized integers wraps/clamps the tree. */
export function bakePropGeometry(source:BufferGeometry,matrix:Matrix4){
 const geometry=source.clone()
 for(const name of ['position','normal','tangent']){
  const attribute=source.getAttribute(name);if(!attribute)continue
  const values=new Float32Array(attribute.count*attribute.itemSize)
  for(let i=0;i<attribute.count;i++)for(let c=0;c<attribute.itemSize;c++)values[i*attribute.itemSize+c]=attribute.getComponent(i,c)
  geometry.setAttribute(name,new BufferAttribute(values,attribute.itemSize))
 }
 geometry.applyMatrix4(matrix);geometry.computeBoundingBox();geometry.computeBoundingSphere()
 return geometry
}
