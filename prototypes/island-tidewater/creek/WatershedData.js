// Museum-authored regional extension: the same 4m terrain grid reaches the
// original river's sea-level outlet, while the accepted 1m creek core stays.
import {TerrainData} from '../vendor/tidewater/src/world/TerrainData.js';
import {bedRelief} from './BedRelief.js';

export async function expandWatershed(data){
 const get=async(url,json=false)=>{const r=await fetch(url);if(!r.ok)throw Error('Watershed asset '+r.status);return json?r.json():r.arrayBuffer();};
 const [layout,h,m,p]=await Promise.all([get(new URL('./assets/watershed-layout.json',import.meta.url),true),get(new URL('./assets/watershed-heights.bin',import.meta.url)),get(new URL('./assets/watershed-masks.bin',import.meta.url)),get(new URL('./assets/river-profile.bin',import.meta.url))]);
 data.field.extendRiver(layout,new Float32Array(p));
 const cover=data.terrain,core=data.coreTerrain,outer=Object.create(TerrainData.prototype),masks=new Uint8Array(m),n=layout.res**2;
 Object.assign(outer,{size:layout.size,res:layout.res,texel:layout.texel,origin:layout.origin,heights:new Float32Array(h),pads:[],rockSites:[],paths:[],timings:{source:'museum original main watershed'}});
 outer.rock=new Float32Array(n);for(const key of ['sand','path','gully','seagrass','rubble','scarp'])outer[key]=new Uint8Array(n);
 for(let j=0;j<outer.res;j++)for(let i=0;i<outer.res;i++){const k=j*outer.res+i,q=(Math.floor(j*layout.maskRes/outer.res)*layout.maskRes+Math.floor(i*layout.maskRes/outer.res))*4,y=outer.heights[k];outer.path[k]=masks[q];outer.rock[k]=masks[q+2]/255;outer.sand[k]=Math.round((1-outer.rock[k])*Math.max(0,1-Math.abs(y+.7)/8)*255);}
 // Apply modest geometric undulation before rebuilding min/max, normals,
 // shadows, collisions, grass roots and water depths from these same heights.
 let changed=0,maxShift=0;const f=[0,0,0,0];
 for(const t of [core,cover,outer]){
  for(let j=0;j<t.res;j++)for(let i=0;i<t.res;i++){const k=j*t.res+i,x=t.origin+(i+.5)*t.texel,z=t.origin+(j+.5)*t.texel,old=t.heights[k];data.field.sample(x,z,f);const water=f[1]<1?Math.max(-.7,f[0]):-.7;const y=bedRelief(x,z,old,water,t.texel);if(y!==old){t.heights[k]=y;changed++;maxShift=Math.max(maxShift,Math.abs(y-old));}}
  t.buildMinMax();
 }
 const baseHeight=outer.heightAt.bind(outer),baseBounds=outer.boundsFor.bind(outer);
 const weight=(x,z)=>{const u=Math.max(0,Math.min(1,(Math.max(Math.abs(x),Math.abs(z))-448)/48));return 1-u*u*(3-2*u);};
 outer.heightAt=(x,z)=>{const w=weight(x,z),h=baseHeight(x,z);return w>0?h*(1-w)+core.heightAt(x,z)*w:h;};
 outer.boundsFor=(x0,z0,x1,z1)=>{const b=baseBounds(x0,z0,x1,z1);if(x1< -496||z1< -496||x0>496||z0>496)return b;const c=core.boundsFor(Math.max(x0,-496),Math.max(z0,-496),Math.min(x1,496),Math.min(z1,496));return [Math.min(b[0],c[0]),Math.max(b[1],c[1])];};
 data.coverTerrain=cover;data.terrain=outer;data.field.terrain=outer;data.hydrology=layout;data.hydroMasks=masks;
 data.bedRevision={id:'museum-bed-v1',changedGridSamples:changed,maxShiftMetres:maxShift,protected:'ford, spring pool, thin falls and dry shoreline',physicalHeightsShared:true};return data;
}
