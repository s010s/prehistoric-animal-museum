import {TerrainData} from '../vendor/tidewater/src/world/TerrainData.js';
import {Noise2D} from '../vendor/tidewater/src/util/Noise.js';
import {smooth,SAMPLE} from './ContinuousSample.js';
import {mouthFieldAt,mouthFieldInfo} from './MouthTerrainField.js';

const SEA=SAMPLE.sea;
const shoreNoise=new Noise2D(59173);
// The west-facing shore is a curved contour, with a broad inlet where the
// stream arrives. A low foreshore grades into the inherited hills instead of
// meeting the creek in two right angles. All numbers are metres in island XZ.
const shoreX=z=>-864+6.5*shoreNoise.noise(z/72,17.1)+2.8*shoreNoise.noise(z/23,3.8)+15*Math.exp(-(((z-126)/38)**2));
function gradeMouthShore(x,z,bed,shoreline){
  const d=x-shoreline,offshore=Math.max(0,-d);
  // A fixed alongshore range ended its full-strength beach treatment on a
  // perfectly straight east-west line. Drift the feather with the river fan
  // and broad landform noise so that it is a contour, not a tile boundary.
  const along=Math.abs(z-126-offshore*.10+shoreNoise.noise(x/64,z/91)*11);
  const support=(1-smooth(108,235,along))*(1-smooth(95,160,-d))*(1-smooth(72,150,d));
  if(support<=0)return bed;
  const land=Math.max(0,d),sea=Math.max(0,-d);
  // Native run-up measures distance with a 0.066 beach slope. Keep the first
  // thirty metres of our foreshore close to that slope. Smooth its slope
  // through sea level, rather than joining two planes at a sharp edge.
  const profile=SEA+d*(.023+(.050-.023)*smooth(-4,4,d))+land*land*.00026-sea*sea*.000025;
  // Small cusps and wind-built ridges are irregular, interrupted deposits.
  // A fixed 24 m sine and an unbroken berm drew two parallel combs around
  // the river mouth even when the wet-sand simulation moved correctly.
  const broad=.05*shoreNoise.noise(z/57,x/73)*Math.exp(-(((d+4)/47)**2));
  const cusp=.035*shoreNoise.noise(z/18+shoreNoise.noise(z/79,9.4)*.45,1.7)*smooth(4,12,land)*(1-smooth(20,32,land));
  const bermAxis=32+5*shoreNoise.noise(z/85,7.8);
  const berm=.065*smooth(-.12,.25,shoreNoise.noise(z/51,2.6))*Math.exp(-(((land-bermAxis)/7)**2));
  return bed*(1-support)+(profile+broad+cusp+berm)*support;
}
function softenOffshorePit(x,z,bed,design,shoreline){
  const offshore=shoreline-x;if(offshore<0||bed>=SEA)return bed;
  // A fan-shaped deposit joins the local sand shelf at every azimuth. The
  // earlier narrow cap ended before the 300 m offshore hollow, leaving the
  // same dark rectangle visible from the user's reverse overhead camera.
  // The sediment shoulder follows a weak alongshore drift, not a symmetric
  // oval centred on the channel. Its broad feather cannot form a depth step.
  const fan=Math.hypot(offshore/570,(z-126-offshore*.10)/260);
  // The shelf repair belongs offshore. Previously a barely submerged sand
  // shoulder was lowered to the deep-water envelope while its dry neighbour
  // was untouched: the SEA test then became a vertical mouth-bank seam.
  // Fade by both distance from the shoreline and existing water depth so the
  // run-up slope and the stream's carved edge remain continuous.
  const support=(1-smooth(.84,1.22,fan))*smooth(8,48,offshore)*smooth(.03,.65,SEA-bed);
  if(support<=0)return bed;
  const r=design.nearest(x,z),ebb=r?(1-smooth(r.width*.65,r.width+20,r.dist))*(1-smooth(810,920,r.distance)):0;
  // River sand fills the inherited hollow and blankets the old repetitive
  // shelf ribs. Both high and low parts converge toward one depth envelope;
  // raising only the pit left three permanent dark bars in shallow water.
  const maxDepth=.38+offshore*.006+offshore*offshore*.000004+ebb*1.45;
  // One low mouth bar drifts downshore. It is far lower than the former
  // repeated ribs, so a wave can run across it without a hard break line.
  const bar=.18*Math.exp(-(((offshore-112)/76)**2+((z-169-offshore*.10)/94)**2))*(1+.18*shoreNoise.noise(x/47,z/63));
  const floor=SEA-maxDepth+bar+.055*shoreNoise.noise(x/59,z/71)+.025*shoreNoise.noise(x/19,z/25);
  const target=floor+Math.min(0,bed-floor)*ebb;
  return bed*(1-support)+target*support;
}

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
    for(let j=0;j<res;j++){
      const z=center[1]-size/2+(j+.5)*t.texel,shoreline=shoreX(z);
      for(let i=0;i<res;i++){
        const x=center[0]-size/2+(i+.5)*t.texel,k=j*res+i,old=base(x,z),r=design.nearest(x,z);
        const authored=mouthFieldAt(x,z,old);
        const coast=gradeMouthShore(x,z,authored,shoreline);
        // Carve the varying cross-section last. The former z<172 ownership
        // switch was visible as a transverse shelf and square mouth corners.
        const sculpted=design.sculpt(x,z,coast);
        t.heights[k]=softenOffshorePit(x,z,sculpted,design,shoreline);t.rock[k]=rockAt(x,z);
        if(r&&design.weight(x,z)>0){
          const exposure=(1-smooth(.2,1.6,r.dist-r.width))*(1-smooth(350,620,r.distance));
          t.rock[k]=t.rock[k]*(1-design.weight(x,z)*.82)+exposure*.28;
          t.sand[k]=Math.round((1-smooth(4,15,r.dist-r.width))*smooth(540,800,r.distance)*255);
        }
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
  // Measure the final physical bed rather than calling the authored half
  // width a visible water width. This also exposes shelves and deep habitat
  // after the one-metre terrain reconstruction has softened a cross-section.
  const crossSections=SAMPLE.sections.map((p,index)=>{
    const r=design.nearest(p[0],p[1]),step=index<8?.05:.25,normal=[r.dir[1],-r.dir[0]],wet=[];
    let area=0,deepWidth=0;
    for(let across=-r.width-1;across<=r.width+1;across+=step){
      const x=p[0]+normal[0]*across,z=p[1]+normal[1]*across,f=design.sample(x,z),depth=f[0]-terrain.heightAt(x,z);
      if(f[1]<.05&&depth>.03){wet.push({across,depth});area+=depth*step;if(depth>=1.2)deepWidth+=step;}
    }
    return {index,x:p[0],z:p[1],distance:r.distance,authoredWidth:r.width*2,authoredDepth:r.depth,
      wetWidth:wet.length?wet.at(-1).across-wet[0].across:0,centreDepth:design.sample(p[0],p[1])[0]-terrain.heightAt(p[0],p[1]),
      maxDepth:wet.length?Math.max(...wet.map(q=>q.depth)):0,submergedArea:area,depthOver1_2MetresWidth:deepWidth};
  });
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
  const mouthTransects=[84,108,125,145,170,195].map(z=>({z,samples:Array.from({length:34},(_,i)=>{const x=-1400+i*20;return {x,bed:terrain.heightAt(x,z),water:data.field.sample(x,z)[0]};})}));
  design.terrainAudit={mouthField:mouthFieldInfo,shore:'curved inlet and graded foreshore; offshore depth limited before the inherited shelf',layers:data.sampleTerrains.map(p=>({id:p.id,center:p.center,size:p.size,res:p.res,texel:p.texel,blend:[p.inner,p.outer]})),profile:design.profile,crossSections,mouthTransects,samePhysicalArrays:true,extraFramePasses:0};
}
