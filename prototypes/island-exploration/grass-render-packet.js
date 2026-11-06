import {Object3D,Color} from 'three'

// Keep source doubles for current-camera selection; only final GPU rows are floats.
export function makeGrassRenderPacket(items) {
  const count=items.length,raw=new Float64Array(count*9),matrices=new Float32Array(count*16),colors=new Float32Array(count*3)
  const object=new Object3D(),color=new Color()
  for(let i=0;i<count;i++){
    const p=items[i],j=i*9
    raw.set([p.x,p.z,p.y,p.scale,p.sy,p.sx,p.sz,p.yaw,p.tint],j)
    object.position.set(p.x,p.y,p.z)
    object.rotation.set(p.tilt??0,p.yaw,p.roll??0)
    object.scale.set(p.scale*(p.sx??1),p.scale*(p.sy??1),p.scale*(p.sz??1))
    object.updateMatrix();object.matrix.toArray(matrices,i*16)
    const shade=p.tint??1
    color.setRGB(shade*.97,shade,shade*.93);color.toArray(colors,i*3)
  }
  return {count,length:count,raw,matrices,colors}
}

// Diagnostic identity only. The normal render path does not rebuild objects.
export function grassRecord(packet,index) {
  const a=packet.raw,i=index*9
  return {x:a[i],z:a[i+1],y:a[i+2],scale:a[i+3],sy:a[i+4],sx:a[i+5],sz:a[i+6],yaw:a[i+7],tint:a[i+8]}
}
