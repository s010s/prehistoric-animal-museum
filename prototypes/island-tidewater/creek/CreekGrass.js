// Native blue-noise patches and actual 35/12/2 triangle LOD stay intact.
// Adapt only placement, shared ground appearance and museum habitat forms.
import {Float32BufferAttribute,InstancedBufferAttribute,DynamicDrawUsage,Vector2,Vector4} from '../vendor/tidewater/src/engine/index.js';
import {GrassField,CELL,FADE_T1,FADE_T2} from '../vendor/tidewater/src/world/vegetation/GrassField.js';
import {f,uGustOffset} from '../vendor/tidewater/src/world/vegetation/VegNodes.js';
import {srgb} from '../vendor/tidewater/src/world/terrain/TerrainShading.js';
import {GPU,StorageBuffer,ComputeKernel,readBuffer,G} from '../vendor/tidewater/src/engine/webgpu.js';
import {ShaderModule,UniformBlock} from '../vendor/tidewater/src/engine/gpu/Shader.js';
import {GrassRootCache} from './GrassRootCache.js';
import {strandGrowthLimits} from './StrandGrowth.js';

// Occupancy is only a conservative CPU acceleration structure. The real
// density texture and world-fixed probability remain in museumFloraAt.
function occupancyMask(data){
 const raw=data.grass,bytes=new Uint8Array(raw.data);
 for(let i=0;i<bytes.length;i++)if(bytes[i]>0&&bytes[i]<9)bytes[i]=9;
 const fine=data.masks,n=data.geography.maskRes,t=data.coverTerrain??data.terrain;
 for(let j=0;j<n;j++)for(let i=0;i<n;i++)if(fine[(j*n+i)*4+1]){
  const x=-512+(i+.5)*1024/n,z=-512+(j+.5)*1024/n;
  if(Math.max(Math.abs(x),Math.abs(z))>496)continue;
  const ci=Math.max(0,Math.min(raw.res-1,Math.floor((x-t.origin)/t.size*raw.res))),cj=Math.max(0,Math.min(raw.res-1,Math.floor((z-t.origin)/t.size*raw.res)));
  bytes[(cj*raw.res+ci)*4+1]=255;
 }
 return {res:raw.res,data:bytes};
}

export class CreekGrass extends GrassField {
 constructor({data,terrainGPU}){
  super({terrain:data.coverTerrain??data.terrain,mask:occupancyMask(data)});this.appearance=data.appearance;this.gpu=terrainGPU;this.coverData=data;
  const mat=this.material;mat.modules.push(data.appearance.module);delete mat.bindings.grassHeights;
  this.review=new UniformBlock('MuseumGrassReuseReview',{enabled:['f32',1]});
  mat.modules.push(new ShaderModule({name:'museumGrassReuseReview',uniforms:this.review}));
  this.crushers=new UniformBlock('MuseumGrassCrushers',{
   c0:['vec4f',new Vector4()],c1:['vec4f',new Vector4()],c2:['vec4f',new Vector4()],c3:['vec4f',new Vector4()],
   p0:['vec4f',new Vector4()],p1:['vec4f',new Vector4()],p2:['vec4f',new Vector4()],p3:['vec4f',new Vector4()],
  });
  this._crusherState=Array.from({length:4},()=>new Vector4());
  mat.modules.push(new ShaderModule({name:'museumGrassCrushers',uniforms:this.crushers,uniformName:'museumGrassCrushers',code:`
fn museumGrassCrush(xz:vec2f,ob:vec3f,c0:vec4f,c1:vec4f,c2:vec4f,c3:vec4f)->vec3f{
 let len=length(ob);
 if(len<1e-4){return ob;}
 var out=ob;
 let cs=array<vec4f,4>(c0,c1,c2,c3);
 for(var i=0;i<4;i++){
  let c=cs[i];
  if(c.w<=.01){continue;}
  let d=xz-c.xz;
  let d2=dot(d,d);
  if(d2>=c.w*c.w){continue;}
  let dist=sqrt(d2);
  let k=smoothstep(c.w,c.w*.25,dist);
  let dir=select(vec2f(1.0,0.0),d/dist,dist>1e-3);
  out.y*=1.0-k*.78;
  out.x+=dir.x*len*k*.68;
  out.z+=dir.y*len*k*.68;
 }
 return normalize(out+vec3f(0.0,1e-4,0.0))*len;
}
`}));
  this.previousWind=new UniformBlock('MuseumGrassPreviousWind',{
   gustOffset:['vec2f',new Vector2()],direction:['vec2f',new Vector2()],speed:['f32',0],time:['f32',0]
  });
  this.wind={gustOffset:new Vector2(),direction:new Vector2(),speed:0,time:undefined};
  mat.modules.push(new ShaderModule({name:'museumGrassMotion',uniforms:this.previousWind,uniformName:'museumGrassPreviousWind',code:`
fn museumGrassLOD(tier:f32,dist:f32,cut:f32,isGrass:bool)->vec2f{
 let own=vegGrassTierFade(tier,dist,cut);
 let f2=1.0-smoothstep(${FADE_T2.map(f).join(',')},dist);
 let f1=1.0-smoothstep(${FADE_T1.map(f).join(',')},dist);
 let comp=7.0/(f2*3.0+f1*2.0+2.0);
 return select(vec2f(own,1.0),vec2f(1.0,comp*own),isGrass);
}
fn museumGrassBend(rest:vec3f,windDir:vec2f,w:f32,g:f32,tm:f32,ph:f32,rootX:f32,bRnd:f32,flex:f32,dist:f32)->vec3f{
 let gustKeep=1.0-smoothstep(24.0,52.0,dist);
 let swayKeep=1.0-smoothstep(18.0,38.0,dist);
 let flutterKeep=1.0-smoothstep(13.0,26.0,dist);
 let bend=w*mix(.36,g*.55+.22,gustKeep)+sin(tm*1.9+ph+rootX*.2)*w*.1*swayKeep;
 let flutter=sin(tm*7.3+ph*3.0+bRnd*20.0)*(w*.06+.015)*flutterKeep;
 let restLength=length(rest);
 let displacement=(windDir*(bend*flex)+vec2f(-windDir.y,windDir.x)*(flutter*flex))*(restLength+1e-4);
 return normalize(rest+vec3f(displacement.x,1e-5,displacement.y))*restLength;
}
fn museumGrassGust(p:vec2f)->f32{
 let n=textureSampleLevel(vegDetail,smpLinearRepeat,p/140.0,0.0).w*.62
      +textureSampleLevel(vegDetail,smpLinearRepeat,p/61.0+.37,0.0).w*.38;
 return smoothstep(.46,.6,n);
}
`}));
  const change=(from,to)=>{if(!mat.vertex.includes(from))throw Error('Pinned grass adapter seam changed: '+from.slice(0,45));mat.vertex=mat.vertex.replace(from,to);};
  change('let xz = cell + slot.xy;',`let cellYaw=floor(vegHash12(cell*.137+vec2f(7.1,19.3))*4.0)*1.57079632679;
 let cs=cos(cellYaw);let sn=sin(cellYaw);let q=slot.xy-vec2f(4.0);
 let shift=vec2f(vegHash12(cell*.271+3.7),vegHash12(cell*.319+71.0))*8.0;
 let xz=cell+fract((vec2f(q.x*cs-q.y*sn,q.x*sn+q.y*cs)+4.0+shift)/8.0)*8.0;`);
  const maskStart=mat.vertex.indexOf('let m = textureSampleLevel( grassMask');
  const maskEnd=mat.vertex.indexOf('let isGrass',maskStart);
  if(maskStart<0||maskEnd<0)throw Error('Pinned flora mask seam changed');
  mat.vertex=mat.vertex.slice(0,maskStart)+'let flora=museumFloraSampleAt(xz,0.0);let m=flora.forms;let rootFloor=flora.rootFloor;\n\t'+mat.vertex.slice(maskEnd);delete mat.bindings.grassMask;
  change('let dune = m.r;','let dune=0.0;');
  // Every native template triangle has one slot and one kind. An absent plant
  // can collapse to one finite point before tone, ground, wind and prior pose.
  change('let present = select( 0.0, 1.0, r < density ) * flowerOk;',`let seedHead=isOat&&kind>1.5;
 let presenceDensity=density*select(1.0,m.r*.52,seedHead);
 let present=select(0.0,1.0,r<presenceDensity)*flowerOk;
 if(museumGrassReuseReview.enabled>.5&&present==0.0){
  let collapsed=vec3f(xz.x,0.0,xz.y);
  v.useWorld=true;v.worldPos=collapsed;v.prevWorldPos=collapsed;v.worldNormal=vec3f(0.0,1.0,0.0);
  return;
 }`);
  change('let dist = length( xz - vegParams.camPos.xz );',`let clumpHeight=terrainHeightAt(xz);
 let clump=vec3f(xz.x,clumpHeight,xz.y);
 let dist=distance(clump,vegParams.camPos);`);
  change('let cut = mix( 67.0, 87.0, cutK - floor( cutK ) );','let cut=mix(museumGrassDistance.fade.x+5.0,museumGrassDistance.fade.y,fract(cutK));');
  change('let flowerOk = select( 1.0, select( 0.0, 1.0, r2 < 0.35 ), kind > 3.5 );','let flowerOk = select(1.0,0.0,kind>3.5);');
  const toneStart=mat.vertex.indexOf('let mA = textureSampleLevel( vegDetail');
  const toneEnd=mat.vertex.indexOf('// size:',toneStart);
  if(toneStart<0||toneEnd<0)throw Error('Pinned shared meadow tone seam changed');
  mat.vertex=mat.vertex.slice(0,toneStart)+'let mt = museumMeadowAt(xz,0.0);\n\t'+mat.vertex.slice(toneEnd);
  const lodStart=mat.vertex.indexOf('let own = vegGrassTierFade');
  const lodEnd=mat.vertex.indexOf('// per-slot random yaw',lodStart);
  if(lodStart<0||lodEnd<0)throw Error('Pinned grass LOD seam changed');
  mat.vertex=mat.vertex.slice(0,lodStart)+`let lod=museumGrassLOD(tier,dist,cut,isGrass);
 let stand=vegNoise(xz*.012+vec2f(17.0,41.0));
 let waterField=creekFieldAt(xz);
 let marsh=(1.0-smoothstep(.78,1.26,length((xz-vec2f(5600.0,6050.0))/vec2f(2250.0,1500.0))))*(1.0-smoothstep(.5,2.2,clumpHeight-waterField.x));
 let wetBank=max(1.0-smoothstep(2.0,18.0,abs(waterField.y)),marsh);
 let tall=mix(.58,1.16,smoothstep(.42,.72,stand));
 let edgeHeight=select(1.0,mix(.38,1.0,smoothstep(.015,.30,density)),isGrass);
 let heightScale=select(mix(tall,1.25,wetBank)*mix(1.0,.6,museumCover(xz,0.0).a),.42,kind>=2.5);
 let habitatScale=heightScale*select(1.0,mix(.55,.78,m.r),isOat);
 // Smoothly settle mid-to-far grass height onto the terrain across 24-58m so
 // sub-pixel blades on shadowed banks never poke 0.8m out of CSM tree shadows
 // into sunlit space (causing 10x shadow-edge shimmer during camera motion).
 let distSettle=select(1.0,mix(1.0,.08,smoothstep(24.0,58.0,dist)),isGrass);
 let scale=hScale*present*lod.x*edgeHeight*habitatScale*distSettle;
 if(museumGrassReuseReview.enabled>.5&&isGrass&&(dist>66.0||scale<.02)){
  let collapsed=vec3f(xz.x,clumpHeight,xz.y);
  v.useWorld=true;v.worldPos=collapsed;v.prevWorldPos=collapsed;v.worldNormal=vec3f(0.0,1.0,0.0);
  return;
 }
 `+mat.vertex.slice(lodEnd);
  const groundStart=mat.vertex.indexOf('// terrain height (float texels');
  const groundEnd=mat.vertex.indexOf('let pl =',groundStart);
  if(groundStart<0||groundEnd<0)throw Error('Pinned grass ground seam changed');
  mat.vertex=mat.vertex.slice(0,groundStart)+`// Every blade uses its own root, sampled from the rendered fine/coarse terrain.
 let rootOffset=vec2f(v.aRoot.x*cy-v.aRoot.y*sy,v.aRoot.x*sy+v.aRoot.y*cy)*spread;
 let rootXZ=xz+rootOffset*scale;
 let ground=museumGrassGround(rootXZ);
 // A blade can lean toward the surf while its own root stays on dry sand.
 if(ground+.035<rootFloor){
  let collapsed=vec3f(xz.x,ground,xz.y);
  v.useWorld=true;v.worldPos=collapsed;v.prevWorldPos=collapsed;v.worldNormal=vec3f(0.0,1.0,0.0);
  return;
 }
 let base=vec3f(xz.x,ground,xz.y);
 `+mat.vertex.slice(groundEnd);
  const poseStart=mat.vertex.indexOf('let o0 =');
  const poseEnd=mat.vertex.indexOf('// lighting normal',poseStart);
  if(poseStart<0||poseEnd<0)throw Error('Pinned grass pose seam changed');
  mat.vertex=mat.vertex.slice(0,poseStart)+`let rest=vec3f(pl.x*cy-pl.z*sy,pl.y,pl.x*sy+pl.z*cy);
 let w=vegWindStrength();
 let g=vegGustAt(xz);
 let ph=r*6.2832;
 let stiff=select(select(.08,.8,isOat),1.0,isGrass);
 let flex=hf*hf*stiff;
 let ob=museumGrassCrush(xz,museumGrassBend(rest*scale,frame.windDir,w,g,frame.time,ph,xz.x,bRnd,flex,dist),museumGrassCrushers.c0,museumGrassCrushers.c1,museumGrassCrushers.c2,museumGrassCrushers.c3);
 let wScale=select(1.0,mix(1.5,1.55,duneF),isGrass);
 let wide=wScale*lod.y*min(scale*2.0,max(scale,.5));
 let sideR=vec3f(side.x*cy-side.z*sy,side.y,side.x*sy+side.z*cy);
 var pos=base+ob+sideR*wide;
 if(kind>=2.5){pos.y=terrainHeightAt(pos.xz)+max(ob.y-.004,.003);}
#if PASS_MAIN
 // Match the last rendered wind and the camera-dependent blade shape and
 // width through the tier fades.
 let oldDist=distance(clump,frame.prevCameraPos);
 let oldLOD=museumGrassLOD(tier,oldDist,cut,isGrass);
 let oldDistSettle=select(1.0,mix(1.0,.08,smoothstep(24.0,58.0,oldDist)),isGrass);
 let oldScale=hScale*present*oldLOD.x*edgeHeight*habitatScale*oldDistSettle;
 var oldGround=ground;
 if(oldScale!=scale){oldGround=museumGrassGround(xz+rootOffset*oldScale);}
 let oldG=museumGrassGust(xz-museumGrassPreviousWind.gustOffset);
 let oldW=max(museumGrassPreviousWind.speed*.1,.03);
 let oldOb=museumGrassCrush(xz,museumGrassBend(rest*oldScale,museumGrassPreviousWind.direction,oldW,oldG,museumGrassPreviousWind.time,ph,xz.x,bRnd,flex,oldDist),museumGrassCrushers.p0,museumGrassCrushers.p1,museumGrassCrushers.p2,museumGrassCrushers.p3);
 let oldWide=wScale*oldLOD.y*min(oldScale*2.0,max(oldScale,.5));
 var oldPos=vec3f(xz.x,oldGround,xz.y)+oldOb+sideR*oldWide;
 if(kind>=2.5){oldPos.y=terrainHeightAt(oldPos.xz)+max(oldOb.y-.004,.003);}
 v.prevWorldPos=oldPos;
#endif
 `+mat.vertex.slice(poseEnd);
  change('select( blade.w, 0.0, kind < 2.5 )','select(select(blade.w,m.r,kind<2.5),abs(across),isGrass)');
  mat.varyings.vVegGround='vec4f';
  change('v.useWorld = true;',`var vegGnd=vec4f(0.0,1.0,0.0,.86);
 if(isGrass&&dist>11.0){
  let gnd=terrainNormalRockLevel(xz,0.0);
  vegGnd=vec4f(normalize(vec3f(gnd.x,sqrt(max(1.0-dot(gnd.xy,gnd.xy),.0025)),gnd.y)),gnd.w);
 }
 o.vVegGround=vegGnd;
 v.useWorld = true;`);
  mat.attributes.aRoot='vec2f';
  for(const level of this.levels){
   const geometry=level.geometry,p=geometry.attributes.position,b=geometry.attributes.aBlade,roots=new Float32Array(p.count*2);let x=0,z=0;
   for(let i=0;i<p.count;i++){
    if(b.getX(i)===0){x=p.getX(i);z=p.getZ(i);}
    roots[i*2]=x;roots[i*2+1]=z;
   }
   geometry.setAttribute('aRoot',new Float32BufferAttribute(roots,2));
   // Native coastal spikelets have four vertices starting at the stalk
   // attachment. Tighten the outline without moving that anchor.
   for(let i=0;i<p.count;i++){
    if(b.getY(i)!==2)continue;
    const [x,y,z]=[p.getX(i),p.getY(i),p.getZ(i)];
    for(let j=i+1;j<i+4;j++){
     if(b.getY(j)!==2||b.getX(j)!==b.getX(i)||b.getZ(j)!==b.getZ(i))throw Error('Pinned coastal spikelet seam changed');
     p.setXYZ(j,x+(p.getX(j)-x)*.62,y+(p.getY(j)-y)*.62,z+(p.getZ(j)-z)*.62);
    }
    i+=3;
   }
  }
  this.capacity=[64,192,1280];this.overflowSeen=[0,0,0];this.rangeAudit={};
  for(let i=0;i<this.levels.length;i++){
   const l=this.levels[i];l.max=this.capacity[i];l.arr=new Float32Array(l.max*4);l.attr=new InstancedBufferAttribute(l.arr,4);l.attr.setUsage(DynamicDrawUsage);l.geometry.setAttribute('iCell',l.attr);l.candidates=[];
  }
  // Native wind preserves centre-line length. Bound every template vertex
  // with maximum size, spread and blade-width compensation, in every pose.
  let envelope=0;
  for(const level of this.levels){const g=level.geometry,p=g.attributes.position,b=g.attributes.aBlade,s=g.attributes.aSide;
   for(let i=0;i<p.count;i++){const kind=b.getY(i),grass=kind<.5,scale=grass?1.3*1.25*1.18*1.25:kind<2.5?1.55*1.25:1.2*.42,spread=grass?1.35:1;
    const line=Math.hypot(p.getX(i)*spread,p.getY(i),p.getZ(i)*spread)*scale;
    const side=Math.hypot(s.getX(i),s.getY(i),s.getZ(i))*scale*(grass?1.55*3.5:1);
    envelope=Math.max(envelope,line+side);
   }
  }
  this.envelope=Math.ceil((envelope+.1)*10)/10;this.legacyBounds=false;this.auditBounds=false;this.visible=true;
  // Roots displaced into a neighbour still use that neighbour's ground range.
  const n=this.cellsPerSide,t=data.coverTerrain??data.terrain;
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){
   const x=t.origin+i*CELL,z=t.origin+j*CELL,k=j*n+i;
   if(!this.cellFlags[k])continue;
   const [lo,hi]=t.boundsFor(x-this.envelope,z-this.envelope,x+CELL+this.envelope,z+CELL+this.envelope);this.cellMinY[k]=lo;this.cellMaxY[k]=hi;
  }
  mat.surface+=`
 // Each row carries the maximum across coordinate. Its interpolation gives
 // the narrowing tip's half-width in the same units as across. Convert that
 // width to pixels using the cross-blade gradient, including oblique views.
 let acrossStep=max(length(vec2f(dpdx(across),dpdy(across))),1e-4);
 let halfSpan=in.vs.vVegGrass2.y;
 let bladePixels=2.0*halfSpan/acrossStep;
 let fragDist=distance(in.P,frame.cameraPos);
 if(kind<.5){
  // Keep 0-16m foreground grass 100% pure 3D blades (where all 12 clump blades
  // are present) so swaying opaque triangles never camouflage into ground-shaded
  // jelly; once tier thinning stretches surviving blades at 16-40m, pre-filter
  // dark roots and dry-straw spikes smoothly using vertex-fetched terrain normals.
  let farCalm=smoothstep(16.0,38.0,fragDist);
  let resolved=smoothstep(.65,2.3,bladePixels)*(1.0-farCalm*.88);
  let lo=max(-halfSpan,across-acrossStep*.5);
  let hi=min(halfSpan,across+acrossStep*.5);
  let coverage=sat((hi-lo)/acrossStep);
  let bladeWeight=coverage*mix(mix(.40,.03,farCalm),1.0,resolved);
  if(bladeWeight<.999){
   let meadowTone=in.vs.vVegGrassTone.xyz;
   let density=in.vs.vVegGrass2.x;
   let spatialCover=smoothstep(.008,.36,density);
   let dryThatch=mix(meadowTone*.78,${srgb(.36,.34,.23)},.24);
   let base=mix(museumMeadowSoil(meadowTone),dryThatch,(1.0-spatialCover)*.50);
   let windTint=1.0+vec3f(.14,.12,.04)*in.vs.vVegGust*.48;
   let sward=mix(base,meadowTone*windTint,spatialCover);
   let calmAlbedo=sward*mix(.89,1.06,smoothstep(.08,.92,hf));
   let filteredBlade=mix(albedo,calmAlbedo,farCalm*.92);
   let gnd=in.vs.vVegGround;
   let normalKeep=bladeWeight*(1.0-smoothstep(16.0,46.0,fragDist));
   s.albedo=mix(sward,filteredBlade,bladeWeight);
   s.normal=normalize(mix(gnd.xyz,s.normal,normalKeep));
   s.ao=mix(mix(.72,1.0,gnd.w),s.ao,normalKeep);
   s.roughness=mix(.94,s.roughness,normalKeep);
   s.specularIntensity=mix(.22,s.specularIntensity,normalKeep);
   s.translucency*=normalKeep;
  }
 }
 if(kind>.5&&kind<2.5){
  let height=smoothstep(.06,.94,hf);
  let shoot=mix(${srgb(.18,.23,.12)},${srgb(.35,.42,.23)},height*(.67+rnd*.33));
  let dryStem=mix(shoot,${srgb(.41,.37,.23)},smoothstep(.53,.94,rnd)*height);
  let ripeHead=mix(${srgb(.34,.29,.18)},${srgb(.49,.43,.30)},rnd);
  let rawShoot=select(mix(shoot,dryStem,centre),ripeHead,kind>1.5);
  let shootFade=1.0-smoothstep(28.0,56.0,fragDist);
  s.albedo=mix(in.vs.vVegGrassTone.xyz*mix(.86,1.06,height),rawShoot,shootFade);
  s.normal=normalize(mix(vec3f(0.0,1.0,0.0),s.normal,shootFade));
  s.roughness=.91;
  s.specularIntensity=.12;
  s.translucency=s.albedo*(.10*height*shootFade);
 }
 if(kind>2.5&&kind<3.5){
  let leafAge=smoothstep(.45,.95,rnd);
  let olive=mix(tone*vec3f(.64,.68,.57),vec3f(.045,.042,.021),leafAge*.5);
  let midrib=pow(clamp(centre,0.0,1.0),5.0);
  s.albedo=olive*(.77+ao*.23)*(1.0+midrib*.12);
  s.roughness=.90;s.specularIntensity=.14;
  s.normal=normalize(normalize(in.vs.normal)+in.V*.12);
  s.translucency*=.28;
 }
`;
  this.rootCache=new GrassRootCache({appearance:this.appearance,levels:this.levels,material:mat});
  mat.needsUpdate=true;this.groundAudit=null;
 }
 update(camera){
  const wind=this.wind,previous=this.previousWind.fields;
  previous.gustOffset.value.copy(wind.time===undefined?uGustOffset.value:wind.gustOffset);
  previous.direction.value.copy(wind.time===undefined?G.windDir.value:wind.direction);
  previous.speed.value=wind.time===undefined?G.windSpeed.value:wind.speed;
  previous.time.value=wind.time??G.time.value;
  wind.gustOffset.copy(uGustOffset.value);
  wind.direction.copy(G.windDir.value);
  wind.speed=G.windSpeed.value;
  wind.time=G.time.value;
  const e=camera.matrixWorld.elements,pe=camera.projectionMatrix.elements,L=this._last;
  if(Math.abs(e[12]-L[0])<.05&&Math.abs(e[13]-L[1])<.05&&Math.abs(e[14]-L[2])<.05&&Math.abs(e[8]-L[3])<1e-3&&Math.abs(e[9]-L[4])<1e-3&&Math.abs(e[10]-L[5])<1e-3&&pe[0]===L[6]&&pe[5]===L[7]){this.rootCache.update(this.levels,{selectionUnchanged:true});return false;}
  L.set([e[12],e[13],e[14],e[8],e[9],e[10],pe[0],pe[5]]);
  this._mat.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);this._frustum.setFromProjectionMatrix(this._mat,camera.coordinateSystem,camera.reversedDepth);
  const cx=e[12],cy=e[13],cz=e[14],t=this.terrain,n=this.cellsPerSide,far=this.appearance.distance.radius;
  const i0=Math.max(0,Math.floor((cx-far-t.origin)/CELL)),i1=Math.min(n-1,Math.floor((cx+far-t.origin)/CELL));
  const j0=Math.max(0,Math.floor((cz-far-t.origin)/CELL)),j1=Math.min(n-1,Math.floor((cz+far-t.origin)/CELL));
  for(const l of this.levels)l.pending=0;
  let unsafeRejected=0;const rescued=[];
  for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
   const k=j*n+i;if(!this.cellFlags[k])continue;const x=t.origin+i*CELL,z=t.origin+j*CELL;
   const dx=Math.max(x-cx,0,cx-x-CELL),dz=Math.max(z-cz,0,cz-z-CELL),dy=Math.max(this.cellMinY[k]-.5-cy,0,cy-this.cellMaxY[k]-1.8),d=Math.hypot(dx,dy,dz);
   if(d>far)continue;
   const pad=this.envelope;this._box.min.set(x-pad,this.cellMinY[k]-.5,z-pad);this._box.max.set(x+CELL+pad,this.cellMaxY[k]+pad,z+CELL+pad);if(!this._frustum.intersectsBox(this._box))continue;
   if(this.auditBounds||this.legacyBounds){const [oldLo,oldHi]=t.boundsFor(x-1,z-1,x+CELL+1,z+CELL+1);this._box.min.set(x,oldLo-.5,z);this._box.max.set(x+CELL,oldHi+2.8,z+CELL);
    if(!this._frustum.intersectsBox(this._box)){unsafeRejected++;if(rescued.length<12)rescued.push([x,z]);if(this.legacyBounds)continue;}}
   const l=this.levels[d<18?0:d<46?1:2],c=l.candidates[l.pending]??(l.candidates[l.pending]={});c.x=x;c.z=z;c.d=d;l.pending++;
  }
  let extendedCells=0;const overflow=[];
  for(let tier=0;tier<3;tier++){
   const l=this.levels[tier],lost=Math.max(0,l.pending-l.max);overflow.push(lost);this.overflowSeen[tier]=Math.max(this.overflowSeen[tier],lost);
   const candidates=lost?l.candidates.slice(0,l.pending).sort((a,b)=>a.d-b.d||a.x-b.x||a.z-b.z):l.candidates;
   l.count=Math.min(l.pending,l.max);l.maxSelectedDistance=0;
   for(let i=0;i<l.count;i++){const c=candidates[i],o=i*4;l.arr[o]=c.x;l.arr[o+1]=c.z;l.arr[o+2]=0;l.arr[o+3]=0;l.maxSelectedDistance=Math.max(l.maxSelectedDistance,c.d);if(c.d>=88)extendedCells++;}
   l.geometry.instanceCount=l.count;l.attr.clearUpdateRanges();l.attr.addUpdateRange(0,Math.max(1,l.count)*4);l.attr.needsUpdate=true;
  }
  this.rangeAudit={eligible:this.levels.map(l=>l.pending),capacity:this.capacity,overflow,overflowSeen:this.overflowSeen.slice(),extendedCells,maxSelectedDistance:this.levels.map(l=>l.maxSelectedDistance),envelope:this.envelope,legacyBounds:this.legacyBounds,boundsAudit:this.auditBounds,unsafeRejected:this.auditBounds||this.legacyBounds?unsafeRejected:null,rescued,selection:'conservative plant-envelope frustum; 3D cell distance; closest first only on overflow'};
  this.rootCache.update(this.levels);
  return true;
 }
 setCrushers(list){
  const f=this.crushers.fields;
  for(let i=0;i<4;i++){
   f['p'+i].value.copy(this._crusherState[i]);
   const item=list[i];
   if(item)f['c'+i].value.set(item.x,item.y,item.z,item.r);
   else f['c'+i].value.set(0,0,0,0);
   this._crusherState[i].copy(f['c'+i].value);
  }
 }
 setFarRange(radius){this.appearance.distance.set(radius);this._last.fill(NaN);}
 setLegacyBounds(on){this.legacyBounds=!!on;this._last.fill(NaN);}
 setBoundsAudit(on){this.auditBounds=!!on;this._last.fill(NaN);}
 setVisible(on){this.visible=!!on;for(const m of this.meshes)m.visible=this.visible;}
 probeAt(x,z){
  const data=this.coverData,t=this.terrain,n=data.grass.res;
  const sample=(bytes,res,origin,size)=>{const fx=Math.max(0,Math.min(res-1,(x-origin)/size*res-.5)),fz=Math.max(0,Math.min(res-1,(z-origin)/size*res-.5)),i=Math.min(res-2,Math.floor(fx)),j=Math.min(res-2,Math.floor(fz)),a=fx-i,b=fz-j;const g=(i,j)=>bytes[(j*res+i)*4+1]/255;return (g(i,j)*(1-a)+g(i+1,j)*a)*(1-b)+(g(i,j+1)*(1-a)+g(i+1,j+1)*a)*b;};
  const coarse=sample(data.grass.data,n,t.origin,t.size),fine=sample(data.masks,data.geography.maskRes,-512,1024),edge=Math.max(Math.abs(x),Math.abs(z)),u=Math.max(0,Math.min(1,(edge-448)/48)),weight=1-u*u*(3-2*u);
  const k=Math.floor((z-t.origin)/CELL)*this.cellsPerSide+Math.floor((x-t.origin)/CELL),h=t.heightAt(x,z),water=data.field.sample(x,z),rise=Math.hypot(t.heightAt(x+1,z)-t.heightAt(x-1,z),t.heightAt(x,z+1)-t.heightAt(x,z-1))/2;
  const smooth=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
  const support=1-smooth(0,2.5,water[1]),legacy=this.appearance.review.fields.legacyWater.value,waterDry=1+(smooth(.08,.6,h-water[0])-1)*(support*(1-legacy)+legacy),density=coarse*(1-weight)+fine*weight;
  const beachReach=data.field.continuousSample?1-smooth(170,320,Math.hypot(x+875,z-125)):0;
  const beachWarp=Math.sin(x*.081+z*.023)*.70+Math.sin(z*.12-x*.047)*.35;
  const mouthOpenSand=beachReach*(1-smooth(11+beachWarp,19+beachWarp,h+.7));
  const coast=this.appearance.strand.sampleAt(x,z),aboveSea=h-data.island.seaLevel;
  const strand=coast.presence>0?{...coast,aboveSea,rootRise:[-1,1].map(pocket=>strandGrowthLimits(aboveSea,coast.exposure,pocket).low)}:null;
  return {point:[x,h,z],strand,coarseDensity:coarse,fineDensity:fine,fineWeight:weight,coverDensity:density,waterDry,effectiveWaterDensity:density*waterDry,mouthOpenSand,upperBoundAfterMouthSand:density*waterDry*(1-mouthOpenSand),water:{nearestLevel:water[0],signedEdge:water[1],support,contains:water[1]<=0,legacy},cpuOccupied:!!this.cellFlags[k],normalY:1/Math.sqrt(1+rise*rise),heightAboveWater:water[1]<=0?h-water[0]:null,scope:'CPU bilinear mask, signed-water and open-sand upper bound; GPU also applies dune pockets and wet-bank/grove suppression'};
 }
 async auditGround(){
  const pts=[[7690.312686253738,-2002.8799280156782],[8319.441878239979,-2633.1065592216073],[7486.592,-1873.309],[3600,-5280],[4170,-5280],[2850,-1950],[3520,-1950],...Array.from({length:25},(_,i)=>[-46+i*4,-60]),...Array.from({length:13},(_,i)=>[-170+i*8,80]),[460,0],[480,0],[496,0],[-460,80],[-480,80],[-496,80],[-849,-32],[-823,119],[-810,170],[-761,50],[-880,145],[-88,18],[-88,16],[-84,74],[-84,78],[-84,82],[-36,-60]];
  for(const p of this.coverData.field.continuousSample?.points.filter((_,i)=>i%37===0)??[]){const r=this.coverData.field.continuousSample.nearest(p.x,p.z);pts.push([p.x+r.dir[1]*(p.width+1),p.z-r.dir[0]*(p.width+1)]);}
  const strandPoints=[
   [10385.723,160.230],[5221.478,-7333.813], // reported wash
   [10347.76,164.47],[5197.27,-7308.60], // patchy lower backshore
   [10300,187],[5172,-7261], // dry grassland behind the strand
  ];
  const strandStart=pts.length;pts.push(...strandPoints);
  const input=new StorageBuffer({label:'Actual grass root audit points',count:pts.length,type:'vec4f',data:new Float32Array(pts.flatMap(p=>[...p,0,0]))});
  const output=new StorageBuffer({label:'Grass vs terrain root heights',count:pts.length,type:'vec4f'});
  const kernel=new ComputeKernel({label:'Museum grass startup integration audit',modules:[this.appearance.module],bindings:{grassAuditPoints:{storage:input,access:'read'},grassAuditHeights:{storage:output,access:'read_write'}},code:`
@compute @workgroup_size(WG_X,WG_Y,WG_Z)
fn main(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=${pts.length}u){return;}let p=grassAuditPoints[i].xy;let flora=museumFloraAt(p,0.0);
 let density=select(flora.g,max(flora.g,max(flora.b,flora.a)),i>=${strandStart}u);
 grassAuditHeights[i]=vec4f(museumGrassGround(p),terrainHeightAt(p),terrainHeightAtCoarse(p),density);}`});
  await GPU.pipelinesReady();GPU.beginFrame();kernel.dispatch(Math.ceil(pts.length/64));const values=new Float32Array(await readBuffer(output,pts.length*16));
  const rows=pts.map((p,i)=>{const a=Array.from(values.subarray(i*4,i*4+4));return {point:p,root:a[0],surface:a[1],oldCoarse:a[2],density:a[3],cpu:this.terrain.heightAt(...p),gap:a[0]-a[1],oldError:a[2]-a[1]};});input.destroy();output.destroy();
  const strand=rows.slice(strandStart);
  const strandPassed=strand.slice(0,2).every(p=>p.density===0)
   &&strand.slice(2,4).every((p,i)=>p.density>.01&&p.density<strand[i+4].density)
   &&strand.slice(4).every(p=>p.density>.035);
  const passed=rows.every(r=>Math.abs(r.surface-r.cpu)<.002&&Math.abs(r.gap+.035)<.002);
  if(!passed)throw Error('Shared grass/terrain root integration failed');
  return this.groundAudit={passed,strandPassed,phase:'startup-only; no timed readback',rows,maxOldError:Math.max(...rows.map(r=>Math.abs(r.oldError))),maxOldErrorInGrass:Math.max(...rows.filter(r=>r.density>.035).map(r=>Math.abs(r.oldError))),maxRootError:Math.max(...rows.map(r=>Math.abs(r.gap+.035)))};
 }
 stats(){return {visible:this.visible,envelope:this.envelope,cells:this.levels.map(x=>x.count),triangles:this.triangles,patchTriangles:this.patchTris,forms:this.appearance.counts,strandGrowth:this.appearance.strand.stats,range:this.appearance.distance.stats(),rangeAudit:this.rangeAudit,reuse:{enabled:this.review.fields.enabled.value>.5,condition:'absent plant or a root below the coastal wash limit collapses to a zero-area triangle'},handover:'shared 3D tier0/ground fade; native near/mid tiers, projected warped tussocks and surface-gradient relief',placement:'same terrainHeightAt as ground, per-blade roots; cell-dependent torus offsets/quarter turns',wind:'native envelope; world-fixed 0.52–1.25 grass heights and 0.42 low cover; template-derived conservative root/vertex envelope',groundAudit:this.groundAudit};}
}
