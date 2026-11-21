import {BufferAttribute,BufferGeometry,InstancedMesh,Matrix4,Quaternion,Euler,Vector3} from '../vendor/tidewater/src/engine/index.js';

const url=new URL('./assets/.transport/marine-rock-profiles.bin',import.meta.url);
const linear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;

export async function loadMarineRockProfiles(){
  const bytes=globalThis.__assetFile?await globalThis.__assetFile(url.href):await fetch(url).then(r=>{
    if(!r.ok)throw Error('Cannot read submarine rock profiles: '+r.status);
    return r.arrayBuffer();
  });
  const view=new DataView(bytes),profiles=[];
  let offset=0;
  while(offset<bytes.byteLength){
    const count=view.getUint32(offset,true),indices=view.getUint32(offset+4,true);offset+=8;
    const p=new Float32Array(count*3),n=new Float32Array(count*3),colors=new Float32Array(count*3);
    for(let j=0;j<count;j++,offset+=12)for(let k=0;k<3;k++){
      p[j*3+k]=view.getInt16(offset+k*2,true)/30000;
      n[j*3+k]=view.getInt8(offset+6+k)/127;
      colors[j*3+k]=linear(view.getUint8(offset+9+k)/255);
    }
    const idx=new Uint16Array(bytes,offset,indices);offset+=indices*2;
    const geometry=new BufferGeometry();
    geometry.setAttribute('position',new BufferAttribute(p,3));
    geometry.setAttribute('normal',new BufferAttribute(n,3));
    geometry.setAttribute('tint',new BufferAttribute(colors,3));
    geometry.setIndex(new BufferAttribute(idx,1));geometry.computeBoundingSphere();
    profiles.push({geometry,instances:[]});
  }
  return profiles;
}

export function placeMarineRock(profile, host, x,y,z, sx,sy,sz, yaw,pitch,roll){
  const pos=new Vector3(x,y,z);
  const q=new Quaternion().setFromEuler(new Euler(pitch,yaw,roll,'YXZ'));
  const transform=new Matrix4().compose(pos,q,new Vector3(sx,sy,sz));
  profile.instances.push({x,y,z,matrix:Float32Array.from(transform.elements)});
  // Reference faces are used only while fixing the actual attachment points.
  // The renderer reuses one shared mesh per original specimen.
  const base=host.pos.length/3, points=profile.geometry.attributes.position.array, m=transform.elements;
  for(let i=0;i<points.length;i+=3){
    const px=points[i],py=points[i+1],pz=points[i+2];
    host.pos.push(x+m[0]*px+m[4]*py+m[8]*pz,y+m[1]*px+m[5]*py+m[9]*pz,z+m[2]*px+m[6]*py+m[10]*pz);
  }
  for(const index of profile.geometry.index.array)host.idx.push(base+index);
}

export function attachMarineRockProfiles(profiles,material,group){
  for(const p of profiles){
    p.mesh=new InstancedMesh(p.geometry,material,Math.max(1,p.instances.length));
    p.mesh.name='Subtidal lithology';p.mesh.castShadow=false;p.mesh.receiveShadow=true;
    p.mesh.staticVelocity=true;p.mesh.frustumCulled=false;p.mesh.count=0;p.mesh.visible=false;
    group.add(p.mesh);
  }
}

export function updateMarineRockProfiles(profiles,eye){
  for(const p of profiles){
    let count=0;
    for(const row of p.instances){
      if((eye.x-row.x)**2+(eye.y-row.y)**2+(eye.z-row.z)**2>49*49)continue;
      p.mesh.instanceMatrix.array.set(row.matrix,count++*16);
    }
    p.mesh.count=count;p.mesh.visible=count>0;p.mesh.instanceMatrix.needsUpdate=true;
  }
}
