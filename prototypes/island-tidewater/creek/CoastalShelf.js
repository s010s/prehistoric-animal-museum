// Museum-authored, coast-following bathymetry. One CPU construction before
// native height/normal/shadow upload; no additional per-frame simulation.
import {Noise2D} from '../vendor/tidewater/src/util/Noise.js';
const SEA=-.7;
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const mix=(a,b,t)=>a+(b-a)*t;

// Squared Euclidean distance transform, in grid units. Finite infinity keeps
// entirely wet rows defined until the orthogonal pass reaches the island.
function distanceTransform(ocean,n){
 const tmp=new Float32Array(n*n),out=new Float32Array(n*n);
 const f=new Float64Array(n),d=new Float64Array(n),v=new Int32Array(n),z=new Float64Array(n+1);
 const line=()=>{
  let k=0;v[0]=0;z[0]=-Infinity;z[1]=Infinity;
  for(let q=1;q<n;q++){
   let s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*(q-v[k]));
   while(s<=z[k]){k--;s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*(q-v[k]));}
   k++;v[k]=q;z[k]=s;z[k+1]=Infinity;
  }
  k=0;for(let q=0;q<n;q++){while(z[k+1]<q)k++;d[q]=(q-v[k])**2+f[v[k]];}
 };
 for(let j=0;j<n;j++){for(let i=0;i<n;i++)f[i]=ocean[j*n+i]?1e12:0;line();tmp.set(d,j*n);}
 for(let i=0;i<n;i++){for(let j=0;j<n;j++)f[j]=tmp[j*n+i];line();for(let j=0;j<n;j++)out[j*n+i]=d[j];}
 return out;
}

export function extendCoastalShelf(grids,readHeight,waterField){
 const started=performance.now(),size=32768,n=1024,texel=size/n,origin=-size/2;
 const heights=new Float32Array(n*n),ocean=new Uint8Array(n*n),queue=new Int32Array(n*n);
 for(let j=0;j<n;j++)for(let i=0;i<n;i++)heights[j*n+i]=readHeight(origin+(i+.5)*texel,origin+(j+.5)*texel);
 let head=0,tail=0;
 const enqueue=k=>{if(!ocean[k]&&heights[k]<SEA){ocean[k]=1;queue[tail++]=k;}};
 for(let i=0;i<n;i++){enqueue(i);enqueue((n-1)*n+i);enqueue(i*n);enqueue(i*n+n-1);}
 while(head<tail){const k=queue[head++],i=k%n,j=Math.floor(k/n);if(i>0)enqueue(k-1);if(i<n-1)enqueue(k+1);if(j>0)enqueue(k-n);if(j<n-1)enqueue(k+n);}
 const sq=distanceTransform(ocean,n),distance=new Float32Array(n*n);
 for(let k=0;k<distance.length;k++)distance[k]=ocean[k]?(Math.sqrt(sq[k])-.5)*texel:-texel*.5;
 const at=(a,x,z)=>{
  const fx=Math.max(0,Math.min(n-1.001,(x-origin)/texel-.5)),fz=Math.max(0,Math.min(n-1.001,(z-origin)/texel-.5)),i=Math.floor(fx),j=Math.floor(fz),u=fx-i,v=fz-j,k=j*n+i;
  return mix(mix(a[k],a[k+1],u),mix(a[k+n],a[k+n+1],u),v);
 };
 const noise=new Noise2D(71321),small=new Noise2D(2917);
 const distanceAt=(x,z)=>at(distance,x,z);
 const oceanAt=(x,z)=>at(ocean,x,z)>.5;
 const widthAt=(x,z)=>880+noise.noise(x/1700,z/1900)*230+noise.noise(x/630+9,z/710-7)*90;
 const shape=(x,z,d)=>{
  const width=widthAt(x,z),q=d/width;
  const curve=[[0,.12],[.05,.85],[.18,1.95],[.35,3.3],[.55,5.5],[.72,9.2],[.86,18],[1,37]];
  let depth=37;for(let i=1;i<curve.length;i++)if(q<curve[i][0]){const a=curve[i-1],b=curve[i];depth=mix(a[1],b[1],smooth(a[0],b[0],q));break;}
  const wx=x+noise.noise(x/310,z/270)*45,wz=z+noise.noise(x/370+81,z/330)*45;
  // Resolve at least six samples even on the16m outer field. Sub-grid relief
  // belongs to the filtered material, rather than normals/AO on a coarse grid.
  const relief=noise.noise(wx/137,wz/173)*1.25+small.noise(wx/97,wz/123)*.18;
  const reef=smooth(.17,.65,noise.noise(wx/193+31,wz/157))*2.1;
  depth=Math.max(.18,depth-(relief+reef)*smooth(15,90,d)*(1-smooth(.72,1,q)));
  return {height:SEA-depth,weight:1-smooth(.94,1.28,q),width,reef};
 };

 // March the actual sea-level crossings, excluding enclosed inland basins.
 // Length weights come from sub-cell crossings, not compass-point counts.
 const segments=[];
 for(let j=0;j<n-1;j++)for(let i=0;i<n-1;i++){
  const ids=[j*n+i,j*n+i+1,(j+1)*n+i+1,(j+1)*n+i],wet=ids.map(k=>ocean[k]);
  if(wet.every(v=>v===wet[0]))continue;
  const corners=[[i,j],[i+1,j],[i+1,j+1],[i,j+1]],cross=[];
  for(let e=0;e<4;e++){
   const next=(e+1)%4;if(wet[e]===wet[next])continue;
   const h=heights[ids[e]],h1=heights[ids[next]],u=Math.max(0,Math.min(1,(SEA-h)/(h1-h)));
   cross.push([origin+(mix(corners[e][0],corners[next][0],u)+.5)*texel,origin+(mix(corners[e][1],corners[next][1],u)+.5)*texel]);
  }
  for(let e=0;e+1<cross.length;e+=2){
   const a=cross[e],b=cross[e+1],x=(a[0]+b[0])/2,z=(a[1]+b[1])/2,length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<.01)continue;
   let nx=at(heights,x-8,z)-at(heights,x+8,z),nz=at(heights,x,z-8)-at(heights,x,z+8),l=Math.hypot(nx,nz);
   if(l<.0001){nx=b[1]-a[1];nz=a[0]-b[0];l=Math.hypot(nx,nz);}
   nx/=l;nz/=l;if(!oceanAt(x+nx*24,z+nz*24)){nx=-nx;nz=-nz;}
   segments.push({point:[x,z],normal:[nx,nz],length});
  }
 }
 const xs=segments.map(s=>s.point[0]),zs=segments.map(s=>s.point[1]);
 const center=[(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...zs)+Math.max(...zs))/2];
 const sectorOf=p=>((Math.round(Math.atan2(p[1]-center[1],p[0]-center[0])*4/Math.PI)+8)%8);
 const labels=['东岸','东南岸','南岸','西南岸','西岸','西北岸','北岸','东北岸'];
 const stations=labels.map((label,k)=>{
  const angle=k*Math.PI/4;
  const choices=segments.filter(s=>sectorOf(s.point)===k);
  const s=choices.reduce((a,b)=>{
   const score=s=>Math.abs(Math.atan2(Math.sin(Math.atan2(s.point[1]-center[1],s.point[0]-center[0])-angle),Math.cos(Math.atan2(s.point[1]-center[1],s.point[0]-center[0])-angle)));
   return score(a)<score(b)?a:b;
  });
  return {...s,id:'shelf-'+['east','southeast','south','southwest','west','northwest','north','northeast'][k],label,sector:k,width:widthAt(...s.point),at(offshore,along=0){return [s.point[0]+s.normal[0]*offshore-s.normal[1]*along,s.point[1]+s.normal[1]*offshore+s.normal[0]*along];}};
 });
 const probeDistances=[25,75,150,300,500,750,1100,1500];
 const measure=height=>{
  const sectors=labels.map((label,i)=>({label,sector:i,coastLength:0,shallowLength:0,blockedLength:0}));
  const rows=segments.map(s=>{
   const depths=[75,150,300].map(d=>{const x=s.point[0]+s.normal[0]*d,z=s.point[1]+s.normal[1]*d;return {offshore:d,point:[x,z],ocean:oceanAt(x,z),depth:SEA-height(x,z)};});
   const blocked=depths.some(p=>!p.ocean||p.depth<=.1),shallow=!blocked&&depths.every(p=>p.depth<=12);
   const sector=sectors[sectorOf(s.point)];sector.coastLength+=s.length;if(shallow)sector.shallowLength+=s.length;if(blocked)sector.blockedLength+=s.length;
   return {...s,sector:sector.sector,depths,shallow,blocked};
  });
  const coastLength=sectors.reduce((a,s)=>a+s.coastLength,0),shallowLength=sectors.reduce((a,s)=>a+s.shallowLength,0);
  return {coastLength,shallowLength,coverage:shallowLength/coastLength,sectors:sectors.map(s=>({...s,coverage:s.shallowLength/s.coastLength})),transects:stations.map(s=>({id:s.id,label:s.label,point:s.point,normal:s.normal,width:s.width,samples:probeDistances.map(offshore=>{const point=s.at(offshore);return {offshore,point,ocean:oceanAt(...point),depth:SEA-height(...point)};})})),rows};
 };
 const before=measure(readHeight),changes=[];
 for(const grid of grids){
  // All terrain channels start aliased on global grids. Split before writing.
  grid.sand=new Uint8Array(grid.sand);let changed=0,maxShift=0,dryChanged=0,protectedWater=0;
  const c=grid.center??[0,0],ox=c[0]-grid.size/2,oz=c[1]-grid.size/2,f=[0,0,0,0];
  for(let j=0;j<grid.res;j++)for(let i=0;i<grid.res;i++){
   const k=j*grid.res+i,old=grid.heights[k];if(old>=SEA-.12)continue;
   const x=ox+(i+.5)*grid.texel,z=oz+(j+.5)*grid.texel,d=distanceAt(x,z);if(d<=0||d>1550||!oceanAt(x,z))continue;
   waterField.sample(x,z,f);
   // An estuary is continuous with the shelf. A hard level cutoff raised the
   // first unprotected row by metres and baked its diagonal into the bed/AO.
   // Keep the river thalweg through the tidal reach; relax only gradually in
   // the sea-level tail, and feather sideways across both wet banks.
   const tail=f[0]>SEA+.01?1:1-smooth(3500,4050,z);
   const channel=(1-smooth(-8,24,f[1]))*tail;
   if(channel>.999){protectedWater++;continue;}
   const form=shape(x,z,d);if(form.weight<=0)continue;
   // Leave the source wet/dry vertices intact. Near shore, the old shallow
   // slope is the upper envelope; no submerged moat around a new sand platform.
   const target=d<50?Math.max(old,form.height):form.height;
   const weight=form.weight*(1-channel);const y=mix(old,target,weight);
   if(y===old)continue;grid.heights[k]=y;changed++;maxShift=Math.max(maxShift,Math.abs(y-old));if(old>=SEA)dryChanged++;
   const sand=1-smooth(.18,.7,form.reef/2.1);grid.sand[k]=Math.round(sand*255);grid.rock[k]=mix(grid.rock[k],.06+(1-sand)*.5,weight);
  }
  grid.buildMinMax();changes.push({grid:grid.id??'regional',changed,maxShift,dryChanged,protectedWater});
 }
 const after=measure(readHeight),strip=r=>{const {rows,...summary}=r;return summary;};
 const audit={schema:'museum-continuous-shelf-v1',seaLevel:SEA,gridMetres:texel,definition:'Length-weighted ocean-connected sea-level contour; all normal probes at75/150/300m must have0.1–12m depth. Land-blocked transects count as failures.',before,after,changes};
 const summary={...strip(after),baseline:strip(before),gridMetres:texel,definition:audit.definition,coastSegments:segments.length,changes,buildMs:performance.now()-started,extraFramePasses:0,extraGPUTextureBindings:0,chartBytes:distance.byteLength+ocean.byteLength};
 return {summary,audit,stations,segments,distanceAt,oceanAt,marineAt:(x,z)=>at(ocean,x,z),widthAt};
}
