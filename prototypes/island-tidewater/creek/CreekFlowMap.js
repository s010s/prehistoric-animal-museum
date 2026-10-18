// A static, bounded whitewater-source map from our authored spring, not a fluid
// simulation. This replaces repeated upstream height queries in every pixel.
import {Texture} from '../vendor/tidewater/src/engine/gpu/Texture.js';
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function creekFlowMap(field) {
  const origin=[-72,-96],size=96,res=192,data=new Uint8Array(res*res*4);
  const slope=(x,z)=>{
    const f=field.sample(x,z);if(f[1]>.05)return 0;
    const h=(dx,dz)=>{const v=field.sample(x+dx,z+dz);return v[1]>.05||Math.abs(v[0]-f[0])>2?f[0]:v[0];};
    return Math.hypot(h(.5,0)-h(-.5,0),h(0,.5)-h(0,-.5));
  };
  let active=0;
  for(let j=0;j<res;j++)for(let i=0;i<res;i++){
    const x=origin[0]+(i+.5)*size/res,z=origin[1]+(j+.5)*size/res;
    const f=field.sample(x,z),speed=Math.hypot(f[2],f[3]),k=(j*res+i)*4;
    if(f[1]>.05||speed<.55)continue;
    const grad=slope(x,z),dx=f[2]/speed,dz=f[3]/speed;
    let upstream=0;
    for(const d of [.65,1.3,2.1,3.2])upstream=Math.max(upstream,smooth(.32,1.15,slope(x-dx*d,z-dz*d))*Math.exp(-d/1.7));
    const landing=upstream*(1-smooth(.15,.65,grad))*smooth(.55,1.3,speed);
    const rapid=smooth(.15,.95,grad)*smooth(.65,1.8,speed);
    data[k]=Math.round(landing*255);data[k+1]=Math.round(rapid*255);
    data[k+2]=Math.round(smooth(.5,1.2,speed)*(1-smooth(.12,.5,f[0]-field.terrain.heightAt(x,z)))*255);data[k+3]=255;active++;
  }
  const texture=new Texture({label:'Museum spring whitewater sources',width:res,height:res,format:'rgba8unorm',data,usage:['sample','copyDst'],sampler:'linearClamp'});
  return {texture,origin,size,res,active,method:'authored speed/slope, four upstream samples and 1.7m downstream decay; static source map'};
}
