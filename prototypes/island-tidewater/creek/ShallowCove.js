// Museum-authored connected bathymetry. Dry shore is preserved; every physical
// grid, depth query, normal bake and navigation reads the same edited arrays.
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const lerp=(a,b,t)=>a+(b-a)*t;
export const SHELF_DESIGNS=[
 {id:'west-shelf',center:[-864.4846725463867,-32],normal:[-1,0],along:760,width:500,kind:'sand tongues and exposed stone ribs'},
 {id:'east-shelf',center:[11160,2990],normal:[1,0],along:1040,width:600,kind:'sheltered blue bay with stepped sand channels'},
 {id:'south-shelf',center:[6200,7750],normal:[0,1],along:1250,width:640,kind:'broad sediment shelf and scattered boulders'},
];
export function sculptShallowCove(regional,global,site,otherGrids=[]){
 const sea=-.7,grids=[global,regional,...otherGrids],step=8;
 // Query untouched grids with the same regional blends as the final surface.
 const base=(x,z)=>{let h=global.heightAt(x,z);for(const p of [regional,...otherGrids]){const c=p.center??[0,0],w=1-smooth(3800,4080,Math.max(Math.abs(x-c[0]),Math.abs(z-c[1])));if(w>0)h=lerp(h,p.heightAt(x,z),w);}return h;};
 const shelves=SHELF_DESIGNS.map(design=>{
  const center=design.id==='west-shelf'?[site.x,site.z]:design.center,n=design.normal,t=[-n[1],n[0]],edges=[],span=design.along+80;
  for(let a=-span;a<=span+step;a+=step){
   // Find the first contiguous open-water crossing on this coast transect.
   let lo=-900,hi=900;for(let i=0;i<22;i++){const d=(lo+hi)/2,h=base(center[0]+t[0]*a+n[0]*d,center[1]+t[1]*a+n[1]*d);if(h>sea)lo=d;else hi=d;}edges.push((lo+hi)/2);
  }
  const shore=a=>{const f=Math.max(0,Math.min(edges.length-1.0001,(a+span)/step)),i=Math.floor(f);return lerp(edges[i],edges[i+1],f-i);};
  const at=(along,offshore=0)=>{const d=shore(along)+offshore;return[center[0]+t[0]*along+n[0]*d,center[1]+t[1]*along+n[1]*d];};
  return {...design,center,tangent:t,shore,at,changedSamples:0,maxShiftMetres:0};
 });
 for(const grid of grids){grid.sand=new Uint8Array(grid.sand);const c=grid.center??[0,0],ox=c[0]-grid.size/2,oz=c[1]-grid.size/2;
  for(const shelf of shelves){const {center:c,normal:n,tangent:t,along:A,width:W}=shelf,R=A+W+100;
   const i0=Math.max(0,Math.floor((c[0]-R-ox)/grid.texel)),i1=Math.min(grid.res-1,Math.ceil((c[0]+R-ox)/grid.texel));
   const j0=Math.max(0,Math.floor((c[1]-R-oz)/grid.texel)),j1=Math.min(grid.res-1,Math.ceil((c[1]+R-oz)/grid.texel));
   for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
    const k=j*grid.res+i,x=ox+(i+.5)*grid.texel,z=oz+(j+.5)*grid.texel,dx=x-c[0],dz=z-c[1],a=dx*t[0]+dz*t[1],off=dx*n[0]+dz*n[1]-shelf.shore(a),old=grid.heights[k];
    const width=1+Math.sin(a*.008+.6)*.14+Math.sin(a*.019+1.7)*.07,d=off/width,w=(1-smooth(A*.72,A,Math.abs(a)))*smooth(.3,9,d)*(1-smooth(W*.72,W,d));
    if(w<=0||old>sea+.2)continue;
    const q=d/W,curve=[[0,0],[.04,.55],[.12,1.5],[.25,3],[.42,5],[.64,9.5],[.82,19],[1,34]];let dep=34;
    for(let u=1;u<curve.length;u++)if(q<=curve[u][0]){const [v,h]=curve[u-1],[vv,hh]=curve[u];dep=lerp(h,hh,(q-v)/(vv-v));break;}
    const envelope=smooth(5,35,d)*(1-smooth(W*.65,W,d)),ribs=Math.sin(a*.031+Math.sin(d*.017)*1.3)*Math.sin(d*.044+a*.007)*.45;
    const tongue=Math.exp(-((a*.007+Math.sin(d*.015)*.9)**2))*.55,stone=Math.exp(-((Math.sin(a*.006+d*.009)*3.5)**2))*.85;
    const y=lerp(old,sea-Math.max(.08,dep-(ribs+tongue+stone)*envelope),w);
    grid.heights[k]=y;shelf.changedSamples++;shelf.maxShiftMetres=Math.max(shelf.maxShiftMetres,Math.abs(y-old));
    if(sea-y<14){grid.sand[k]=Math.round(w*255);grid.rock[k]*=1-w*.8;}
   }
  }grid.buildMinMax();
 }
 const west=shelves[0],edgeAt=z=>west.at((z-west.center[1])/west.tangent[1])[0];
 const sections=shelves.map(s=>({id:s.id,center:s.center,normal:s.normal,length:s.along*2,width:s.width,kind:s.kind,changedSamples:s.changedSamples,maxShiftMetres:s.maxShiftMetres,transects:[-s.along*.4,0,s.along*.4].map(a=>({along:a,samples:[0,20,60,120,210,320,450].map(d=>{const p=s.at(a,d);return{offshore:d,point:p,depth:sea-base(...p)};})}))}));
 return {id:'museum-three-shallow-shelves-v2',center:west.center,extent:[west.along*2,west.width],edgeAt,shelves,sections,changedSamples:shelves.reduce((a,s)=>a+s.changedSamples,0),maxShiftMetres:Math.max(...shelves.map(s=>s.maxShiftMetres)),physicalSurface:'same physical arrays for native terrain, normals, depth and navigation; dry shore preserved',extraSimulationPasses:0};
}
export const coveShadingWGSL=`
fn museumShelfWeight(p:vec3f,footprint:f32)->f32{
 // Connectivity is packed into an existing texture, distinct from inland
 // wetland/river beds even if those beds happen to lie below mean sea level.
 let marine=textureSampleLevel(museumFlora,smpLinearClamp,(p.xz+16384.0)/32768.0,max(0.0,log2(max(footprint,.001)/32.0))).r;
 return marine*(1.0-smoothstep(12.0,24.0,frame.seaLevel-p.y))*(1.0-smoothstep(3.0,8.0,p.y-frame.seaLevel));
}
fn museumCoveWeight(p:vec2f)->f32{
 var w=0.0;
 ${SHELF_DESIGNS.map(s=>{const n=s.normal,t=[-n[1],n[0]];return`{let q=p-vec2f(${s.center.map(v=>v.toFixed(6)).join(',')});let a=dot(q,vec2f(${t.map(v=>v.toFixed(1)).join(',')}));let d=dot(q,vec2f(${n.map(v=>v.toFixed(1)).join(',')}));w=max(w,(1.0-smoothstep(${(s.along*.72).toFixed(1)},${s.along.toFixed(1)},abs(a)))*(1.0-smoothstep(${(s.width*.74).toFixed(1)},${(s.width+180).toFixed(1)},abs(d-${(s.width*.32).toFixed(1)}))));}`;}).join('\n')}
 return w;
}
fn museumCovePatch(p:vec2f,footprint:f32,legacy:f32)->vec3f{
 if(legacy<.5){
  // Habitat scale is world-fixed and non-tiled. Fine sand remains a filtered
  // texture; it no longer decides where a dark meadow/reef occurs every17m.
  let warp=vec2f(perlin2(p/283.0+vec2f(9.1,31.7)),perlin2(p/337.0+vec2f(47.3,2.9)))*43.0;
  let q=p+warp;
  let wide=perlin2(q/173.0+vec2f(11.7,5.2));
  let middle=perlin2(mat2x2f(.764842,.644218,-.644218,.764842)*q/79.0+vec2f(17.9,63.1));
  let substrate=.5+wide*.48+middle*.20;
  let resolve=1.0-smoothstep(18.0,65.0,footprint);
  let meadow=mix(.13,smoothstep(.49,.68,substrate),resolve);
  let rubble=mix(.08,smoothstep(.55,.76,.5+wide*.30-middle*.38),resolve);
  return vec3f(meadow,rubble,clamp(.5+wide*.5,0.0,1.0));
 }
 let a=textureSampleLevel(terrainDetailTex,smpLinearRepeat,mat2x2f(.764842,.644218,-.644218,.764842)*p/61.0,max(0.0,log2(max(footprint,.001)*512.0/61.0))).w;
 let b=textureSampleLevel(terrainDetailTex,smpLinearRepeat,mat2x2f(-.504846,.863209,-.863209,-.504846)*p/17.0+a*.23,max(0.0,log2(max(footprint,.001)*512.0/17.0))).w;
 return vec3f(smoothstep(.53,.72,a*.6+b*.4),smoothstep(.51,.77,b),.5);
}`;
