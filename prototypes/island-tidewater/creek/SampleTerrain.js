import {TerrainData} from '../vendor/tidewater/src/world/TerrainData.js';
import {smooth,SAMPLE} from './ContinuousSample.js';
import {mouthFieldAt,mouthFieldInfo} from './MouthTerrainField.js';

// Independently rebuildable authoring overlay over the accepted whole island.
// Every physical query uses these arrays, including roots, shadows and water.
export function applySampleTerrain(data){
  const design=data.field.continuousSample;data.sampleTerrains=[];if(!design)return;
  const terrain=data.terrain,base=terrain.heightAt.bind(terrain),bounds=terrain.boundsFor.bind(terrain);
  const rockAt=(x,z)=>{
    const n=data.island.maskRes,i=Math.max(0,Math.min(n-1,Math.floor((x+16384)/32))),j=Math.max(0,Math.min(n-1,Math.floor((z+16384)/32)));
    return data.islandMasks[(j*n+i)*4+2]/255;
  };
  const create=(id,center,size,res,inner,outer)=>{
    const t=Object.create(TerrainData.prototype),count=res*res;
    Object.assign(t,{id,center,size,res,texel:size/res,origin:-size/2,heights:new Float32Array(count),rock:new Float32Array(count),pads:[],rockSites:[],paths:[],timings:{source:design.id},inner,outer});
    for(const k of ['sand','path','gully','seagrass','rubble','scarp'])t[k]=new Uint8Array(count);
    for(let j=0;j<res;j++)for(let i=0;i<res;i++){
      const x=center[0]-size/2+(i+.5)*t.texel,z=center[1]-size/2+(j+.5)*t.texel,k=j*res+i,old=base(x,z),r=design.nearest(x,z);
      t.heights[k]=mouthFieldAt(x,z,design.sculpt(x,z,old));t.rock[k]=rockAt(x,z);
      if(r&&design.weight(x,z)>0){
        const exposure=(1-smooth(.2,1.6,r.dist-r.width))*(1-smooth(350,620,r.distance));
        t.rock[k]=t.rock[k]*(1-design.weight(x,z)*.82)+exposure*.28;
        t.sand[k]=Math.round((1-smooth(4,15,r.dist-r.width))*smooth(540,800,r.distance)*255);
      }
    }
    t.buildMinMax();const h=t.heightAt.bind(t),b=t.boundsFor.bind(t);
    t.heightAt=(x,z)=>h(x-center[0],z-center[1]);t.boundsFor=(x0,z0,x1,z1)=>b(x0-center[0],z0-center[1],x1-center[0],z1-center[1]);
    return t;
  };
  data.sampleTerrains=[create('continuous-sample',design.center,1024,1024,480,504),create('continuous-spring',design.sourceCenter,128,512,56,62)];
  terrain.heightAt=(x,z)=>{
    let h=base(x,z);for(const p of data.sampleTerrains){const d=Math.max(Math.abs(x-p.center[0]),Math.abs(z-p.center[1])),w=1-smooth(p.inner,p.outer,d);if(w>0)h=h*(1-w)+p.heightAt(x,z)*w;}return h;
  };
  terrain.boundsFor=(x0,z0,x1,z1)=>{
    let [lo,hi]=bounds(x0,z0,x1,z1);for(const p of data.sampleTerrains){const s=p.size/2,[x,z]=p.center;if(x1<x-s||x0>x+s||z1<z-s||z0>z+s)continue;const b=p.boundsFor(x0,z0,x1,z1);lo=Math.min(lo,b[0]);hi=Math.max(hi,b[1]);}return[lo,hi];
  };
  const coast=data.cove.continuous,originalMarine=coast.marineAt;
  coast.marineAt=(x,z)=>{const f=design.sample(x,z),tidal=(1-smooth(-.2,1.5,f[0]))*(1-smooth(0,12,f[1]));return Math.max(originalMarine(x,z),tidal);};
  // Preserve the actual original for a quantitative, same-coordinate report.
  design.baselineHeight=base;design.profile=design.points.filter((_,i)=>i%8===0).map(p=>({x:p.x,z:p.z,distance:p.distance,water:data.field.sample(p.x,p.z)[0],bed:terrain.heightAt(p.x,p.z),baseline:base(p.x,p.z),halfWidth:p.width}));
  design.auditPoints=[];
  for(const p of design.points.filter((_,i)=>i%23===0)){
    design.auditPoints.push([p.x,p.z]);const r=design.nearest(p.x,p.z),n=[r.dir[1],-r.dir[0]];
    for(const d of [-p.width-.2,-p.width+.2,p.width-.2,p.width+.2,36,85])design.auditPoints.push([p.x+n[0]*d,p.z+n[1]*d]);
  }
  for(const z of [-456.1,-456,-455.9,-452,-448.1,-448,-447.9])for(const x of [-690,-687,-686,-685,-682])design.auditPoints.push([x,z]);
  // Actual high-resolution texel centres and both edges of the former hard
  // fine-field support. The startup readback checks the rendered water/bed
  // contract at the reported defect, rather than only at channel centres.
  for(const z of [-499.875,-495.875,-491.625,-487.875,-483.875,-479.875,-467.875]){
    const control=SAMPLE.sections.findIndex(p=>p[1]>=z),a=SAMPLE.sections[control-1],b=SAMPLE.sections[control];
    const t=(z-a[1])/(b[1]-a[1]),cx=a[0]+(b[0]-a[0])*t,w=a[3]+(b[3]-a[3])*t;
    for(const side of [-1,1])for(const edge of [1.999,2.001,3,4,5,5.999,6.001])design.auditPoints.push([cx+side*(w+edge),z]);
  }
  for(const p of data.sampleTerrains)for(const d of [p.inner-.1,p.inner+.1,p.outer-.1,p.outer+.1])for(const side of [-1,1])design.auditPoints.push([p.center[0]+side*d,p.center[1]],[p.center[0],p.center[1]+side*d]);
  for(const z of [mouthFieldInfo.outer[1],mouthFieldInfo.inner[1],mouthFieldInfo.inner[3],mouthFieldInfo.outer[3]])for(const x of [-1050,-1000,-900,-812,-780])design.auditPoints.push([x,z]);
  for(const x of [mouthFieldInfo.outer[0],mouthFieldInfo.inner[0],mouthFieldInfo.inner[2],mouthFieldInfo.outer[2]])for(const z of [-40,0,125,266,300])design.auditPoints.push([x,z]);
  design.terrainAudit={mouthField:mouthFieldInfo,layers:data.sampleTerrains.map(p=>({id:p.id,center:p.center,size:p.size,res:p.res,texel:p.texel,blend:[p.inner,p.outer]})),profile:design.profile,samePhysicalArrays:true,extraFramePasses:0};
}
