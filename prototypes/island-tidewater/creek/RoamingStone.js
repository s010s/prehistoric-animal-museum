// The marine reef already loads these two screened geological specimens.
// Its low-resolution index addresses the very same textured rock surface.
import {BufferAttribute} from '../vendor/tidewater/src/engine/index.js';

export function roamingStoneGeometry(profile, coarse) {
  const g=profile.geometry.clone();
  if (coarse) g.setIndex(new BufferAttribute(profile.coarseIndices,1));
  g.scale(2.08,1.27,1.69);
  const color=g.attributes.tint, packed=new Float32Array(color.count*4);
  for (let i=0;i<color.count;i++) {
    const rgb=[color.getX(i),color.getY(i),color.getZ(i)].map(v=>Math.max(2,Math.min(255,Math.round(v*255))));
    packed[i*4+1]=(rgb[0]<<16)+(rgb[1]<<8)+rgb[2];
    packed[i*4+2]=.93;
  }
  g.setAttribute('aData',new BufferAttribute(packed,4));
  return g;
}
