// Native wave propagation at native local detail, alongside the coarse island
// field. Both layers share ONE texture binding; no new simulation render pass.
import {computeShoreField} from '../vendor/tidewater/src/world/ShoreField.js';
import {Texture} from '../vendor/tidewater/src/engine/gpu/Texture.js';
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
function sample(f,x,z,out){
 const n=f.res,px=Math.max(0,Math.min(n-1.001,(x-f.origin)/f.size*n-.5)),pz=Math.max(0,Math.min(n-1.001,(z-f.origin)/f.size*n-.5)),i=Math.floor(px),j=Math.floor(pz),u=px-i,v=pz-j,k=(j*n+i)*4;
 const ids=[k,k+4,k+n*4,k+(n+1)*4],weights=[(1-u)*(1-v),u*(1-v),(1-u)*v,u*v];let total=0;
 out.fill(0);
 for(let j=0;j<4;j++){const q=ids[j],w=weights[j];if(f.data[q]>=10000||f.data[q+3]>=10000)continue;total+=w;for(let c=0;c<4;c++)out[c]+=f.data[q+c]*w;}
 if(total<1e-6){out[0]=out[3]=100000;out[1]=out[2]=0;}else for(let c=0;c<4;c++)out[c]/=total;
 return out;
}
export function refineCoveShoreField(gpu,terrain,field,cove){
 const n=field.res,start=performance.now();
 function localField(id,center,normal,size,res,anchorDistance){
  const local=computeShoreField({size,origin:-size/2,heightAt:(x,z)=>terrain.heightAt(x+center[0],z+center[1])},{res,swellDir:[1,0],seaLevel:-.7});
  // Arrival times and directions are the persistent CPU sampler. The
  // solver's scratch depth is already available from the shared terrain.
  delete local.depth;
  const anchor=[center[0]+normal[0]*anchorDistance,center[1]+normal[1]*anchorDistance];
  const coarse=sample(field,...anchor,[0,0,0,0]),fine=sample(local,anchor[0]-center[0],anchor[1]-center[1],[0,0,0,0]);
  const offset=coarse[0]-fine[0];
  if(!Number.isFinite(offset)||coarse[0]>=90000||fine[0]>=90000)throw Error('Invalid '+id+' wave phase anchor');
  for(let k=0;k<local.data.length;k+=4)for(const c of [0,3])if(local.data[k+c]<90000)local.data[k+c]+=offset;
  return {id,center,local,offset,xy:[0,0]};
 }
 const locals=cove.shelves.map((s,i)=>({...localField(s.id,s.center,s.normal,3072,n,1200),layer:i+1,fade:[1120,1450]}));
 const outlet={...localField('main-estuary',[-550,3600],[-1,0],1536,Math.min(384,n),684),fade:[490,725]};
 // The southern shelf atlas has an inland corner unreachable by either
 // propagation time. Reuse those empty texels for the 4 m tidal field.
 // If a future island opens this slope to the sea, give it its own layer.
 const host=locals.find(f=>f.id==='south-shelf'),ox=580,oz=12,side=outlet.local.res;
 let canPack=!!host&&ox+side+1<n&&oz+side+1<n;
 if(canPack)for(let z=oz-1;z<=oz+side&&canPack;z++)for(let x=ox-1;x<=ox+side;x++){
  const k=(z*n+x)*4;if(host.local.data[k]<10000||host.local.data[k+3]<10000){canPack=false;break;}
 }
 outlet.layer=canPack?host.layer:1+locals.length;
 if(canPack)outlet.xy=[ox,oz];
 const layers=1+locals.length+(canPack?0:1);
 const bytes=new Float32Array(field.data.length*layers);bytes.set(field.data);
 locals.forEach(f=>bytes.set(f.local.data,field.data.length*f.layer));
 const [tx,tz]=outlet.xy;
 for(let j=0;j<side;j++)bytes.set(outlet.local.data.subarray(j*side*4,(j+1)*side*4),field.data.length*outlet.layer+((tz+j)*n+tx)*4);
 locals.push(outlet);
 const old=gpu.shoreTexture;gpu.shoreTexture=new Texture({label:'Island and coastal wave propagation',width:n,height:n,depth:layers,dimension:'2d-array',format:'rgba32float',data:bytes,usage:['sample','copyDst']});gpu.shoreTexture.getGPU();old.destroy();
 const oldFn=/fn terrainShoreSample\([\s\S]*?\n}/;
 if(!oldFn.test(gpu.module.code))throw Error('Pinned native wave field seam changed');
 gpu.module.code=gpu.module.code.replace(oldFn,`
fn museumShoreLayer(xz:vec2f,c:vec2f,size:f32,res:f32,layer:i32,offset:vec2i)->vec4f{
 let f=clamp((xz-c+size*.5)/size*res-.5,vec2f(0.0),vec2f(res-1.001));let q=vec2i(floor(f))+offset;let t=fract(f);
 ${canPack?`if(layer==${host.layer}&&offset.x==0&&all(q>=vec2i(${ox-1},${oz-1}))&&all(q<vec2i(${ox+side},${oz+side}))){return vec4f(100000.0,0.0,0.0,100000.0);}`:''}
 let a=textureLoad(terrainShoreTex,q,layer,0);let b=textureLoad(terrainShoreTex,q+vec2i(1,0),layer,0);let c0=textureLoad(terrainShoreTex,q+vec2i(0,1),layer,0);let d=textureLoad(terrainShoreTex,q+vec2i(1,1),layer,0);
 let ok=vec4f(select(0.0,1.0,a.x<10000.0&&a.w<10000.0),select(0.0,1.0,b.x<10000.0&&b.w<10000.0),select(0.0,1.0,c0.x<10000.0&&c0.w<10000.0),select(0.0,1.0,d.x<10000.0&&d.w<10000.0));
 if(all(ok>vec4f(.5))){return mix(mix(a,b,t.x),mix(c0,d,t.x),t.y);}
 let w=vec4f((1.0-t.x)*(1.0-t.y),t.x*(1.0-t.y),(1.0-t.x)*t.y,t.x*t.y)*ok;let total=dot(w,vec4f(1.0));
 if(total<1e-6){return vec4f(100000.0,0.0,0.0,100000.0);}return (a*w.x+b*w.y+c0*w.z+d*w.w)/total;
}
fn terrainShoreSample(p:vec2f)->vec4f{
 var coarse=museumShoreLayer(p,vec2f(0.0),32768.0,terrainParams.shoreRes,0,vec2i(0));
 ${locals.map(f=>`{
 let c=vec2f(${f.center.map(x=>x.toFixed(7)).join(',')});let w=1.0-smoothstep(${f.fade[0]}.0,${f.fade[1]}.0,max(abs(p.x-c.x),abs(p.y-c.y)));
 if(w>0.0){let fine=museumShoreLayer(p,c,${f.local.size}.0,${f.local.res}.0,${f.layer},vec2i(${f.xy}));if(fine.x<10000.0&&fine.w<10000.0){if(coarse.x>=10000.0||coarse.w>=10000.0){coarse=fine;}else{coarse=mix(coarse,fine,w);}}}
 }`).join('\n')}
 return coarse;
}`);
 const b=[0,0,0,0];
 field.sampleAt=(x,z,out=[0,0,0,0])=>{sample(field,x,z,out);for(const f of locals){const w=1-smooth(...f.fade,Math.max(Math.abs(x-f.center[0]),Math.abs(z-f.center[1])));if(w<=0)continue;sample(f.local,x-f.center[0],z-f.center[1],b);if(b[0]>=10000||b[3]>=10000)continue;const valid=out[0]<10000&&out[3]<10000;for(let i=0;i<4;i++)out[i]=valid?out[i]*(1-w)+b[i]*w:b[i];}return out;};
 field.localCove={center:cove.center,size:3072,res:n,texelMetres:3072/n,fields:locals.map(f=>({id:f.id,center:f.center,offsetSeconds:f.offset,texelMetres:f.local.cellSize})),extraBytes:(layers-1)*field.data.byteLength,buildMs:performance.now()-start,sampleBindingCountUnchanged:true,extraFramePasses:0};
 return gpu;
}

// Native ShoreSim asks ShoreWaves for a small per-pixel direction texture.
// Preserve its texture/uniform setup, then fill it from our SAME hybrid field.
export function useHybridShoreDirection(shore,field){
 const nativeBuild=shore.buildDirTexture.bind(shore);
 shore.buildDirTexture=options=>{const texture=nativeBuild(options);if(!texture||!field.sampleAt)return texture;
  const {min,size}=options,res=shore.dirRes,out=new Float32Array(res*res*4),v=[0,0,0,0];
  for(let j=0;j<res;j++)for(let i=0;i<res;i++){field.sampleAt(min.x+(i+.5)/res*size,min.y+(j+.5)/res*size,v);const e=Math.hypot(v[1],v[2])||1e-4,k=(j*res+i)*4;out.set([v[1]/e,v[2]/e,Math.min(1,e*1.4),1],k);}
  texture.upload(out);field.localCove.directionLookup='native 128² layout from same hybrid CPU field';return texture;
 };
}
